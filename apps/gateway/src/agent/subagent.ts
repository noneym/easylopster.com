import { tool, type ToolSet } from "ai";
import { z } from "zod";

/**
 * Subagents (OpenClaw sessions_spawn, simplified): run a bounded side task in a fresh isolated
 * session and return its result inline. Depth is limited to one level.
 */
export interface SpawnRequest {
  task: string;
  context: "isolated" | "fork";
  label?: string;
}

export type SpawnRunner = (req: SpawnRequest) => Promise<{ text: string; toolCalls: number; durationMs: number }>;

const SPAWN_TIMEOUT_MS = 240_000;

export function subagentTools(run: SpawnRunner): ToolSet {
  return {
    sessions_spawn: tool({
      description:
        "Spawn a subagent for a bounded side task and wait for its result (up to 4 minutes). It has the same tools as you but a clean context (context=\"isolated\") or a copy of this conversation (context=\"fork\"). Give it the objective, the expected output shape and any write scope. Use for investigations that need many tool calls; do not use it for one-step work.",
      inputSchema: z.object({
        task: z.string().min(1).max(8000),
        context: z.enum(["isolated", "fork"]).default("isolated"),
        label: z.string().max(60).optional(),
      }),
      execute: async ({ task, context, label }) => {
        const timer = new Promise<{ error: string }>((resolve) => setTimeout(() => resolve({ error: "subagent timed out after 4 minutes; the partial work may still be in the workspace" }), SPAWN_TIMEOUT_MS));
        try {
          const r = await Promise.race([run({ task, context, label }), timer]);
          if ("error" in r) return r;
          return { result: r.text, toolCalls: r.toolCalls, durationMs: r.durationMs };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    }),
  };
}

export const SUBAGENT_TASK_LABEL = "[Subagent Task]";
