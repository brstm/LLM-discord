# LLM Discord Bot Manager

LLM Discord Bot Manager is a TypeScript service for running one or more Discord bots backed by large language model inference endpoints. It provisions Discord.js clients from environment-driven configuration, fetches conversation context on demand, and forwards the dialog to your LLM so you can ship tailored assistants.

> Fork origin: This project is a fork of [KindroidAI/Kindroid-discord](https://github.com/KindroidAI/Kindroid-discord) and is intended to extend that functionality.

## Features
- Run multiple Discord bots from one app; add one env block per bot.
- Bring your own LLM: works with hosted APIs or local servers—no code changes.
- Respond when you want: only on @mentions, when someone says the bot’s name, or to every message (your choice).
- Smarter context: quickly fetches recent chat and the channel topic so answers stay on‑topic.
- Thread‑aware: replies in threads only when already a member and permitted; doesn’t auto‑join.
- Safer by default: respects channel permissions, avoids mass pings, and prevents bot‑to‑bot loops.
- Handy reactions: thumbs up adds a celebratory emoji; thumbs down regenerates the reply.
- Easy to extend: add API keys, custom headers, or extra JSON fields.

## What's different from Kindroid-discord

This fork is for teams running more than one Discord AI bot, wanting freedom to use any LLM backend, and wanting better, safer context. Highlights:

- Multi‑bot manager: run many bots in one process; add `<ID>_DISCORD_BOT_TOKEN` per bot (IDs can be numbers or names).
- Provider‑agnostic LLMs: point to any HTTP endpoint or a local model server; same payload format.
- Kindroid made easy: drop‑in examples for `discord-bot` and `send-message`, including `CUSTOM_FIELDS_JSON`.
- Channel topic in context: if set, the channel topic is sent first so answers match the room’s purpose.
- Thread‑aware behavior: responds inside threads it already has access to; doesn’t auto‑join. No @mention needed in threads; session IDs use the parent channel for continuity.
- Control chat history: choose how many recent messages to send (0 = only the latest).
- You control the voice: `respondTo=dynamic|name` and `respondAsReply=true|false` let you pick when and how it talks; replies are only forced in standard channels.
- Clearer names: mention IDs like `<@123>` become readable display names; names are cached for speed.
- Faster and lighter: a small 5s cache reduces duplicate fetches while keeping context fresh.
- Safer defaults: permission checks, loop prevention, and `allowedMentions` that avoid mass pings.
- Flexible responses: accepts simple strings or full Discord message objects; gracefully backs off on HTTP 429.
- Optional session header: send a base64 session id (bot, user, channel) in a header your API can read.

## Prerequisites
- Node.js 20 or newer (Discord.js 14 requires >= 16.11; the project is tested with modern LTS releases).
- npm 8+ (bundled with Node).

## Installation
1. Install dependencies: `npm install`.
2. Copy `.env.example` to `.env` (or whichever secrets store you use).
3. Fill in the per-bot environment variables described below.

## Running

- Development watch mode: `npm run dev`
- One-off production build: `npm run build`
- Build and start (used by `npm start`): `npm run start`
- Lint with ESLint: `npm run lint`

## Usage

- Create a Discord application and bot, invite it to your server, and enable intents:
  - Message Content (required)
  - Server Members (recommended for nickname display)
- Configure environment variables for one or more bots as described in Configuration below.
- Start the service with `npm run dev` (hot reload) or `npm start` (build then run).
- Talk to your bot:
  - In servers: mention the bot to trigger, or set `RESPOND_TO=name` or `RESPOND_TO=dynamic` for broader triggers.
  - In DMs: the bot responds to every message.
  - In threads: replies only if the bot is already a member and has permission; the bot does not auto-join threads.
- Moderation shortcuts:
  - React with 👍 to add a celebratory emoji for tracking/tagging good responses.
  - React with 👎 to regenerate a reply; the previous bot message is deleted.

Restart the process after changing environment variables so new bots are detected.

## Configuration

Each bot is configured by a shared prefix. The prefix can be numeric (`1`, `2`, `3`) or a readable identifier (`KINDROID`, `SUPPORT`, etc.). Set one `_DISCORD_BOT_TOKEN` environment variable per bot and any additional keys that reuse the same prefix.

Required keys per bot:

| Key | Description |
| --- | --- |
| `<BOT_ID>_DISCORD_BOT_TOKEN` | Discord token for that bot user. |
| `<BOT_ID>_LLM_INFER_URL` | HTTP endpoint that receives the shaped conversation payload. |

Optional keys per bot:

| Key | Default | Description |
| --- | --- | --- |
| `<BOT_ID>_LLM_API_KEY` | `undefined` | Bearer token attached to the `Authorization` header. |
| `<BOT_ID>_SESSION_HEADER` | `undefined` | Name of an HTTP header that receives the base64 session id. |
| `<BOT_ID>_CONVERSATION_LENGTH` | `0` | Number of prior messages to include. `0` sends only the triggering message. |
| `<BOT_ID>_RESPOND_TO` | mention only | `dynamic` (respond to everything), `name` (respond when display name appears), or omit for mentions only. |
| `<BOT_ID>_RESPOND_AS_REPLY` | `false` | Set to `true` to answer with Discord replies instead of plain channel messages. Mentions always reply. |
| `<BOT_ID>_CUSTOM_FIELDS_JSON` | `{}` | JSON string merged into the request body (useful for model ids, share codes, etc.). |

Example `.env` snippet:

```
1_DISCORD_BOT_TOKEN=discord-token-for-support
1_LLM_INFER_URL=https://api.example.com/v1/support
1_LLM_API_KEY=sk-123
1_RESPOND_TO=name

2_DISCORD_BOT_TOKEN=discord-token-for-companion
2_LLM_INFER_URL=https://api.kindroid.ai/v1/discord-bot
2_CUSTOM_FIELDS_JSON={"share_code":"abc123","enable_filter":true}
2_CONVERSATION_LENGTH=30
2_SESSION_HEADER=X-Kindroid-Requester

3_DISCORD_BOT_TOKEN=discord-token-for-personal
3_LLM_INFER_URL=https://api.kindroid.ai/v1/send-message
3_LLM_API_KEY=your_kindroid_api_key
3_CUSTOM_FIELDS_JSON={"ai_id":"your_ai_id"}
```

## How it works

- `src/index.ts` reads the environment, builds `BotConfig` objects, and spins up every Discord client.
- `src/botManager.ts` creates and tracks Discord.js clients, handles graceful shutdown, and exposes a shared getter for the active client.
- `src/eventHandler.ts` decides whether a bot should reply by checking message types, mentions, permissions, and loop prevention rules. It also watches reaction events.
- `src/responseOrchestrator.ts` fetches channel history, includes the channel topic (when present) as leading context, caches display names and message transcripts, builds the payload, and relays responses back to Discord. In threads, it uses the parent channel id when constructing the session id for continuity.
- `src/llmAPI.ts` wraps the HTTP call to your inference endpoint and normalises success, error, and rate limit cases.
- `src/types.ts` defines shared interfaces and extends Discord.js types so each client carries its own configuration.

## LLM API Contract

`callLLM` posts JSON to the configured `LLM_INFER_URL`.

- When `<BOT_ID>_CONVERSATION_LENGTH` is `0` or unset, the payload is `{ "message": "<latest text>", ...customFields }`.
- Otherwise the payload is `{ "conversation": [ { "username": "...", "text": "...", "timestamp": "..." }, ... ], ...customFields }`.

The response can follow either pattern:

1. A structured response: `{ "success": true, "reply": "string reply" }` or `{ "success": true, "reply": { "content": "...", "embeds": [...] } }`.
2. Any other payload (missing the `success` flag) is treated as a raw reply and converted to a string.

Return a `429` status to signal rate limiting; the bot will silently drop the message instead of erroring.

## Reactions and safety checks

- Reacting to a bot message with a thumbs up makes the bot add one of several celebratory emojis (if it has not already reacted).
- Reacting with a thumbs down asks the bot to regenerate a response and deletes the previous reply.
- Conversation fetches are cached briefly to avoid redundant Discord API calls, and display names are cached for one hour.
- Bot-to-bot loops are capped so the same channel does not devolve into an infinite conversation.

## Development tips

- Use `npm run dev` during development so message handlers reload automatically on save.
- Enable Discord's privileged intents for message content or the bot will ignore messages.
- Watch the console for `Invalid JSON in <BOT_ID>_CUSTOM_FIELDS_JSON` warnings when tweaking configuration.

## Project structure

```
src/
  botManager.ts
  eventHandler.ts
  index.ts
  llmAPI.ts
  responseOrchestrator.ts
  types.ts
```

## License

Released under the MIT License (see `LICENSE`).










