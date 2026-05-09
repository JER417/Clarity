import sqlite3
from datetime import datetime
from pathlib import Path

_DB = Path(__file__).parent / "interactions.db"


class InteractionLog:
    def __init__(self):
        self._conn = sqlite3.connect(str(_DB), check_same_thread=False)
        self._conn.execute("""
            CREATE TABLE IF NOT EXISTS interactions (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                person_name TEXT NOT NULL,
                context     TEXT,
                ts          TEXT NOT NULL
            )
        """)
        self._conn.commit()

    def log(self, person_name: str, context: str):
        self._conn.execute(
            "INSERT INTO interactions (person_name, context, ts) VALUES (?,?,?)",
            (person_name, context, datetime.now().isoformat(timespec="seconds")),
        )
        self._conn.commit()

    def person_history(self, name: str, limit: int = 15) -> list[dict]:
        rows = self._conn.execute(
            "SELECT ts, context FROM interactions WHERE person_name=? ORDER BY ts DESC LIMIT ?",
            (name, limit),
        ).fetchall()
        return [{"ts": r[0], "context": r[1]} for r in rows]

    def recent(self, limit: int = 30) -> list[dict]:
        rows = self._conn.execute(
            "SELECT person_name, context, ts FROM interactions ORDER BY ts DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [{"person": r[0], "context": r[1], "ts": r[2]} for r in rows]

    def summary(self) -> list[dict]:
        rows = self._conn.execute("""
            SELECT
                person_name,
                COUNT(*)  AS cnt,
                MAX(ts)   AS last_seen,
                (SELECT context FROM interactions i2
                 WHERE i2.person_name = i.person_name
                 ORDER BY ts DESC LIMIT 1) AS last_ctx
            FROM interactions i
            GROUP BY person_name
            ORDER BY last_seen DESC
        """).fetchall()
        return [
            {"name": r[0], "count": r[1], "last_seen": r[2], "last_context": r[3]}
            for r in rows
        ]
