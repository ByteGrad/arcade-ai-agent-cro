# CRO Autopilot Demo Runbook

## Goal
Show a repeatable "safe action agent" loop with these receipts:
1. Google Sheet updates (`RiskScore`, `NextStep`, `LastAutopilotRun`)
2. Slack daily brief posted
3. Gmail draft created (not sent)
4. Optional: Google Doc deal plan

## Prerequisites
- Copy `seed/crm-template.csv` into a Google Sheet tab named `Sheet1`.
- Set `.env.local` from `.env.example`.
- Start the web app:
  - `npm run dev:web`
- Optional memory server:
  - `npm run dev:memory`

## First-Run Auth Flow
1. Open `http://localhost:3000`.
2. Prompt the assistant to locate or open your CRM sheet.
3. If authorization is requested, click **Authorize now** and finish OAuth.
4. Return to chat and allow auto-retry.

## Per-User OAuth Proof (Incognito)
1. Open the app in an incognito/private window.
2. Submit the same hero prompt.
3. Confirm authorization is requested again for the new browser profile.
4. Complete OAuth and rerun to show the flow is user-scoped, not globally shared.

## First-Run Sheet Access (drive.file)
If the agent cannot access an existing sheet, ask:
- `Generate a Google file picker URL so I can open my CRM sheet.`

After you open/select the file with the picker, rerun the hero prompt.

## Hero Prompt
Use this exact prompt for recording:

```text
What should my AEs do today? Use my CRM sheet, Gmail, and Calendar to pick the top 3 at-risk deals. Propose updates, then ask for approval before writing. After approval, update RiskScore, NextStep, and LastAutopilotRun in the sheet, post a Slack daily brief, and create Gmail drafts for each AE.
```

## Approval Demo
- Deny one write action first to show guardrails.
- Approve the follow-up attempt.
- Keep the tool trace visible on screen.

## Receipt Checklist
- [ ] Tool trace shows approvals for write actions.
- [ ] Incognito/private window required its own authorization flow.
- [ ] Sheet row updates are visible in Google Sheets.
- [ ] Slack brief appears in channel/DM.
- [ ] Gmail drafts exist in Drafts.
- [ ] (Optional) Doc created/updated.

## Optional Memory Moment
1. Ask the agent to store a deal note in memory.
2. Ask the hero prompt again.
3. Confirm the memory note appears in reasoning/action recommendations.

## MCP HTTP Security Note
If you expose the memory server over HTTP beyond localhost, enforce:
- Origin validation
- Authentication (for example, bearer token)
- TLS on public endpoints
