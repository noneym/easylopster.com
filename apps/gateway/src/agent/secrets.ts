import { tool, type ToolSet } from "ai";
import { z } from "zod";
import { db } from "@easylopster/db";
import { decrypt } from "@easylopster/shared/crypto";

/**
 * Secrets never reach the model. The agent can list names/descriptions and request new ones; values
 * are injected as environment variables into sandbox and node exec only.
 */
export interface BotSecrets {
  /** NAME -> plaintext (kept in process memory for the duration of the run only) */
  env: Record<string, string>;
  meta: { name: string; description: string | null }[];
}

export async function loadBotSecrets(botId: string): Promise<BotSecrets> {
  const rows = await db.botSecret.findMany({ where: { botId }, include: { secret: true } });
  const env: Record<string, string> = {};
  const meta: { name: string; description: string | null }[] = [];
  for (const r of rows) {
    env[r.secret.name] = decrypt(r.secret.encValue);
    meta.push({ name: r.secret.name, description: r.secret.description });
  }
  return { env, meta };
}

export function secretsTools(s: BotSecrets): ToolSet {
  return {
    secrets: tool({
      description:
        "Protected credentials. `list` returns names and descriptions of secrets available to you; their values are injected as environment variables ($NAME) into exec on the sandbox or nodes, never shown to you or in chat. `request` asks the owner to add a missing secret in the dashboard (give the exact NAME and why).",
      inputSchema: z.object({
        action: z.enum(["list", "request"]),
        name: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/, "ENV_STYLE_NAME").optional(),
        reason: z.string().max(300).optional(),
      }),
      execute: async ({ action, name, reason }) => {
        if (action === "list") return { secrets: s.meta, note: "Use them in exec as environment variables, e.g. $GITHUB_TOKEN." };
        if (!name) return { error: "name is required for request" };
        return {
          status: "pending_owner",
          message: `Ask the owner to add secret ${name} in the dashboard (Secrets → Add) and enable it for this bot${reason ? `. Reason: ${reason}` : ""}. It becomes available as $${name} on the next turn.`,
        };
      },
    }),
  };
}
