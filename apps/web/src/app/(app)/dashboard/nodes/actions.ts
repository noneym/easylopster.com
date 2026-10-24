"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { pairingCode } from "@easylopster/shared/crypto";
import { nodeCapabilitySchema } from "@easylopster/shared/node-protocol";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { LIMITS } from "@/lib/limits";

export type NodeFormState = { error?: string; fieldErrors?: Record<string, string>; ok?: boolean; message?: string } | undefined;

const PAIRING_TTL_MS = 15 * 60_000;

export async function createNode(_prev: NodeFormState, formData: FormData): Promise<NodeFormState> {
  const user = await requireUser();
  const count = await db.node.count({ where: { userId: user.id, status: { not: "revoked" } } });
  if (count >= LIMITS.nodes) return { error: `The beta allows ${LIMITS.nodes} nodes per account.` };
  const parsed = z.object({ name: z.string().trim().min(1, "Give the node a name").max(60) }).safeParse({ name: formData.get("name") });
  if (!parsed.success) return { fieldErrors: { name: parsed.error.issues[0]?.message ?? "Invalid" } };

  let code = pairingCode(2, 4);
  for (let i = 0; i < 5; i++) {
    if (!(await db.node.findUnique({ where: { pairingCode: code } }))) break;
    code = pairingCode(2, 4);
  }
  const node = await db.node.create({
    data: { userId: user.id, name: parsed.data.name, pairingCode: code, pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MS), status: "pending" },
  });
  revalidatePath("/dashboard/nodes");
  redirect(`/dashboard/nodes/${node.id}`);
}

/** New pairing code for a node that never connected or was revoked. */
export async function renewPairing(id: string) {
  const user = await requireUser();
  const node = await db.node.findFirst({ where: { id, userId: user.id } });
  if (!node) return;
  await db.node.update({
    where: { id },
    data: { pairingCode: pairingCode(2, 4), pairingExpiresAt: new Date(Date.now() + PAIRING_TTL_MS), status: "pending", tokenHash: null },
  });
  revalidatePath(`/dashboard/nodes/${id}`);
}

export async function updateNode(_prev: NodeFormState, formData: FormData): Promise<NodeFormState> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  const node = await db.node.findFirst({ where: { id, userId: user.id } });
  if (!node) return { error: "Node not found" };
  const parsed = z
    .object({ name: z.string().trim().min(1).max(60), execApproval: z.enum(["always", "never"]) })
    .safeParse({ name: formData.get("name"), execApproval: formData.get("execApproval") });
  if (!parsed.success) return { fieldErrors: { name: "Name is required" } };
  const declared = Array.isArray(node.caps) ? (node.caps as string[]) : [];
  const enabled = declared.filter((c) => nodeCapabilitySchema.safeParse(c).success && formData.get(`cap:${c}`) === "on");
  await db.node.update({ where: { id }, data: { name: parsed.data.name, execApproval: parsed.data.execApproval, enabledCaps: enabled } });
  revalidatePath(`/dashboard/nodes/${id}`);
  revalidatePath("/dashboard/nodes");
  return { ok: true, message: "Saved." };
}

/** Removes one "Always allow" entry so that action asks again. */
export async function clearAutoApprove(id: string, cap: string) {
  const user = await requireUser();
  const node = await db.node.findFirst({ where: { id, userId: user.id }, select: { autoApprove: true } });
  if (!node) return;
  const list = (Array.isArray(node.autoApprove) ? (node.autoApprove as string[]) : []).filter((c) => c !== cap);
  await db.node.update({ where: { id }, data: { autoApprove: list } });
  revalidatePath(`/dashboard/nodes/${id}`);
}

export async function revokeNode(id: string) {
  const user = await requireUser();
  await db.node.updateMany({ where: { id, userId: user.id }, data: { status: "revoked", tokenHash: null, pairingCode: null, pairingExpiresAt: null } });
  revalidatePath(`/dashboard/nodes/${id}`);
  revalidatePath("/dashboard/nodes");
}

export async function deleteNode(id: string) {
  const user = await requireUser();
  await db.node.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/dashboard/nodes");
  redirect("/dashboard/nodes");
}

/** Bot page: which nodes a bot may use. */
export async function setBotNodes(botId: string, formData: FormData) {
  const user = await requireUser();
  const bot = await db.bot.findFirst({ where: { id: botId, userId: user.id }, select: { id: true } });
  if (!bot) return;
  const nodes = await db.node.findMany({ where: { userId: user.id, status: { not: "revoked" } }, select: { id: true } });
  await db.$transaction(async (tx) => {
    await tx.botNode.deleteMany({ where: { botId } });
    for (const n of nodes) {
      if (formData.get(`node:${n.id}`) === "on") await tx.botNode.create({ data: { botId, nodeId: n.id } });
    }
  });
  revalidatePath(`/dashboard/bots/${botId}`);
}

/** Gateway's live view of connected nodes (ids). Empty on any error so the page still renders. */
export async function onlineNodeIds(): Promise<Set<string>> {
  try {
    const res = await fetch(`${process.env.GATEWAY_INTERNAL_URL ?? "http://localhost:4000"}/internal/nodes/online`, {
      headers: { "x-internal-secret": process.env.INTERNAL_SECRET ?? "" },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return new Set();
    const j = (await res.json()) as { nodes: string[] };
    return new Set(j.nodes);
  } catch {
    return new Set();
  }
}
