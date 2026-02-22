import argparse
import os
import sqlite3
from datetime import datetime, timezone
from typing import Annotated

from arcade_mcp_server import MCPApp

app = MCPApp(name="deal_memory")


def db_path() -> str:
    default_path = os.path.join(os.path.dirname(__file__), "deal-memory.sqlite3")
    return os.getenv("DEAL_MEMORY_DB_PATH", default_path)


def get_connection() -> sqlite3.Connection:
    return sqlite3.connect(db_path())


def init_db() -> None:
    with get_connection() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS deal_notes (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              deal_id TEXT NOT NULL,
              note TEXT NOT NULL,
              tags TEXT,
              created_at TEXT NOT NULL
            )
            """
        )


@app.tool()
def upsert_deal_note(
    deal_id: Annotated[str, "CRM deal identifier, for example D-1004"],
    note: Annotated[str, "Free-form deal note to store in memory"],
    tags: Annotated[str, "Optional comma-separated tags"] = "",
) -> dict:
    """Store a note for a deal.

    Args:
        deal_id: CRM deal identifier.
        note: Free-form note text.
        tags: Optional comma-separated tags.
    """

    init_db()
    normalized_tags = ",".join([tag.strip() for tag in tags.split(",") if tag.strip()])
    created_at = datetime.now(timezone.utc).isoformat()

    with get_connection() as connection:
        cursor = connection.execute(
            """
            INSERT INTO deal_notes (deal_id, note, tags, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (deal_id, note, normalized_tags, created_at),
        )
        note_id = cursor.lastrowid

    return {
        "saved": True,
        "note_id": note_id,
        "deal_id": deal_id,
        "created_at": created_at,
    }


@app.tool()
def get_deal_context(
    deal_id: Annotated[str, "CRM deal identifier, for example D-1004"],
    limit: Annotated[int, "Maximum number of recent notes to return"] = 5,
) -> dict:
    """Return recent notes for a deal.

    Args:
        deal_id: CRM deal identifier.
        limit: Maximum number of notes to return.
    """

    init_db()
    bounded_limit = min(max(limit, 1), 20)

    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT id, note, tags, created_at
            FROM deal_notes
            WHERE deal_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (deal_id, bounded_limit),
        ).fetchall()

    notes = [
        {
            "id": row[0],
            "note": row[1],
            "tags": row[2] or "",
            "created_at": row[3],
        }
        for row in rows
    ]

    return {
        "deal_id": deal_id,
        "note_count": len(notes),
        "notes": notes,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Deal memory MCP server")
    parser.add_argument(
        "transport",
        nargs="?",
        default="stdio",
        choices=["stdio", "http"],
        help="Transport to run",
    )
    parser.add_argument("--host", default="127.0.0.1", help="HTTP bind host")
    parser.add_argument("--port", type=int, default=9400, help="HTTP bind port")

    args = parser.parse_args()

    if args.transport == "http":
        app.run(transport="http", host=args.host, port=args.port)
        return

    app.run(transport="stdio")


if __name__ == "__main__":
    main()
