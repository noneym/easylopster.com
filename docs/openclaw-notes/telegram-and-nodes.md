# OpenClaw — Telegram channel + node/device protocol (reverse-engineering notes)

Source: shallow clone of OpenClaw (`extensions/telegram/src/**`, `src/pairing/**`, `src/gateway/**`,
`packages/gateway-protocol/src/schema/**`, `docs/**`). Everything below is taken from the code or the
docs of that snapshot; strings in quotes/code blocks are verbatim. Where OpenClaw behaviour depends on
its single-tenant gateway (SQLite state, config file, CLI), the note says so, because the hosted
rewrite (easylopster.com: many users × several bots, webhook mode, grammY, Node worker) must replace
those with per-tenant storage.

Key source files (for later look-ups):

| Topic | File(s) |
| --- | --- |
| Account resolution / merge | `extensions/telegram/src/account-config.ts`, `accounts.ts`, `account-selection.ts` |
| Access decisions | `bot-access.ts`, `dm-access.ts`, `group-access.ts`, `group-policy.ts`, `access-groups.ts`, `allow-from.ts`, `bot-handlers.inbound-authorization.ts`, `ingress.ts` |
| Inbound pipeline | `bot-handlers.inbound-pipeline.ts`, `bot-handlers.inbound-buffer.ts`, `bot-handlers.inbound-media.ts`, `bot-handlers.message-context.ts` |
| Message context (what the agent sees) | `bot-message-context.ts`, `bot-message-context.body.ts`, `bot-message-context.session.ts`, `src/auto-reply/envelope.ts`, `src/auto-reply/reply/inbound-meta.ts` |
| Session keys / routing | `dm-session-key.ts`, `conversation-route.ts`, `topic-conversation.ts`, `thread-spec.ts` |
| Pairing (DM) | `src/pairing/pairing-store-model.ts`, `pairing-store.ts`, `pairing-challenge.ts`, `pairing-messages.ts`, `src/channels/plugins/pairing-message.ts` |
| Outbound streaming | `draft-stream.ts`, `draft-stream-message.ts`, `preview-streaming.ts`, `bot-message-dispatch-draft.ts`, `progress-draft-preview.ts`, `telegram-text-delivery.ts` |
| Formatting / chunking | `format.ts`, `format-html.ts`, `text-chunk-limit.ts`, `rich-message.ts` |
| Reply threading | `reply-parameters.ts`, `outbound-params.ts` |
| Buttons / callbacks | `button-types.ts`, `inline-keyboard.ts`, `inline-buttons.ts`, `approval-callback-data.ts`, `question-callback-data.ts`, `native-command-callback-data.ts`, `bot-handlers.callback-router.ts`, `bot-handlers.callback-router-controls.ts`, `bot-handlers.callback-actions.ts` |
| Rate limiting | `grammy-api-throttler.ts`, `account-throttler.ts`, `chat-action-timing.ts` |
| Webhook | `webhook.ts`, `webhook-route.ts`, `allowed-updates.ts` |
| Native commands | `bot-native-commands.ts`, `bot-native-command-builtins.ts`, `bot-native-command-dispatch.ts`, `command-config.ts`, `src/auto-reply/commands-registry.shared.ts` |
| Exec approvals | `approval-native.ts`, `approval-handler.runtime.ts`, `approval-terminal.ts`, `exec-approvals.ts`, `src/infra/exec-approval-reply.ts` |
| Node protocol | `packages/gateway-protocol/src/schema/frames.ts`, `nodes.ts`, `devices.ts`, `exec-approvals.ts`; `src/gateway/node-command-policy.ts`, `node-registry*.ts`, `server/ws-connection/connect-node-session.ts`; `src/infra/device-pairing*.ts`, `node-commands.ts`; `packages/gateway-client/src/device-auth.ts`; `src/agents/tools/nodes-tool.ts` |
| Config schema | `extensions/telegram/src/config-schema.ts`, `src/config/zod-schema.channel-messaging-common.ts` |

---

## 1. Telegram inbound pipeline (step by step)

### 1.0 Transport → durable queue

* Both long-polling and webhook commit the raw `Update` JSON into a per-account durable queue
  (`channel_ingress_events` in SQLite) **before** acknowledging Telegram. Webhook returns an empty
  `200` with header `x-openclaw-delivery-accepted: durable` only after the SQLite transaction
  committed; failures return non-200 so Telegram redelivers. Duplicate `update_id`s are admitted once
  (bounded replay dedupe: a row is rejected only while a pending row / completed tombstone / failed
  row exists; tombstones retained 30 days, max 1000 per class).
* A "drain" then processes queued updates in per-chat/per-topic **lanes**, in order. Slow agent turns
  never hold Telegram's delivery ACK.
* `allowed_updates` = grammY `API_CONSTANTS.DEFAULT_UPDATE_TYPES` minus `stopped_message_generation`,
  plus `message_reaction` and `channel_post` (`allowed-updates.ts`).
* grammY handler registration: `bot.on(["message","edited_message","channel_post","edited_channel_post"], pipeline.handle)`,
  `bot.on("callback_query", router.route)`, plus `bot.command(<name>)` handlers for every native
  command (registered before the generic handler, so commands get first pick) and a
  `message_reaction` handler.

### 1.1 Account resolution

* Config lives at `channels.telegram` (root) + `channels.telegram.accounts.<accountId>`. Account IDs
  are normalized lowercase; the default is `"default"`. `mergeTelegramAccountConfig(cfg, accountId)`
  merges root → account with `omitKeys: ["defaultAccount"]`; empty `capabilities: []` on an account
  inherits the root; `groups` inherits root only in single-account setups (multi-account: an account
  `groups` map **replaces** root; `groups: {}` isolates); `preserveRootAllowFrom: true` (a restrictive
  root `allowFrom` is a safety boundary — account `allowFrom: ["*"]` does not make an account public
  unless the merged list still contains `"*"`).
* Token resolution order: `tokenFile` > `botToken` > env `TELEGRAM_BOT_TOKEN` (env only for the
  default account). Bot identity (`getMe`) is cached up to 24h.
* Each account is owned by one agent through top-level `bindings[]`:
  `{ agentId: "main", match: { channel: "telegram", accountId: "default" } }`. Missing owner → the
  account is blocked (other accounts keep running).
* For the hosted rewrite: every bot = one "account"; the per-bot settings listed in §7 are the fields
  to persist per bot.

### 1.2 Update kinds and early filtering (`bot-handlers.inbound-pipeline.ts`)

1. `message` / `channel_post` → `handleMessage`; `edited_message` / `edited_channel_post` →
   `handleEditedMessage` (edits are **only recorded** into the reply-chain cache — never dispatched,
   never trigger pairing replies: `dmAccess: "silent"`).
2. `isGroup = isChannelPost || chat.type in {group, supergroup}`. Channel posts are normalized: a
   synthetic `from` = `{ id: sender_chat.id, is_bot: true, first_name: sender_chat.title || "Channel", username? }`
   and `chat.type` forced to `"supergroup"`; channel posts require an explicitly configured group
   (`requireConfiguredGroup: true`).
3. Forum flag: `chat.is_forum` / `is_topic_message`, falling back to `getChat` (cached 10 min, max 1024
   chats).
4. Messages whose `from.id === bot id` are ignored (bot echoes), except channel posts.
5. `senderId = sender_chat.id (channel post) | from.id | ""`.
6. `shouldSkipUpdate(ctx)` — update tracker dedupe (same update processed once per process).

### 1.3 Access check (`authorizeInboundMessage`)

Runs **before** any cache/dedupe side effect so blocked content is never recorded. Order:

1. Resolve the authorization context from the *current* runtime config (hot reload applies to new
   admissions; an admitted turn keeps its captured settings): `dmPolicy`, `allowFrom`,
   `groupAllowFrom`, group/topic config, `storeAllowFrom` (pairing-store approved IDs for this
   account), `threadSpec`.
2. `commandAuthorizedByConfig` — a native command (leading `bot_command` entity, name in the
   registered native set, optional `@botname` must match) sent by a sender present in
   `commands.allowFrom` / `commands.ownerAllowFrom` bypasses DM pairing and group allowlist gates
   (`event: { kind: "native-command", authMode: "command", mayPair: false }`).
3. **Group base access** (`evaluateTelegramGroupBaseAccess`): `groupConfig.enabled === false` →
   blocked (`"group-disabled"`); `topicConfig.enabled === false` → `"topic-disabled"`; if the group or
   topic has its own `allowFrom` override and the sender is not in it → `"group-override-unauthorized"`.
   (Also applied to DMs: `channels.telegram.direct.<chatId>.allowFrom`.)
4. **Group policy** (`evaluateTelegramGroupPolicyAccess`, groups only). Effective policy =
   `topic.groupPolicy ?? group.groupPolicy ?? telegram.groupPolicy ?? channels.defaults.groupPolicy ?? "allowlist"`.
   * `"disabled"` → blocked.
   * Chat allowlist: if `groups` map is configured it is an allowlist (explicit chat id or `"*"`); with
     no `groups` and policy `allowlist` all groups are blocked; with no `groups` and policy `open` any
     group passes.
   * `"allowlist"` sender check (skipped when `commandAuthorizedByConfig`): sender ID must be in the
     effective group allow (`groupAllowFrom`, falling back to `allowFrom` — never the pairing store).
     Exception: a chat explicitly listed in `groups` with **no** `groupAllowFrom`/`allowFrom` entries
     passes any sender. Errors: `"group-policy-allowlist-no-sender"`, `"group-policy-allowlist-empty"`,
     `"group-policy-allowlist-unauthorized"`, `"group-chat-not-allowed"` (logged as
     `skipping group message` with `reason: "not-allowed"`).
   * `"open"` → any sender in an allowed chat.
5. **DM policy** (DMs only). Effective policy = `direct.<chatId>.dmPolicy ?? dmPolicy ?? "pairing"`.
   `requireTopic: true` on a direct config blocks DMs without `message_thread_id`. Then
   `enforceTelegramDmAccess`:
   * `"disabled"` → silently blocked.
   * Effective DM allow = `allowFrom` (+ access-group expansion) + pairing-store approvals **only when
     policy is `pairing`** (`mergeDmAllowFromSources` drops store entries for `allowlist`/`open`).
     Entries are normalized by stripping `telegram:`/`tg:` prefixes; only `^\d+$` user IDs count;
     `"*"` = wildcard. Invalid entries log:
     `Invalid allowFrom entry: "<x>" - allowFrom/groupAllowFrom authorization expects numeric Telegram sender user IDs only. ...`
   * `candidateId = from.id ?? chat.id`. Allowed if candidate ∈ effective allow (or wildcard).
   * `"open"` but not allowed (no wildcard) → blocked, log
     `Blocked unauthorized telegram sender <id> (dmPolicy=open)`.
   * `"pairing"` and not allowed → **issue pairing challenge** (§2) and block.
   * `"allowlist"` and not allowed → blocked (`Blocked unauthorized telegram sender <id> (dmPolicy=allowlist)`).
