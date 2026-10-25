// Offline check of the Telegram streaming helpers with a fake Bot API.
// Run: cd apps/gateway && ../../node_modules/.bin/tsx scripts/stream-modes.test.mts
import { TelegramSender, completedParagraphs, paragraphsOf } from "../src/telegram/api.ts";

const calls: string[] = [];
let nextId = 100;
const tg = new TelegramSender("0:fake");
(tg as unknown as { api: unknown }).api = {
  sendMessage: async (_c: unknown, text: string, o: { disable_notification?: boolean } = {}) => {
    calls.push(`send(${o.disable_notification ? "silent" : "loud"}): ${text.replace(/\n/g, "⏎").slice(0, 60)}`);
    return { message_id: nextId++ };
  },
  editMessageText: async (_c: unknown, id: number, text: string) => {
    calls.push(`edit(${id}): ${text.replace(/\n/g, "⏎").slice(0, 60)}`);
    return true;
  },
  deleteMessage: async (_c: unknown, id: number) => {
    calls.push(`delete(${id})`);
    return true;
  },
};

const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error("FAIL: " + msg);
};

// paragraph helpers
assert(paragraphsOf("a\n\nb\n\n```\nx\n\ny\n```\n\nc").length === 4, "fenced block stays one paragraph");
assert(completedParagraphs("one\n\ntwo").length === 1, "last paragraph without trailing blank line is incomplete");
assert(completedParagraphs("one\n\ntwo\n\n").length === 2, "trailing blank line completes the last paragraph");
assert(completedParagraphs("one\n\n```\ncode\n\n").length === 1, "blank line inside an open fence does not complete it");

// block mode
calls.length = 0;
const block = tg.blockStream(1, { replyTo: 7 });
block.update("First para");
block.update("First paragraph.\n\nSecond");
block.update("First paragraph.\n\nSecond paragraph.\n\nThi");
const ids = await block.finish("First paragraph.\n\nSecond paragraph.\n\nThird, final.");
assert(calls.filter((c) => c.startsWith("send")).length === 3, `block sends 3 messages, got ${calls.length}: ${calls.join(" | ")}`);
assert(calls[0]!.includes("First paragraph."), "first paragraph sent first");
assert(calls[2]!.includes("Third, final."), "remainder sent on finish");
assert(ids.length === 1, "finish returns the id of the final chunk");
console.log("block ok:", calls.join(" | "));

// progress mode
calls.length = 0;
const prog = tg.progressStream(1, {});
prog.thinking();
await new Promise((r) => setTimeout(r, 50));
prog.tool("fs_read");
prog.writing("Here is what I found about your files and more text");
await new Promise((r) => setTimeout(r, 1700));
const finalIds = await prog.finish("**Done.** Here is the answer.");
assert(calls[0]!.startsWith("send(silent): ⏳"), "status message is sent silently first");
assert(calls.some((c) => /^edit(d+): ✍️/.test(c)), `status edited to writing: ${calls.join(" | ")}`);
assert(calls.some((c) => /^delete(d+)$/.test(c)), "status deleted on finish");
assert(calls[calls.length - 1]!.startsWith("send(loud)"), "final answer is a new, notifying message");
assert(finalIds.length === 1, "finish returns the final message id");
console.log("progress ok:", calls.join(" | "));

// discard on NO_REPLY
calls.length = 0;
const prog2 = tg.progressStream(1, {});
prog2.thinking();
await new Promise((r) => setTimeout(r, 50));
await prog2.discard();
assert(calls.includes("delete(103)") || calls.some((c) => c.startsWith("delete(")), "discard removes the status message");
console.log("discard ok:", calls.join(" | "));
console.log("ALL OK");
