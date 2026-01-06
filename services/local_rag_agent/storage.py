from __future__ import annotations

import datetime as dt
import logging
import sqlite3
from contextlib import contextmanager
import json
from pathlib import Path
from typing import Any, Iterable, Iterator, Optional

from .models import (
    ChunkSnapshot,
    FileRecord,
    FolderRecord,
    NoteRecord,
    SearchHit,
    ActivityLog,
    ChatSession,
    ChatMessage,
    ApiKey,
)


logger = logging.getLogger(__name__)


_SQLITE_PRAGMAS = (
    "PRAGMA journal_mode=WAL;",
    "PRAGMA synchronous=NORMAL;",
    "PRAGMA temp_store=MEMORY;",
    "PRAGMA foreign_keys=ON;",
)


class IndexStorage:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self._ensure_schema()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self.db_path, check_same_thread=False, detect_types=sqlite3.PARSE_DECLTYPES)
        conn.row_factory = sqlite3.Row
        try:
            for pragma in _SQLITE_PRAGMAS:
                conn.execute(pragma)
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _ensure_schema(self) -> None:
        with self.connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS folders (
                    id TEXT PRIMARY KEY,
                    path TEXT NOT NULL UNIQUE,
                    label TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_indexed_at TEXT,
                    enabled INTEGER NOT NULL DEFAULT 1
                );

                CREATE TABLE IF NOT EXISTS api_keys (
                    key TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    last_used_at TEXT,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    is_system INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS files (
                    id TEXT PRIMARY KEY,
                    folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
                    path TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    extension TEXT NOT NULL,
                    size INTEGER NOT NULL,
                    modified_at TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    hash TEXT NOT NULL,
                    summary TEXT,
                    embedding_vector BLOB,
                    embedding_determined_at TEXT,
                    mime_type TEXT,
                    checksum_sha256 TEXT,
                    duration_seconds REAL,
                    page_count INTEGER,
                    preview_image BLOB,
                    metadata TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id);
                CREATE INDEX IF NOT EXISTS idx_files_kind ON files(kind);
                CREATE INDEX IF NOT EXISTS idx_files_modified ON files(modified_at);

                CREATE TABLE IF NOT EXISTS chunks (
                    id TEXT PRIMARY KEY,
                    file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
                    ordinal INTEGER NOT NULL,
                    text TEXT NOT NULL,
                    snippet TEXT NOT NULL,
                    token_count INTEGER NOT NULL,
                    char_count INTEGER NOT NULL,
                    section_path TEXT,
                    metadata TEXT,
                    created_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id);
                CREATE INDEX IF NOT EXISTS idx_chunks_section ON chunks(section_path);

                CREATE TABLE IF NOT EXISTS email_accounts (
                    id TEXT PRIMARY KEY,
                    label TEXT NOT NULL,
                    protocol TEXT NOT NULL,
                    host TEXT NOT NULL,
                    port INTEGER NOT NULL,
                    username TEXT NOT NULL,
                    secret TEXT NOT NULL,
                    use_ssl INTEGER NOT NULL DEFAULT 1,
                    folder TEXT,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    last_synced_at TEXT,
                    last_sync_status TEXT,
                    client_id TEXT,
                    tenant_id TEXT
                );

                CREATE TABLE IF NOT EXISTS email_messages (
                    id TEXT PRIMARY KEY,
                    account_id TEXT NOT NULL REFERENCES email_accounts(id) ON DELETE CASCADE,
                    external_id TEXT NOT NULL,
                    subject TEXT,
                    sender TEXT,
                    recipients TEXT,
                    sent_at TEXT,
                    stored_path TEXT NOT NULL,
                    size INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    UNIQUE(account_id, external_id)
                );

                CREATE INDEX IF NOT EXISTS idx_email_messages_account ON email_messages(account_id);
                CREATE INDEX IF NOT EXISTS idx_email_messages_created ON email_messages(created_at);

                CREATE TABLE IF NOT EXISTS notes (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    path TEXT NOT NULL UNIQUE,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);

                CREATE TABLE IF NOT EXISTS activity_logs (
                    id TEXT PRIMARY KEY,
                    timestamp TEXT NOT NULL,
                    description TEXT NOT NULL,
                    short_description TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON activity_logs(timestamp);

                CREATE TABLE IF NOT EXISTS chat_sessions (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated ON chat_sessions(updated_at DESC);

                CREATE TABLE IF NOT EXISTS chat_messages (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    meta TEXT,
                    "references" TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
                CREATE INDEX IF NOT EXISTS idx_chat_messages_timestamp ON chat_messages(timestamp);
                """
            )
            self._ensure_file_columns(conn)
            self._ensure_chunk_columns(conn)
            self._ensure_email_columns(conn)
            self._ensure_note_columns(conn)
            self._ensure_activity_columns(conn)
            self._ensure_folder_columns(conn)
            self._ensure_chat_columns(conn)

    def _ensure_folder_columns(self, conn: sqlite3.Connection) -> None:
        existing = {row["name"] for row in conn.execute("PRAGMA table_info(folders)").fetchall()}

        def add_column(name: str, definition: str) -> None:
            if name not in existing:
                conn.execute(f"ALTER TABLE folders ADD COLUMN {name} {definition}")

        add_column("failed_files", "TEXT")
        add_column("scan_mode", "TEXT NOT NULL DEFAULT 'full'")

    def _ensure_chat_columns(self, conn: sqlite3.Connection) -> None:
        existing = {row["name"] for row in conn.execute("PRAGMA table_info(chat_messages)").fetchall()}

        def add_column(name: str, definition: str) -> None:
            if name not in existing:
                conn.execute(f"ALTER TABLE chat_messages ADD COLUMN {name} {definition}")

        add_column("is_multi_path", "INTEGER")
        add_column("thinking_steps", "TEXT")

    def _ensure_file_columns(self, conn: sqlite3.Connection) -> None:
        existing = {row["name"] for row in conn.execute("PRAGMA table_info(files)").fetchall()}

        def add_column(name: str, definition: str) -> None:
            if name not in existing:
                conn.execute(f"ALTER TABLE files ADD COLUMN {name} {definition}")

        add_column("mime_type", "TEXT")
        add_column("checksum_sha256", "TEXT")
        add_column("duration_seconds", "REAL")
        add_column("page_count", "INTEGER")
        add_column("preview_image", "BLOB")
        add_column("metadata", "TEXT")
        # Index status tracking columns
        if "index_status" not in existing:
            conn.execute("ALTER TABLE files ADD COLUMN index_status TEXT NOT NULL DEFAULT 'indexed'")
        # Always fix any incorrectly marked files (e.g., from previous buggy migration)
        # Files with embeddings/summary should be marked as indexed, not pending
        conn.execute("""
            UPDATE files SET index_status = 'indexed' 
            WHERE index_status = 'pending' 
            AND (embedding_vector IS NOT NULL OR summary IS NOT NULL OR (metadata IS NOT NULL AND metadata != '{}'))
        """)
        add_column("error_reason", "TEXT")
        add_column("error_at", "TEXT")

    def _ensure_chunk_columns(self, conn: sqlite3.Connection) -> None:
        existing = {row["name"] for row in conn.execute("PRAGMA table_info(chunks)").fetchall()}

        def add_column(name: str, definition: str) -> None:
            if name not in existing:
                conn.execute(f"ALTER TABLE chunks ADD COLUMN {name} {definition}")

        add_column("section_path", "TEXT")
        add_column("metadata", "TEXT")

    def _ensure_email_columns(self, conn: sqlite3.Connection) -> None:
        accounts = {row["name"] for row in conn.execute("PRAGMA table_info(email_accounts)").fetchall()}
        messages = {row["name"] for row in conn.execute("PRAGMA table_info(email_messages)").fetchall()}

        def add_account_column(name: str, definition: str) -> None:
            if name not in accounts:
                conn.execute(f"ALTER TABLE email_accounts ADD COLUMN {name} {definition}")

        def add_message_column(name: str, definition: str) -> None:
            if name not in messages:
                conn.execute(f"ALTER TABLE email_messages ADD COLUMN {name} {definition}")

        add_account_column("last_synced_at", "TEXT")
        add_account_column("last_sync_status", "TEXT")
        add_account_column("enabled", "INTEGER NOT NULL DEFAULT 1")
        add_message_column("recipients", "TEXT")
        add_message_column("created_at", "TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP")

    def _ensure_note_columns(self, conn: sqlite3.Connection) -> None:
        existing = {row["name"] for row in conn.execute("PRAGMA table_info(notes)").fetchall()}

        def add_column(name: str, definition: str) -> None:
            if name not in existing:
                conn.execute(f"ALTER TABLE notes ADD COLUMN {name} {definition}")

        add_column("title", "TEXT NOT NULL")
        add_column("path", "TEXT NOT NULL")
        add_column("created_at", "TEXT NOT NULL")
        add_column("updated_at", "TEXT NOT NULL")

    def _ensure_activity_columns(self, conn: sqlite3.Connection) -> None:
        existing = {row["name"] for row in conn.execute("PRAGMA table_info(activity_logs)").fetchall()}

        def add_column(name: str, definition: str) -> None:
            if name not in existing:
                conn.execute(f"ALTER TABLE activity_logs ADD COLUMN {name} {definition}")

        add_column("short_description", "TEXT")

    def insert_activity_log(self, record: ActivityLog) -> None:
        with self.connect() as conn:
            conn.execute(
                "INSERT INTO activity_logs (id, timestamp, description, short_description) VALUES (?, ?, ?, ?)",
                (record.id, record.timestamp.isoformat(), record.description, record.short_description),
            )

    def list_activity_logs(self, start: Optional[dt.datetime] = None, end: Optional[dt.datetime] = None, limit: int = 1000) -> list[ActivityLog]:
        query = "SELECT * FROM activity_logs"
        params: list[Any] = []
        conditions: list[str] = []

        if start:
            conditions.append("timestamp >= ?")
            params.append(start.isoformat())
        if end:
            conditions.append("timestamp <= ?")
            params.append(end.isoformat())

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        query += " ORDER BY timestamp ASC LIMIT ?"
        params.append(limit)

        with self.connect() as conn:
            rows = conn.execute(query, params).fetchall()

        return [
            ActivityLog(
                id=row["id"],
                timestamp=dt.datetime.fromisoformat(row["timestamp"]),
                description=row["description"],
                short_description=row["short_description"] if "short_description" in row.keys() else None
            )
            for row in rows
        ]

    def delete_activity_logs(self, start: Optional[dt.datetime] = None, end: Optional[dt.datetime] = None) -> int:
        query = "DELETE FROM activity_logs"
        params: list[Any] = []
        conditions: list[str] = []

        if start:
            conditions.append("timestamp >= ?")
            params.append(start.isoformat())
        if end:
            conditions.append("timestamp <= ?")
            params.append(end.isoformat())

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        with self.connect() as conn:
            cursor = conn.execute(query, params)
            deleted_count = cursor.rowcount

        return deleted_count

    def delete_activity_log(self, log_id: str) -> bool:
        with self.connect() as conn:
            cursor = conn.execute("DELETE FROM activity_logs WHERE id = ?", (log_id,))
            deleted_count = cursor.rowcount
        return deleted_count > 0

    def upsert_folder(self, record: FolderRecord) -> None:
        failed_files_json = json.dumps([f.dict() for f in record.failed_files], default=str) if record.failed_files else None
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO folders (id, path, label, created_at, updated_at, last_indexed_at, enabled, failed_files, scan_mode)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    path=excluded.path,
                    label=excluded.label,
                    updated_at=excluded.updated_at,
                    last_indexed_at=excluded.last_indexed_at,
                    enabled=excluded.enabled,
                    failed_files=excluded.failed_files,
                    scan_mode=excluded.scan_mode
                """,
                (
                    record.id,
                    str(record.path),
                    record.label,
                    record.created_at.isoformat(),
                    record.updated_at.isoformat(),
                    record.last_indexed_at.isoformat() if record.last_indexed_at else None,
                    1 if record.enabled else 0,
                    failed_files_json,
                    record.scan_mode,
                ),
            )

    def remove_folder(self, folder_id: str) -> None:
        with self.connect() as conn:
            conn.execute("DELETE FROM folders WHERE id = ?", (folder_id,))

    def list_folders(self) -> list[FolderRecord]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT f.*, (SELECT COUNT(*) FROM files WHERE folder_id = f.id) as indexed_count
                FROM folders f
                ORDER BY f.created_at ASC
                """
            ).fetchall()
        return [self._row_to_folder(row) for row in rows]

    def get_folder(self, folder_id: str) -> Optional[FolderRecord]:
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT f.*, (SELECT COUNT(*) FROM files WHERE folder_id = f.id) as indexed_count
                FROM folders f
                WHERE f.id = ?
                """,
                (folder_id,)
            ).fetchone()
        return self._row_to_folder(row) if row else None

    def folder_by_path(self, path: Path) -> Optional[FolderRecord]:
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT f.*, (SELECT COUNT(*) FROM files WHERE folder_id = f.id) as indexed_count
                FROM folders f
                WHERE f.path = ?
                """,
                (str(path),)
            ).fetchone()
        return self._row_to_folder(row) if row else None

    def upsert_note(self, record: NoteRecord) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO notes (id, title, path, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    title=excluded.title,
                    path=excluded.path,
                    updated_at=excluded.updated_at
                """,
                (
                    record.id,
                    record.title,
                    str(record.path),
                    record.created_at.isoformat(),
                    record.updated_at.isoformat(),
                ),
            )

    def list_notes(self) -> list[NoteRecord]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM notes ORDER BY updated_at DESC"
            ).fetchall()
        return [self._row_to_note(row) for row in rows]

    def get_note(self, note_id: str) -> Optional[NoteRecord]:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()
        return self._row_to_note(row) if row else None

    def delete_note(self, note_id: str) -> None:
        with self.connect() as conn:
            conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))

    def create_api_key(self, key: str, name: str, is_system: bool = False) -> ApiKey:
        now = dt.datetime.now(dt.timezone.utc)
        record = ApiKey(
            key=key,
            name=name,
            created_at=now,
            is_active=True,
            is_system=is_system,
        )
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO api_keys (key, name, created_at, is_active, is_system)
                VALUES (?, ?, ?, ?, ?)
                """,
                (
                    record.key,
                    record.name,
                    record.created_at.isoformat(),
                    1 if record.is_active else 0,
                    1 if record.is_system else 0,
                ),
            )
        return record

    def get_api_key(self, key: str) -> Optional[ApiKey]:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM api_keys WHERE key = ?", (key,)).fetchone()
        if not row:
            return None
        return ApiKey(
            key=row["key"],
            name=row["name"],
            created_at=dt.datetime.fromisoformat(row["created_at"]),
            last_used_at=dt.datetime.fromisoformat(row["last_used_at"]) if row["last_used_at"] else None,
            is_active=bool(row["is_active"]),
            is_system=bool(row["is_system"]),
        )

    def list_api_keys(self) -> list[ApiKey]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM api_keys ORDER BY created_at DESC").fetchall()
        return [
            ApiKey(
                key=row["key"],
                name=row["name"],
                created_at=dt.datetime.fromisoformat(row["created_at"]),
                last_used_at=dt.datetime.fromisoformat(row["last_used_at"]) if row["last_used_at"] else None,
                is_active=bool(row["is_active"]),
                is_system=bool(row["is_system"]),
            )
            for row in rows
        ]

    def delete_api_key(self, key: str) -> bool:
        with self.connect() as conn:
            cursor = conn.execute("DELETE FROM api_keys WHERE key = ?", (key,))
            return cursor.rowcount > 0

    def update_api_key_usage(self, key: str) -> None:
        now = dt.datetime.now(dt.timezone.utc)
        with self.connect() as conn:
            conn.execute(
                "UPDATE api_keys SET last_used_at = ? WHERE key = ?",
                (now.isoformat(), key),
            )

    def count_email_messages_since(self, account_id: str, threshold: dt.datetime) -> int:
        with self.connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) FROM email_messages WHERE account_id = ? AND created_at >= ?",
                (account_id, threshold.isoformat()),
            ).fetchone()
        return int(row[0] if row else 0)

    def upsert_file(self, record: FileRecord) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO files (
                    id, folder_id, path, name, extension, size, modified_at, created_at, kind, hash, summary,
                    embedding_vector, embedding_determined_at, mime_type, checksum_sha256, duration_seconds,
                    page_count, preview_image, metadata, index_status, error_reason, error_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    folder_id=excluded.folder_id,
                    path=excluded.path,
                    name=excluded.name,
                    extension=excluded.extension,
                    size=excluded.size,
                    modified_at=excluded.modified_at,
                    created_at=excluded.created_at,
                    kind=excluded.kind,
                    hash=excluded.hash,
                    summary=excluded.summary,
                    embedding_vector=excluded.embedding_vector,
                    embedding_determined_at=excluded.embedding_determined_at,
                    mime_type=excluded.mime_type,
                    checksum_sha256=excluded.checksum_sha256,
                    duration_seconds=excluded.duration_seconds,
                    page_count=excluded.page_count,
                    preview_image=excluded.preview_image,
                    metadata=excluded.metadata,
                    index_status=excluded.index_status,
                    error_reason=excluded.error_reason,
                    error_at=excluded.error_at
                """,
                (
                    record.id,
                    record.folder_id,
                    str(record.path),
                    record.name,
                    record.extension,
                    record.size,
                    record.modified_at.isoformat(),
                    record.created_at.isoformat(),
                    record.kind,
                    record.hash,
                    record.summary,
                    self._serialize_vector(record.embedding_vector),
                    record.embedding_determined_at.isoformat() if record.embedding_determined_at else None,
                    record.mime_type,
                    record.checksum_sha256,
                    record.duration_seconds,
                    record.page_count,
                    record.preview_image,
                    self._serialize_metadata(record.metadata),
                    record.index_status,
                    record.error_reason,
                    record.error_at.isoformat() if record.error_at else None,
                ),
            )

    def remove_files_not_in(self, folder_id: str, keep_paths: Iterable[Path]) -> list[FileRecord]:
        keep = {str(p) for p in keep_paths}
        removed: list[FileRecord] = []
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM files WHERE folder_id = ?",
                (folder_id,),
            ).fetchall()
            for row in rows:
                if row["path"] not in keep:
                    record = self._row_to_file(row)

                    # Ensure vector_chunks is present in metadata so indexer can clean up vectors
                    metadata = record.metadata or {}
                    if "vector_chunks" not in metadata or not metadata["vector_chunks"]:
                        chunk_rows = conn.execute("SELECT id FROM chunks WHERE file_id = ?", (record.id,)).fetchall()
                        chunk_ids = [r["id"] for r in chunk_rows]
                        if chunk_ids:
                            metadata["vector_chunks"] = chunk_ids
                            record.metadata = metadata

                    conn.execute("DELETE FROM chunks WHERE file_id = ?", (record.id,))
                    conn.execute("DELETE FROM files WHERE id = ?", (record.id,))
                    removed.append(record)
        return removed

    def delete_file(self, file_id: str) -> None:
        with self.connect() as conn:
            conn.execute("DELETE FROM chunks WHERE file_id = ?", (file_id,))
            conn.execute("DELETE FROM files WHERE id = ?", (file_id,))

    def register_pending_file(self, record: FileRecord) -> None:
        """Register a file as pending for indexing. Only inserts if the file doesn't exist."""
        with self.connect() as conn:
            conn.execute(
                """
                INSERT OR IGNORE INTO files (
                    id, folder_id, path, name, extension, size, modified_at, created_at, kind, hash,
                    index_status, error_reason, error_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL)
                """,
                (
                    record.id,
                    record.folder_id,
                    str(record.path),
                    record.name,
                    record.extension,
                    record.size,
                    record.modified_at.isoformat(),
                    record.created_at.isoformat(),
                    record.kind,
                    record.hash,
                ),
            )

    def register_pending_files_batch(self, records: list[FileRecord]) -> int:
        """Register multiple files as pending in a single transaction. Returns count of newly inserted."""
        if not records:
            return 0
        with self.connect() as conn:
            cursor = conn.executemany(
                """
                INSERT OR IGNORE INTO files (
                    id, folder_id, path, name, extension, size, modified_at, created_at, kind, hash,
                    index_status, error_reason, error_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL)
                """,
                [
                    (
                        record.id,
                        record.folder_id,
                        str(record.path),
                        record.name,
                        record.extension,
                        record.size,
                        record.modified_at.isoformat(),
                        record.created_at.isoformat(),
                        record.kind,
                        record.hash,
                    )
                    for record in records
                ],
            )
            return cursor.rowcount

    def get_existing_file_ids(self, file_ids: list[str]) -> set[str]:
        """Get which file IDs already exist in the database. Batch lookup."""
        if not file_ids:
            return set()
        with self.connect() as conn:
            # SQLite has a limit on the number of variables, so we batch
            existing: set[str] = set()
            batch_size = 500
            for i in range(0, len(file_ids), batch_size):
                batch = file_ids[i:i + batch_size]
                placeholders = ",".join("?" for _ in batch)
                rows = conn.execute(
                    f"SELECT id FROM files WHERE id IN ({placeholders})",
                    batch,
                ).fetchall()
                existing.update(row["id"] for row in rows)
            return existing

    def mark_file_indexed(self, file_id: str) -> None:
        """Mark a file as successfully indexed."""
        with self.connect() as conn:
            conn.execute(
                "UPDATE files SET index_status = 'indexed', error_reason = NULL, error_at = NULL WHERE id = ?",
                (file_id,),
            )

    def mark_file_error(self, file_id: str, error_reason: str) -> None:
        """Mark a file as failed to index with an error reason."""
        now = dt.datetime.now(dt.timezone.utc)
        with self.connect() as conn:
            conn.execute(
                "UPDATE files SET index_status = 'error', error_reason = ?, error_at = ? WHERE id = ?",
                (error_reason, now.isoformat(), file_id),
            )

    def reset_file_for_reindex(self, file_id: str) -> None:
        """Reset a file's status to pending for re-indexing."""
        with self.connect() as conn:
            conn.execute(
                "UPDATE files SET index_status = 'pending', error_reason = NULL, error_at = NULL WHERE id = ?",
                (file_id,),
            )

    def list_pending_files(self, folder_id: Optional[str] = None) -> list[FileRecord]:
        """List all files that are pending indexing."""
        query = "SELECT * FROM files WHERE index_status = 'pending'"
        params: list[object] = []
        if folder_id:
            query += " AND folder_id = ?"
            params.append(folder_id)
        query += " ORDER BY modified_at DESC"
        
        with self.connect() as conn:
            rows = conn.execute(query, params).fetchall()
        return [self._row_to_file(row) for row in rows]

    def list_error_files(self, folder_id: Optional[str] = None) -> list[FileRecord]:
        """List all files that failed to index."""
        query = "SELECT * FROM files WHERE index_status = 'error'"
        params: list[object] = []
        if folder_id:
            query += " AND folder_id = ?"
            params.append(folder_id)
        query += " ORDER BY error_at DESC"
        
        with self.connect() as conn:
            rows = conn.execute(query, params).fetchall()
        return [self._row_to_file(row) for row in rows]

    def list_files(self, limit: int = 100, offset: int = 0, folder_id: Optional[str] = None) -> tuple[list[FileRecord], int]:
        query = "SELECT * FROM files"
        params: list[object] = []
        if folder_id:
            query += " WHERE folder_id = ?"
            params.append(folder_id)
        query += " ORDER BY modified_at DESC LIMIT ? OFFSET ?"
        params.extend([limit, offset])

        with self.connect() as conn:
            rows = conn.execute(query, params).fetchall()
            cursor = conn.execute(
                "SELECT COUNT(*) FROM files" + (" WHERE folder_id = ?" if folder_id else ""),
                ([folder_id] if folder_id else []),
            )
            total = cursor.fetchone()[0]
        return [self._row_to_file(row) for row in rows], int(total)

    def get_recent_files_with_suggestions(self, limit: int = 5) -> list[FileRecord]:
        with self.connect() as conn:
            # SQLite JSON support allows querying inside JSON columns
            # We check if suggested_questions exists and is not null/empty
            rows = conn.execute(
                """
                SELECT * FROM files 
                WHERE json_extract(metadata, '$.suggested_questions') IS NOT NULL
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (limit,)
            ).fetchall()
        return [self._row_to_file(row) for row in rows]

    def folder_files(self, folder_id: str) -> list[FileRecord]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM files WHERE folder_id = ? ORDER BY modified_at DESC",
                (folder_id,),
            ).fetchall()
        return [self._row_to_file(row) for row in rows]

    def get_file(self, file_id: str) -> Optional[FileRecord]:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM files WHERE id = ?", (file_id,)).fetchone()
        return self._row_to_file(row) if row else None

    def get_file_by_path(self, path: Path | str) -> Optional[FileRecord]:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM files WHERE path = ?", (str(path),)).fetchone()
        return self._row_to_file(row) if row else None

    def get_file_by_chunk_id(self, chunk_id: str) -> Optional[FileRecord]:
        """Get file by chunk ID (for backward compatibility with old vector data)."""
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT f.* FROM files f
                JOIN chunks c ON c.file_id = f.id
                WHERE c.id = ?
                LIMIT 1
                """,
                (chunk_id,)
            ).fetchone()
        return self._row_to_file(row) if row else None

    def counts(self) -> tuple[int, int]:
        with self.connect() as conn:
            files = conn.execute("SELECT COUNT(*) FROM files").fetchone()[0]
            folders = conn.execute("SELECT COUNT(*) FROM folders WHERE enabled = 1").fetchone()[0]
        return int(files), int(folders)

    def folder_file_count(self, folder_id: str) -> int:
        """Get the count of indexed files for a specific folder (fast query)."""
        with self.connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) FROM files WHERE folder_id = ?",
                (folder_id,),
            ).fetchone()
        return int(row[0] if row else 0)

    def total_size(self, folder_id: Optional[str] = None) -> int:
        query = "SELECT COALESCE(SUM(size), 0) FROM files"
        params: tuple[str, ...] = ()
        if folder_id:
            query += " WHERE folder_id = ?"
            params = (folder_id,)
        with self.connect() as conn:
            result = conn.execute(query, params).fetchone()[0]
        return int(result or 0)

    def files_with_embeddings(self) -> list[FileRecord]:
        with self.connect() as conn:
            rows = conn.execute("SELECT * FROM files WHERE embedding_vector IS NOT NULL").fetchall()
        return [self._row_to_file(row) for row in rows]

    def replace_chunks(self, file_id: str, chunks: list[ChunkSnapshot]) -> None:
        with self.connect() as conn:
            conn.execute("DELETE FROM chunks WHERE file_id = ?", (file_id,))
            if not chunks:
                return
            conn.executemany(
                """
                INSERT INTO chunks (id, file_id, ordinal, text, snippet, token_count, char_count, section_path, metadata, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        chunk.chunk_id,
                        chunk.file_id,
                        chunk.ordinal,
                        chunk.text,
                        chunk.snippet,
                        chunk.token_count,
                        chunk.char_count,
                        chunk.section_path,
                        self._serialize_metadata(chunk.metadata),
                        chunk.created_at.isoformat(),
                    )
                    for chunk in chunks
                ],
            )

    def chunks_for_file(self, file_id: str) -> list[ChunkSnapshot]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM chunks WHERE file_id = ? ORDER BY ordinal ASC",
                (file_id,),
            ).fetchall()
        return [self._row_to_chunk(row) for row in rows]

    def get_chunk(self, chunk_id: str) -> Optional[ChunkSnapshot]:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM chunks WHERE id = ?", (chunk_id,)).fetchone()
        return self._row_to_chunk(row) if row else None

    def find_files_by_name(self, name_pattern: str) -> list[FileRecord]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM files WHERE name LIKE ?",
                (f"%{name_pattern}%",),
            ).fetchall()
        return [self._row_to_file(row) for row in rows]

    # ==========================================
    # Progressive/Layered Search Methods
    # ==========================================

    def search_files_by_filename(self, query: str, limit: int = 10) -> list[SearchHit]:
        """
        L1: Fast filename matching - searches file names for query terms.
        Returns file-level hits (no chunk_id) sorted by match quality.
        """
        terms = [t.strip().lower() for t in query.split() if len(t.strip()) >= 2]
        if not terms:
            return []

        # Build LIKE conditions for each term
        conditions = " AND ".join(["LOWER(name) LIKE ?" for _ in terms])
        params = [f"%{term}%" for term in terms]
        params.append(limit * 2)  # Fetch extra for scoring

        sql = f"""
            SELECT id, name, path, summary, metadata
            FROM files
            WHERE {conditions}
            ORDER BY modified_at DESC
            LIMIT ?
        """

        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()

        hits: list[SearchHit] = []
        for row in rows:
            name_lower = (row["name"] or "").lower()
            score = self._lexical_score(name_lower, terms)
            # Boost exact matches in filename
            if all(term in name_lower for term in terms):
                score = min(1.0, score + 0.2)

            metadata = self._deserialize_metadata(row["metadata"])
            metadata["path"] = row["path"]
            metadata["name"] = row["name"]

            hits.append(SearchHit(
                file_id=row["id"],
                score=score,
                summary=row["summary"],
                snippet=None,  # File-level hit, no chunk snippet
                metadata=metadata,
                chunk_id=None,
            ))

        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:limit]

    def search_files_by_summary(self, query: str, limit: int = 10, exclude_file_ids: set[str] | None = None) -> list[SearchHit]:
        """
        L2: Search file summaries for query terms.
        Returns file-level hits sorted by match quality.
        """
        terms = [t.strip().lower() for t in query.split() if len(t.strip()) >= 2]
        if not terms:
            return []

        exclude_file_ids = exclude_file_ids or set()

        # Build LIKE conditions - at least one term must match
        conditions = " OR ".join(["LOWER(summary) LIKE ?" for _ in terms])
        params = [f"%{term}%" for term in terms]
        params.append(limit * 3)

        sql = f"""
            SELECT id, name, path, summary, metadata
            FROM files
            WHERE summary IS NOT NULL AND summary != '' AND ({conditions})
            ORDER BY modified_at DESC
            LIMIT ?
        """

        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()

        hits: list[SearchHit] = []
        for row in rows:
            if row["id"] in exclude_file_ids:
                continue

            summary_lower = (row["summary"] or "").lower()
            score = self._lexical_score(summary_lower, terms)

            metadata = self._deserialize_metadata(row["metadata"])
            metadata["path"] = row["path"]
            metadata["name"] = row["name"]

            # Create a snippet from the summary
            snippet = row["summary"][:300] if row["summary"] else None

            hits.append(SearchHit(
                file_id=row["id"],
                score=score,
                summary=row["summary"],
                snippet=snippet,
                metadata=metadata,
                chunk_id=None,
            ))

        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:limit]

    def search_files_by_metadata(self, query: str, limit: int = 10, exclude_file_ids: set[str] | None = None) -> list[SearchHit]:
        """
        L3: Search file metadata (JSON) for query terms.
        Returns file-level hits sorted by match quality.
        """
        terms = [t.strip().lower() for t in query.split() if len(t.strip()) >= 2]
        if not terms:
            return []

        exclude_file_ids = exclude_file_ids or set()

        # Build LIKE conditions on metadata JSON text
        conditions = " OR ".join(["LOWER(metadata) LIKE ?" for _ in terms])
        params = [f"%{term}%" for term in terms]
        params.append(limit * 3)

        sql = f"""
            SELECT id, name, path, summary, metadata
            FROM files
            WHERE metadata IS NOT NULL AND ({conditions})
            ORDER BY modified_at DESC
            LIMIT ?
        """

        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()

        hits: list[SearchHit] = []
        for row in rows:
            if row["id"] in exclude_file_ids:
                continue

            metadata_text = (row["metadata"] or "").lower()
            score = self._lexical_score(metadata_text, terms)

            metadata = self._deserialize_metadata(row["metadata"])
            metadata["path"] = row["path"]
            metadata["name"] = row["name"]

            hits.append(SearchHit(
                file_id=row["id"],
                score=score,
                summary=row["summary"],
                snippet=row["summary"][:200] if row["summary"] else None,
                metadata=metadata,
                chunk_id=None,
            ))

        hits.sort(key=lambda h: h.score, reverse=True)
        return hits[:limit]

    @staticmethod
    def _lexical_score(text: str, terms: list[str]) -> float:
        """
        Calculate lexical match score with strong emphasis on matching ALL query terms.

        Scoring strategy:
        1. Exact phrase match (all terms in order) → 1.0
        2. All terms present (any order) → 0.90-0.95 (very high!)
        3. Most terms present → exponential decay
        4. Few terms present → low score

        The key insight: If a chunk matches ALL query terms, it's highly relevant
        regardless of order. Use exponential scoring to heavily favor complete matches.
        """
        if not text or not terms:
            return 0.0

        text_lower = text.lower()

        # Check for exact phrase match (all terms in order)
        query_phrase = " ".join(terms)
        if query_phrase in text_lower:
            return 1.0

        # Count matched terms
        matched_terms = sum(1 for term in terms if term in text_lower)
        if matched_terms == 0:
            return 0.1

        # Calculate match ratio
        match_ratio = matched_terms / len(terms)

        # CRITICAL: Use exponential scoring to heavily favor complete matches
        # This creates a steep curve where matching all terms gets much higher scores
        # Examples:
        #   5/5 terms (100%) → 0.95
        #   4/5 terms (80%)  → 0.78
        #   3/5 terms (60%)  → 0.56
        #   2/5 terms (40%)  → 0.37
        if match_ratio == 1.0:
            # Perfect match of all terms (but not exact phrase) → very high score
            base_score = 0.95
        else:
            # Use quadratic curve to emphasize completeness
            # Formula: 0.2 + (ratio^2 * 0.65)
            base_score = 0.2 + (match_ratio ** 2) * 0.65

        # Bonus for multiple occurrences (more mentions = more relevant)
        total_occurrences = sum(text_lower.count(term) for term in terms)
        frequency_bonus = min(0.05, (total_occurrences - matched_terms) * 0.01)

        # Extra bonus for matching many terms (scales with query complexity)
        if matched_terms >= 3 and match_ratio >= 0.8:
            completeness_bonus = 0.1 * (matched_terms / len(terms))
        else:
            completeness_bonus = 0.0

        final_score = base_score + frequency_bonus + completeness_bonus

        return min(1.0, final_score)

    def search_snippets(self, query: str, limit: int = 10, require_all_terms: bool = False, file_ids: Optional[list[str]] = None) -> list[SearchHit]:
        """
        Lexical search using keyword matching.

        Args:
            query: Search query
            limit: Maximum number of results
            require_all_terms: If True, only return chunks containing ALL query terms (AND logic)
                              If False, return chunks with ANY terms (OR logic)
            file_ids: Optional list of file IDs to restrict search to
        """
        terms = [part.strip().lower() for part in query.split() if len(part.strip()) >= 2]
        if not terms:
            return []

        like_clauses: list[str] = []
        params: list[Any] = []
        for term in terms[:6]:  # Consider up to 6 terms
            pattern = f"%{term}%"
            like_clauses.append("(lower(ch.text) LIKE ? OR lower(ch.snippet) LIKE ?)")
            params.extend([pattern, pattern])

        # Use AND logic if require_all_terms=True (must match ALL terms)
        # Use OR logic otherwise (match ANY terms)
        if require_all_terms:
            where_clause = " AND ".join(like_clauses) if like_clauses else "1=1"
        else:
            where_clause = " OR ".join(like_clauses) if like_clauses else "1=1"

        if file_ids:
            placeholders = ",".join("?" for _ in file_ids)
            where_clause = f"({where_clause}) AND ch.file_id IN ({placeholders})"
            params.extend(file_ids)

        fetch_limit = max(limit * 5, 20)  # Fetch more candidates for better ranking
        sql = f"""
            SELECT
                ch.id AS chunk_id,
                ch.file_id AS file_id,
                ch.text AS chunk_text,
                ch.snippet AS chunk_snippet,
                ch.metadata AS chunk_metadata,
                ch.created_at AS chunk_created_at,
                f.summary AS file_summary,
                f.metadata AS file_metadata,
                f.path AS file_path
            FROM chunks ch
            JOIN files f ON f.id = ch.file_id
            WHERE {where_clause}
            ORDER BY ch.created_at DESC
            LIMIT ?
        """
        params.append(fetch_limit)

        with self.connect() as conn:
            rows = conn.execute(sql, params).fetchall()

        hits: list[SearchHit] = []
        for row in rows:
            chunk_text = row["chunk_text"] or ""
            snippet = row["chunk_snippet"] or chunk_text[:480]
            chunk_metadata = self._deserialize_metadata(row["chunk_metadata"])
            file_metadata = self._deserialize_metadata(row["file_metadata"])
            metadata = {**file_metadata, **chunk_metadata}
            metadata.setdefault("path", row["file_path"])
            metadata.setdefault("chunk_id", row["chunk_id"])
            score = self._lexical_score(chunk_text.lower(), terms)
            hits.append(
                SearchHit(
                    file_id=row["file_id"],
                    score=score,
                    summary=row["file_summary"],
                    snippet=snippet,
                    metadata=metadata,
                    chunk_id=row["chunk_id"],
                )
            )

        hits.sort(key=lambda item: item.score, reverse=True)

        # Log top lexical hits for debugging
        if hits:
            logger.debug(f"Top lexical search results for '{query}':")
            for idx, hit in enumerate(hits[:5], 1):
                metadata = hit.metadata or {}
                label = metadata.get("path", hit.file_id)
                logger.debug(f"  {idx}. {label} (score={hit.score:.3f})")

        return hits[:limit]

    def upsert_chat_session(self, session: ChatSession) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO chat_sessions (id, title, created_at, updated_at)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    title=excluded.title,
                    updated_at=excluded.updated_at
                """,
                (
                    session.id,
                    session.title,
                    session.created_at.isoformat(),
                    session.updated_at.isoformat(),
                ),
            )

    def get_chat_session(self, session_id: str) -> Optional[ChatSession]:
        with self.connect() as conn:
            row = conn.execute("SELECT * FROM chat_sessions WHERE id = ?", (session_id,)).fetchone()
            if not row:
                return None

            messages_rows = conn.execute(
                "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC",
                (session_id,),
            ).fetchall()

            messages = [self._row_to_chat_message(r) for r in messages_rows]

            return ChatSession(
                id=row["id"],
                title=row["title"],
                created_at=dt.datetime.fromisoformat(row["created_at"]),
                updated_at=dt.datetime.fromisoformat(row["updated_at"]),
                messages=messages,
            )

    def list_chat_sessions(self, limit: int = 100, offset: int = 0) -> list[ChatSession]:
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT * FROM chat_sessions ORDER BY updated_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()

            sessions = []
            for row in rows:
                # For list view, we might not need all messages, but let's fetch them for now or keep it empty
                # To keep it lightweight, we can fetch messages or just return session info.
                # The frontend expects messages in the session object usually.
                # Let's fetch messages for each session to be consistent with the model.
                messages_rows = conn.execute(
                    "SELECT * FROM chat_messages WHERE session_id = ? ORDER BY timestamp ASC",
                    (row["id"],),
                ).fetchall()
                messages = [self._row_to_chat_message(r) for r in messages_rows]

                sessions.append(ChatSession(
                    id=row["id"],
                    title=row["title"],
                    created_at=dt.datetime.fromisoformat(row["created_at"]),
                    updated_at=dt.datetime.fromisoformat(row["updated_at"]),
                    messages=messages,
                ))
            return sessions

    def delete_chat_session(self, session_id: str) -> None:
        with self.connect() as conn:
            conn.execute("DELETE FROM chat_sessions WHERE id = ?", (session_id,))

    def add_chat_message(self, message: ChatMessage) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO chat_messages (id, session_id, role, content, timestamp, meta, "references", is_multi_path, thinking_steps)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    message.id,
                    message.session_id,
                    message.role,
                    message.content,
                    message.timestamp.isoformat(),
                    message.meta,
                    self._serialize_references(message.references),
                    1 if message.is_multi_path else (0 if message.is_multi_path is False else None),
                    self._serialize_thinking_steps(message.thinking_steps),
                ),
            )
            # Update session updated_at
            conn.execute(
                "UPDATE chat_sessions SET updated_at = ? WHERE id = ?",
                (message.timestamp.isoformat(), message.session_id),
            )

    @staticmethod
    def _row_to_chat_message(row: sqlite3.Row) -> ChatMessage:
        # Handle is_multi_path: SQLite stores as INTEGER (0/1/NULL)
        is_multi_path = None
        if "is_multi_path" in row.keys() and row["is_multi_path"] is not None:
            is_multi_path = bool(row["is_multi_path"])
        
        # Handle thinking_steps
        thinking_steps = None
        if "thinking_steps" in row.keys() and row["thinking_steps"]:
            thinking_steps = IndexStorage._deserialize_thinking_steps(row["thinking_steps"])
        
        return ChatMessage(
            id=row["id"],
            session_id=row["session_id"],
            role=row["role"],
            content=row["content"],
            timestamp=dt.datetime.fromisoformat(row["timestamp"]),
            meta=row["meta"],
            references=IndexStorage._deserialize_references(row["references"]),
            is_multi_path=is_multi_path,
            thinking_steps=thinking_steps,
        )

    @staticmethod
    def _serialize_references(refs: Optional[list[SearchHit]]) -> Optional[str]:
        if not refs:
            return None
        return json.dumps([ref.dict() for ref in refs], ensure_ascii=False)

    @staticmethod
    def _deserialize_references(payload: Optional[str]) -> Optional[list[SearchHit]]:
        if not payload:
            return None
        try:
            data = json.loads(payload)
            if isinstance(data, list):
                return [SearchHit(**item) for item in data]
        except (json.JSONDecodeError, TypeError):
            pass
        return None

    @staticmethod
    def _serialize_thinking_steps(steps: Optional[list[dict]]) -> Optional[str]:
        if not steps:
            return None
        return json.dumps(steps, ensure_ascii=False)

    @staticmethod
    def _deserialize_thinking_steps(payload: Optional[str]) -> Optional[list[dict]]:
        if not payload:
            return None
        try:
            data = json.loads(payload)
            if isinstance(data, list):
                return data
        except (json.JSONDecodeError, TypeError):
            pass
        return None

    @staticmethod
    def _row_to_folder(row: sqlite3.Row) -> FolderRecord:
        failed_files = []
        if "failed_files" in row.keys() and row["failed_files"]:
            try:
                data = json.loads(row["failed_files"])
                if isinstance(data, list):
                    from .models import FailedFile
                    failed_files = [FailedFile(**item) for item in data]
            except (json.JSONDecodeError, TypeError):
                pass

        # Handle scan_mode with fallback for existing rows
        scan_mode = "full"
        if "scan_mode" in row.keys() and row["scan_mode"]:
            scan_mode = row["scan_mode"]

        return FolderRecord(
            id=row["id"],
            path=Path(row["path"]),
            label=row["label"],
            created_at=dt.datetime.fromisoformat(row["created_at"]),
            updated_at=dt.datetime.fromisoformat(row["updated_at"]),
            last_indexed_at=dt.datetime.fromisoformat(row["last_indexed_at"]) if row["last_indexed_at"] else None,
            enabled=bool(row["enabled"]),
            failed_files=failed_files,
            indexed_count=row["indexed_count"] if "indexed_count" in row.keys() else 0,
            scan_mode=scan_mode,
        )

    @staticmethod
    def _row_to_file(row: sqlite3.Row) -> FileRecord:
        # Handle index_status with fallback for existing rows without the column
        keys = row.keys()
        raw_status = row["index_status"] if "index_status" in keys else None
        error_reason = row["error_reason"] if "error_reason" in keys else None
        error_at = dt.datetime.fromisoformat(row["error_at"]) if "error_at" in keys and row["error_at"] else None
        
        # Determine actual index status
        if raw_status == "error":
            index_status = "error"
        elif raw_status == "indexed":
            index_status = "indexed"
        elif raw_status == "pending":
            # Check if file was actually indexed (has embedding or summary or metadata)
            # This handles the case where the column was added with wrong default
            has_embedding = row["embedding_vector"] is not None
            has_summary = row["summary"] is not None and row["summary"] != ""
            has_metadata = row["metadata"] is not None and row["metadata"] != "" and row["metadata"] != "{}"
            if has_embedding or has_summary or has_metadata:
                index_status = "indexed"
            else:
                index_status = "pending"
        else:
            # No status column or null - check content to determine
            has_embedding = row["embedding_vector"] is not None
            has_summary = row["summary"] is not None and row["summary"] != ""
            if has_embedding or has_summary:
                index_status = "indexed"
            else:
                index_status = "pending"
        
        return FileRecord(
            id=row["id"],
            folder_id=row["folder_id"],
            path=Path(row["path"]),
            name=row["name"],
            extension=row["extension"],
            size=int(row["size"]),
            modified_at=dt.datetime.fromisoformat(row["modified_at"]),
            created_at=dt.datetime.fromisoformat(row["created_at"]),
            kind=row["kind"] if row["kind"] else "other",
            hash=row["hash"],
            summary=row["summary"],
            embedding_vector=IndexStorage._deserialize_vector(row["embedding_vector"]),
            embedding_determined_at=dt.datetime.fromisoformat(row["embedding_determined_at"]) if row["embedding_determined_at"] else None,
            mime_type=row["mime_type"],
            checksum_sha256=row["checksum_sha256"],
            duration_seconds=row["duration_seconds"],
            page_count=row["page_count"],
            preview_image=row["preview_image"],
            metadata=IndexStorage._deserialize_metadata(row["metadata"]),
            index_status=index_status,
            error_reason=error_reason,
            error_at=error_at,
        )

    @staticmethod
    def _row_to_chunk(row: sqlite3.Row) -> ChunkSnapshot:
        return ChunkSnapshot(
            chunk_id=row["id"],
            file_id=row["file_id"],
            ordinal=int(row["ordinal"]),
            text=row["text"],
            snippet=row["snippet"],
            token_count=int(row["token_count"]),
            char_count=int(row["char_count"]),
            section_path=row["section_path"],
            metadata=IndexStorage._deserialize_metadata(row["metadata"]),
            created_at=dt.datetime.fromisoformat(row["created_at"]),
        )

    @staticmethod
    def _row_to_note(row: sqlite3.Row) -> NoteRecord:
        return NoteRecord(
            id=row["id"],
            title=row["title"],
            path=Path(row["path"]),
            created_at=dt.datetime.fromisoformat(row["created_at"]),
            updated_at=dt.datetime.fromisoformat(row["updated_at"]),
        )

    @staticmethod
    def _serialize_vector(vector: Optional[list[float]]) -> Optional[bytes]:
        if vector is None:
            return None
        return ",".join(f"{value:.6f}" for value in vector).encode("ascii")

    @staticmethod
    def _deserialize_vector(blob: Optional[bytes]) -> Optional[list[float]]:
        if not blob:
            return None
        text = blob.decode("ascii")
        return [float(part) for part in text.split(",") if part]

    @staticmethod
    def _serialize_metadata(metadata: dict[str, Any] | None) -> Optional[str]:
        if not metadata:
            return None
        return json.dumps(metadata, ensure_ascii=False)

    @staticmethod
    def _deserialize_metadata(payload: Optional[str]) -> dict[str, Any]:
        if not payload:
            return {}
        try:
            data = json.loads(payload)
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError:
            pass
        return {}
