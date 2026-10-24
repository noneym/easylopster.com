# easylopster.com — Plan

> OpenClaw'un "hosted, kurulumsuz" yeniden yazımı. Kullanıcı webden üye olur, API anahtarını girer,
> Telegram botunu bağlar ve dakikalar içinde çalışan bir AI asistanı olur. Sonra isterse
> Windows/macOS/Linux makinesini "node" olarak bağlar, MCP sunucuları ekler.

## 0. Karar özeti (⚑ = onay bekleyen)

| Konu | Karar | Neden |
|---|---|---|
| Kod tabanı | Sıfırdan yazım, OpenClaw mimarisi referans (kod kopyalanmaz) | OpenClaw tek kullanıcı + lokal; bizimki çok kiracılı SaaS. Fork yerine fikirleri almak daha temiz |
| ⚑ Stack | **Next.js 16 (App Router, SSR) + Prisma 7 + MariaDB + Redis**, TypeScript pnpm monorepo | Telegram webhook, WebSocket node bağlantısı, MCP streaming, LLM tool-call döngüsü Node tarafında çok daha doğal. mailbuda ile aynı stack |
| ⚑ Servis yapısı | 2 process: `web` (Next.js) + `gateway` (Node worker: agent döngüsü, Telegram gönderim, WS, MCP) | SSR ile uzun ömürlü WS/queue işlerini ayırmak; dockxo'da 2 servis |
| LLM katmanı | **Vercel AI SDK v5** (`ai` + `@ai-sdk/anthropic`, `@ai-sdk/openai`, OpenRouter, OpenAI-uyumlu custom URL) | Tek arayüzle çoklu sağlayıcı tool-calling + streaming + hazır MCP client |
| Telegram | **grammY, webhook modu** (`/api/tg/{botId}/{secret}`) | Yüzlerce bot için long-polling tutmak yerine webhook; OpenClaw da grammY kullanıyor |
| Kuyruk | BullMQ (Redis) | Mesaj işleme, retry, rate limit |
| ⚑ Node protokolü | Faz 4'te **kendi hafif ajanımız** (`npx easylopster-node`), OpenClaw node protokolü uyumu sonra değerlendirilir | OpenClaw'ın cihaz-imzalı pairing protokolü kaynak okumadan garanti edilemez; önce basit kendi WS protokolümüz |
| Auth | E-posta + şifre (Argon2), Redis session, e-posta doğrulama; Google OAuth sonra | Beta için en basit |
| Beta | Ücretsiz; kota: 3 bot / 2 node / 5 MCP / 500 mesaj-gün (env ile ayarlanır) | Kötüye kullanım freni |
| Gizli veriler | API key + bot token AES-256-GCM şifreli (`ENCRYPTION_KEY`), UI'da sadece son 4 hane | |

## 1. Ürün akışı (kullanıcı gözünden)

1. **Kayıt / giriş** → doğrulama maili → dashboard.
2. **API anahtarı ekle** → sağlayıcı seç (Anthropic, OpenAI, OpenRouter, DeepSeek, Google, OpenAI-uyumlu özel URL) → anahtar → "Test et" → varsayılan model.
3. **Telegram botu ekle** → BotFather token yapıştır → `getMe` ile doğrulanır, webhook kurulur → ayarlar: ad, sistem promptu, API anahtarı + model, erişim politikası (**pairing** / allowlist / açık), grup davranışı (sadece mention), tool izinleri.
4. İlk DM → pairing kodu → dashboardda "Onayla" → bot cevaplamaya başlar. Birden fazla bot, her biri farklı model/prompt.
5. **MCP sunucusu ekle** → URL (streamable-http / SSE) + header/token → "Bağlan" → tool listesi çekilir → hangi botlarda açık olacağı seçilir.
6. **Node bağla** → "Yeni node" → eşleştirme kodu → makinede `npx easylopster-node connect <kod>` → node online → bota `system.run`, `screen.snapshot`, `files.read` gibi yetenekler (her komut ayrı onay / allowlist).
7. **Web chat** → her botla tarayıcıdan konuşma, oturum geçmişi, kullanım (token/maliyet).

## 2. Mimari

