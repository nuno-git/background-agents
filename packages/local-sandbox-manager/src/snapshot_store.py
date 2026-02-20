"""
SQLite-backed snapshot metadata store.
Replaces Modal Volume at /data/ for snapshot tracking.
"""

import json
import os
import sqlite3
import time
from dataclasses import asdict, dataclass

from . import config

DB_PATH = os.path.join(config.SNAPSHOT_DIR, "snapshots.db")


@dataclass
class SnapshotRecord:
    image_id: str
    sandbox_id: str
    session_id: str
    repo_owner: str
    repo_name: str
    reason: str
    tar_path: str
    created_at: float


class SnapshotStore:
    def __init__(self, db_path: str = DB_PATH):
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self.db = sqlite3.connect(db_path)
        self.db.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self) -> None:
        self.db.execute("""
            CREATE TABLE IF NOT EXISTS snapshots (
                image_id TEXT PRIMARY KEY,
                sandbox_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                repo_owner TEXT NOT NULL,
                repo_name TEXT NOT NULL,
                reason TEXT NOT NULL,
                tar_path TEXT NOT NULL,
                created_at REAL NOT NULL
            )
        """)
        self.db.execute("""
            CREATE INDEX IF NOT EXISTS idx_snapshots_repo
            ON snapshots (repo_owner, repo_name, created_at DESC)
        """)
        self.db.commit()

    def save(self, record: SnapshotRecord) -> None:
        self.db.execute(
            """INSERT OR REPLACE INTO snapshots
               (image_id, sandbox_id, session_id, repo_owner, repo_name, reason, tar_path, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                record.image_id,
                record.sandbox_id,
                record.session_id,
                record.repo_owner,
                record.repo_name,
                record.reason,
                record.tar_path,
                record.created_at,
            ),
        )
        self.db.commit()

    def get(self, image_id: str) -> SnapshotRecord | None:
        row = self.db.execute(
            "SELECT * FROM snapshots WHERE image_id = ?", (image_id,)
        ).fetchone()
        if not row:
            return None
        return SnapshotRecord(**dict(row))

    def get_latest(self, repo_owner: str, repo_name: str) -> SnapshotRecord | None:
        row = self.db.execute(
            "SELECT * FROM snapshots WHERE repo_owner = ? AND repo_name = ? ORDER BY created_at DESC LIMIT 1",
            (repo_owner, repo_name),
        ).fetchone()
        if not row:
            return None
        return SnapshotRecord(**dict(row))

    def delete(self, image_id: str) -> bool:
        cursor = self.db.execute("DELETE FROM snapshots WHERE image_id = ?", (image_id,))
        self.db.commit()
        return cursor.rowcount > 0
