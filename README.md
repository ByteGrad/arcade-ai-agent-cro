# Arcade + Vercel AI SDK Demo

This repo is a Next.js chat app that uses Arcade tools with the Vercel AI SDK.

## Security Notice

This project is intended for demo purposes only.

Before using it for any serious internal or external scenario, especially production, add the security controls that fit your environment. That includes, at minimum, proper user authentication, per-user identity and authorization boundaries, rate limiting, secret management, audit/logging controls, and a review of which tools can run automatically versus requiring explicit approval.

The default flow is tuned for a CRO Autopilot demo:

- per-user session identity (`/api/session`) for user-scoped OAuth
- OAuth handoff for `authorization_required` tool calls
- approval gating for write tools
- tool trace visibility in chat
- optional MCP memory tools via `@ai-sdk/mcp`

## Disclaimer

This repository is provided strictly as an oversimplified demo and starting point for building with Arcade and the Vercel AI SDK. It is not intended for production use, and should not be used as-is for any internal or customer-facing scenario without significant review and modification.

It is provided "as is" and "as available", without warranties or representations of any kind, whether express, implied, or statutory, including any implied warranties of merchantability, fitness for a particular purpose, title, non-infringement, security, availability, accuracy, or suitability for production use.

No rights, guarantees, service levels, support commitments, security assurances, compliance assurances, or other obligations may be derived from this repository, its contents, or any related demo, video, or documentation.

You are solely responsible for reviewing, modifying, securing, testing, and validating this code before any internal use, customer-facing use, regulated use, or production deployment. That includes responsibility for access control, data protection, privacy disclosures, retention policies, audit logging, approval controls, incident response, vendor review, and compliance with applicable law, regulation, contract, and internal policy.

This repository does not constitute legal, security, privacy, compliance, or other professional advice. If you need those assurances, obtain them from qualified counsel and security reviewers for your specific environment and use case.

By using, copying, deploying, or referencing this repository, you accept that any use is at your own risk.

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
DEAL_MEMORY_DATABASE_URL=postgresql://...
```

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
