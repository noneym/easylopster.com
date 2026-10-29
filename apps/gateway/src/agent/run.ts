import { generateText, stepCountIs, streamText, type ModelMessage, type ToolSet } from "ai";
import { db, type Bot, type Conversation, type ProviderKey } from "@easylopster/db";
import { BOOTSTRAP_FILES } from "@easylopster/shared";
import { resolveModel } from "./providers.ts";
import { buildRuntimeContext, buildSystemPrompt } from "./prompt.ts";
import { builtinTools } from "./tools.ts";
import { Workspace } from "../workspace/fs.ts";
import { loadHistory, maybeCompact, saveMessage, SUMMARIZE_INSTRUCTIONS } from "./session.ts";
import { contextWindowFor, isContextLengthError, type ModelsMeta } from "@easylopster/shared/context";
import { recordUsage } from "./usage.ts";
import { redis } from "../redis.ts";
import { abortKey } from "./pubsub.ts";
import { mcpToolsForBot } from "./mcp.ts";
import { sandboxTools } from "../sandbox/tool.ts";
import { sandboxAvailable } from "../sandbox/docker.ts";
import { nodeToolsForBot } from "./node-tools.ts";
import type { ApprovalChannel } from "./approvals.ts";
import type { NodeServer } from "../nodes/server.ts";
import { loadSkills, skillsCatalog, skillTools } from "./skills.ts";
import { memoryFlush, memoryRecall, memoryTools } from "./memory.ts";
import { loadBotSecrets, secretsTools } from "./secrets.ts";
import { secretsSetupTools, setupTools } from "./setup-tools.ts";
import { namesiloTools } from "./namesilo.ts";
import { automationsTools } from "./automations.ts";
import { firedIntents, intentTools } from "./intents.ts";
import { subagentTools, SUBAGENT_TASK_LABEL } from "./subagent.ts";
import { webSearchTools } from "./web-search.ts";
import { extractMedia } from "../telegram/media.ts";
import { getOrCreateConversation } from "./session.ts";

/** Live progress of one tool call, for the "what is the bot doing" status in chats. */
export interface ToolProgress {
  id: string;
  name: string;
  status: "start" | "end";
  /** Short human summary of the arguments (URL, command, path…). */
  preview?: string;
  ms?: number;
  ok?: boolean;
}

const PREVIEW_BARE = new Set(["url", "command", "cmd", "path", "query", "task"]);
const PREVIEW_KEYS = ["url", "command", "cmd", "path", "query", "task", "text", "target", "selector", "name", "action", "prompt", "message", "to", "subject", "q"];
/** One-line argument summary for status lines; never the full payload (it may be long or sensitive). */
export function toolPreview(input: unknown): string | undefined {
  if (!input || typeof input !== "object") return typeof input === "string" ? input.slice(0, 60) : undefined;
  const obj = input as Record<string, unknown>;
  const parts: string[] = [];
  for (const k of PREVIEW_KEYS) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) parts.push(PREVIEW_BARE.has(k) ? v.trim() : `${k}=${v.trim()}`);
    else if (typeof v === "number" || typeof v === "boolean") parts.push(`${k}=${v}`);
    if (parts.length >= 2) break;
  }
  const s = (parts.length ? parts.join(" ") : JSON.stringify(obj)).replace(/\s+/g, " ");
  if (!s || s === "{}") return undefined;
  return s.length > 70 ? `${s.slice(0, 69)}…` : s;
}

export interface RunInput {
  bot: Bot & { providerKey: ProviderKey | null; user: { id: string; timezone: string } };
  conversation: Conversation;
  channel: "telegram" | "web";
  chatType: "direct" | "group";
  /** Already-formatted user text (envelope included for Telegram). */
  userText: string;
  /** Plain text stored as the message body. */
  storedText: string;
  senderTgId?: string;
  senderName?: string;
  tgMessageId?: string;
  extraTools?: ToolSet;
  nodes?: NodeServer;
  approvalChannel?: ApprovalChannel;
  onDelta?: (fullText: string) => void;
  onTool?: (ev: ToolProgress) => void;
  /** Inbound images (vision) */
  images?: { data: Buffer; mimeType: string }[];
  /** Extra runtime-context lines */
  extraContext?: string[];
  /** Subagent nesting depth (0 = top level) */
  depth?: number;
  /** Continuation turn: the user text is a runtime nudge, not stored as a message. */
  ephemeralUser?: boolean;
  /** How many automatic continuations already happened for this user turn. */
  continuation?: number;
  /** Set on the retry after an automatic compaction (context-length error). */
  retriedAfterCompact?: boolean;
}