6. Returns a memoized `resolveChannelIngress(contextBinding)` closure so retries cannot mint new
   authority.

Mention gating and privacy mode are **not** part of this gate; they happen in context construction
(§1.7). Privacy mode is a Telegram-side setting (BotFather `/setprivacy` or make the bot admin) —
OpenClaw only documents it: without it Telegram never delivers unmentioned group messages, so
`requireMention: false` cannot work.

### 1.4 Session state, dedupe, reply-chain record

* `resolveTelegramSessionState` → route + session key (§1.8) + session entry (for
  `sessionStartedAt`, used as `promptContextMinTimestampMs` so history before `/new` is excluded).
* `claimMessageDispatchDedupe(msg, botUserId)` — persistent per-message dispatch claim (at-least-once
  → effectively once).
* `recordMessageForReplyChain(msg, threadSpec, botUserId)` — every admitted message is stored in
  the bounded message cache (SQLite plugin state) keyed by account+chat+message id. Used later for
  reply chains, quoted context, reaction topic recovery, group history window.

### 1.5 Control-lane shortcuts

* `isAbortRequestText` (stop/abort words, `/stop`) from an authorized sender → `cancelPending` for
  that sender's debounce key (drops buffered text).
* `isTelegramControlLaneText` / `isBtwRequestText` → bypass the text buffer (dispatch immediately).

### 1.6 Buffering / debounce (`bot-handlers.inbound-buffer.ts`)

* **Media groups (albums)**: 500 ms quiet window; if another member of the same `media_group_id`
  is already queued in the lane, wait for it (hold bounded to 20 s from first member). Album reaches
  the agent as one message with N media.
