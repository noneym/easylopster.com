import { createHash } from "node:crypto";
import { db } from "@easylopster/db";
import { decrypt } from "@easylopster/shared/crypto";
import type { Workspace } from "../workspace/fs.ts";

/**
 * Optional vector layer for memory search: when the owner has an OpenAI key, memory chunks are
 * embedded with text-embedding-3-small and cached in memory/.embeddings.json (keyed by chunk hash).
 * Without a key, search stays keyword-only.
 */
const MODEL = "text-embedding-3-small";
const CACHE = "memory/.embeddings.json";
const MAX_CHUNKS = 2000;

interface Cache {
  model: string;
  vectors: Record<string, number[]>; // sha1(text) -> vector
}

async function openaiKey(userId: string): Promise<string | null> {
  const k = await db.providerKey.findFirst({ where: { userId, provider: "openai" }, select: { encKey: true } });
  return k ? decrypt(k.encKey) : null;
}

export async function embeddingsAvailable(userId: string): Promise<boolean> {
  return !!(await openaiKey(userId));
}

async function embed(key: string, inputs: string[]): Promise<number[][]> {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, input: inputs }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) throw new Error(`embeddings ${r.status}`);
  const j = (await r.json()) as { data: { embedding: number[] }[] };
  return j.data.map((d) => d.embedding);
}

const hash = (s: string) => createHash("sha1").update(s).digest("hex");

function cosine(a: number[], b: number[]) {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** Returns semantic scores (0..1) per chunk index, or null when embeddings are unavailable. */
export async function semanticScores(ws: Workspace, userId: string, query: string, chunks: string[]): Promise<number[] | null> {
  const key = await openaiKey(userId);
  if (!key || chunks.length === 0) return null;
  let cache: Cache = { model: MODEL, vectors: {} };
  try {
    const raw = await ws.readOptional(CACHE);
    if (raw) cache = JSON.parse(raw) as Cache;
    if (cache.model !== MODEL) cache = { model: MODEL, vectors: {} };
  } catch {}
  const limited = chunks.slice(0, MAX_CHUNKS);
  const missing = limited.map((c, i) => [hash(c), i] as const).filter(([h]) => !cache.vectors[h]);
  if (missing.length) {
    for (let i = 0; i < missing.length; i += 64) {
      const batch = missing.slice(i, i + 64);
      const vecs = await embed(key, batch.map(([, idx]) => limited[idx]!));
      batch.forEach(([h], j) => (cache.vectors[h] = vecs[j]!));
    }
    // Drop vectors for chunks that no longer exist to keep the cache bounded.
    const live = new Set(limited.map(hash));
    for (const h of Object.keys(cache.vectors)) if (!live.has(h)) delete cache.vectors[h];
    await ws.write(CACHE, JSON.stringify(cache));
  }
  const [q] = await embed(key, [query.slice(0, 2000)]);
  return limited.map((c) => cosine(q!, cache.vectors[hash(c)] ?? []));
}
