# Deal Memory MCP Server

Minimal `arcade-mcp` server for CRO Autopilot memory.

## Tools
- `upsert_deal_note(deal_id, note, tags="")`
- `get_deal_context(deal_id, limit=5)`

## Run (HTTP)

```bash
uv run src/deal_memory/server.py http --host 127.0.0.1 --port 9400
```

MCP endpoint URL:

```text
http://127.0.0.1:9400/mcp
```

## Run (stdio)

```bash
uv run src/deal_memory/server.py stdio
```