export interface RunOutput {
  text: string;
  /** MEDIA: paths/urls the model asked to attach */
  media: string[];
  silent: boolean;
  messageId: string;
  tokensIn: number;
  tokensOut: number;
  toolCalls: number;
  /** The step budget ended the run while the model still wanted to call tools. */
  cutOff: boolean;
  /** Context gauge: input tokens of the last call vs the model's window. */
  context: { used: number; window: number };
}

/** Tool-call steps per model turn (OpenClaw-sized budget); env MAX_STEPS overrides. */
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 40);
/** Whole-run ceiling so a hung provider never pins a worker slot. */
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS ?? 600_000);
/** Automatic "keep going" turns after a cut-off, so long tasks are not left half done. */
const MAX_CONTINUATIONS = Number(process.env.MAX_CONTINUATIONS ?? 2);
const CONTINUE_PROMPT =
  "[easylopster] Your previous turn was cut off by the per-turn tool budget before the task was finished. Continue the same task from exactly where you stopped: do not restart, do not repeat completed steps, do not re-explain. When the task is done, give the final result; if you are blocked, say what blocks you.";

export function isSilent(text: string) {
  return /^\s*NO_REPLY[.!]?\s*$/i.test(text);
}

/** Strips leading/trailing NO_REPLY lines (OpenClaw semantics) and inline reply tags we do not render. */
export function cleanFinalText(text: string): string {
  let t = text.replace(/^\s*NO_REPLY[.!]?\s*\n/i, "").replace(/\n\s*NO_REPLY[.!]?\s*$/i, "");
  t = t.replace(/\[\[\s*(reply_to_current|reply_to\s*:[^\]]*|audio_as_voice)\s*\]\]/gi, "");
  return t.trim();
}

