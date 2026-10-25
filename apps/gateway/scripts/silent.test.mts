import { automationReplyIsSilent } from "../src/agent/automations.ts";
const cases: [string, boolean][] = [
  ["NO_NEW_POST — sessiz kalıyorum.", true],
  ["NO_REPLY.", true],
  ["NOTHING_NEW", true],
  ["HEARTBEAT_OK", true],
  ["Yeni Patreon postu var: Karolin, Vimeo. İndirdim ve DB'ye kaydettim.", false],
  ["NO_NEW_POST\n\nAma mail kutusunda 3 yeni mesaj var, bakmak ister misin?", false],
  ["API_KEY hatası aldım, NameSilo anahtarı geçersiz görünüyor; kontrol eder misin?", false],
];
for (const [t, exp] of cases) { const r = automationReplyIsSilent(t); if (r.silent !== exp) { console.error("FAIL", JSON.stringify(t), r); process.exit(1); } }
console.log("silent markers ok");
