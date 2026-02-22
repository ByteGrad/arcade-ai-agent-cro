# Arcade + Vercel AI SDK Demo

This repo is a Next.js chat app that uses Arcade tools with the Vercel AI SDK.

The default flow is tuned for a CRO Autopilot demo:
- per-user session identity (`/api/session`) for user-scoped OAuth
- OAuth handoff for `authorization_required` tool calls
- approval gating for write tools
- tool trace visibility in chat
- optional MCP memory tools via `@ai-sdk/mcp`

## Setup

```bash
npm install
cp .env.example .env.local
```

Required `.env.local` values:

```env
ARCADE_API_KEY=your_arcade_api_key
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-5.2
```

Optional value:

```env
DEAL_MEMORY_MCP_URL=http://127.0.0.1:9400/mcp
```

Notes:
- Gmail defaults are drafts-first (`Gmail_WriteDraftEmail`), not send.
- Slack toolkit loading is filtered to a small built-in allowlist to keep behavior deterministic.
- If Google Docs tools are unavailable in your Arcade environment, remove the docs tools directly in `app/api/chat/route.ts`.
- If Docs tools are unavailable at runtime, the agent falls back to returning a markdown deal plan in chat and Slack.

## Run

Web app:

```bash
npm run dev:web
```

Optional memory server (second terminal):

```bash
npm run dev:memory
```

Open `http://localhost:3000`.

## Demo Assets

- `docs/demo-runbook.md`: deterministic demo script and receipt checklist
- `seed/crm-template.csv`: sample CRM sheet template
- `seed/deal-plan-template.md`: optional deal-plan markdown template

## Memory Server

- `mcp/deal-memory/src/deal_memory/server.py`
- `mcp/deal-memory/pyproject.toml`

The server is built with `arcade-mcp-server` and exposes two tools:
- `upsert_deal_note`
- `get_deal_context`

## Key App Files

- `app/page.tsx`: chat UI, OAuth handoff, approval UI, tool trace
- `app/api/session/route.ts`: sets/reads `arcade_user_id` cookie
- `app/api/chat/route.ts`: tool loading, approvals, MCP memory integration
- `app/api/auth/status/route.ts`: polls Arcade auth completion status

## Validation

```bash
npm run lint
npm run build
```