export async function runAgent(input: RunInput): Promise<RunOutput> {
  const { bot, conversation } = input;
  if (!bot.providerKey) throw new Error("This bot has no API key assigned. Add one in the dashboard.");
  const modelId = conversation.modelOverride || bot.model || bot.providerKey.defaultModel;
  const resolved = resolveModel(bot.providerKey, modelId, conversation.thinkingOverride ?? bot.thinking);
  const contextWindow = contextWindowFor(modelId, bot.providerKey.modelsMeta as ModelsMeta | null).tokens;
  const depth = input.depth ?? 0;
  const timezone = bot.user.timezone || "UTC";

  const ws = new Workspace(bot.userId, bot.id);
  await ws.ensure();

  // Bootstrap files: SOUL.md / USER.md from the dashboard, MEMORY.md + recent daily notes from the workspace.
  const bootstrap: [string, string][] = [];
  const bootstrapMd = await ws.readOptional("BOOTSTRAP.md");
  if (bootstrapMd) bootstrap.push(["BOOTSTRAP.md", bootstrapMd]);
  // Workspace files win (the agent can edit them); the dashboard columns are the fallback/mirror.
  const soul = (await ws.readOptional("SOUL.md")) ?? bot.systemPrompt;
  if (soul) bootstrap.push(["SOUL.md", soul]);
  const userMd = (await ws.readOptional("USER.md")) ?? bot.userProfile;
  if (userMd) bootstrap.push(["USER.md", userMd]);
  const memory = await ws.readOptional("MEMORY.md");
  if (memory) bootstrap.push(["MEMORY.md", memory]);
  const now = new Date();
  const recentNotes: string[] = [];
  for (const daysAgo of [0, 1]) {
    const d = new Date(now.getTime() - daysAgo * 86_400_000);
    const note = await ws.readOptional(ws.dailyMemoryPath(d, timezone));
    if (note) recentNotes.push(`### ${ws.dailyMemoryPath(d, timezone)}\n${note.slice(0, 1200)}`);
  }
  if (recentNotes.length) bootstrap.push(["memory (recent)", recentNotes.join("\n\n")]);
  for (const name of BOOTSTRAP_FILES) {
    if (name === "AGENTS.md" || name === "IDENTITY.md" || name === "TOOLS.md") {
      const extra = await ws.readOptional(name);
      if (extra) bootstrap.push([name, extra]);
    }
  }

  const mcp = await mcpToolsForBot(bot.id);
  const policy = (bot.toolPolicy ?? {}) as { exec?: string };
  const secrets = await loadBotSecrets(bot.id);
  const execTools = policy.exec === "sandbox" && sandboxAvailable() ? sandboxTools(bot.userId, bot.id, secrets.env) : {};
  const skills = await loadSkills(ws);
  const nodeTools = input.nodes ? await nodeToolsForBot({ botId: bot.id, conversationId: conversation.id, nodes: input.nodes, channel: input.approvalChannel, env: secrets.env, workspace: ws }) : { tools: {}, summary: [] };
  const tools: ToolSet = {
    ...builtinTools({ ws, botId: bot.id, timezone, now: () => new Date() }),
    ...memoryTools(ws, bot.userId),
    ...skillTools(ws, skills),
    ...(depth === 0 ? secretsSetupTools({ botId: bot.id, userId: bot.userId, conversationId: conversation.id }, secrets.meta) : secrets.meta.length ? secretsTools(secrets) : {}),
    ...(depth === 0 ? setupTools({ botId: bot.id, userId: bot.userId, conversationId: conversation.id }) : {}),
    ...automationsTools(bot.id, timezone),
    ...intentTools(bot.id, conversation.id),
    ...webSearchTools(),
    ...(secrets.env.NAMESILO_API_KEY ? namesiloTools(secrets.env.NAMESILO_API_KEY) : {}),
    ...(depth === 0
      ? subagentTools(async (req) => {
          const sub = await getOrCreateConversation(bot.id, `sub:${bot.id}:${Date.now().toString(36)}`, "web", { title: `Subagent: ${req.label ?? req.task.slice(0, 40)}` });
          const forkContext = req.context === "fork" ? ["## Parent conversation (recent)", ...(await loadHistory(conversation)).slice(-12).map((h) => `${h.role}: ${typeof h.content === "string" ? h.content.slice(0, 600) : "[parts]"}`)] : [];
          const started = Date.now();
          const r = await runAgent({ ...input, conversation: sub, userText: `${SUBAGENT_TASK_LABEL}\n${req.task}`, storedText: req.task, senderName: "parent", images: undefined, onDelta: undefined, onTool: undefined, extraContext: forkContext, depth: depth + 1 });
          return { text: r.text, toolCalls: r.toolCalls, durationMs: Date.now() - started };
        })
      : {}),
    ...execTools,
    ...mcp.tools,
    ...nodeTools.tools,
    ...(input.extraTools ?? {}),
  };
  console.log(`[run] ${new Date().toISOString()} bot=${bot.id} tools=${Object.keys(tools).join(",")}${mcp.errors.length ? ` mcpErrors=${JSON.stringify(mcp.errors)}` : ""}`);

  const system = buildSystemPrompt({
    agentName: bot.agentName || bot.name,
    modelIdentity: resolved.identity,
    channel: input.channel,
    chatType: input.chatType,
    requireMention: bot.requireMention,
    workspaceDir: "/workspace",
    sandbox: Object.keys(execTools).length > 0,
    nodes: nodeTools.summary,
    skillsCatalog: skillsCatalog(skills, "/workspace"),
    secretNames: secrets.meta.map((m) => m.name),
    bootstrap,
    bootstrapPending: !!bootstrapMd,
    toolNames: Object.keys(tools),
    mcpInstructions: mcp.instructions,
    timezone,
  });

  const history = await loadHistory(conversation, contextWindow);
  const messages: ModelMessage[] = [
    ...history,
    {
      role: "user",
      content: buildRuntimeContext({
        now,
        timezone,
        extra: [
          ...(mcp.errors.length ? ["## MCP", ...mcp.errors.map((e) => `Unavailable this turn: ${e}`)] : []),
          ...(nodeTools.summary.length ? ["## Nodes", ...nodeTools.summary] : []),
          ...(await memoryRecall(ws, input.storedText, bot.userId)),
          ...(await firedIntents(bot.id, conversation.id, input.storedText)),
          ...(input.extraContext ?? []),
        ],
      }),
    },
    { role: "assistant", content: "Noted." },
    input.images?.length
      ? { role: "user", content: [{ type: "text", text: input.userText }, ...input.images.map((im) => ({ type: "image" as const, image: im.data, mediaType: im.mimeType }))] }
      : { role: "user", content: input.userText },
  ];

  const userRow = input.ephemeralUser
    ? null
    : await saveMessage(conversation.id, {
        role: "user",
        content: { text: input.storedText },
        text: input.storedText,
        senderTgId: input.senderTgId,
        senderName: input.senderName,
        tgMessageId: input.tgMessageId,
      });

  const started = Date.now();
  const abortCtrl = new AbortController();
  let timedOut = false;
  const runTimer = setTimeout(() => {
    timedOut = true;
    abortCtrl.abort();
  }, RUN_TIMEOUT_MS);
  const abortPoll = setInterval(async () => {
    if (await redis().get(abortKey(conversation.sessionKey))) {
      await redis().del(abortKey(conversation.sessionKey));
      abortCtrl.abort();
    }
  }, 1000);

  let text = "";
  let toolCalls = 0;
  const toolStarted = new Map<string, { name: string; at: number; preview?: string }>();
  let tokensIn = 0;
  let tokensOut = 0;
  let error: string | undefined;
  let cutOff = false;
  let lastStepInputTokens = 0;

  try {
    const result = streamText({
      model: resolved.model,
      system,
      messages,
      tools,
      stopWhen: stepCountIs(MAX_STEPS),
      providerOptions: resolved.providerOptions as never,
      temperature: bot.temperature ?? undefined,
      abortSignal: abortCtrl.signal,
      maxRetries: 2,
    });

    for await (const part of result.fullStream) {
      const p = part as { type: string; text?: string; delta?: string; toolName?: string; error?: unknown };
      switch (p.type) {
        case "text-delta":
          text += p.text ?? p.delta ?? "";
          input.onDelta?.(text);
          break;
        case "tool-call": {
          toolCalls++;
          const name = p.toolName ?? "tool";
          const id = (p as { toolCallId?: string }).toolCallId ?? `${name}#${toolCalls}`;
          const preview = toolPreview((p as { input?: unknown }).input);
          toolStarted.set(id, { name, at: Date.now(), preview });
          input.onTool?.({ id, name, status: "start", preview });
          break;
        }
        case "tool-result":
        case "tool-error": {
          const name = p.toolName ?? "tool";
          const id = (p as { toolCallId?: string }).toolCallId ?? name;
          const started = toolStarted.get(id);
          const ms = Date.now() - (started?.at ?? Date.now());
          const output = (p as { output?: unknown }).output;
          const ok = p.type === "tool-result" && !(output && typeof output === "object" && "error" in (output as object) && (output as { error?: unknown }).error);
          const out = JSON.stringify(p.type === "tool-error" ? String(p.error) : (output ?? "")).slice(0, 160);
          console.log(`[run] ${new Date().toISOString()} bot=${bot.id} tool=${name} ${ms}ms${ok ? "" : " FAILED"} -> ${out}`);
          input.onTool?.({ id, name, status: "end", preview: started?.preview, ms, ok });
          break;
        }
        case "error":
          error = p.error instanceof Error ? p.error.message : String(p.error);
          break;
      }
    }
    const usage = await Promise.resolve(result.totalUsage).catch(() => null);
    tokensIn = usage?.inputTokens ?? 0;
    tokensOut = usage?.outputTokens ?? 0;
    const steps = await Promise.resolve(result.steps).catch(() => []);
    lastStepInputTokens = steps[steps.length - 1]?.usage?.inputTokens ?? 0;
    cutOff = steps.length >= MAX_STEPS && steps[steps.length - 1]?.finishReason === "tool-calls";
    console.log(`[run] ${new Date().toISOString()} bot=${bot.id} steps=${steps.length} finish=${steps[steps.length - 1]?.finishReason ?? "?"} cutOff=${cutOff} continuation=${input.continuation ?? 0} textChars=${text.length}`);
  } catch (err) {
    if (timedOut) {
      error = `The model did not answer within ${Math.round(RUN_TIMEOUT_MS / 1000)} seconds (${resolved.identity}).`;
    } else if (abortCtrl.signal.aborted) {
      error = "stopped";
    } else {
      error = err instanceof Error ? err.message : String(err);
    }
  } finally {
    clearInterval(abortPoll);
    clearTimeout(runTimer);
  }

  if (error && error !== "stopped" && !text.trim()) {
    // Context overflow: fold the history into the summary and run the same turn once more.
    if (isContextLengthError(error) && !input.retriedAfterCompact) {
      console.log(`[run] ${new Date().toISOString()} bot=${bot.id} context length exceeded (${contextWindow} window); compacting and retrying`);
      if (userRow) await db.message.delete({ where: { id: userRow.id } }).catch(() => {});
      await maybeCompact(
        conversation,
        async (transcript) => (await generateText({ model: resolved.model, system: SUMMARIZE_INSTRUCTIONS, prompt: transcript.slice(0, 120_000), maxRetries: 1 })).text,
        true,
        contextWindow,
      ).catch(() => {});
      return runAgent({ ...input, retriedAfterCompact: true });
    }
    if (userRow) await db.message.update({ where: { id: userRow.id }, data: { error: error.slice(0, 1000) } });
    throw new Error(error);
  }

  const silent = isSilent(text);
  const extracted = silent ? { text: "", media: [] } : extractMedia(cleanFinalText(text));
  const finalText = silent ? "" : extracted.text || (extracted.media.length ? "" : error === "stopped" ? "(stopped)" : "");
  const assistantRow = await saveMessage(conversation.id, {
    role: "assistant",
    content: { text: finalText, silent, media: extracted.media },
    text: finalText,
    model: resolved.identity,
    tokensIn,
    tokensOut,
    durationMs: Date.now() - started,
    error: error?.slice(0, 1000),
  });

  await recordUsage(bot.userId, bot.id, { messages: 1, tokensIn, tokensOut, toolCalls });
  // Context gauge for /status and the web chat header: the last call's input size is the live "used" value.
  const lastInput = lastStepInputTokens || tokensIn;
  await db.conversation.update({ where: { id: conversation.id }, data: { lastInputTokens: lastInput, contextWindow } }).catch(() => {});

  // Fire-and-forget compaction with the same model; durable notes are flushed to memory first (OpenClaw pre-compaction flush).
  void maybeCompact(
    conversation,
    async (transcript) => {
      await memoryFlush(ws, resolved.model, transcript, timezone).catch(() => false);
      const r = await generateText({ model: resolved.model, system: SUMMARIZE_INSTRUCTIONS, prompt: transcript, maxRetries: 1 });
      return r.text;
    },
    false,
    contextWindow,
  ).catch(() => {});

  const context = { used: lastInput, window: contextWindow };
  const out: RunOutput = { text: finalText, media: extracted.media, silent: silent || (!finalText && extracted.media.length === 0), messageId: assistantRow.id, tokensIn, tokensOut, toolCalls, cutOff, context };

  // Cut off mid-task: keep going in a continuation turn (the partial reply is already saved as history).
  const continuation = input.continuation ?? 0;
  if (cutOff && !error && continuation < MAX_CONTINUATIONS) {
    console.log(`[run] ${new Date().toISOString()} bot=${bot.id} cut off after ${MAX_STEPS} steps; continuation ${continuation + 1}/${MAX_CONTINUATIONS}`);
    const prefix = finalText ? `${finalText}\n\n` : "";
    const next = await runAgent({
      ...input,
      userText: CONTINUE_PROMPT,
      storedText: "",
      images: undefined,
      ephemeralUser: true,
      continuation: continuation + 1,
      onDelta: input.onDelta ? (t) => input.onDelta!(prefix + t) : undefined,
    });
    return {
      text: [finalText, next.text].filter(Boolean).join("\n\n"),
      media: [...extracted.media, ...next.media],
      silent: out.silent && next.silent,
      messageId: next.messageId,
      tokensIn: tokensIn + next.tokensIn,
      tokensOut: tokensOut + next.tokensOut,
      toolCalls: toolCalls + next.toolCalls,
      cutOff: next.cutOff,
      context: next.context,
    };
  }
  return out;
}