* **Text debounce** key = `telegram:<accountId|default>:<conversationKey>:<senderId>` where
  `conversationKey = buildTelegramGroupPeerId(chatId, threadSpec)` (chat id, or `<chatId>:topic:<n>`).
  * Not buffered: messages starting with a `bot_command` entity at offset 0, messages with media
    (non-forward lane), control-lane text.
  * Quiet window: `messages.inbound.byChannel.telegram.debounceMs` → `messages.inbound.debounceMs` →
    **300 ms** default. A non-forwarded text of ≥ 4000 chars ("near limit", i.e. a long paste
    fragment) extends the window to `max(debounceMs, 1500 ms)`; explicit `0` disables ordinary
    bursts but keeps long-paste assembly. Hard max wait = `1500*5 = 7.5 s` from the first message.
  * `canAppend`: same lane, max **12** messages and **50 000** chars per batch.
  * **Forward lane** (`msg.forward_origin` set): separate 1 000 ms quiet window, no max wait; media
    download is deferred until flush (so a slow download doesn't split the burst); flush is held while
    another forward from the same sender/chat is still in the lane backlog.
  * Flush: messages are joined into one synthetic message. Join separator: `"\n"`, except after a
    ≥4000-char fragment where the separator is `""` (paste continuation); forwards always `"\n"`.
    `message_id` of the synthetic message = first message; `messageIdOverride` = last message id;
    `date` = last message's date; `forward_origin` cleared; media of all members concatenated;
    `bufferedMessages` kept for context rendering; `ambientTranscriptBody` = one line per message
    `#<message_id> <SenderName>: <text|<media:kind>>`.
  * On flush error the bot sends
    `"Something went wrong while processing your message. Please try again."` (with thread params).
  * Handler failure on a live (non-replayed) update replies
    `"⚠️ Couldn't process this message, please try again in a moment."` as a reply to the message.

### 1.7 Media download (`resolveMedia`)

* Primary media precedence: `photo[last]` → image; `video | video_note | animation` → video;
  `audio | voice` → audio; `document` → document; `sticker` → sticker. One primary media per message.
* Download via `getFile` + file URL (or trusted local path for self-hosted Bot API). Size cap
  `mediaMaxMb` (default 100 MB, fractional allowed). On oversize the user gets
  `⚠️ File too large. Maximum size is <limit>.` (limit in binary units e.g. `512KB`, `20MB`) and the
  agent body gets `[media unavailable: file exceeds <limit> limit]`. On download failure:
  `⚠️ Failed to download media. Please try again.` and `[media unavailable: download failed]`.
  Multi-attachment: `[media unavailable: <n> of <total> attachments could not be downloaded]`.
  Warnings are suppressed for channel posts / "silent-ingest" (unmentioned group media kept only
  as history).
* Media ref = `{ kind, path, contentType, fileName?, stickerMetadata? }`. Saved under the inbound
  media dir; agent sees it as `media://inbound/<id>` / `[media_path:…]`.
* Stickers: static WEBP downloaded (`kind: "sticker"`); animated TGS / video WEBM → no media, body
  falls back to the sticker emoji, else `<media:sticker>`. Cached vision descriptions render as
  `[Sticker <emoji> from "<setName>"] <description>` prefixed to the body.
* Voice notes: if the message has no text and (DM, or mention-gated group) a **preflight
  transcription** runs so mention detection can use the transcript; body becomes the transcript
  framed as machine-generated untrusted text (`formatAudioTranscriptForAgent`).
* Location / venue / contact / poll / dice are rendered into text by `resolveTelegramNonTextBody`
  (dice → `[Dice 🎲 = 4]`; location also produces `LocationLat/Lon/...` context fields).

### 1.8 Session key / routing (`conversation-route.ts`, `dm-session-key.ts`)

* `conversationId` = `String(chatId)` for plain chats; forum topic → `<chatId>:topic:<threadId>`;
  channel Direct-Messages topic → `<chatId>:direct-topic:<topicId>`.
* DM peer id = `senderId || chatId`. Group peer id = conversationId; `parentPeer` = chat id for
  topics.
* `resolveAgentRoute({channel:"telegram", accountId, peer, parentPeer})` applies bindings
  (`bindings[]`: account, peer, parent, `type:"acp"` topic bindings). Topic `agentId`
  (`groups.<chat>.topics.<id>.agentId`) overrides the agent and rebuilds the key.
* Resulting key shape: `agent:<agentId>:telegram:<accountId?>:<direct|group>:<peerId>` e.g.
  `agent:zu:telegram:group:-1001234567890:topic:3`. DM scope (`session.dmScope`): `"main"` collapses
  DMs into the agent main session; `per-account-channel-peer` isolates per account/peer; a named
  (non-default) account that matched only the default binding is always isolated.
* DM topics: only when `getMe().has_topics_enabled` (BotFather threaded mode) and the message carries
  `message_thread_id` → thread session key `resolveThreadSessionKeys({ baseSessionKey, threadId: "<chatId>:<threadId>" })`.
* General forum topic id is `1`: sends omit `message_thread_id` (Telegram rejects it), but
  `sendChatAction` includes it.

### 1.9 Message-context construction — the text the agent sees

`buildTelegramMessageContext` → `resolveTelegramInboundBody` → `buildTelegramInboundContextPayload`
→ core `buildChannelInboundEventContext`. The agent receives (a) a system-prompt "Message Context"
JSON block, (b) a user-role context prefix with structured JSON blocks, (c) the **envelope body**.

**Mention gating (groups):**

* `requireMention` precedence: `topic.requireMention` → session `/activation` override →
  `group.requireMention` → `groups."*"` → core default (**true**). `requireMentionInBotThreads`
  (group or topic) applies only in topics the bot created (`forum_topic_created` observed or created
  by the bot; ownership cache holds 2 048 topics).
* "Mentioned" = native `@botusername` mention / `text_mention` of the bot, or a configured
  `mentionPatterns` regex (agent or account), or `GroupThread` multi-agent mention, or an implicit
  mention `reply_to_bot` (reply to a bot message that is not a forum service message), or an
  authorized native command, or a `[[...]]`-free control command from an authorized sender.
  Leading `/cmd@otherbot` → dropped (`command addressed to another bot`).
* Unmentioned group message with `requireMention` → `skipping group message` (`reason: "no-mention"`);
  if `historyLimit > 0` it is still recorded (and a `message_received` hook fires) so later addressed
  turns get it as chat-window context.
* Unauthorized control command in a group → dropped (`control command (unauthorized)`).

**Envelope (`formatInboundEnvelope` in `src/auto-reply/envelope.ts`):**

```
[<Channel> <from-label>[ +<elapsed>] <timestamp>] <sender-label>: <body>
```

* `Channel` = `Telegram`.
* `from-label` (conversation label): DM → `buildSenderLabel` = `"<First Last> (@username) id:<userId>"`
  (name or @username, falls back to `id:<userId>`, `id:unknown`); group →
  `buildGroupLabel` = `"<chat title> id:<chatId>[ topic:<threadId>]"` or `group:<chatId>`.
* `+<elapsed>` = time since the session's last update (`formatTimeAgo`, e.g. `+2m`), omitted for the
  first message.
* Timestamp: weekday + local/zoned time with seconds (e.g. `Tue 2026-10-24 14:03:11`), timezone from
  `agents.defaults.userTimezone` (default host-local). `includeTimestamp`/`includeElapsed` default
  true.
* Header parts are sanitized: `[`→`(`, `]`→`)`, whitespace collapsed.
* `sender-label` prefix inside the body: DM → the display label without the ` id:` suffix
  (`"<First Last> (@username)"`; if the label contains `:` it becomes `(sender)`); group →
  `resolveSenderLabel({name, username, id})` → `"<name> (<userId>)"`. Example DM:
  `[Telegram Ali Veli (@aliveli) id:603767951 Tue 2026-10-24 14:03:11] Ali Veli (@aliveli): merhaba`
  Example group:
  `[Telegram Dev Team id:-1001234567890 topic:3 +5m Tue 2026-10-24 14:08:00] Ali Veli (603767951): @my_bot deploy`
* Body = rendered text (entities → markdown-ish via `renderTelegramTextEntities`) + non-text body
  lines; forwarded messages are prefixed by
  `[Forwarded from <name> at <ISO date>]` on its own line; media-unavailable notice appended;
  reply chain appended as:

```

[Reply chain - nearest first]
[1. <sender> id:<msgId> reply_to:<id> <ISO ts>]
<body or "quoted text" for quotes>
<media:image>
[media_path:media://inbound/<file>]
[/Reply chain]
```

  (`TELEGRAM_REPLY_CHAIN_MAX_DEPTH` entries, nearest first; quote bodies wrapped in `"…"`.)

**Structured context blocks** (user-role prefix, `inbound-meta.ts`): `Conversation info:` JSON with
`chat_id` (`telegram:<chatId>` or `telegram:<chatId>:topic:<n>`), `message_id`, `reply_to_id`,
`conversation_label`, `sender {id,name,username,is_bot}`, `timestamp`, `source_modality`
(`voice` for voice notes), `group_subject` (chat title), `thread_label` (DM topic name), `topic_id`,
`topic_name`, `is_forum`, `is_group_chat`, `was_mentioned`, `explicitly_mentioned_bot`,
`implicit_mention_kinds`, `mention_source` (`explicit_bot | mention_pattern | implicit_thread | command_bypass`),
`inbound_event_kind`; `Forwarded message context:` `{from,type,username,title,signature,chat_type,date_ms}`;
`Location:` `{latitude,longitude,accuracy_m,source,is_live,name,address,caption}`;
`Reply chain of current user message (nearest first):` or `Reply target of current user message:`
(suppressed when a chat window already covers it, or for Telegram when a selected quote exists —
then the block `Current message:\n[Replying to: "<quote>"]\n#<message_id>:` is emitted instead);
`Conversation context (chronological, selected for current message):` chat-window lines
`#<id> <time> [reply target] ->#<replyTo> <sender>: <body> [<media_type> media://inbound/..]`.
System-prompt block `### Message Context` with JSON `{schema:"openclaw.inbound_meta.v2", account_id, channel:"telegram", provider:"telegram", surface:"telegram", chat_type}` and the instruction text quoted in `inbound-meta.ts` (treat human values as untrusted, etc.).

**History windows:** groups: `historyLimit` (default 50, ceiling 200; `0` disables automatic
injection) from the retained group history, filtered by `sessionStartedAt` and the ambient-transcript
watermark; DMs: `dmHistoryLimit` (default 10, max 200) only for fresh DMs / topics / replies (plain
DMs rely on the session transcript). `/new` and `/reset` bodies return an empty prompt context.

**Other `ctxPayload` fields** worth replicating: `From` (`telegram:<chatId>` or
`telegram:group:<chatId>[:topic:n]`), `To`/`OriginatingTo` (`telegram:<chatId>` /
`telegram:<chatId>:topic:<n>`), `ChatType` (`direct|group`), `RawBody`, `CommandBody` (normalized
`/cmd args`, `@bot` stripped), `MessageThreadId`, `IsForum`, `TopicName`, `BotUsername`,
`WasMentioned`, `GroupRequireMention`, `Sticker {emoji,setName,fileId,fileUniqueId,cachedDescription}`,
`ProviderUpdateId`, `ProviderUpdateKind`, `ProviderMessageTimestamp`, `ProviderEditTimestamp`,
`LocationLivePeriodSeconds`, `ReplyToQuoteText/Position/Entities`, `ReplyToIsExternal`,
`ReplyToForwardedFrom*`, `ForwardedFrom*`.

### 1.10 Ack reaction and enqueue

* `ackReaction` emoji: `accounts.<id>.ackReaction` → `channels.telegram.ackReaction` →
  `messages.ackReaction` → agent identity emoji → `"👀"`. Scope `messages.ackReactionScope`
  default `"group-mentions"` (no DMs); `all | direct | group-all | group-mentions | off|none`.
  Sent via `setMessageReaction(chatId, message_id, [{type:"emoji", emoji}])`; status reactions
  (`messages.statusReactions.enabled`) rotate queued/working/done emojis.
* Typing: `sendChatAction(chatId, "typing", {message_thread_id})` (skipped in channel DM topics);
  started on reply start and kept alive every **4 000 ms** (`TELEGRAM_CHAT_ACTION_INTERVAL_MS`,
  Telegram typing expires after 5 s) for a TTL of 2 min max per keepalive; stopped when the run is
  complete and the dispatcher queue is idle. `record_voice` is used before voice replies.
* Session persistence: `recordInboundSession` updates the session entry and the agent's
  `lastRoute` (`{sessionKey, channel:"telegram", to: telegramTo, accountId, threadId}`) so later
  heartbeats/cron can deliver to the same chat.
* The turn is enqueued to the agent with the ctxPayload; `message_received` hook fires
  (fire-and-forget); the dispatch queue mode (`steer | followup | collect | interrupt`) decides what
  happens if a run is active.

---

## 2. DM pairing

Implemented in core, shared by all channels (`src/pairing/*`); Telegram plugs in via
`pairing.text` adapter (`channel.ts`):

```ts
pairing: {
  text: {
    idLabel: "telegramUserId",
    message: PAIRING_APPROVED_MESSAGE,
    normalizeAllowEntry: createPairingPrefixStripper(/^(telegram|tg):/i),
    notify: async ({ cfg, id, message, accountId }) => send(id, message, { cfg, token, accountId }),
  },
},
```

### Code format / limits (`pairing-store-model.ts`)

* `PAIRING_CODE_LENGTH = 8`, alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (uppercase, no `0 O 1 I`),
  generated with `crypto.randomInt`, unique among pending codes (500 attempts).
* `CHANNEL_PAIRING_PENDING_TTL_MS = 60 * 60 * 1000` (**1 hour**, measured from `createdAt`).
* `CHANNEL_PAIRING_PENDING_MAX = 3` pending requests **per channel account**; the oldest by
  `lastSeenAt` are pruned beyond that (so a 4th stranger gets no code until one expires/is approved).
* Request record: `{ id (sender user id), code, createdAt (ISO), lastSeenAt (ISO), meta: { accountId, username?, firstName?, lastName? } }`.
  Opaque request id for UI approval = `sha256("<channel>\0<accountId>\0<id>\0<createdAt>")` base64url, 32 chars.
* Storage: `channel_pairing_requests` (pending) and `channel_pairing_allow_entries` (approved) in
  the shared SQLite; keyed by channel + account.

### Challenge flow (`issuePairingChallenge`)

1. `upsertChannelPairingRequest({channel:"telegram", id: senderId, accountId, meta})` → `{code, created}`.
   If a non-expired request already exists for this sender: `created=false`, `lastSeenAt` refreshed,
   **nothing is sent** (so repeated messages while pending are silently dropped; the user sees the
   code roughly once per hour per sender). Code is regenerated only after expiry.
2. If created: `channel_pairing_requested` hook (async, never delays the reply), log
   `telegram pairing request` with `{chatId, senderUserId, username, firstName, lastName}`.
3. Reply sent with `sendMessage(chatId, html, { parse_mode: "HTML" })` where the text is rendered
   from this markdown (`buildPairingReply`):

```
OpenClaw: access not configured.

Your Telegram user id: <senderId>
Pairing code:
```
<CODE>
```

Ask the bot owner to approve with:
```
openclaw pairing approve telegram <CODE>
```
```

   (`idLine` is exactly `` `Your Telegram user id: ${sender.candidateId}` ``; the approve command is
   formatted through the CLI helper so profile flags stay valid, e.g.
   `openclaw --profile x pairing approve telegram ABCD2345`.)
4. The triggering message is **not processed**.

### Approval

* CLI: `openclaw pairing list telegram`, `openclaw pairing approve telegram <CODE> [--notify] [--account <id>]`.
  Code is upper-cased before lookup. Control UI: Settings → Channels → DM access requests → Approve
  (options: *Notify the requester after approval*, *Also make this sender the first command owner*)
  or Dismiss (not a block; the sender can request again).
* Approval appends the sender id to the account's allow store (`channel_pairing_allow_entries`).
  Only effective when `dmPolicy === "pairing"` (store entries are ignored for `allowlist`/`open`).
* CLI auto-bootstraps `commands.ownerAllowFrom` with `telegram:<userId>` on the **first** approval
  when no owner exists (grants owner-only commands + exec-approver role). Later approvals only grant
  DM access.
* `--notify` sends `PAIRING_APPROVED_MESSAGE` to the user:
  `"✅ OpenClaw access approved. Send a message to start chatting."`
* Approval grants **DM access only**; group sender authorization never consults the pairing store.
* Reactions, callbacks and edits from unapproved senders are dropped silently (never challenge).

---

## 3. Outbound

### 3.1 Formatting: Markdown → Telegram HTML

* Default outbound text is Telegram **HTML** (`parse_mode: "HTML"`), produced by
  `markdownToTelegramHtml` (markdown-it IR → tags). Mapping: bold `<b>`, italic `<i>`,
  strikethrough `<s>`, inline code `<code>`, fenced block `<pre><code class="language-x">`,
  spoiler `||x||` → `<tg-spoiler>`, blockquote `<blockquote>`, links `<a href="…">` (only
  `https?:`, `tg://`, `mailto:`, `tel:`, `#`; auto-linkified file names like `README.md` are
  suppressed), headings rendered as plain text (`headingStyle: "none"`), tables per
  `markdown.tables` (`off | bullets | code | block`; `block` behaves as `code` in HTML mode).
  Text is escaped (`& < >`), attributes also `"`. Supported raw HTML tags in authored text
  (`b strong i em u ins s strike del code pre tg-spoiler`, `a href`, `span class="tg-spoiler"`,
  `tg-emoji emoji-id`, `tg-time unix format`, `blockquote [expandable]`) are preserved; others
  are escaped. Rich-prompt tags `<ul><ol><li><input type=checkbox><aside><hr>` are downgraded
  (`• `, `1. `, `[x] `, blockquote).
* On a Telegram `can't parse entities` / empty-content rejection the sender retries with the plain
  text fallback (`telegramHtmlToPlainTextFallback`: strips tags, `a` → `label (href)`, tables →
  `a | b` rows) — `withTelegramPlainFallback`.
* `linkPreview: false` → `link_preview_options: { is_disabled: true }`. Bare URLs are explicitly
  linked so they stay tappable, except URLs containing `&`.
* Optional Bot API 10.3 `richMessages: true` → `sendRichMessage` blocks (headings, tables, details,
  checklists…) with limit `TELEGRAM_RICH_TEXT_LIMIT = 32_768`; off by default.
* Captions: HTML, capped at 1024 visible chars; overflow is sent as a following message.
* `responsePrefix` string is prepended to replies when configured.

### 3.2 Chunking

* `TELEGRAM_TEXT_CHUNK_LIMIT = 4000` (Telegram hard limit 4096; safety margin). Effective limit =
  `min(channels.telegram.textChunkLimit ?? 4000, platformLimit)`.
* `markdownToTelegramChunks` splits the markdown IR so rendered HTML per chunk ≤ limit, reopening
  open tags (`<pre><code>`, `<b>` …) at chunk boundaries (`splitTelegramHtmlChunks`).
  `streaming.chunkMode: "newline"` first splits on blank lines (paragraphs) before length.
* A `400 chat not found` / `message thread not found` aborts the remaining chunks; other structured
  400s skip the chunk and continue; 5xx/network stop immediately (partial-delivery error carries
  the message ids already sent).
* Albums: up to 10 photos per `sendMediaGroup`, caption on the first photo.

### 3.3 Streaming / draft modes (`streaming.mode`)

`off | partial | block | progress` — default **`progress`** (since 2026.8.1; previously `partial`).
Also `streaming.chunkMode`, `streaming.preview.{toolProgress, commandText: "status"|"raw"}`,
`streaming.progress.{toolProgress, commandText, commentary}`, `streaming.block.{enabled,...}`.

* `off`: no preview edits; tool/progress chatter suppressed; final answer sent normally.
* `partial`: a preview message is sent once ≥ `DRAFT_MIN_INITIAL_CHARS = 30` chars of answer text
  exist (debounce for push notifications), then `editMessageText` on every throttle tick; the final
  answer is edited in place (short) or the preview becomes chunk 1 and only the remainder is sent.
  Tool-progress lines reuse the same preview (`preview.toolProgress`, default true).
* `block`: completed answer blocks are delivered as separate messages (block streaming); preview
  limited by `resolveChannelDraftStreamingChunking` max chars.
* `progress`: one editable **status draft** (status headline + plan milestones + approval
  requests; tool log only with `progress.toolProgress: true`; failures hidden) is kept during the
  turn and **deleted** at completion; the final answer is a normal new message. Reasoning
  (`/reasoning stream`) streams into the draft and is deleted after final delivery.
* Previews are skipped for the turn when `replyToMode != off` and the inbound has a selected quote
  (native quote reply path), for room events, and when reasoning level `on` forces block mode.

**Edit throttling (`draft-stream.ts`):**

* `DEFAULT_THROTTLE_MS = 1000`, floor 250 ms (`throttleMs = max(250, configured ?? 1000)`): at most
  one `sendMessage`/`editMessageText` per second per draft; latest text wins (coalesced).
* Identical rendered text is not re-sent (dedupe key = `[mode, text, skipEntityDetection, linkPreviewDisabled]`);
  `message is not modified` counts as success.
* Preview calls are "replaceable": during a 429 flood wait they are **skipped**, not queued; final
  sends wait the flood window (budget 5 min). Transient preview failures retry up to
  `MAX_CONSECUTIVE_PREVIEW_FAILURES = 3`, then the preview stops for the turn and final delivery
  falls back to a normal send.
* `MIN_PREVIEW_DWELL_MS = 4000`: a preview is never deleted before it was visible 4 s;
  superseded previews are deleted detached, ≥ `REPOSITION_DELETE_DELAY_MS = 1500` after the
  replacement landed (viewport anchoring).
* Final text longer than the limit: pages are planned once from the rendered HTML; page 1 edits the
  preview, remaining pages are new messages; if the edit fails before confirmation, fall back to
  normal delivery and delete the stale preview.
* Telegram cannot change a message's reply target by edit → in `partial` mode a final that targets a
  different message replaces the preview instead of editing it.

### 3.4 Reply threading (`replyToMode`)

* `channels.telegram.replyToMode`: `off` (default) | `first` | `all` (docs also mention `batched`).
  `off` disables implicit replies only.
* Explicit tags in model output (stripped before render): `[[reply_to_current]]` → reply to the
  triggering message; `[[reply_to:<id>]]` → reply to a specific message id. `[[audio_as_voice]]`
  → send audio as a voice note.
* `first`: one implicit reply target per turn (first message replies, follow-ups don't); each
  queued follow-up turn gets a fresh target. `all`: every message replies.
* Native quote: when threading is on and the original text is known, the reply carries
  `reply_parameters: { message_id, allow_sending_without_reply: true, quote, quote_position?, quote_entities? }`
  (quote ≤ 1024 UTF-16 units, taken from the start). If Telegram answers
  `quote not found` / `QUOTE_TEXT_INVALID` / `quote text invalid` the send is retried with legacy
  `reply_to_message_id` + `allow_sending_without_reply: true`. Without quote text the legacy form is
  used directly.
* Thread params: forum topic → `message_thread_id` (omitted for General topic `1`); channel DM
  topic → `direct_messages_topic_id`; topic id must be a positive integer
  (`TELEGRAM_INVALID_TOPIC_ID_MESSAGE` otherwise).
* `silent: true` → `disable_notification: true`; `--pin` → pin after send when allowed.

### 3.5 Inline buttons / callback data

* Scope `capabilities.inlineButtons`: `off | dm | group | all | allowlist` (default **allowlist** =
  sender must pass the normal access policy to click); legacy `capabilities: ["inlineButtons"]` ⇒ `all`.
* `presentation.blocks[{type:"buttons", buttons:[{label, action, style}]}]` →
  `reply_markup.inline_keyboard`; interactive rows are chunked **3 per row**
  (`TELEGRAM_INTERACTIVE_ROW_SIZE`), `ask_user` question options one per row; `style`
  `danger | success | primary` (Bot API button style). Button kinds:
  `{type:"url", url}` → `url`; `{type:"web-app", url}` → `web_app` (DM only, else dropped);
  `{type:"callback", value}` → `callback_data = value` (plain, ≤ 64 bytes).
* Reserved callback-data namespaces (all ≤ `TELEGRAM_CALLBACK_DATA_MAX_BYTES = 64` UTF-8 bytes):
  * Approvals: `tga1:<kind>:<decision>:<approvalId>` with kind `e|p|s` (exec, plugin, system-agent)
    and decision `o|a|d` (allow-once, allow-always, deny); if too long the approvalId is replaced
    by `buildApprovalResolutionRef` digest.
  * Questions (`ask_user`): `tgq1:<ask_[32 hex]>:<optionIndex 0-3>` select;
    `tgqo1:<ask_[32 hex]>` = "Other…" custom input (Force Reply prompt
    `"Reply with your own answer."`, in groups `"<first_name>, reply with your own answer."` with
    selective force reply; feedback `"Answer submitted."` / `"This question was already answered."` /
    `"Could not submit this answer."`).
  * Native command menus: `tgcmd:/<command> <arg>` (e.g. `/think` level picker, `/fast`, `/tts`
    menus; built as 2 buttons per row).
  * Opaque plugin values: `tgcb1:<5-char fnv1a base36 checksum>:<value>`.
  * Model picker: `mdl1~…`; commands pagination `commands_page_<n>[:<agentId>]` / `commands_page_noop`.
  * Legacy approval commands `/approve <id> allow-once|always|deny` as raw callback data.
  * Managed selects: `OC_SELECT|…`, `OC_MULTI|toggle|…` (prefix `✅ ` marks selected).
* Buttons that cannot be encoded are dropped and rendered as text fallback
  (`appendTelegramDroppedControlFallback`), with warning
  `Telegram delivered <n> unencodable control(s) as readable text.` / `Telegram could not deliver <n> control(s).`
* **Callback handling** (`bot-handlers.callback-router.ts`): always `answerCallbackQuery` first
  (durable ingress answers right after storing the update); authorize sender
  (`callback-allowlist` for DMs or allowlist scope, `callback-scope` for group with dm/group/all,
  `callback-runtime-allowlist` for questions); after routing, the message's inline keyboard is
  cleared (`editMessageReplyMarkup` with `{inline_keyboard: []}`); unclaimed generic values are
  turned into a synthetic text message for the agent: `callback_data: <value>` (or the value itself
  if it starts with `/`), with `forceWasMentioned: true`, `messageIdOverride = callback.id`,
  date = time the click was received. Stale typed controls reply
  `"This action is no longer available."`.

### 3.6 Reactions

* Outbound: `react` action → `setMessageReaction(chatId, messageId, [{type:"emoji"|"custom_emoji", ...}])`;
  `emoji-list` returns allowed reactions; gated by `actions.reactions` (default on).
* Inbound `message_reaction` updates: `reactionNotifications: off | own | all` (default `own` =
  reactions on bot-sent messages, tracked via the sent-message cache) and `reactionLevel`
  `off | ack | minimal | extensive` (default `minimal`). Enqueued as system event text
  `Telegram reaction added: 👍 by Alice (@alice) on msg 42` (custom emoji → `custom emoji <id>`,
  paid reactions ignored). Topic recovered from the message cache (reaction updates carry no
  thread id). Access policy applies (unauthorized senders dropped).

### 3.7 Rate limiting (`grammy-api-throttler.ts`, `account-throttler.ts`)

* Owned copy of grammY `apiThrottler` defaults: global reservoir 30 req/s; per-group-chat
  (`chat_id < 0`) `maxConcurrent 1, minTime 1000 ms, reservoir 20 / 60 s`; per-private-chat
  `maxConcurrent 1, minTime 1000 ms`. Disposed when a bot token is retired.
* Flood gate per bot token: on `429` with `retry_after` all calls for that token wait that long
  (bare 429 → 1 000 ms); non-replaceable calls (final replies, deletes, reactions) wait and retry
  within `TELEGRAM_OUTBOUND_FLOOD_BUDGET_MS = 5 min`; replaceable calls (stream previews, typing)
  return a synthetic 429 (`Too Many Requests: retry after N (flood wait active; request not sent)`)
  and are skipped. `getUpdates` bypasses the gate. Log:
  `Telegram flood control on <method>: all calls for this bot wait <n>s[; replaceable update skipped]`.
* `sendChatAction` has a separate per-account 401 backoff handler.

### 3.8 Other outbound behaviours

* Error policy `errorPolicy: always | once | silent` (default `always`) decides whether agent/provider
  errors are posted to the chat; `silentErrorReplies` suppresses text.
* Media sends: images → `sendPhoto` (or `sendDocument` with `--force-document`), video →
  `sendVideo`/`sendVideoNote` (`asVideoNote`), audio → `sendAudio`/`sendVoice` (`asVoice` or
  `[[audio_as_voice]]`; duration probed with ffprobe), documents → `sendDocument`, location/venue →
  `sendLocation`/`sendVenue`, stickers (`actions.sticker`, off by default) → `sendSticker`, polls →
  `sendPoll` (2–12 options, 5–604800 s).
* Group join: when added to an allowed group the bot posts one introduction (`joinIntro`, default
  true) grounded in title/description/pinned message.

---

## 4. Native commands

Registered at startup with `setMyCommands` when `commands.native` is `"auto"`/true. Names
normalized (`strip /`, lowercase, pattern `^[a-z0-9_]{1,32}$`); Telegram caps the menu at 100
commands and a conservative total text budget — overflow trims skill commands first (keeping `/skill`),
then shortens descriptions, then drops. Custom entries `customCommands: [{command, description}]`
are menu-only (no behaviour) and cannot override natives. Hidden commands remain callable.
`/<cmd>@<botname>` is accepted only when the target matches this bot. Commands are dispatched
through `bot.command(...)` **before** the generic message pipeline; commands whose argument menu
can't be resolved fall through to the pipeline (then handled by the core slash-command parser).

Built-in registry (`commands-registry.shared.ts`; `nativeName: false` = text-only, not in the menu):

| Command | Description (verbatim) | Notes |
| --- | --- | --- |
| `/help` | Show available commands. | essential |
| `/commands` | List all slash commands. | paginated with inline keyboard |
| `/tools [compact\|verbose]` | List available runtime tools. | choice menu |
| `/skill <name> [input]` | Run a skill by name. | |
| `/dashboard [request]` | Create or update this session's dashboard. | |
| `/learn [request]` | Draft a reusable skill from recent work or named sources. | |
| `/loop …` | Loop a prompt: /loop [interval] <prompt> \| /loop status \| /loop stop [name] | |
| `/status` | Show current status. | shows rich-messages on/off etc. |
| `/goal <action> [text]` | Show or control the current goal. | status/start/edit/pause/resume/complete/block/clear |
| `/diagnostics [note]` | Explain Gateway diagnostics and Codex feedback upload options. | |
| `/login [provider]` | Connect a model provider. | native on telegram; inline provider buttons |
| `/openclaw` | Run the OpenClaw setup and repair helper. | text-only |
| `/allowlist` | List/add/remove allowlist entries. | text-only |
| `/approve <id> <decision>` | Approve or deny exec requests. | see §5 |
| `/context` | Explain how context is built and used. | |
| `/btw` (`/side`) | Ask a side question without changing future session context. | bypasses debounce |
| `/export-session [path]` (`/export`) | Export current session to an owner-only HTML file in the workspace. | |
| `/export-trajectory [path]` (`/trajectory`) | Export a JSONL trajectory bundle for the active session. | |
| `/tts <action> [value]` | Control text-to-speech (TTS). | menu title: "TTS Actions:\n• On – Enable TTS for responses\n• Off – Disable TTS\n• Status – Show current settings\n• Provider – Show or set the voice provider\n• Limit – Set max characters for TTS\n• Summary – Toggle AI summary for long texts\n• Audio – Generate TTS from custom text\n• Help – Show usage guide" |
| `/whoami` (`/id`) | Show your sender id. | useful to find user/group IDs |
| `/session <idle\|max-age\|unbind> [value]` | Manage conversation bindings and session lifecycle settings. | |
| `/subagents <list\|log\|info> …` | Inspect subagent runs for this session. | |
| `/acp <action> …` | Manage ACP sessions and runtime options. | spawn/cancel/steer/close/… |
| `/agents` | List thread-bound agents for this session. | |
| `/steer <msg>` (`/tell`) | Send guidance to the active run in this session. | |
| `/followup <msg>` | Run this message as a new turn without changing queue mode. | |
| `/config show\|get\|set\|unset <path> [value]` | Show or set config values. | owner-only; `set/unset` need `configWrites` |
| `/mcp …` | Show or set OpenClaw MCP servers. | |
| `/plugins …` (`/plugin`) | List, show, enable, or disable plugins. | |
| `/debug …` | Set runtime debug overrides. | |
| `/usage off\|tokens\|full\|cost` | Usage footer or cost summary. | |
| `/stop` | Stop the current run. | also cancels pending buffered text |
| `/restart` | Restart OpenClaw. | owner |
| `/update` | Update OpenClaw and restart. | owner |
| `/activation mention\|always` | Set group activation mode. | session-scoped, not persisted |
| `/send on\|off\|inherit` | Set send policy. | |
| `/reset [soft]` | Reset the current session. | `/reset soft` keeps context |
| `/new` | Start a new session. | resets automatic context, not retained history |
| `/name [title]` | Name or rename the current session. | |
| `/compact [instructions]` | Compact the session context. | |
| `/think <level>` (`/thinking`, `/t`) | Set thinking level. | inline level picker, title prefixed `Current thinking level: <x>.` |
| `/verbose on\|off\|full` (`/v`) | Toggle verbose mode. | |
| `/trace on\|off\|raw` | Toggle plugin trace lines. | |
| `/fast on\|off\|auto\|default\|status` | Toggle fast mode. | |
| `/reasoning on\|off\|stream` (`/reason`) | Toggle reasoning visibility. | |
| `/elevated on\|off\|ask\|full` (`/elev`) | Toggle elevated mode. | |
| `/exec host=… security=… ask=… node=…` | Set exec defaults for this session. | |
| `/model [id] [-s\|-a\|-g]` | Show or set the model; use -s, -a, or -g to choose scope. | inline provider/model picker (`mdl1~`) |
| `/models` | List model providers/models. | |
| `/queue mode=… debounce=… cap=… drop=…` | Adjust queue settings. | |
| `/bash <command>` | Run host shell commands (host-only). | text-only |

Plugin commands: `/pair`, `/pair qr`, `/pair pending`, `/pair approve [<requestId>|latest]`,
`/pair cleanup` (device-pair plugin), `/controlui` (Mini App), skill commands (`/<skill>`).
There is no `/start` handler: a `/start` from a new user just goes through the normal pipeline
(pairing challenge if unapproved). Native commands from an authorized sender count as a mention
in groups and bypass pairing when the sender is in `commands.allowFrom`/`ownerAllowFrom`.
Model-change reply after picker: `✅ Model changed to <b>provider/model</b>\n\nSession-only model selection. Runtime set to <b>…</b>. The agent default in openclaw.json is unchanged. This chat keeps the model selection across /new and /reset; use /model default -s to clear the session model selection.`

---

## 5. Exec approval flow over Telegram

Config (`channels.telegram[.accounts.<id>].execApprovals`): `enabled: "auto" | true | false`
(`auto` = enabled when ≥ 1 approver resolvable), `approvers: [userIds]` (fallback: numeric IDs in
`commands.ownerAllowFrom` with `telegram:` prefix stripped; negative chat ids ignored),
`target: "dm" | "channel" | "both"` (default `dm`), `agentFilter`, `sessionFilter`.
Approval request default TTL `DEFAULT_EXEC_APPROVAL_TIMEOUT_MS = 1_800_000` (**30 min**).

**Who may approve:** only resolved approvers (explicit `approvers` or owner IDs). Being in
`allowFrom` does not make one an approver. Non-approver `/approve` →
`❌ You are not authorized to approve this request.`; wrong bot →
`❌ This /approve command targets a different Telegram bot.`; disabled →
`❌ Telegram exec approvals are not enabled for this bot account.`; system-agent changes →
`❌ Only the owner can approve OpenClaw changes in this chat.`. Unauthorized button clicks are
dropped silently (log `Blocked telegram approval callback from <id> (not authorized)`).

**Delivery:** `sendTyping` then `sendMessage` to each approver DM (`target dm`/`both`) and/or the
originating chat/topic (`channel`/`both`; preserves `message_thread_id`). When only DMs are used the
origin chat gets `Approval required. I sent approval DMs to the approvers for this account.`
Buttons require `capabilities.inlineButtons` to allow the surface.

**Pending text** (`buildExecApprovalPendingReplyPayload`, markdown → HTML):

```
[warningText]

Approval required.

Run:
```txt
/approve <approvalId> allow-once
```

Pending command:
```sh
<command>
```

Other options:
```txt
/approve <approvalId> allow-always
/approve <approvalId> deny
```

[Allow Always is unavailable for this command.]

Host: gateway|node
[Node: <nodeId>]
[CWD: <cwd>]
[Scope: <scope summary>]
Expires in: 29m
Full id: `<approvalId>`
```

**Buttons** (one row, in this order, filtered by `allowedDecisions`):
`Allow Once` (style `success`, callback `tga1:e:o:<id>`), `Allow Always` (`primary`, `tga1:e:a:<id>`),
`Deny` (`danger`, `tga1:e:d:<id>`). Plugin approvals use kind `p`; system-agent approvals use
`s` and the text
`🔒 OpenClaw change requires approval\nChange: <summary>\nAgent: <id>\nExpires in: <t>` plus an
optional `Review in Control UI` URL button.
Legacy/text path: `/approve <id> allow-once|allow-always|always|deny` (`always` alias rewritten to
`allow-always`; `parseExecApprovalCommandText` regex
`^/?approve(?:@[^\s]+)?\s+([A-Za-z0-9][A-Za-z0-9._:-]*)\s+(allow-once|allow-always|always|deny)\b`).

**Resolution:** first answer wins (`approval.resolve` over the gateway); the card is edited to the
terminal text with buttons removed (`editMessageText` + `buttons: []`):

```
✅ Approval resolved here            | ℹ️ Approval already resolved
Recorded result: Allow once|Allow always|Deny|Expired|Cancelled
ID: <approvalId>

Command:
<command preview>
```

Native resolved/expired events: `✅ Exec approval resolved\nRecorded result: <…>\n[Resolved by: <who>]\nID: …\n\nCommand:\n…`,
`⏱️ Exec approval expired\nRecorded result: Expired\nID: …`; system-agent:
`✅ OpenClaw change approved. Applying: <desc>`, `❌ OpenClaw change denied. No change was made.`,
`⏱️ OpenClaw change expired. No change was made.`,
`⚠️ OpenClaw change was cancelled because its run ended. No change was made. Retry.`;
malformed reserved callback → `ℹ️ Approval action unavailable\nThis button is invalid or no longer actionable.`;
stale legacy → `ℹ️ Approval no longer pending\nIt was already resolved or expired; the recorded decision is unavailable here.\nID: …`.
Limits: detail 2 800 chars, id 512, whole message 4 000. The result of a delegated change is
returned to the requesting chat/topic even if the card went to an approver DM.

---

## 6. Node protocol (devices with `role: "node"`)

### 6.1 Transport & framing

WebSocket, text frames, JSON. Frames: request `{type:"req", id, method, params, traceparent?, expectedProfileId?}`,
response `{type:"res", id, ok, payload|error}`, event `{type:"event", event, payload, seq?, stateVersion?}`.
Errors `{ code, message, details?, retryable?, retryAfterMs? }`. Pre-auth frames ≤ 64 KiB; after
hello `policy.maxPayload` (default 25 MiB) / `maxBufferedBytes` (50 MiB). Protocol version 4
(N-1 = v3 nodes accepted when `role:"node"` and `client.mode:"node"`). Keepalive: WS ping/pong,
25 s pong window. Connect deadline 30 s total.

### 6.2 Handshake

1. Server sends `{"type":"event","event":"connect.challenge","payload":{"nonce":"…","ts":1737264000000}}`.
2. Client sends `connect` (schema `ConnectParamsSchema`, closed object):

```json
{
  "type": "req", "id": "…", "method": "connect",
  "params": {
    "minProtocol": 4, "maxProtocol": 4,
    "client": { "id": "ios-node", "displayName"?: "…", "version": "1.2.3", "buildId"?: "…",
                "platform": "ios", "deviceFamily"?: "iphone", "modelIdentifier"?: "…",
                "timeZone"?: "Europe/Istanbul", "mode": "node", "instanceId"?: "…" },
    "role": "node",
    "scopes": [],
    "caps": ["camera", "canvas", "screen", "location", "voice", "talk", "computer", "system.run.execution-context.v1"],
    "commands": ["camera.snap", "screen.record", "location.get", "system.run", "system.which", "system.notify", "device.info", "device.status"],
    "permissions": { "camera.capture": true, "screen.record": false },
    "computerUse"?: { … },
    "pathEnv"?: "…",
    "auth": { "token"?: "<shared gateway token>", "password"?: "…", "bootstrapToken"?: "<from setup code>", "deviceToken"?: "<issued per device+role>" },
    "locale": "en-US",
    "userAgent": "openclaw-ios/1.2.3",
    "device": { "id": "<sha256 fingerprint of public key>", "publicKey": "<base64 ed25519>", "signature": "<base64>", "signedAt": <challenge.ts>, "nonce": "<challenge.nonce>" }
  }
}
```

3. Signature payload (`packages/gateway-client/src/device-auth.ts`), signed with the device key:
   * v2: `"v2|<deviceId>|<clientId>|<clientMode>|<role>|<scopes joined by ','>|<signedAtMs>|<token or ''>|<nonce>"`
   * v3 (preferred): `"v3|<deviceId>|<clientId>|<clientMode>|<role>|<scopes>|<signedAtMs>|<token>|<nonce>|<platform lowercased>|<deviceFamily lowercased>"`
   `device.id` must equal the public-key fingerprint. Error codes: `DEVICE_AUTH_NONCE_REQUIRED`,
   `DEVICE_AUTH_NONCE_MISMATCH`, `DEVICE_AUTH_SIGNATURE_INVALID`, `DEVICE_AUTH_SIGNATURE_EXPIRED`,
   `DEVICE_AUTH_DEVICE_ID_MISMATCH`, `DEVICE_AUTH_PUBLIC_KEY_INVALID`.
4. Auth path: shared secret (`auth.token`/`auth.password`), bootstrap token (setup code), or
   device token. `auth.token` priority on the client: explicit shared token → explicit device token
   → stored per-device token (keyed by deviceId+role); `bootstrapToken` only when none resolved.
5. Response `hello-ok`:

```json
{ "type":"res","id":"…","ok":true,"payload":{
  "type":"hello-ok","protocol":4,
  "server":{"version":"…","connId":"…"},
  "features":{"methods":["…"],"events":["…"],"capabilities":["…"]},
  "snapshot":{…},
  "auth":{"role":"node","scopes":[],"deviceToken"?:"…","deviceTokens"?:[{"deviceToken":"…","role":"operator","scopes":["operator.approvals","operator.read","operator.talk.secrets","operator.write"]}]},
  "policy":{"maxPayload":26214400,"maxBufferedBytes":52428800,"tickIntervalMs":15000,"attachments":{"maxBytes":20971520,"maxImageBytes":6291456}},
  "pluginSurfaceUrls"?:{"canvas":"…"} } }
```

   Unpaired device → error `NOT_PAIRED` with `details.code: "PAIRING_REQUIRED"`, `details.requestId`,
   `details.deviceId`, `recommendedNextStep: "wait_then_retry"`, `retryable: true`; node hosts keep
   reconnecting with exponential backoff capped at 30 s. Other codes: `AUTH_TOKEN_MISMATCH`
   (`canRetryWithDeviceToken`), `AUTH_SCOPE_MISMATCH`, `OPERATOR_ACCESS_DENIED`, `UNAVAILABLE`
   (`details.reason: "startup-sidecars"`, `retryAfterMs`).

### 6.3 Device pairing store (approval of the connection)

* First connect of an unknown `device.id` creates a pending request
  (`DevicePairRequestedEvent`): `{ requestId, deviceId, publicKey, displayName?, platform?, deviceFamily?, clientId?, clientMode?, browserOrigin?, role?, roles?, scopes?, remoteIp?, silent?, isRepair?, ts }`.
  Broadcast as event `device.pair.requested`. Pending TTL **5 min** from the device's last retry
  (`refreshedAtMs` keepalive — one pending request per device). Changed role/scopes/public key
  supersedes the request (new `requestId`, event `device.pair.resolved` for the old one).
* Approve/reject: RPC `device.pair.approve {requestId}` / `device.pair.reject {requestId}` /
  `device.pair.list {}` / `device.pair.remove {deviceId}` / `device.pair.rename {deviceId,label}`;
  CLI `openclaw devices list|approve|reject <requestId>`; Control UI Settings → Devices. Approval
  scope: `operator.pairing`; approving broader scopes than the caller holds → `missing scope: …`.
* Paired record (`PairedDevice`): pending fields minus `requestId/silent/isRepair/ts` plus
  `operatorLabel?`, `approvedScopes?`, `tokens?: Record<role, DeviceAuthToken>` where
  `DeviceAuthToken = { token, role, scopes, issuer?, createdAtMs, rotatedAtMs?, revokedAtMs?, lastUsedAtMs? }`,
  `approvedVia?: "owner"|"silent"|"trusted-cidr"|"trusted-proxy"|"remote-ingress"|"ssh-verified"|"bootstrap"`,
  `nodeSurface?`, `pendingNodeSurface?`, `createdAtMs`, `approvedAtMs`, `lastSeenAtMs?`, `lastSeenReason?`.
  A device token is issued per device+role and returned in `hello-ok.auth.deviceToken`; rotate /
  revoke via `device.token.rotate {deviceId, role, scopes?}` / `device.token.revoke {deviceId, role}`.
* Auto-approval options: `gateway.nodes.pairing.autoApproveCidrs` (first-time `role:node` with no
  scopes only, approves the device not the surface), `sshVerify` (default on), same-host loopback
  "silent", bootstrap setup codes.
* **Setup code** (`device.pair.setupCode {publicUrl?, preferRemoteUrl?, includeQr?, bootstrapProfile?: "limited"|"node"|"voice-node", joinUrl?}`,
  requires `operator.admin`) → `{ setupId?, setupCode, joinUrl?, command?, qrDataUrl?, gatewayUrl, gatewayUrls?, auth: "token"|"password"|"trusted-proxy", urlSource, access?: "full"|"limited"|"node", accessDowngraded?, expiresAtMs? }`.
  The code is base64 JSON `{ url, urls?, bootstrapToken }`; bootstrap token single-use, expires after
  **10 minutes**. Default profile: `node` token (`scopes: []`) + operator token with
  `operator.admin, operator.approvals, operator.read, operator.talk.secrets, operator.write`;
  `limited` omits `operator.admin`; plaintext LAN `ws://` is auto-limited. Telegram `/pair` sends the
  instruction and the code as two messages; `/pair pending`, `/pair approve <requestId>|latest`,
  `/pair cleanup`. Node host one-paste: `openclaw node run --pair "oc-pair://<setup-code>"`.
  Completion events `device.pair.setup.completed` / `device.pair.setup.deliveryUncertain`
  `{ setupId, deviceId, deviceName?, access, ts }`; `device.pair.setupStatus {setupId}`.

### 6.4 Capability / command surface approval (second approval)

Device approval admits the connection; the **declared surface** (`caps`, `commands`,
`permissions`, `computerUse`) needs its own approval stored on the same paired-device record
(`pendingNodeSurface` → `nodeSurface` = `{ displayName?, version?, caps?, commands?, permissions?, bins?, sessionHost?, createdAtMs, approvedAtMs, lastConnectedAtMs?, lastHostStats? }`).

* RPCs: `node.pair.list {}` → `{ pending: [{requestId, nodeId, commands, requiredApproveScopes, …}], paired: [...] }`,
  `node.pair.approve {requestId}`, `node.pair.reject {requestId}`, `node.pair.remove {nodeId}`,
  `node.rename {nodeId, displayName}`; CLI `openclaw nodes pending|approve|reject|remove|rename`.
* Required approver scopes (`node-pairing-authz.ts`): no commands → `operator.pairing`; ordinary
  commands → `operator.pairing + operator.write`; includes `system.run`, `system.run.prepare`,
  `system.which`, `browser.proxy`, `browser.proxy.upload.v1`, `fs.listDir`,
  `system.execApprovals.get/set` → `operator.pairing + operator.admin`.
* Initial surface auto-approved when the device was approved via `silent` (same host, unless
  `gateway.nodes.pairing.autoApproveLocal: false`), `ssh-verified` or `bootstrap`; `trusted-cidr`
  does not. Expansions (new commands/caps/permissions) always create a new pending surface; already
  approved commands keep working while pending. Broadcast `node.pair.resolved {requestId, nodeId, decision:"approved"|"rejected", ts}`.
* Runtime invoke requires all three: declared in `connect.commands`, present in the approved
  surface, allowed by Gateway policy (`resolveNodeCommandAllowlist`): platform defaults
  (iOS: `camera.list location.get device.info device.status contacts.search calendar.events reminders.list photos.latest motion.activity motion.pedometer system.notify`;
  watchOS: `device.info device.status system.notify`; Android adds `notifications.list notifications.actions device.permissions device.health device.apps callLog.search mobile.ui.observe mobile.ui.act`;
  macOS: camera + `camera.ptz.status location.get device.info device.status device.apps …`
  + desktop commands; Windows: `camera.list location.get device.info device.status system.notify computer.act` + desktop host commands after pairing approval;
  Linux: `system.notify computer.act` + desktop host; unknown platform: `camera.list location.get system.notify` only)
  + talk PTT commands when the node has the `talk` cap + plugin defaults + `gateway.nodes.commands.allow`
  − `gateway.nodes.commands.deny` − private worker commands. Dangerous commands
  (`camera.snap camera.clip camera.ptz.control screen.record contacts.add calendar.add reminders.add sms.send sms.search health.summary`)
  need explicit `commands.allow`. Desktop host commands (`system.run system.run.prepare system.which system.execApprovals.* fs.listDir terminal.upload browser.proxy* mcp.tools.call.v1 agent.cli.claude.run.v1 screen.snapshot desktop.stream`) enter the allowlist only through surface approval.
  Denials: `command not allowlisted`, `command not declared by node`, `node did not declare commands`.

### 6.5 Invoke / result / event frames

* Operator → gateway `node.invoke` (`NodeInvokeParamsSchema`):
  `{ nodeId, command, params?, timeoutMs?, idempotencyKey, sessionKey?, turnSourceChannel?, turnSourceTo?, turnSourceAccountId?, turnSourceThreadId? }`
  (the `turnSource*` / `sessionKey` fields are gateway-only routing metadata, stripped before
  forwarding).
* Gateway → node event `node.invoke.request` (`NodeInvokeRequestEventSchema`):
  `{ id, nodeId, command, paramsJSON?, timeoutMs?, idempotencyKey? }`.
* Node → gateway `node.invoke.result` (`NodeInvokeResultParamsSchema`):
  `{ id, nodeId, ok, payload?, payloadJSON?, error?: { code?, message?, details?: { capabilities: [..], state } } }`.
  `NODE_NOT_READY` is retried up to 4× within the deadline; `NODE_BACKGROUND_UNAVAILABLE` etc. are
  terminal.
* Streaming: node → `node.invoke.progress { invokeId, nodeId, seq, chunk (≤16 KiB UTF-8, "" = heartbeat) }`;
  gateway → node `node.invoke.input { id, nodeId, seq, payloadJSON (≤16 KiB) }`;
  cancel event `node.invoke.cancel { invokeId, nodeId }`. Duplex idle timeout
  `NODE_DUPLEX_INVOKE_IDLE_TIMEOUT_MS = 30_000`.
* Node-originated events: `node.event { event, payload?, payloadJSON? }` → `{ ok, event, handled, reason? }`.
  Known events: `presence.alive` (`{ trigger, sentAtMs?, displayName?, version?, platform?, deviceFamily?, modelIdentifier?, pushTransport? }`),
  `presence.activity` (`{ idleSeconds, source?: "app"|"system", saturated? } | { action: "clear" }`),
  host stats (`{ cpuCount, loadAverage?: [n,n,n], memoryTotalBytes, memoryFreeBytes, diskTotalBytes?, diskAvailableBytes? }`, every 60 s),
  `system.run` exit notifications, location/status replies to pending work.
* Pending work for offline nodes: `node.pending.enqueue { nodeId, type: "status.request"|"location.request", priority?: "normal"|"high", expiresInMs? (1 s–24 h), wake? }`,
  node side `node.pending.pull` / `node.pending.drain { maxItems? ≤10 }` → `{ nodeId, revision, items:[{id,type,priority,createdAtMs,expiresAtMs?,payload?}], hasMore }`,
  `node.pending.ack { ids }`.
* Catalog publication (node role, after connect): `node.pluginTools.update { tools: [{ pluginId, name (^[A-Za-z][A-Za-z0-9_-]{0,63}$), description, parameters?, command?, mcp?: {server, tool} }] }`,
  `node.skills.update { skills: [{ name, description ≤1024, content ≤64 KiB }] (≤64) }`.
* `node.list {}` / `node.describe {nodeId}` return `{ nodeId, displayName, platform, deviceFamily, caps, commands, permissions, connected, connectedAtMs, lastSeenAtMs, hostStats, paired, … }`.

### 6.6 Node commands and param shapes

| Command | Params | Result / notes |
| --- | --- | --- |
| `system.run.prepare` | same as `system.run`; node evaluates local exec policy and returns a `systemRunPlan` (`{ argv, cwd, commandText, commandPreview?, agentId, sessionKey, policySnapshot?, mutableFileOperand? }`) + whether approval is needed | exec tool only |
| `system.run` | `{ command: string[] (argv), rawCommand?, systemRunPlan?, cwd?, env?: {k:v}, executionContext?: { senderId?, chatId?, subagent? }, timeoutMs? (null = none), needsScreenRecording?, agentId?, sessionKey?, runId (uuid, gateway-assigned if missing), suppressNotifyOnExit? }` — forwarding allowlist in `pickSystemRunParams` | payload `{ stdout, stderr, exitCode, … }`; progress streamed; blocked in `nodes invoke` / `nodes` tool (`reserved for shell execution; call the shell exec tool with { command, host: "node", node }`); `PATH` overrides ignored, interpreter env vars stripped; shell wrappers (`bash -c`) keep only `TERM LANG LC_* COLORTERM NO_COLOR FORCE_COLOR`; local policy `deny|allowlist|full` + `ask off|on-miss|always`; denied prompts → `SYSTEM_RUN_DENIED`; grace for authorized-run events 5 min |
| `system.which` | `{ bins: string[] (1–64) }` | `{ bins: {...}}` resolved paths |
| `system.execApprovals.get` / `.set` | `{}` / `{ file, baseHash?, expectedOwnerId? }` | node-local exec approval policy |
| `system.notify` | `{ title, body, sound?, priority?: "passive"\|"active"\|"timeSensitive", delivery?: "system"\|"overlay"\|"auto" }` (title or body required) | `{ ok: true }`; Linux maps priority to `notify-send --urgency low/normal/critical`; errors `NOTIFICATIONS_DISABLED`, `NOTIFICATIONS_UNAVAILABLE`, `INVALID_REQUEST: empty notification` |
| `screen.snapshot` | `{ screenIndex?: 0, maxWidth?, format?: "jpg" }` | `{ format, base64, width, height, screenIndex }` |
| `screen.record` | `{ durationMs (tool caps 300000), screenIndex?, fps?, format: "mp4", includeAudio?: true }` | `{ format:"mp4", base64, durationMs, fps, screenIndex }`; dangerous (needs `commands.allow`) |
| `camera.list` | `{}` | `{ devices: [{ id, name, position, deviceType }] }` |
| `camera.snap` | `{ facing?: "front"\|"back" (default front), maxWidth? (1600), quality? 0..1 (0.9 iOS / 0.95 Android), format: "jpg", delayMs? (0, cap 10000; macOS default 2000), deviceId? }` | `{ format:"jpg", base64, width, height }`; base64 kept < 5 MB; foreground only on mobile (`NODE_BACKGROUND_UNAVAILABLE`), `CAMERA_DISABLED`, `CAMERA_PERMISSION_REQUIRED` |
| `camera.clip` | `{ facing?, durationMs (3000; iOS 250–60000, Android 200–60000), includeAudio?: true, format: "mp4", deviceId? }` | `{ format:"mp4", base64, durationMs, hasAudio }`; `MIC_PERMISSION_REQUIRED`, `PAYLOAD_TOO_LARGE` (>18 MB) |
| `camera.ptz.status` / `camera.ptz.control` | `{ deviceId }` / `{ deviceId, operation: "set"\|"move"\|"home", target?|delta?: { panDegrees?, tiltDegrees?, zoomPercent? } }` | macOS UVC only |
| `photos.latest` | `{ limit?, maxWidth?, quality? }` | images |
| `location.get` | `{ timeoutMs?, maxAgeMs?, desiredAccuracy?: "coarse"\|"balanced"\|"precise" }` | `{ lat, lon, accuracyMeters, altitudeMeters?, speedMps?, headingDeg?, timestamp (ISO), isPrecise, source: "gps"\|"wifi"\|"cell"\|"unknown" }`; errors `LOCATION_DISABLED`, `LOCATION_PERMISSION_REQUIRED`, `LOCATION_BACKGROUND_UNAVAILABLE`, `LOCATION_TIMEOUT`, `LOCATION_UNAVAILABLE` |
| `device.info` | `{}` | static device facts (model, OS, version…) |
| `device.status` | `{}` | battery / network / thermal state etc. |
| `device.permissions`, `device.health`, `device.apps` (`{ query?, limit?, includeSystem?, includeNonLaunchable? }`) | | Android/macOS |
| `notifications.list` / `notifications.actions` | `{}` / `{ key, action: "open"\|"dismiss"\|"reply", replyText? }` | Android |
| `contacts.search`, `contacts.add`, `calendar.events`, `calendar.add`, `reminders.list`, `reminders.add`, `callLog.search`, `sms.search` (`{query…}`), `sms.send` (`{ to, message }`), `motion.activity`, `motion.pedometer`, `health.summary` | | mobile; `*.add`, `sms.*`, `health.summary` dangerous |
| `talk.ptt.start` / `talk.ptt.stop` / `talk.ptt.cancel` / `talk.ptt.once` | push-to-talk control | allowed when node has `talk` cap |
| `talk.speak` | gateway RPC (scope `operator.talk`): `{ text, voice?, rateWpm?/speed 0.5–2, … }` | errors `talk.speak requires text`, `talk.speak unavailable: talk provider not configured` |
| `canvas.present {x?,y?,width?,height?}`, `canvas.hide`, `canvas.navigate {url}` | macOS widget panel | plugin default on macOS |
| `computer.act`, `mobile.ui.observe`, `mobile.ui.act`, `desktop.stream` | computer-use | advertised only while local control is enabled |
| `fs.listDir` (sub-directories only), `terminal.upload`, `file.fetch`, `dir.list`, `dir.fetch`, `file.write` | path-allowlisted file transfer | admin-only / dedicated tools |
| `browser.proxy`, `browser.proxy.upload.v1`, `mcp.tools.call.v1` (120 s), `agent.cli.claude.run.v1`, `codex.exec-server.stdio.v1` | host relays | admin approval |

Node `permissions` map in `node.list`: e.g. `{ screenRecording: true, accessibility: false, location: true, "camera.capture": true }`.

### 6.7 How the gateway exposes nodes to the agent

* Tool **`nodes`** (`src/agents/tools/nodes-tool.ts`), label `Nodes`, description (verbatim):
  > Paired nodes: status/list with active-computer presence; pass node to describe/control. Pairing lifecycle (pending/approve/reject), notify, camera_snap/camera_list/camera_clip (with audio), camera_ptz for physical camera pan/tilt/zoom, photos_latest, screen_snapshot, screen_record video, location_get, notifications_list + notifications_action (open/dismiss/reply), device_status/device_info/device_permissions/device_health, executable lookup (which + bins), generic invoke (fs.listDir returns sub-directories only). File transfer is a separate capability.

  Flat parameter schema: `action` ∈ `status, describe, pending, approve, reject, notify, camera_snap, camera_list, camera_clip, camera_ptz, photos_latest, screen_record, screen_snapshot, location_get, notifications_list, notifications_action, device_status, device_info, device_permissions, device_health, which, invoke`;
  `node` ("Node ID, name, or IP. Required for describe and node-targeted actions; use status to discover nodes."),
  `requestId`, `title`, `body`, `sound`, `priority (passive|active|timeSensitive)`, `delivery (system|overlay|auto)`,
  `facing (front|back|both)` ("camera_snap: front/back/both; camera_clip: front/back only."), `maxWidth`, `quality 0..1`, `delayMs`,
  `deviceId` ("For camera_ptz, use a camera_list devices[].id value as deviceId; it is required and must not be guessed."),
  `ptzOperation (status|set|move|home)`, `panDegrees`, `tiltDegrees`, `zoomPercent`, `limit ≤20`, `duration`, `durationMs ≤300000`,
  `includeAudio`, `fps`, `screenIndex`, `outPath`, `maxAgeMs`, `locationTimeoutMs`, `desiredAccuracy (coarse|balanced|precise)`,
  `notificationAction (open|dismiss|reply)`, `notificationKey`, `notificationReplyText`, `bins[] (1–64)` ("which: executable names to resolve on the selected node."),
  `invokeCommand` ("Node command to relay. fs.listDir returns sub-directories only."), `invokeParamsJson`, `invokeTimeoutMs`,
  plus gateway call options (`gatewayUrl`, `gatewayToken`, `timeoutMs`).
  `status` → `node.list`; `describe` → `node.describe`; `pending` → `node.pair.list`; `approve/reject` → `node.pair.*`
  (approve scopes resolved from `requiredApproveScopes`); `notify` → `system.notify`; media actions
  return the file as a MEDIA attachment (base64 decoded to a temp file) instead of raw base64;
  `invoke` refuses `system.run`/`system.run.prepare` and media commands (`returns media payloads and is blocked to prevent base64 context bloat; use action="…"`);
  errors are prefixed `agent=<id> node=<name|auto> gateway=<url|default> action=<a>: …`; a
  `PAIRING_REQUIRED` gateway error becomes `pairing required before node invoke. Approve pairing request <id> and retry.`.
  Transport timeout for `invoke` = `invokeTimeoutMs + 30 s`; `location_get` adds 30 s for the node and 30 s for transport.
* Tool **`exec`** with `host: "node"` (and `node: <id|name>`) is the only path for `system.run`
  (`tools.exec.host = "node"`, `tools.exec.mode = "allowlist"`, `tools.exec.node = "<id>"`, or
  session `/exec host=node security=allowlist node=<id>`). Without a bound node, the sole paired +
  connected node that supports `system.run` is selected. Exec approvals (§5) are raised with
  `host: "node"`, `nodeId`.
* Tool **`computer`** (`computer-tool-node.ts`) for `computer.act` / `mobile.ui.*`; `canvas` /
  `show_widget` with `presentation.target: "node_panel"`; `file transfer` tools (`file_fetch`,
  `dir_list`, `dir_fetch`, `file_write`); node-published plugin/MCP tool descriptors appear as
  additional tools named by the descriptor (`name`) and bound to `command`/`mcp`.
* The agent system prompt receives the current connected node id hint (active Mac presence) so
  `node` can be omitted for the default.

---

## 7. Multi-account config shape

```json5
{
  channels: {
    telegram: {
      // root = defaults + the implicit "default" account
      enabled: true,
      botToken: "123:abc",            // or tokenFile, or env TELEGRAM_BOT_TOKEN (default account only)
      name: "Main bot",
      defaultAccount: "main",         // required/warned when >1 accounts and no accounts.default
      dmPolicy: "pairing",            // pairing | allowlist | open | disabled  (default pairing)
      allowFrom: ["603767951", "tg:12345", "accessGroup:operators"],
      groupPolicy: "allowlist",       // open | allowlist | disabled  (default allowlist)
      groupAllowFrom: ["603767951"],  // user ids; falls back to allowFrom
      groups: {
        "*": { requireMention: true },
        "-1001234567890": {
          enabled: true, requireMention: true, requireMentionInBotThreads: false,
          groupPolicy: "open", allowFrom: [...], skills: [...], systemPrompt: "...",
          ingest: true, disableAudioPreflight: false, errorPolicy: "silent",
          tools: { deny: ["write"] }, toolsBySender: { "id:123": {...} },
          topics: { "*": {...}, "3": { agentId: "zu", requireMention: false, allowFrom: [...], skills, systemPrompt, enabled, groupPolicy, errorPolicy, ingest, disableAudioPreflight } }
        }
      },
      direct: {
        "*": { tools: { deny: ["write", "edit"] } },
        "603767951": { dmPolicy: "open", tools: {}, toolsBySender: {}, skills, enabled, allowFrom, systemPrompt, topics: {...}, errorPolicy, requireTopic: false, autoTopicLabel: true | { enabled, prompt } }
      },
      dms: { "<userId>": { historyLimit: 20 } },
      historyLimit: 50, dmHistoryLimit: 10,
      textChunkLimit: 4000,
      replyToMode: "off",             // off | first | all
      streaming: { mode: "progress", chunkMode: "newline", preview: { toolProgress: true, commandText: "status" }, progress: { toolProgress: false, commandText: "status", commentary: false }, block: { enabled: false } },
      markdown: { tables: "code" },
      richMessages: false, linkPreview: true, responsePrefix: "",
      mediaMaxMb: 100,
      capabilities: { inlineButtons: "allowlist" },   // or legacy ["inlineButtons"]
      actions: { sendMessage: true, poll: true, deleteMessage: true, editMessage: true, reactions: true, sticker: false, createForumTopic: true, editForumTopic: true },
      reactionNotifications: "own", reactionLevel: "minimal", ackReaction: "👀",
      commands: { native: "auto", nativeSkills: true },
      customCommands: [{ command: "backup", description: "Git backup" }],
      execApprovals: { enabled: "auto", approvers: ["603767951"], target: "dm", agentFilter: [...], sessionFilter: [...] },
      joinIntro: true, configWrites: true, contextVisibility: "...", mentionPatterns: [...],
      threadBindings: { enabled: true, ... },
      errorPolicy: "always", silentErrorReplies: false,
      healthMonitor: {...},
      network: { autoSelectFamily: true, dnsResultOrder: "ipv4first", dangerouslyAllowPrivateNetwork: false },
      proxy: "http://...", apiRoot: "https://api.telegram.org", trustedLocalFileRoots: [...],
      webhookUrl: "https://host/telegram-webhook", webhookSecret: "…", webhookPath: "/telegram-webhook", webhookCertPath: "...", legacyWebhook: false | { port, host },
      autoTopicLabel: true,
      accounts: {
        main:  { botToken: "...", name: "...", /* any of the above except defaultAccount/accounts */ },
        sales: { tokenFile: "/run/secrets/sales", dmPolicy: "allowlist", allowFrom: ["111"], groups: {}, webhookPath: "/tg/sales", webhookSecret: "…" }
      }
    }
  },
  bindings: [
    { agentId: "main",  match: { channel: "telegram", accountId: "main" } },
    { agentId: "sales", match: { channel: "telegram", accountId: "sales" } },
    { type: "acp", match: { channel: "telegram", accountId: "main", peer: { kind: "group", id: "-1001234567890:topic:42" } }, ... }
  ],
  accessGroups: { operators: { type: "message.senders", members: { telegram: ["987654321"] } } },
  commands: { ownerAllowFrom: ["telegram:603767951"], allowFrom: { telegram: [...], "*": [...] } },
  messages: { inbound: { debounceMs: 300, byChannel: { telegram: 300 } }, ackReaction: "👀", ackReactionScope: "group-mentions", groupChat: { historyLimit: 50, mentionPatterns: [...] }, statusReactions: { enabled: false } },
  session: { dmScope: "main" | "per-account-channel-peer", mainKey: "main", identityLinks: {...}, threadBindings: { spawnSessions: true } },
  gateway: { nodes: { pairing: { autoApproveCidrs: [...], sshVerify: true, autoApproveLocal: true }, pluginTools: { enabled: true }, allowSkills: true, commands: { allow: [...], deny: [...] } } },
  tools: { exec: { host: "node", mode: "allowlist", node: "build-node" } }
}
```

Validation rules (`config-schema.ts`): `webhookUrl` requires a `webhookSecret` (root or account);
`dmPolicy: "allowlist"` with empty effective `allowFrom` is rejected; `dmPolicy: "open"` requires
`allowFrom` to include `"*"`; account webhook paths/secrets must be distinct when sharing a route;
`webhookPath` may not be `/healthz`, gateway probe paths or `/api/channels/*`. Omitted account
`dmPolicy/groupPolicy/allowFrom/groupAllowFrom` inherit the **root**, not `accounts.default`.
Webhook registration call: `setWebhook(publicUrl, { secret_token, allowed_updates, certificate? })`,
retried with backoff 5 s → 60 s (×2, jitter 0.2); inbound verified via header
`x-telegram-bot-api-secret-token` (constant-time compare; failed guesses rate-limited per
`<path>:<ip>`), body ≤ 1 MiB, body timeout 30 s, ambiguous multi-account match → `401 ambiguous webhook target`.

### Hosted-rewrite mapping (what to persist per tenant/bot)

* **Per bot (account):** token, `name`, `dmPolicy`, `allowFrom`, `groupPolicy`, `groupAllowFrom`,
  `groups{}` (with topics), `direct{}`, `replyToMode`, `streaming.*`, `textChunkLimit`,
  `markdown.tables`, `linkPreview`, `richMessages`, `capabilities.inlineButtons`, `actions.*`,
  `reactionNotifications/reactionLevel/ackReaction`, `commands.native/customCommands`,
  `execApprovals.{enabled,approvers,target}`, `historyLimit/dmHistoryLimit`, `mediaMaxMb`,
  `errorPolicy`, `joinIntro`, `webhookSecret/path`, owning agent.
* **Per bot state:** pairing requests `{senderId, code, createdAt, lastSeenAt, meta}` (≤3 pending,
  1 h TTL), approved sender ids, message cache (reply chains / history, bounded), sent-message cache
  (for `own` reactions), topic name/owner cache (2 048), bot-info cache (24 h), ingress queue +
  dedupe tombstones, session entries keyed by the session key shape above, `lastRoute`.
* **Per tenant (gateway):** `commands.ownerAllowFrom`, `accessGroups`, `bindings`, exec-approval
  records (30 min TTL), paired devices + device tokens + node surfaces, node pairing pending
  requests (5 min TTL), bootstrap setup codes (10 min, single use), `gateway.nodes.commands.allow/deny`.