```
                 +-------------- easylopster.com ----------------+
 Browser --SSR-->| web (Next.js 16)                               |
                 |  landing, auth, dashboard, web chat (SSE)      |
                 |  /api/tg/{botId}/{secret}  <- Telegram webhook |---+
                 +----------------+-------------------------------+   | enqueue
                                  | Prisma                            v
   MariaDB <----------------------+-------------------------->  Redis (BullMQ, session, presence)
                                  |                                   ^
                 +----------------+-------------------------------+   | consume
                 | gateway (Node worker)                          |<--+
                 |  agent loop (AI SDK) . tool router             |
                 |  MCP client pool . Telegram sender             |
                 |  WS server -> nodes (pairing, caps)            |<---- Windows/mac/Linux node ajani
                 +------------------------------------------------+
```

- **web**: SSR sayfalar, auth, CRUD, Telegram webhook alıcı (doğrular + kuyruğa atar, hemen 200), web chat SSE.
- **gateway**: kuyruktan iş alır → oturum + sistem promptu + geçmiş + tool tanımları (built-in, MCP, node) → AI SDK `streamText` tool-loop → Telegram'a yazar (düzenlenen mesajla streaming). Node WS sunucusu burada.
- **packages/db**: Prisma şeması + client. **packages/shared**: zod, şifreleme, provider registry. **packages/node-agent**: node CLI.

### Veri modeli (Prisma)

`User` · `Session` · `ProviderKey` (provider, encKey, label, defaultModel, lastTestedAt) · `Bot` (userId, platform=telegram, encToken, username, webhookSecret, systemPrompt, providerKeyId, model, dmPolicy, groupPolicy, toolPolicy JSON, status) · `BotAllowlist` · `PairingRequest` · `McpServer` (name, url, transport, encHeaders, status, toolsCache JSON) · `BotMcp` · `Node` (name, platform, encToken, caps JSON, lastSeenAt, status) · `BotNode` · `Conversation` (bot, chatId, threadId, kind dm/group/web) · `Message` (role, content JSON, toolCalls, tokens) · `ToolApproval` · `UsageDaily`.

### Güvenlik
- Webhook: botId + rastgele secret path + Telegram `X-Telegram-Bot-Api-Secret-Token`.
- Varsayılan `dmPolicy=pairing`; gruplarda mention zorunlu.
- Node komutları: node yeteneklerini bildirir, kullanıcı hangilerinin açık olduğunu seçer; `system.run` varsayılan "her çalıştırmada Telegram inline buton ile onay".
- Her sorguda `userId` izolasyonu; API key'ler asla loglanmaz.

### Dosya sistemi: üç katman

| Katman | Nerede | Ne zaman | Tool'lar |
|---|---|---|---|
| **1. Bulut workspace** | Gateway volume: `/data/workspaces/{userId}/{botId}/` — `SOUL.md`, `USER.md`, `MEMORY.md`, `memory/YYYY-MM-DD.md`, `skills/*/SKILL.md`, yüklenen dosyalar | Her zaman, Faz 2'den itibaren | `fs.read/write/list/search`, path klasöre kilitli; dashboardda dosya tarayıcı + editör; Telegram'dan gelen dosyalar buraya düşer |
| **2. Sandbox exec** | Gateway'in Docker API ile açtığı kısa ömürlü container (workspace mount, ağ kısıtlı, CPU/RAM limit, root yok, boşta kapanır) | Faz 3b | `exec`; stdio MCP sunucuları da bu container içinde çalışır |
| **3. Node / self-host** | Kullanıcının makinesi: `easylopster-node` CLI (Windows exe) **veya** `docker run -e EASYLOPSTER_TOKEN=... -v data:/workspace ghcr.io/noneym/easylopster-node` | Faz 4 | `fs.*`, `exec`, `screen.snapshot`, `notify`; bot workspace'i "node X, klasör Y" olarak seçilebilir |

Tool router her çağrıda "bu tool nerede çalışacak" kararını botun ayarına göre verir (bulut → sandbox → node). Katman 3'ün Docker imajı aynı repodan GitHub Actions ile `ghcr.io/noneym/easylopster-node` olarak yayınlanır.

