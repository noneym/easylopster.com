import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { sandboxExec } from "./docker.ts";

/** The `exec` tool backed by the per-bot cloud sandbox. Description mirrors OpenClaw's exec tool intent. */
export function sandboxTools(userId: string, botId: string, env: Record<string, string> = {}, onCall?: (summary: string) => void): ToolSet {
  return {
    exec: tool({
      description:
        "Run a shell command in your private Linux sandbox (Debian, bash, python3, node, git, curl, jq, rg). The workspace is mounted at /workspace and persists; everything else is ephemeral. Network is available. Default timeout 60s (max 300). Returns exit code, stdout and stderr.",
      inputSchema: z.object({
        command: z.string().min(1).max(8000).describe("Command for `bash -lc`"),
        timeoutSec: z.number().int().min(1).max(300).optional(),
        cwd: z.string().max(400).optional().describe("Working directory relative to /workspace"),
      }),
      execute: async ({ command, timeoutSec, cwd }) => {
        onCall?.(command.slice(0, 200));
        try {
          const r = await sandboxExec(userId, botId, command, { timeoutSec, cwd, env });
          return { exitCode: r.exitCode, timedOut: r.timedOut, durationMs: r.durationMs, stdout: r.stdout, stderr: r.stderr };
        } catch (err) {
          return { error: `sandbox unavailable: ${err instanceof Error ? err.message : String(err)}` };
        }
      },
    }),
  };
}
