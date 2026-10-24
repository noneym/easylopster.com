import { generateText, stepCountIs, streamText, type ModelMessage, type ToolSet } from "ai";
import { db, type Bot, type Conversation, type ProviderKey } from "@easylopster/db";
import { BOOTSTRAP_FILES } from "@easylopster/shared";
import { resolveModel } from "./providers.ts";
import { buildRuntimeContext, buildSystemPrompt } from "./prompt.ts";
import { builtinTools } from "./tools.ts";
import { Workspace } from "../workspace/fs.ts";
import { loadHistory, maybeCompact, saveMessage, SUMMARIZE_INSTRUCTIONS } from "./session.ts";
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
import { automationsTools } from "./automations.ts";
import { firedIntents, intentTools } from "./intents.ts";
import { subagentTools, SUBAGENT_TASK_LABEL } from "./subagent.ts";
import { webSearchTools } from "./web-search.ts";
import { extractMedia } from "../telegram/media.ts";
import { getOrCreateConversation } from "./session.ts";

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
  onTool?: (name: string, status: "start" | "end") => void;
  /** Inbound images (vision) */
  images?: { data: Buffer; mimeType: string }[];
  /** Extra runtime-context lines */
  extraContext?: string[];
  /** Subagent nesting depth (0 = top level) */
  depth?: number;
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
}

const MAX_STEPS = 12;
/** Whole-run ceiling so a hung provider never pins a worker slot. */
const RUN_TIMEOUT_MS = Number(process.env.RUN_TIMEOUT_MS ?? 180_000);

export function isSilent(text: string) {
  return text.trim().toUpperCase() === "NO_REPLY";
}

/** Strips a leading NO_REPLY line (OpenClaw semantics) and inline reply tags we do not render. */
export function cleanFinalText(text: string): string {
  let t = text.replace(/^\s*NO_REPLY\s*\n/, "");
  t = t.replace(/\[\[\s*(reply_to_current|reply_to\s*:[^\]]*|audio_as_voice)\s*\]\]/gi, "");
  return t.trim();
}

export async function runAgent(input: RunInput): Promise<RunOutput> {
  const { bot, conversation } = input;
  if (!bot.providerKey) throw new Error("This bot has no API key assigned. Add one in the dashboard.");
  const modelId = conversation.modelOverride || bot.model || bot.providerKey.defaultModel;
  const resolved = resolveModel(bot.providerKey, modelId, conversation.thinkingOverride ?? bot.thinking);
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
    if (name === "AGENTS.md" || name === "IDENTITY.md") {
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

  const history = await loadHistory(conversation);
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

  const userRow = await saveMessage(conversation.id, {
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
  const toolStarted = new Map<string, number>();
  let tokensIn = 0;
  let tokensOut = 0;
  let error: string | undefined;

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
        case "tool-call":
          toolCalls++;
          toolStarted.set(p.toolName ?? "tool", Date.now());
          input.onTool?.(p.toolName ?? "tool", "start");
          break;
        case "tool-result": {
          const name = p.toolName ?? "tool";
          const ms = Date.now() - (toolStarted.get(name) ?? Date.now());
          const out = JSON.stringify((p as { output?: unknown }).output ?? "").slice(0, 160);
          console.log(`[run] ${new Date().toISOString()} bot=${bot.id} tool=${name} ${ms}ms -> ${out}`);
          input.onTool?.(name, "end");
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
    await db.message.update({ where: { id: userRow.id }, data: { error: error.slice(0, 1000) } });
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

  // Fire-and-forget compaction with the same model; durable notes are flushed to memory first (OpenClaw pre-compaction flush).
  void maybeCompact(conversation, async (transcript) => {
    await memoryFlush(ws, resolved.model, transcript, timezone).catch(() => false);
    const r = await generateText({ model: resolved.model, system: SUMMARIZE_INSTRUCTIONS, prompt: transcript, maxRetries: 1 });
    return r.text;
  }).catch(() => {});

  return { text: finalText, media: extracted.media, silent: silent || (!finalText && extracted.media.length === 0), messageId: assistantRow.id, tokensIn, tokensOut, toolCalls };
}