### OpenClaw'dan taşınan davranışlar (kod değil, mantık)
- Sistem promptu bölümleri: Tooling, Execution Bias, Promised Work, Care, Messaging, Workspace, Runtime, Silent Replies, Group Chat Context, Reactions. Kaynak: `buildAgentSystemPrompt` + prompt snapshot fixture'ları.
- Değişken bilgiler (tarih, saat dilimi, aktif işler) sistem promptunda değil ayrı runtime-context mesajında → prompt cache sabit kalır.
- Bootstrap dosyaları (`AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `USER.md`, `MEMORY.md`) ve limitleri (20k/dosya, 60k toplam); bizde dosyalar bulut workspace'te, dashboarddan düzenlenir.
- Oturum modeli: DM'ler ana oturumu paylaşır, her grup ayrı, forum topic ayrı anahtar; compaction/pruning.
- Erişim: `dmPolicy=pairing` varsayılan, allowlist, gruplarda mention; tool politikası promptta değil runtime'da.
- Telegram: streaming modları (off/partial/block/progress), inline buton aksiyonları, exec onayları, reply threading.
- Alınmayanlar: CLI onboarding, Tailscale, macOS Canvas, lokal daemon.

## 3. Fazlar

| Faz | Kapsam | Çıktı |
|---|---|---|
| **0 İskelet** | pnpm monorepo, Next 16, Prisma şema + ilk migration (uzak MariaDB), Redis, Dockerfile x2, `.env.example`, lint/tsc | Ayağa kalkan `web` + `gateway` |
| **1 Auth + Landing + Shell** | Kayıt/giriş/doğrulama, dashboard layout, **landing (design-taste-frontend, SSR)**, boş durum ekranları | Üyelik açılabiliyor |
| **2 API Key + Telegram + Agent** | ProviderKey CRUD + test, Bot CRUD + webhook, pairing, agent loop, Telegram streaming cevap, web chat, usage | Kurulumsuz çalışan Telegram asistanı (çekirdek değer) |
| **2 (devam)** | Bulut workspace: volume, `fs.*` tool'ları, dashboard dosya tarayıcı/editör, memory günlükleri, SOUL/USER/MEMORY düzenleme | Agent dosya ve hafıza kullanıyor |
| **3 MCP** | McpServer CRUD, bağlantı testi + tool keşfi, bot başına MCP seçimi, tool-call enjeksiyonu, timeout yönetimi | MCP destekli botlar |
| **3b Sandbox exec** | Docker API ile bot başına kısa ömürlü container, `exec` tool'u, kotalar, stdio MCP köprüsü | Bulutta kabuk |
| **4 Node** | WS sunucusu, pairing kodu, `easylopster-node` CLI (Windows exe) + `ghcr.io/noneym/easylopster-node` Docker imajı (self-host dosya sistemi), `exec`, `fs.*`, `screen.snapshot`, `notify`; onay akışı | "Kendi makinene / sunucuna bağlan" |
| **5 Deploy + Cila** | dockxo: `web.easylopster` + `gateway.easylopster` (GitHub → Dockerfile), env'ler, domain easylopster.com, health check | Canlı beta |

Her faz sonunda commit + push (`noneym/easylopster.com`), Faz 5'te dockxo deploy.

## 4. Repo yerleşimi

```
easyclaw/
  apps/web/            Next.js 16
  apps/gateway/        worker + WS server
  packages/db/         prisma schema, client, migrations
  packages/shared/     zod, crypto, constants, provider registry
  packages/node-agent/ CLI (Windows/mac/Linux)
  docker/              web.Dockerfile, gateway.Dockerfile
  PLAN.md
```

## 5. Ortam değişkenleri

`DATABASE_URL`, `REDIS_URL`, `ENCRYPTION_KEY` (32 byte base64), `APP_URL=https://easylopster.com`, `SESSION_SECRET`, `SMTP_*`, `GATEWAY_WS_URL=wss://gw.easylopster.com`, `BETA_LIMITS_*`.

## 6. Notlar / riskler

- Lokal Node 22; Next 16 için yeterli. Prod imaj `node:22-alpine`.
- `C:/projects` kökü ayrı bir git reposu → `easyclaw` içinde ayrı `git init` + remote `noneym/easylopster.com` (repo şu an boş).
- MCP **stdio** sunucuları Faz 3b sandbox container'ında veya node üzerinde çalışır.
- E-posta doğrulama beta başında kapalı; SMTP gelince açılır. Sandbox exec için gateway'in Docker socket erişimi dockxo'da doğrulanacak.
- Ekstra repo yok: node ajanı + Docker imajı aynı monorepo'dan (GitHub Actions → ghcr.io). `npx easylopster-node` için npm hesabı sonradan.
- Telegram 4096 karakter sınırı; mesaj düzenleme rate limit'i (streaming için ~1 edit/sn).
- dockxo `easylopster` projesinde MariaDB + Redis zaten hazır (epyc sunucusu); sadece `web` ve `gateway` servisleri eklenecek.
