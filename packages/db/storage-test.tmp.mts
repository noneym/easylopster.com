// Temporary end-to-end test for storage + backups against the local dev gateway and a mock S3.
// setup   : StorageConfig for the test account → mock S3, BackupPolicy on the test bot
// run     : POST /internal/backup/run, then /internal/backup/restore on the result; print rows
// cleanup : remove config, policy, backups
import { db } from "./src/index.ts";
import { encrypt } from "../shared/src/crypto.ts";

const action = process.argv[2] ?? "run";
const GW = "http://localhost:4700";
const BOT = "cmvlp5aen0000zgm4wkp0i9o0";
const user = await db.user.findUnique({ where: { email: "test@example.com" }, select: { id: true } });
if (!user) throw new Error("test user missing");
const secret = process.env.INTERNAL_SECRET!;
const call = async (p: string, body: unknown) => {
  const r = await fetch(`${GW}${p}`, { method: "POST", headers: { "content-type": "application/json", "x-internal-secret": secret }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};

if (action === "setup") {
  const data = { provider: "minio", endpoint: "http://127.0.0.1:4568", region: "us-east-1", bucket: "easylopster-test", prefix: "el/", forcePathStyle: true, encAccessKey: encrypt("mock"), encSecretKey: encrypt("mock"), accessKeyLast4: "mock" };
  await db.storageConfig.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
  await db.backupPolicy.upsert({ where: { botId: BOT }, create: { botId: BOT, schedule: { kind: "every", everyMs: 3_600_000 }, retentionDays: 7, keepLast: 1, includeConversations: true }, update: { retentionDays: 7, keepLast: 1, includeConversations: true, enabled: true } });
  console.log("setup ok");
}
if (action === "run") {
  const r1 = await call("/internal/backup/run", { botId: BOT });
  console.log("run:", r1.status, JSON.stringify(r1.json).slice(0, 400));
  const id = (r1.json as { id?: string }).id;
  const r1b = await call("/internal/backup/run", { botId: BOT });
  console.log("run2:", r1b.status, (r1b.json as { bytes?: number }).bytes, "bytes");
  const rows = await db.backup.findMany({ where: { botId: BOT }, orderBy: { createdAt: "desc" } });
  console.log("backup rows after retention (keepLast=1, 7d):", rows.length, rows.map((r) => r.key));
  if (id) {
    const r2 = await call("/internal/backup/restore", { backupId: rows[0]!.id, settings: true });
    console.log("restore:", r2.status, JSON.stringify(r2.json));
  }
}
if (action === "cleanup") {
  await db.backup.deleteMany({ where: { botId: BOT } });
  await db.backupPolicy.deleteMany({ where: { botId: BOT } });
  await db.storageConfig.deleteMany({ where: { userId: user.id } });
  console.log("cleanup ok");
}
await db.$disconnect();
