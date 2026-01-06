"""Advanced indexing pipeline for the local RAG agent."""

from __future__ import annotations
from .vector_store import VectorStore, vector_store
from .storage import IndexStorage

import asyncio
import datetime as dt
import hashlib
import logging
import mimetypes
import os
import random
import re
from collections import deque
from pathlib import Path
from typing import Iterable, Optional, Sequence, Literal

from .clients import EmbeddingClient, LlmClient, TranscriptionClient
from .chunker import ChunkingPipeline, ChunkPayload, chunking_pipeline
from .config import settings
from .content import ContentRouter, content_router
from .models import ChunkSnapshot, IngestArtifact, FileRecord, FolderRecord, IndexProgress, IndexingItem, VectorDocument, infer_kind, FailedFile
from .vision import VisionProcessor

logger = logging.getLogger(__name__)


DEFAULT_SUMMARY_PROMPT = (
    "Write a plain, objective summary of this document in 2-3 sentences (around 60 words). "
    "Include: the filename, document title, author or organization if known, and what the document is about. "
    "Use simple language. Do not use markdown formatting, bold, or bullet points."
)

IMAGE_PROMPT = (
    "You are a vision assistant. Describe the image precisely, focusing on visible text, objects, and context."
)

PDF_PAGE_PROMPT = (
    "You are an OCR assistant. Extract everything from this page as Markdown. \n\n"
    "Rules:\n"
    "1. Extract all text exactly as shown.\n"
    "2. Start from the top. Use # for titles, ## for sections, ### for sub-sections.\n"
    "3. For multi-column layouts (e.g., two columns): read the LEFT column completely from top to bottom FIRST, then read the RIGHT column from top to bottom. Do NOT read across columns horizontally.\n"
    "4. For charts, list 2–4 key visible facts as bullet points (numbers, trends, labels).\n"
    "5. Organize the output comprehensively and in a logical and readable manner.\n"
    "Only Markdown. No guessing. No explanations. Do not show page number."
)

VIDEO_SEGMENT_PROMPT = (
    "You are a video analyst. Describe what happens in this video segment. "
    "Focus on actions, objects, people, and any visible text. Be concise and specific."
)

CHUNK_QUESTIONS_PROMPT = (
    "Write ONE concise, self-contained question (no more than 10 words) about this content. Be highly specific about the subject of the question—do not use pronouns, and ensure the question can stand alone without additional context.\n\n"
    "Examples:\n"
    "- What is the Q3 revenue of the company XXXX?\n"
    "- When is the deadline of the conference on XXXX?\n"
    "Write only the question. Do not include any explanations or extra text."
)


class Indexer:
    """Coordinates folder scans, parsing, summarisation, and vector persistence."""

    def __init__(
            self,
            storage: IndexStorage,
            *,
            embedding_client: EmbeddingClient,
            llm_client: LlmClient,
            transcription_client: Optional[TranscriptionClient] = None,
            content: ContentRouter = content_router,
            chunker: ChunkingPipeline = chunking_pipeline,
            vectors: VectorStore = vector_store,
            vision_processor: Optional[VisionProcessor] = None,
    ) -> None:
        self.storage = storage
        self.embedding_client = embedding_client
        self.llm_client = llm_client
        self.transcription_client = transcription_client
        self.content_router = content
        self.chunker = chunker
        self.vector_store = vectors
        self.vision_processor = vision_processor or VisionProcessor(llm_client)
        self.progress = IndexProgress(status="idle", started_at=None, completed_at=None, processed=0)
        self._lock = asyncio.Lock()
        self._pending_paths: dict[str, deque[Path]] = {}
        self._active_folder: FolderRecord | None = None
        self._active_path: Path | None = None
        self._active_started_at: dt.datetime | None = None
        self._active_progress: float | None = None
        self._active_kind: str | None = None
        self._active_stage: str | None = None
        self._active_detail: str | None = None
        self._active_step_current: int | None = None
        self._active_step_total: int | None = None
        self._active_recent_events: list[dict] = []
        self._current_run_started: dt.datetime | None = None
        self._current_run_total: int = 0
        self._current_processed: int = 0
        self._pause_event = asyncio.Event()
        self._pause_event.set()
        self._is_paused = False
        self._cancelled_folders: set[str] = set()

    def cancel_folder(self, folder_id: str) -> None:
        """Mark a folder as cancelled to stop processing it."""
        self._cancelled_folders.add(folder_id)
        # If we are currently processing this folder, we can't easily interrupt the current file,
        # but we can stop the loop in _process_folder.

    def _resolve_targets(self, folders: Optional[list[str]], files: Optional[list[str]]) -> tuple[list[FolderRecord], dict[str, list[Path]]]:
        target_files_by_folder: dict[str, list[Path]] = {}
        # Track if this is an explicit request (specific files or folders) vs automatic refresh
        is_explicit_request = bool(files) or bool(folders)
        
        if files:
            for file_path_str in files:
                path = Path(file_path_str).resolve()
                folder = self.storage.folder_by_path(path.parent)
                # If not found directly, try to find which folder contains this file
                if not folder:
                    # This is a bit expensive but necessary if we don't have direct mapping
                    all_folders = self.storage.list_folders()
                    for f in all_folders:
                        try:
                            path.relative_to(f.path)
                            folder = f
                            break
                        except ValueError:
                            continue

                if folder:
                    if folder.id not in target_files_by_folder:
                        target_files_by_folder[folder.id] = []
                    target_files_by_folder[folder.id].append(path)

            # If we have target files, we only process those folders
            if target_files_by_folder:
                folders = list(target_files_by_folder.keys())

        # Include manual folders only for explicit requests (specific files or folders)
        # Skip manual folders during automatic refresh (startup/poll)
        targets = self._select_folders(folders, include_manual=is_explicit_request)
        return targets, target_files_by_folder

    def _prepare_batches(
        self,
        targets: list[FolderRecord],
        target_files_by_folder: dict[str, list[Path]],
        refresh_embeddings: bool,
        skip_pending_registration: bool = False,
        skip_recently_indexed_minutes: int = 0,
    ) -> tuple[list[tuple[FolderRecord, list[Path], list[Path], bool]], int]:
        batches: list[tuple[FolderRecord, list[Path], list[Path], bool]] = []
        total_files = 0
        now = dt.datetime.now(dt.timezone.utc)
        
        for folder in targets:
            # Skip folders that were indexed recently (useful for startup refresh)
            if skip_recently_indexed_minutes > 0 and folder.last_indexed_at:
                last_indexed = folder.last_indexed_at
                if last_indexed.tzinfo is None:
                    last_indexed = last_indexed.replace(tzinfo=dt.timezone.utc)
                minutes_since = (now - last_indexed).total_seconds() / 60
                if minutes_since < skip_recently_indexed_minutes:
                    logger.info(
                        "Skipping folder %s - indexed %.1f minutes ago (threshold: %d)",
                        folder.path, minutes_since, skip_recently_indexed_minutes
                    )
                    continue

            # If we have specific files for this folder, skip the expensive full folder scan
            specific_files = target_files_by_folder.get(folder.id)
            if specific_files:
                # Only process the specific files - no need to scan entire folder
                to_process = [p for p in specific_files if p.exists()]
                # Use the specific files as folder_paths for tracking
                folder_paths = to_process
                force_reembed_for_files = True
            else:
                # Full folder scan - only when no specific files are requested
                folder_paths = list(self._iter_files(folder.path))

                # Register all discovered files as pending if they don't exist yet
                # Skip this expensive operation for startup/poll refresh (only needed for UI display)
                if not skip_pending_registration:
                    self._register_pending_files(folder, folder_paths)

                to_process = self._paths_to_refresh(folder, folder_paths, refresh_embeddings=refresh_embeddings)
                force_reembed_for_files = refresh_embeddings

            total_files += len(to_process)
            batches.append((folder, folder_paths, to_process, force_reembed_for_files))
        return batches, total_files

    def _register_pending_files(self, folder: FolderRecord, paths: list[Path]) -> None:
        """Register all discovered files as pending in the database using batch operations."""
        if not paths:
            return

        # First, compute file hashes and build records in memory
        records_to_insert: list[FileRecord] = []
        file_ids: list[str] = []

        for path in paths:
            try:
                file_hash = self._fingerprint(path)
                file_ids.append(file_hash)
            except OSError:
                continue

        # Batch lookup: which files already exist?
        existing_ids = self.storage.get_existing_file_ids(file_ids)

        # Now build records only for files that don't exist
        for path in paths:
            try:
                file_hash = self._fingerprint(path)
                if file_hash in existing_ids:
                    continue

                stat = path.stat()
                extension = path.suffix.lower().lstrip(".")
                kind = infer_kind(path)

                record = FileRecord(
                    id=file_hash,
                    folder_id=folder.id,
                    path=path,
                    name=path.name,
                    extension=extension,
                    size=stat.st_size,
                    modified_at=dt.datetime.fromtimestamp(stat.st_mtime, tz=dt.timezone.utc),
                    created_at=dt.datetime.fromtimestamp(stat.st_ctime, tz=dt.timezone.utc),
                    kind=kind,
                    hash=file_hash,
                    index_status="pending",
                )
                records_to_insert.append(record)
            except OSError:
                # File might have been deleted or is inaccessible
                continue

        # Batch insert all new records in a single transaction
        if records_to_insert:
            self.storage.register_pending_files_batch(records_to_insert)

    async def refresh(
            self,
            *,
            folders: Optional[list[str]] = None,
            files: Optional[list[str]] = None,
            refresh_embeddings: bool = False,
            drop_collection: bool = False,
            purge_folders: Optional[list[str]] = None,
            indexing_mode: Literal["fast", "fine"] = "fast",
            skip_pending_registration: bool = False,
            skip_recently_indexed_minutes: int = 0,
    ) -> IndexProgress:
        if self._lock.locked():
            return self.progress

        async with self._lock:
            self._is_paused = False
            self._pause_event.set()
            self._cancelled_folders.clear()

            force_reembed = refresh_embeddings or drop_collection

            if drop_collection:
                self.vector_store.drop_collection()

            targets, target_files_by_folder = self._resolve_targets(folders, files)

            self._pending_paths.clear()
            self._active_folder = None
            self._active_path = None
            self._active_started_at = None
            self._active_progress = None

            if not targets:
                now = dt.datetime.now(dt.timezone.utc)
                self._current_run_started = now
                self._current_run_total = 0
                self._current_processed = 0
                self.progress = IndexProgress(
                    status="failed",
                    started_at=now,
                    completed_at=now,
                    processed=0,
                    total=None,
                    message="no-folders",
                    last_error="No folders registered for indexing.",
                )
                self._pause_event.set()
                self._is_paused = False
                return self.progress

            purge_targets = set(purge_folders or [])
            if purge_targets:
                for folder in targets:
                    if folder.id in purge_targets:
                        self._purge_folder(folder)

            batches, total_files = self._prepare_batches(
                targets, target_files_by_folder, force_reembed,
                skip_pending_registration=skip_pending_registration,
                skip_recently_indexed_minutes=skip_recently_indexed_minutes,
            )

            started = dt.datetime.now(dt.timezone.utc)
            self._current_run_started = started
            self._current_run_total = total_files
            self._current_processed = 0
            self.progress = IndexProgress(
                status="running",
                started_at=started,
                processed=0,
                failed=0,
                total=total_files or None,
            )

            for folder, paths, to_process, reembed in batches:
                if folder.id in self._cancelled_folders:
                    logger.info("Skipping cancelled folder %s", folder.id)
                    continue

                try:
                    await self._process_folder(
                        folder,
                        refresh_embeddings=reembed,
                        paths=paths,
                        process_paths=to_process,
                        indexing_mode=indexing_mode,
                    )
                except Exception as exc:  # noqa: BLE001
                    self._pending_paths.pop(folder.id, None)
                    self._active_folder = None
                    self._active_path = None
                    self._active_started_at = None
                    self.progress = IndexProgress(
                        status="failed",
                        started_at=started,
                        completed_at=dt.datetime.now(dt.timezone.utc),
                        processed=self._current_processed,
                        failed=self.progress.failed,
                        failed_items=self.progress.failed_items,
                        total=total_files or None,
                        last_error=str(exc),
                        message=self.progress.message,
                    )
                    break
                else:
                    await self._mark_folder_indexed(folder.id)
                    current_message = self.progress.message
                    self.progress = IndexProgress(
                        status="running",
                        started_at=started,
                        processed=self._current_processed,
                        failed=self.progress.failed,
                        failed_items=self.progress.failed_items,
                        total=total_files or None,
                        message=current_message,
                    )
            else:
                final_message = "No changes detected." if total_files == 0 else None
                self.progress = IndexProgress(
                    status="completed",
                    started_at=started,
                    completed_at=dt.datetime.now(dt.timezone.utc),
                    processed=self._current_processed,
                    failed=self.progress.failed,
                    failed_items=self.progress.failed_items,
                    total=total_files or None,
                    message=final_message,
                )

            self._pending_paths.clear()
            self._active_folder = None
            self._active_path = None
            self._active_started_at = None
            self._active_progress = None
            self._pause_event.set()
            self._is_paused = False
            return self.progress

    def status(self) -> IndexProgress:
        return self.progress

    def pause(self) -> IndexProgress:
        if self.progress.status != "running" or self._is_paused:
            return self.progress
        self._is_paused = True
        self._pause_event.clear()
        total = self._current_run_total or None
        self.progress = IndexProgress(
            status="paused",
            started_at=self._current_run_started,
            completed_at=None,
            processed=self._current_processed,
            failed=self.progress.failed,
            failed_items=self.progress.failed_items,
            total=total,
            message="Indexing paused.",
            last_error=self.progress.last_error,
        )
        return self.progress

    def resume(self) -> IndexProgress:
        if not self._is_paused:
            return self.progress
        self._is_paused = False
        self._pause_event.set()
        self._set_running_progress(message="Resuming indexing…")
        return self.progress

    def _select_folders(self, folder_ids: Optional[list[str]], include_manual: bool = False) -> list[FolderRecord]:
        """
        Select folders for indexing.
        
        Args:
            folder_ids: Optional list of specific folder IDs to include
            include_manual: If False (default), skip folders with scan_mode='manual'
                           during automatic refresh. Set to True when explicitly requesting
                           specific folders.
        """
        folders = [folder for folder in self.storage.list_folders() if folder.enabled]
        
        if folder_ids:
            # Explicit folder IDs - include all requested, even manual ones
            allowed = set(folder_ids)
            return [folder for folder in folders if folder.id in allowed]
        
        # Automatic refresh - skip manual folders unless explicitly requested
        if not include_manual:
            folders = [f for f in folders if f.scan_mode != "manual"]
        
        return folders

    def _set_running_progress(self, *, message: Optional[str] = None) -> None:
        if not self._current_run_started:
            return
        total = self._current_run_total or None
        current_message = message if message is not None else self.progress.message
        self.progress = IndexProgress(
            status="running",
            started_at=self._current_run_started,
            completed_at=None,
            processed=self._current_processed,
            failed=self.progress.failed,
            failed_items=self.progress.failed_items,
            total=total,
            message=current_message,
        )

    def _set_active_stage(
        self,
        *,
        stage: str | None,
        detail: str | None = None,
        step_current: int | None = None,
        step_total: int | None = None,
        progress: float | None = None,
        event: str | None = None,
        event_type: str = "info",
        event_payload: dict | None = None,
    ) -> None:
        self._active_stage = stage
        self._active_detail = detail
        self._active_step_current = step_current
        self._active_step_total = step_total
        if progress is not None:
            self._active_progress = progress

        if event is not None:
            payload = {
                "ts": dt.datetime.now(dt.timezone.utc).isoformat(),
                "type": event_type,
                "message": event,
            }
            if event_payload:
                payload.update(event_payload)
            self._active_recent_events.append(payload)
            if len(self._active_recent_events) > 100:
                self._active_recent_events = self._active_recent_events[-100:]

    def indexing_items(self, folder_id: Optional[str] = None) -> list[IndexingItem]:
        items: list[IndexingItem] = []
        if self._active_folder and self._active_path:
            if folder_id is None or self._active_folder.id == folder_id:
                # Get file ID for reliable matching
                active_file_id = self._fingerprint(self._active_path) if self._active_path.exists() else None
                items.append(
                    IndexingItem(
                        folder_id=self._active_folder.id,
                        folder_path=self._active_folder.path,
                        file_path=self._active_path,
                        file_id=active_file_id,
                        file_name=self._active_path.name,
                        status="processing",
                        started_at=self._active_started_at,
                        progress=self._active_progress,
                        kind=self._active_kind,
                        stage=self._active_stage,
                        detail=self._active_detail,
                        step_current=self._active_step_current,
                        step_total=self._active_step_total,
                        recent_events=list(self._active_recent_events)[-25:],
                    )
                )

        for fid, pending in self._pending_paths.items():
            if folder_id and fid != folder_id:
                continue
            if self._active_folder and self._active_folder.id == fid:
                folder = self._active_folder
            else:
                folder = self.storage.get_folder(fid)
            if not folder:
                continue
            for path in list(pending):
                pending_file_id = self._fingerprint(path) if path.exists() else None
                items.append(
                    IndexingItem(
                        folder_id=fid,
                        folder_path=folder.path,
                        file_path=path,
                        file_id=pending_file_id,
                        file_name=path.name,
                        status="pending",
                        kind=infer_kind(path),
                        stage="pending",
                    )
                )

        return items

    def _paths_to_refresh(
        self,
        folder: FolderRecord,
        paths: Sequence[Path],
            *,
            refresh_embeddings: bool,
    ) -> list[Path]:
        if refresh_embeddings:
            return list(paths)

        failed_paths = {f.path for f in folder.failed_files}
        changed: list[Path] = []
        for path in paths:
            if path in failed_paths:
                changed.append(path)
                continue

            file_id = self._fingerprint(path)
            existing = self.storage.get_file(file_id)
            if not existing:
                changed.append(path)
                continue

            try:
                stat = path.stat()
            except OSError:
                changed.append(path)
                continue

            modified = dt.datetime.fromtimestamp(stat.st_mtime, tz=dt.timezone.utc)
            existing_modified = existing.modified_at
            if existing_modified.tzinfo is None:
                existing_modified = existing_modified.replace(tzinfo=dt.timezone.utc)

            if abs((modified - existing_modified).total_seconds()) >= 1:
                changed.append(path)
                continue

            if existing.size != stat.st_size:
                changed.append(path)
                continue

            if not existing.checksum_sha256:
                changed.append(path)

        return changed

    async def _process_single_file(
        self,
        folder: FolderRecord,
        path: Path,
        refresh_embeddings: bool,
        indexing_mode: Literal["fast", "fine"]
    ) -> bool:
        self._active_path = path
        self._active_started_at = dt.datetime.now(dt.timezone.utc)
        self._active_progress = 0.0
        self._active_kind = infer_kind(path)
        self._active_stage = "scan"
        self._active_detail = "Scanning file"
        self._active_step_current = None
        self._active_step_total = None
        self._active_recent_events = []

        self._set_active_stage(stage="scan", detail="Scanning file", progress=0.0, event=f"Scanning {path.name}")
        self._set_running_progress(message=f"Indexing {path.name}")

        # Get file ID for status updates
        file_id = self._fingerprint(path)

        try:
            # Scan
            record, artifact = await asyncio.to_thread(self._scan_file, folder, path, indexing_mode)

            # Enrich
            self._set_active_stage(stage="enrich", detail="Extracting text / vision", progress=self._active_progress, event="Extracting content")
            enriched = await self._enrich_artifact(record, artifact, refresh_embeddings, indexing_mode)

            # Store
            self._set_active_stage(stage="store", detail="Chunking + embedding + saving", progress=self._active_progress, event="Storing chunks")
            await self._store_artifact(enriched, refresh_embeddings=refresh_embeddings)

            # Mark file as successfully indexed
            self.storage.mark_file_indexed(file_id)

            return True

        except Exception as exc:
            logger.warning("Failed to process %s: %s", path, exc)
            error_reason = str(exc)

            # Mark file as error in the files table
            self.storage.mark_file_error(file_id, error_reason)

            # Also keep in folder.failed_files for backwards compatibility
            failed_file = FailedFile(path=path, reason=error_reason, timestamp=dt.datetime.now(dt.timezone.utc))
            folder.failed_files.append(failed_file)
            self.storage.upsert_folder(folder)

            self.progress.failed += 1
            self.progress.failed_items.append(failed_file)
            self._set_running_progress()
            return False

        finally:
            self._active_path = None
            self._active_started_at = None
            self._active_progress = None
            self._active_kind = None
            self._active_stage = None
            self._active_detail = None
            self._active_step_current = None
            self._active_step_total = None
            self._active_recent_events = []

    async def _process_folder(
            self,
            folder: FolderRecord,
            *,
            refresh_embeddings: bool,
            paths: Optional[list[Path]] = None,
            process_paths: Optional[list[Path]] = None,
            indexing_mode: Literal["fast", "fine"] = "fast",
    ) -> int:
        folder_paths = list(paths) if paths is not None else list(self._iter_files(folder.path))
        process_list = list(process_paths) if process_paths is not None else list(folder_paths)
        if process_list:
            # Deduplicate while preserving order to avoid redundant work.
            process_list = list(dict.fromkeys(process_list))
            self._pending_paths[folder.id] = deque(process_list)
        else:
            self._pending_paths.pop(folder.id, None)
        self._active_folder = folder
        seen_paths: list[Path] = list(folder_paths)
        processed_count = 0

        # Clear failed status for files we are about to process
        if folder.failed_files:
            process_set = set(process_list)
            folder.failed_files = [f for f in folder.failed_files if f.path not in process_set]
            self.storage.upsert_folder(folder)

        for path in process_list:
            if folder.id in self._cancelled_folders:
                logger.info("Stopping processing for cancelled folder %s", folder.id)
                break

            await self._pause_event.wait()
            pending_queue = self._pending_paths.get(folder.id)
            if pending_queue and pending_queue and pending_queue[0] == path:
                pending_queue.popleft()
            self._active_folder = folder

            success = await self._process_single_file(folder, path, refresh_embeddings, indexing_mode)
            if success:
                processed_count += 1
                self._current_processed += 1
                self._set_running_progress()

        if not self._pending_paths.get(folder.id):
            self._pending_paths.pop(folder.id, None)
        self._active_folder = None

        removed_records = self.storage.remove_files_not_in(folder.id, seen_paths)
        for removed in removed_records:
            chunk_ids = removed.metadata.get("vector_chunks", []) if removed.metadata else []
            if chunk_ids:
                self.vector_store.delete(chunk_ids)
        return processed_count

    def _purge_folder(self, folder: FolderRecord) -> None:
        records = self.storage.folder_files(folder.id)
        if not records:
            return

        chunk_ids: set[str] = set()
        for record in records:
            metadata = record.metadata if isinstance(record.metadata, dict) else {}
            raw_chunks = metadata.get("vector_chunks", []) if isinstance(metadata, dict) else []

            if not raw_chunks:
                chunks = self.storage.chunks_for_file(record.id)
                raw_chunks = [c.chunk_id for c in chunks]

            if isinstance(raw_chunks, list):
                for chunk_id in raw_chunks:
                    if isinstance(chunk_id, str):
                        chunk_ids.add(chunk_id)

        if chunk_ids:
            try:
                self.vector_store.delete(list(chunk_ids))
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to delete vectors for folder %s: %s", folder.id, exc)

        for record in records:
            self.storage.delete_file(record.id)

    def _iter_files(self, base: Path, *, max_files: Optional[int] = None) -> Iterable[Path]:
        """
        Iterate over files in the folder.
        
        Args:
            base: The folder path to scan
            max_files: Optional limit on number of files to yield (for quick checks)
        """
        root = base.expanduser().resolve()
        if not root.exists():
            return []
        base_depth = len(root.parts)
        file_count = 0
        for current_root, dirs, files in os.walk(root, followlinks=settings.follow_symlinks):
            depth = len(Path(current_root).parts) - base_depth
            if depth >= settings.max_depth:
                dirs[:] = []
            for filename in files:
                # Skip hidden files and common OS artefacts (.DS_Store, etc.)
                if filename.startswith("."):
                    continue
                path = Path(current_root) / filename
                if not path.is_file():
                    continue
                yield path
                file_count += 1
                if max_files is not None and file_count >= max_files:
                    return

    def _scan_file(self, folder: FolderRecord, path: Path, indexing_mode: Literal["fast", "fine"] = "fast") -> tuple[FileRecord, IngestArtifact]:
        stat = path.stat()
        extension = path.suffix.lower().lstrip(".")
        file_hash = self._fingerprint(path)
        checksum = self._checksum(path)
        mime_type, _ = mimetypes.guess_type(str(path))

        # Skip video parsing in fast mode
        kind = infer_kind(path)
        if indexing_mode == "fast" and kind == "video":
            # Create a minimal record without parsing content
            record = FileRecord(
                id=file_hash,
                folder_id=folder.id,
                path=path,
                name=path.name,
                extension=extension,
                size=stat.st_size,
                modified_at=dt.datetime.fromtimestamp(stat.st_mtime, tz=dt.timezone.utc),
                created_at=dt.datetime.fromtimestamp(stat.st_ctime, tz=dt.timezone.utc),
                kind=kind,
                hash=file_hash,
                mime_type=mime_type,
                checksum_sha256=checksum,
                duration_seconds=0.0,
                page_count=0,
                summary=None,
                preview_image=None,
                metadata={"skipped_fast_mode": True},
            )
            artifact = IngestArtifact(record=record, text="", chunks=[], page_mapping=[])
            artifact.record.metadata["file_name"] = record.name
            artifact.record.metadata["name"] = record.name
            artifact.record.metadata["path"] = str(record.path)
            artifact.record.metadata["full_path"] = str(record.path)
            artifact.record.metadata["file_path"] = str(record.path)
            artifact.record.metadata["folder_id"] = record.folder_id
            artifact.record.metadata["extension"] = record.extension
            artifact.record.metadata["size"] = record.size
            artifact.record.metadata["kind"] = record.kind
            return record, artifact

        parsed = self.content_router.parse(path, indexing_mode=indexing_mode)

        record = FileRecord(
            id=file_hash,
            folder_id=folder.id,
            path=path,
            name=path.name,
            extension=extension,
            size=stat.st_size,
            modified_at=dt.datetime.fromtimestamp(stat.st_mtime, tz=dt.timezone.utc),
            created_at=dt.datetime.fromtimestamp(stat.st_ctime, tz=dt.timezone.utc),
            kind=kind,
            hash=file_hash,
            mime_type=mime_type,
            checksum_sha256=checksum,
            duration_seconds=parsed.duration_seconds,
            page_count=parsed.page_count,
            summary=None,
            preview_image=parsed.preview_image,
            metadata=parsed.metadata,
        )

        artifact = IngestArtifact(record=record, text=parsed.text, chunks=[], page_mapping=parsed.page_mapping)
        artifact.record.metadata.setdefault("attachments_present", bool(parsed.attachments))
        artifact.record.metadata.update({k: v for k, v in parsed.metadata.items() if isinstance(k, str)})
        artifact.record.metadata["attachments"] = list(parsed.attachments.keys()) if parsed.attachments else []
        artifact.record.metadata["__attachments_raw"] = parsed.attachments  # kept in-memory only
        # Add essential file info to metadata for search results
        artifact.record.metadata["file_name"] = record.name
        artifact.record.metadata["name"] = record.name
        artifact.record.metadata["path"] = str(record.path)
        artifact.record.metadata["full_path"] = str(record.path)
        artifact.record.metadata["file_path"] = str(record.path)
        artifact.record.metadata["folder_id"] = record.folder_id
        artifact.record.metadata["extension"] = record.extension
        artifact.record.metadata["size"] = record.size
        artifact.record.metadata["kind"] = record.kind
        return record, artifact

    async def _process_audio_attachments(self, record: FileRecord, attachments: dict) -> Optional[str]:
        if record.kind == "audio" and self.transcription_client and attachments.get("audio_wav"):
            try:
                transcript = await self.transcription_client.transcribe(attachments["audio_wav"])
                record.metadata["transcription_preview"] = transcript[:512]
                return transcript
            except Exception:  # noqa: BLE001
                pass
        return None

    async def _process_image_preview(self, record: FileRecord, indexing_mode: Literal["fast", "fine"]) -> Optional[str]:
        if record.kind == "image" and record.preview_image:
            try:
                text = await self.vision_processor.process_image(
                    record.preview_image,
                    mode=indexing_mode,
                    prompt=IMAGE_PROMPT
                )
                return text
            except Exception as e:
                logger.warning("Vision processing failed for image %s: %s", record.path, e)
                if indexing_mode == "fast" or "Tesseract" in str(e):
                    raise
        return None

    async def _process_pdf_vision(
        self,
        record: FileRecord,
        attachments: dict,
        indexing_mode: Literal["fast", "fine"]
    ) -> Optional[str]:
        # PDF Vision Mode: Process each page with VLM or Tesseract
        if not (record.kind == "document" and record.extension == "pdf" and (settings.pdf_mode == "vision" or indexing_mode == "fine")):
            return None

        logger.info("PDF debug kind=%s ext=%s pdf_mode=%s indexing_mode=%s has_page_texts=%s nonempty_pages=%s",
                    record.kind, record.extension, settings.pdf_mode, indexing_mode,
                    isinstance(record.metadata.get("page_texts"), list),
                    sum(1 for t in (record.metadata.get("page_texts") or []) if (t or "").strip()))

        if not attachments:
            return None

        # Get all page images from attachments
        page_images = {k: v for k, v in attachments.items() if k.startswith("page_")}
        if not page_images:
            return None

        try:
            # Sort pages
            sorted_pages = sorted(page_images.items(), key=lambda x: int(x[0].split("_")[1]))
            total_pages = len(sorted_pages)

            # Use different stage names to distinguish fast (OCR) vs fine (VLM)
            stage_name = "pdf_text" if indexing_mode == "fast" else "pdf_vision"

            page_results = []
            for i, (page_key, image_bytes) in enumerate(sorted_pages):
                # Per-page progress for UI
                self._set_active_stage(
                    stage=stage_name,
                    detail=f"Processing page {i + 1}/{total_pages}",
                    step_current=i + 1,
                    step_total=total_pages,
                    progress=((i) / max(total_pages, 1)) * 100,
                )
                page_num = int(page_key.split("_")[1])

                # Add delay for vision processing to prevent GPU saturation
                if settings.vision_batch_delay_ms > 0 and i > 0:
                    await asyncio.sleep(settings.vision_batch_delay_ms / 1000)

                prompt = PDF_PAGE_PROMPT if indexing_mode == "fine" else ""

                result = await self.vision_processor.process_image(
                    image_bytes,
                    mode=indexing_mode,
                    prompt=prompt
                )

                cleaned = (result or "").strip()
                # Remove markdown code blocks if present (e.g. ```markdown ... ```)
                if cleaned.startswith("```"):
                    cleaned = re.sub(r"^```\w*\s+|\s+```$", "", cleaned, flags=re.MULTILINE).strip()

                page_texts = record.metadata.get("page_texts") or []
                raw_text = ""
                if isinstance(page_texts, list) and 0 <= page_num - 1 < len(page_texts):
                    raw_text = (page_texts[page_num - 1] or "").strip()

                if not cleaned and raw_text:
                    cleaned = raw_text

                if cleaned:
                    page_results.append(cleaned)
                    self._set_active_stage(
                        stage=stage_name,
                        detail=f"Processed page {i + 1}/{total_pages}",
                        step_current=i + 1,
                        step_total=total_pages,
                        progress=((i + 1) / max(total_pages, 1)) * 100,
                        event=f"Page {i + 1}: {cleaned[:180]}",
                        event_payload={"page": i + 1},
                    )
                else:
                    page_results.append(f"[Page {page_num} - no content extracted]")
                    self._report_vision_warning(i + 1, total_pages, stage_name)

            if page_results:
                # Keep per-page descriptions in both fast and fine so page-aware chunks can be built
                record.metadata["pdf_page_descriptions"] = page_results
                record.metadata["pdf_vision_mode"] = indexing_mode

                # Combine all page descriptions as text payload (no page markers in content)
                return "\n\n".join(page_results)

        except Exception as exc:
            logger.warning("Failed to process PDF pages: %s", exc)
            # Re-raise critical errors (like missing Tesseract) to ensure file is marked as failed
            if indexing_mode == "fast" or "Tesseract" in str(exc):
                raise
        return None

    def _report_vision_warning(self, page_num: int, total_pages: int, stage_name: str = "pdf_vision") -> None:
        vision_error = getattr(self.vision_processor, "last_error", None)
        if isinstance(vision_error, str) and vision_error.strip():
            vision_error = vision_error.strip()
            event_text = f"Page {page_num}: no content extracted (vision error: {vision_error[:160]})"
            payload = {"page": page_num, "error": vision_error[:2000]}
        else:
            event_text = f"Page {page_num}: no content extracted"
            payload = {"page": page_num}

        self._set_active_stage(
            stage=stage_name,
            detail=f"Processed page {page_num}/{total_pages}",
            step_current=page_num,
            step_total=total_pages,
            progress=((page_num) / max(total_pages, 1)) * 100,
            event=event_text,
            event_type="warn",
            event_payload=payload,
        )

    async def _process_video_segments(
        self,
        record: FileRecord,
        attachments: dict,
        indexing_mode: Literal["fast", "fine"]
    ) -> Optional[str]:
        # Check prerequisites
        if record.kind != "video":
            return None

        if not settings.endpoints.vision:
            logger.info("Skipping video vision processing: vision endpoint not configured")
            return None

        if not attachments.get("video_segments"):
            logger.warning("No video_segments found in attachments for %s", record.path)
            return None

        if indexing_mode == "fast":
            logger.info("Skipping video vision processing in fast mode for %s", record.path)
            return None

        # Process each 30-second segment independently
        video_segments = attachments["video_segments"]
        segment_captions = []
        total_segments = len(video_segments)

        logger.info("Processing %d video segments for %s", total_segments, record.path)

        for i, segment in enumerate(video_segments):
            try:
                self._set_active_stage(
                    stage="video_vision",
                    detail=f"Processing segment {i + 1}/{total_segments}",
                    step_current=i + 1,
                    step_total=total_segments,
                    progress=((i) / max(total_segments, 1)) * 100,
                )

                caption = await self.llm_client.describe_video_segment(
                    frames=segment["frames"],
                    start_time=segment["start_time"],
                    end_time=segment["end_time"],
                    prompt=VIDEO_SEGMENT_PROMPT
                )
                if caption:
                    segment_captions.append(caption)
                    self._set_active_stage(
                        stage="video_vision",
                        detail=f"Processed segment {i + 1}/{total_segments}",
                        step_current=i + 1,
                        step_total=total_segments,
                        progress=((i + 1) / max(total_segments, 1)) * 100,
                        event=f"Segment {i + 1}: {caption[:100]}...",
                    )
                else:
                    logger.warning("Empty caption for video segment %d of %s", i + 1, record.path)
            except Exception as exc:
                logger.warning("Failed to process video segment %d of %s: %s", i + 1, record.path, exc)
                # Continue with other segments instead of failing completely

        # Combine all segment captions with newlines
        if segment_captions:
            logger.info("Successfully processed %d/%d video segments for %s",
                        len(segment_captions), total_segments, record.path)
            # Store segment captions for chunk creation
            record.metadata["video_segment_captions"] = segment_captions
            return "\n".join(segment_captions)

        logger.warning("No video segment captions generated for %s", record.path)
        return None

    async def _enrich_artifact(
            self,
            record: FileRecord,
            artifact: IngestArtifact,
            refresh_embeddings: bool,
            indexing_mode: Literal["fast", "fine"] = "fast",
    ) -> IngestArtifact:
        attachments = artifact.record.metadata.pop("__attachments_raw", {}) or {}
        text_payload = artifact.text

        # 1. Audio Transcription
        audio_text = await self._process_audio_attachments(record, attachments)
        if audio_text:
            text_payload = audio_text

        # 2. Image Vision Analysis
        image_text = await self._process_image_preview(record, indexing_mode)
        if image_text:
            text_payload = image_text

        # 3. PDF Vision Analysis
        pdf_text = await self._process_pdf_vision(record, attachments, indexing_mode)
        if pdf_text:
            text_payload = pdf_text

        # 4. Video Segment Analysis
        video_text = await self._process_video_segments(record, attachments, indexing_mode)
        if video_text:
            text_payload = video_text

        # 5. Summarization
        summary = None
        if text_payload:
            # For videos, create a summary from all segments
            if record.kind == "video" and record.metadata.get("video_segment_captions"):
                # Use first few segments as summary preview
                captions = record.metadata["video_segment_captions"]
                summary = "\n".join(captions[:3])  # First 3 segments (90 seconds)
                if len(captions) > 3:
                    summary += f"\n... and {len(captions) - 3} more segments"
            else:
                summary = await self._summarize_text_for_retrieval(
                    record,
                    text_payload,
                    indexing_mode=indexing_mode,
                )
        elif record.metadata:
            summary = f"Metadata-only description for {record.name}."
        else:
            summary = f"File {record.name} located at {record.path.parent}."

        record.summary = summary.strip() if summary else None
        artifact.text = text_payload or record.summary or ""

        # 6. Chunking (moved before question generation so we can use chunks)
        self._build_artifact_chunks(record, artifact, indexing_mode)

        # 7. Suggested Questions - generate from random chunks
        await self._generate_suggested_questions_from_chunks(record, artifact.chunks)

        return artifact

    async def _generate_suggested_questions_from_chunks(
        self, record: FileRecord, chunks: Optional[list[ChunkSnapshot]] = None
    ) -> None:
        """Generate suggested questions by randomly sampling up to 4 chunks, 1 question per chunk."""
        # Only generate for document-like files
        if record.kind not in ("document", "presentation", "spreadsheet"):
            return
        
        # Need chunks to generate questions
        if not chunks or len(chunks) == 0:
            return
        
        try:
            # Filter out very short chunks (less than 100 chars)
            meaningful_chunks = [c for c in chunks if len(c.text.strip()) >= 100]
            
            if not meaningful_chunks:
                # Fallback to any chunks if none are "meaningful"
                meaningful_chunks = chunks
            
            # Select up to 4 random chunks (1 question per chunk)
            num_to_select = min(4, len(meaningful_chunks))
            selected_chunks = random.sample(meaningful_chunks, num_to_select)
            
            all_questions: list[str] = []
            
            for chunk in selected_chunks:
                # Truncate chunk text to avoid excessive tokens
                chunk_text = chunk.text.strip()[:1500]
                
                question_text = await self.llm_client.complete(
                    system=CHUNK_QUESTIONS_PROMPT,
                    prompt=chunk_text,
                    max_tokens=50,
                )
                
                # Clean up the question
                q = question_text.strip()
                q = q.strip().lstrip("- ").strip()
                q = re.sub(r'^[\d]+[.\)]\s*', '', q).strip()
                # Take only the first question if multiple were generated
                if "\n" in q:
                    q = q.split("\n")[0].strip()
                # Take only content up to first question mark
                if "?" in q:
                    q = q[:q.index("?") + 1]
                
                # Only keep valid questions (10-120 chars)
                if q and "?" in q and 10 < len(q) < 120:
                    all_questions.append(q)
            
            # Store up to 4 unique questions for this file
            unique_questions = list(dict.fromkeys(all_questions))[:4]
            
            if unique_questions:
                record.metadata["suggested_questions"] = unique_questions
                
        except Exception as e:
            logger.warning("Failed to generate suggested questions for %s: %s", record.path, e)

    def _build_artifact_chunks(
        self,
        record: FileRecord,
        artifact: IngestArtifact,
        indexing_mode: Literal["fast", "fine"]
    ) -> None:
        # For videos, create one chunk per segment caption
        if record.kind == "video" and record.metadata.get("video_segment_captions"):
            artifact.chunks = self._build_video_chunk_snapshots(record, record.metadata["video_segment_captions"])
            record.metadata["chunk_strategy"] = "video_segments_v1"
        # For PDF vision mode, chunk either per-page (fast) or multi-chunk (accurate)
        elif record.kind == "document" and record.extension == "pdf" and record.metadata.get("pdf_page_descriptions"):
            page_descriptions = record.metadata["pdf_page_descriptions"]
            # Use global setting for chunking strategy (per-page vs multi-chunk)
            # Even in fine mode, we might want to split long summaries if configured.
            if settings.pdf_one_chunk_per_page:
                artifact.chunks = self._build_pdf_page_chunk_snapshots(record, page_descriptions, is_vision=True)
                record.metadata["chunk_strategy"] = f"pdf_vision_pages_v2_{indexing_mode}"
            else:
                artifact.chunks = self._build_pdf_multi_chunk_snapshots_from_pages(
                    record,
                    page_descriptions,
                    indexing_mode=indexing_mode,
                )
                record.metadata["chunk_strategy"] = f"pdf_vision_multi_v1_{indexing_mode}"

            logger.info(
                "PDF chunking (vision mode): file=%s pages=%d page_mapping=%d chunks=%d strategy=%s",
                record.path,
                len(page_descriptions or []),
                len(artifact.page_mapping or []),
                len(artifact.chunks),
                record.metadata.get("chunk_strategy"),
            )
        # For PDF text mode (fast), either chunk per-page or multi-chunk if available
        elif record.kind == "document" and record.extension == "pdf":
            page_texts = record.metadata.get("page_texts") or []

            # If page_texts are missing but we still have text and page_mapping, rebuild per-page texts.
            if (not page_texts) and artifact.page_mapping and artifact.text:
                try:
                    sorted_mapping = sorted(artifact.page_mapping, key=lambda x: x[2])
                    if sorted_mapping:
                        max_page = sorted_mapping[-1][2]
                        mapping_dict = {m[2]: (m[0], m[1]) for m in sorted_mapping}
                        reconstructed: list[str] = []
                        for page_num in range(1, max_page + 1):
                            if page_num in mapping_dict:
                                start, end = mapping_dict[page_num]
                                start = min(start, len(artifact.text))
                                end = min(end, len(artifact.text))
                                reconstructed.append(artifact.text[start:end])
                            else:
                                reconstructed.append("")
                        if any((t or "").strip() for t in reconstructed):
                            page_texts = reconstructed
                            record.metadata["page_texts"] = page_texts
                except Exception as exc:  # noqa: BLE001
                    logger.warning("Failed to reconstruct page_texts from mapping: %s", exc)

            if isinstance(page_texts, list) and any((t or "").strip() for t in page_texts):
                if settings.pdf_one_chunk_per_page:
                    artifact.chunks = self._build_pdf_page_chunk_snapshots(record, page_texts, is_vision=False)
                    record.metadata["chunk_strategy"] = "pdf_text_pages_v2"
                else:
                    if artifact.page_mapping and artifact.text.strip():
                        artifact.chunks = self._build_chunk_snapshots(
                            record,
                            artifact.text,
                            page_mapping=artifact.page_mapping,
                            indexing_mode=indexing_mode,
                        )
                    else:
                        artifact.chunks = self._build_pdf_multi_chunk_snapshots_from_pages(
                            record,
                            page_texts,
                            indexing_mode=indexing_mode,
                        )
                    record.metadata["chunk_strategy"] = f"pdf_text_multi_v1_{indexing_mode}"

                logger.info(
                    "PDF chunking (text mode): file=%s pages=%d page_mapping=%d chunks=%d strategy=%s",
                    record.path,
                    len(page_texts),
                    len(artifact.page_mapping or []),
                    len(artifact.chunks),
                    record.metadata.get("chunk_strategy"),
                )
            else:
                # Fallback for empty/scanned PDFs without vision mode
                # Try standard chunker if we have text but no page_texts (e.g. from other parsers)
                if artifact.text.strip():
                    artifact.chunks = self._build_chunk_snapshots(
                        record,
                        artifact.text,
                        page_mapping=artifact.page_mapping,
                        indexing_mode=indexing_mode
                    )
                    record.metadata["chunk_strategy"] = f"chunker_v1_{indexing_mode}"
                    logger.info(
                        "PDF chunking (fallback chunker): file=%s pages=0 page_mapping=%d chunks=%d strategy=%s",
                        record.path,
                        len(artifact.page_mapping or []),
                        len(artifact.chunks),
                        record.metadata.get("chunk_strategy"),
                    )
                else:
                    artifact.chunks = []
                    record.metadata["chunk_strategy"] = "pdf_empty_text"
                    logger.info(
                        "PDF chunking (empty text): file=%s pages=0 page_mapping=%d chunks=%d strategy=%s",
                        record.path,
                        len(artifact.page_mapping or []),
                        len(artifact.chunks),
                        record.metadata.get("chunk_strategy"),
                    )
        else:
            artifact.chunks = self._build_chunk_snapshots(
                record,
                artifact.text,
                page_mapping=artifact.page_mapping,
                indexing_mode=indexing_mode
            )
            record.metadata["chunk_strategy"] = f"chunker_v1_{indexing_mode}"
            if record.extension == "pdf":
                logger.info(
                    "PDF chunking (generic chunker branch): file=%s page_mapping=%d chunks=%d strategy=%s",
                    record.path,
                    len(artifact.page_mapping or []),
                    len(artifact.chunks),
                    record.metadata.get("chunk_strategy"),
                )

    def _format_file_metadata_for_llm(self, record: FileRecord, *, indexing_mode: Literal["fast", "fine"]) -> str:
        modified = record.modified_at.isoformat() if record.modified_at else "unknown"
        created = record.created_at.isoformat() if record.created_at else "unknown"
        size = str(record.size) if record.size is not None else "unknown"
        mode_label = "fast (OCR/text-only)" if indexing_mode == "fast" else "fine (vision -> text)"
        return "\n".join(
            [
                f"Indexing mode: {mode_label}",
                f"File name: {record.name}",
                f"Path: {record.path}",
                f"Kind: {record.kind}",
                f"Extension: {record.extension}",
                f"Size bytes: {size}",
                f"Modified at: {modified}",
                f"Created at: {created}",
            ]
        )

    async def _summarize_text_for_retrieval(
        self,
        record: FileRecord,
        text_payload: str,
        *,
        indexing_mode: Literal["fast", "fine"],
    ) -> str:
        if not text_payload.strip():
            return ""

        # In fast mode, skip LLM summarisation to save tokens/time.
        # Just use the beginning of the text as the summary.
        if indexing_mode == "fast":
            return text_payload.strip()[:2000]

        metadata_block = self._format_file_metadata_for_llm(record, indexing_mode=indexing_mode)

        # Truncate text payload to avoid context window issues
        # This leaves room for metadata and system prompt
        limit = settings.summary_input_max_chars
        logger.info("Summarizing %s with limit=%d chars (payload=%d chars)", record.path, limit, len(text_payload))
        truncated_content = text_payload.strip()[:limit]
        if len(text_payload) > limit:
            truncated_content += "\n...[content truncated]..."

        prompt = f"{metadata_block}\n\nContent:\n{truncated_content}"

        try:
            # Use chat completion for better instruction following with modern models
            messages = [
                {"role": "system", "content": DEFAULT_SUMMARY_PROMPT},
                {"role": "user", "content": prompt},
            ]
            summary = await self.llm_client.chat_complete(
                messages,
                max_tokens=max(int(getattr(settings, "summary_max_tokens", 256)), 32),
                temperature=0.2,
            )
            cleaned = (summary or "").strip()
            if cleaned:
                return cleaned
        except Exception as exc:  # noqa: BLE001
            logger.warning("LLM summarisation failed for %s: %s", record.path, exc)

        # Fail open: keep indexing usable even if the LLM endpoint is down.
        fallback = text_payload.strip()
        return fallback[:2000]

    async def _store_artifact(self, artifact: IngestArtifact, *, refresh_embeddings: bool) -> None:
        existing = self.storage.get_file(artifact.record.id)
        previous_chunk_ids = (
            existing.metadata.get("vector_chunks")
            if existing and isinstance(existing.metadata, dict)
            else []
        )

        reuse_vectors = (
            existing is not None
            and existing.checksum_sha256 == artifact.record.checksum_sha256
            and existing.embedding_vector is not None
            and bool(previous_chunk_ids)
            and settings.reuse_embeddings
            and not refresh_embeddings
            and isinstance(existing.metadata, dict)
            and existing.metadata.get("chunk_strategy") == artifact.record.metadata.get("chunk_strategy")
        )

        if reuse_vectors:
            artifact.record.metadata.setdefault("vector_chunks", previous_chunk_ids)
            artifact.record.embedding_vector = existing.embedding_vector
            artifact.record.embedding_determined_at = existing.embedding_determined_at
            artifact.record.summary = existing.summary
            artifact.record.preview_image = artifact.record.preview_image or existing.preview_image
            artifact.record.index_status = "indexed"
            artifact.record.error_reason = None
            artifact.record.error_at = None
            self.storage.upsert_file(artifact.record)
            return

        chunk_snapshots = artifact.chunks or []
        try:
            vectors = await self._embed_chunks(chunk_snapshots)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Embedding failed for %s: %s", artifact.record.path, exc)
            vectors = []
        now = dt.datetime.now(dt.timezone.utc)

        documents: list[VectorDocument] = []
        for chunk, vector in zip(chunk_snapshots, vectors):
            doc_metadata = {
                "chunk_id": chunk.chunk_id,
                "file_id": artifact.record.id,
                "file_name": artifact.record.name,
                "name": artifact.record.name,
                "path": str(artifact.record.path),
                "full_path": str(artifact.record.path),
                "folder_id": artifact.record.folder_id,
                "extension": artifact.record.extension,
                "size": artifact.record.size,
                "modified_at": artifact.record.modified_at.isoformat() if artifact.record.modified_at else None,
                "created_at": artifact.record.created_at.isoformat() if artifact.record.created_at else None,
                "summary": artifact.record.summary,
                "snippet": chunk.snippet,
                "kind": artifact.record.kind,
                "section_path": chunk.section_path,
                "token_count": chunk.token_count,
                "char_count": chunk.char_count,
                "chunk_metadata": chunk.metadata,
            }
            # Also add page information to top-level metadata for easier access
            if chunk.metadata:
                page_info_keys = ["page_number", "page_numbers", "page_start", "page_end", "pdf_vision_mode"]
                for key in page_info_keys:
                    if key in chunk.metadata and key not in doc_metadata:
                        doc_metadata[key] = chunk.metadata[key]

                # Add alias for UI compatibility
                if "page_number" in chunk.metadata:
                    doc_metadata["page"] = chunk.metadata["page_number"]
            documents.append(
                VectorDocument(
                    doc_id=chunk.chunk_id,
                    vector=vector,
                    metadata=doc_metadata,
                )
            )

        if previous_chunk_ids:
            try:
                self.vector_store.delete(previous_chunk_ids)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to delete previous vectors for %s: %s", artifact.record.id, exc)
        if documents:
            try:
                self.vector_store.upsert(documents)
                self.vector_store.flush()
            except Exception as exc:  # noqa: BLE001
                logger.warning("Vector store upsert failed for %s: %s", artifact.record.id, exc)
                documents = []

        artifact.record.metadata["vector_chunks"] = [doc.doc_id for doc in documents]
        if vectors:
            artifact.record.embedding_vector = vectors[0]
            artifact.record.embedding_determined_at = now

        # Mark as indexed
        artifact.record.index_status = "indexed"
        artifact.record.error_reason = None
        artifact.record.error_at = None

        self.storage.upsert_file(artifact.record)
        self.storage.replace_chunks(artifact.record.id, chunk_snapshots)

    async def _embed_chunks(self, chunks: Sequence[ChunkSnapshot]) -> list[list[float]]:
        chunk_payloads = [(chunk, chunk.text.strip()) for chunk in chunks]
        chunk_payloads = [(chunk, text) for chunk, text in chunk_payloads if text]
        if not chunk_payloads:
            return []

        batch_size = max(settings.embed_batch_size, 1)
        delay_seconds = settings.embed_batch_delay_ms / 1000 if settings.embed_batch_delay_ms else 0.0
        vectors: list[list[float]] = []

        max_chars = settings.embed_max_chars

        total_batches = (len(chunk_payloads) + batch_size - 1) // batch_size
        for batch_index, start in enumerate(range(0, len(chunk_payloads), batch_size), start=1):
            batch = chunk_payloads[start:start + batch_size]
            texts = [text[:max_chars] for _, text in batch]

            # Calculate progress (0-100% within the embedding phase)
            # We start at (batch_index - 1) / total
            current_progress = ((batch_index - 1) / max(total_batches, 1)) * 100

            self._set_active_stage(
                stage="embed",
                detail=f"Embedding batch {batch_index}/{max(total_batches, 1)}",
                step_current=batch_index,
                step_total=total_batches,
                progress=current_progress,
            )
            response_vectors = await self.embedding_client.encode(texts)
            if len(response_vectors) != len(batch):
                raise RuntimeError(
                    f"Embedding service returned {len(response_vectors)} vectors for batch of {len(batch)} chunks"
                )
            vectors.extend(response_vectors)

            # Update progress after completion
            completed_progress = (batch_index / max(total_batches, 1)) * 100

            # Emit event for every batch so UI updates "Now Processing" and Stream
            self._set_active_stage(
                stage="embed",
                detail=f"Embedded {len(vectors)}/{len(chunk_payloads)} chunks",
                step_current=batch_index,
                step_total=total_batches,
                progress=completed_progress,
                event=f"Embedded {len(vectors)} chunks",
            )
            if delay_seconds > 0 and start + batch_size < len(chunk_payloads):
                await asyncio.sleep(delay_seconds)

        return vectors

    def _build_chunk_snapshots(
        self,
        record: FileRecord,
        text: str,
        page_mapping: list[tuple[int, int, int]] = None,
        indexing_mode: Literal["fast", "fine"] = "fast"
    ) -> list[ChunkSnapshot]:
        if not text:
            return []

        # Define chunk sizes based on mode
        # Fast mode: larger chunks for speed and broader context
        # Fine mode: smaller chunks for precision
        # User request: Both use global settings now.
        chunk_tokens = settings.rag_chunk_size
        overlap_tokens = settings.rag_chunk_overlap

        payloads = self.chunker.build(
            record.id,
            text,
            page_mapping=page_mapping,
            chunk_tokens=chunk_tokens,
            overlap_tokens=overlap_tokens
        )
        snapshots = [self._to_snapshot(record.id, payload) for payload in payloads]
        if snapshots:
            return snapshots

        now = dt.datetime.now(dt.timezone.utc)
        fallback_id = f"{record.id}::full"
        return [
            ChunkSnapshot(
                chunk_id=fallback_id,
                file_id=record.id,
                ordinal=0,
                text=text,
                snippet=text[:400],
                token_count=max(len(text) // self.chunker.char_ratio, 1),
                char_count=len(text),
                section_path=None,
                metadata={},
                created_at=now,
            )
        ]

    def _build_video_chunk_snapshots(self, record: FileRecord, segment_captions: list[str]) -> list[ChunkSnapshot]:
        """Build one chunk per video segment caption (each 30-second segment)."""
        if not segment_captions:
            return []

        now = dt.datetime.now(dt.timezone.utc)
        chunks = []

        for ordinal, caption in enumerate(segment_captions):
            chunk_id = f"{record.id}::segment_{ordinal}"
            snippet = caption[:400] if len(caption) > 400 else caption

            chunks.append(
                ChunkSnapshot(
                    chunk_id=chunk_id,
                    file_id=record.id,
                    ordinal=ordinal,
                    text=caption,
                    snippet=snippet,
                    token_count=max(len(caption) // self.chunker.char_ratio, 1),
                    char_count=len(caption),
                    section_path=f"segment_{ordinal}",
                    metadata={"segment_index": ordinal},
                    created_at=now,
                )
            )

        return chunks

    def _build_pdf_page_chunk_snapshots(self, record: FileRecord, page_descriptions: list[str], is_vision: bool = True) -> list[ChunkSnapshot]:
        """
        Build chunks from PDF page descriptions (vision mode) or page texts (text mode).

        Requirement: always generate exactly one chunk per page in PDF modes.
        """
        if not page_descriptions:
            return []

        now = dt.datetime.now(dt.timezone.utc)
        snapshots: list[ChunkSnapshot] = []

        for page_index, page_text in enumerate(page_descriptions, start=1):
            cleaned = (page_text or "").strip()
            if not cleaned:
                cleaned = f"[Page {page_index} - no content extracted]"

            ordinal = page_index - 1
            section_path = f"page_{page_index}"
            chunk_id = self._chunk_id_for_section(record.id, ordinal, section_path)
            snippet = cleaned[:400]

            metadata = {
                "page_numbers": [page_index],
                "page_start": page_index,
                "page_end": page_index,
                "page_number": page_index,  # For compatibility
                "pdf_vision_mode": is_vision,
                "section_path": section_path,
            }

            snapshots.append(
                ChunkSnapshot(
                    chunk_id=chunk_id,
                    file_id=record.id,
                    ordinal=ordinal,
                    text=cleaned,
                    snippet=snippet,
                    token_count=max(len(cleaned) // 4, 1),
                    char_count=len(cleaned),
                    section_path=section_path,
                    metadata=metadata,
                    created_at=now,
                )
            )

        return snapshots

    def _build_pdf_multi_chunk_snapshots_from_pages(
        self,
        record: FileRecord,
        page_texts: list[str],
        *,
        indexing_mode: Literal["fast", "fine"],
    ) -> list[ChunkSnapshot]:
        """Build multiple chunks across a PDF using the chunker, preserving page mapping.

        This intentionally allows multiple chunks per page (better retrieval precision) but
        keeps page-level navigation via page_mapping.
        """
        if not page_texts:
            return []

        # In 'fine' mode (Deep Scan), page_texts are VLM summaries.
        # These are discrete and should not be merged across page boundaries.
        # We chunk each page individually to prevent content bleeding between pages.
        if indexing_mode == "fine":
            all_snapshots = []
            global_ordinal = 0

            for page_index, page_text in enumerate(page_texts, start=1):
                full_page_text = (page_text or "").strip()
                if not full_page_text:
                    continue

                # Map this isolated text to the current page
                current_mapping = [(0, len(full_page_text), page_index)]

                page_snapshots = self._build_chunk_snapshots(
                    record,
                    full_page_text,
                    page_mapping=current_mapping,
                    indexing_mode=indexing_mode
                )

                for snapshot in page_snapshots:
                    # Update ordinal to be sequential across the whole document
                    snapshot.ordinal = global_ordinal
                    # Regenerate chunk_id to ensure uniqueness using the global ordinal
                    snapshot.chunk_id = self._chunk_id_for_section(record.id, global_ordinal, snapshot.section_path)

                    global_ordinal += 1
                    all_snapshots.append(snapshot)

            return all_snapshots

        combined_text = ""
        page_mapping: list[tuple[int, int, int]] = []

        for page_index, page_text in enumerate(page_texts, start=1):
            body = (page_text or "").strip()
            if not body:
                continue
            if combined_text:
                combined_text += "\n\n"
            start = len(combined_text)
            combined_text += body
            end = len(combined_text)
            page_mapping.append((start, end, page_index))

        return self._build_chunk_snapshots(
            record,
            combined_text,
            page_mapping=page_mapping,
            indexing_mode=indexing_mode,
        )

    @staticmethod
    def _split_markdown_sections_with_positions(text: str) -> list[tuple[Optional[str], str, str, int, int]]:
        """
        Split markdown text by headings (##, ###, ####, etc.).
        Returns list of (section_path, heading_line, section_body, start_pos, end_pos) tuples.
        """
        import re
        SECTION_PATTERN = re.compile(r"^(#+)\s+(.*)$", flags=re.MULTILINE)

        if not text:
            return [(None, "", text, 0, len(text))]

        matches = list(SECTION_PATTERN.finditer(text))
        if not matches:
            return [(None, "", text, 0, len(text))]

        sections: list[tuple[Optional[str], str, str, int, int]] = []
        for index, match in enumerate(matches):
            heading_start = match.start()
            heading_end = match.end()
            body_start = match.end()
            body_end = matches[index + 1].start() if index + 1 < len(matches) else len(text)

            heading_level = len(match.group(1))
            heading_text = match.group(2).strip()
            section_marker = f"{heading_level}:{heading_text}"

            # Extract the full heading line (including the # symbols)
            heading_line = text[heading_start:heading_end].strip()
            body = text[body_start:body_end].strip()

            sections.append((section_marker, heading_line, body, heading_start, body_end))

        return sections

    @staticmethod
    def _contains_table(text: str) -> bool:
        """
        Check if text contains a markdown table.
        Tables are identified by lines starting with | and containing |---| or |===| separators.
        More lenient: also accepts tables where separator might be in a separate line.
        """
        lines = [line.strip() for line in text.split('\n') if line.strip()]
        if len(lines) < 2:
            return False

        in_table = False
        has_separator = False
        table_row_count = 0

        for i, line in enumerate(lines):
            # Check for table row (starts with |)
            if line.startswith('|') and '|' in line[1:]:
                in_table = True
                table_row_count += 1
                # Check for separator row (contains --- or ===)
                if '---' in line or '===' in line or '|--' in line or '|==' in line:
                    has_separator = True
                # Also check if next line is a separator
                if i + 1 < len(lines):
                    next_line = lines[i + 1]
                    if ('---' in next_line or '===' in next_line) and '|' in next_line:
                        has_separator = True
            elif in_table:
                # If we were in a table and hit a non-table line, check if we had enough rows
                if table_row_count >= 2 and has_separator:
                    return True
                # Reset if we're clearly out of table context (blank line or heading)
                if not line.startswith('|') and (not line or line.startswith('#')):
                    in_table = False
                    has_separator = False
                    table_row_count = 0

        # Check if we ended while still in a table
        return in_table and table_row_count >= 2 and has_separator

    @staticmethod
    def _split_section_respecting_structure(text: str, max_size: int, min_size: int) -> list[str]:
        """
        Split a section into smaller chunks while respecting paragraph and list boundaries.
        """
        import re
        # Split by double newlines (paragraphs) first
        paragraphs = text.split('\n\n')
        chunks = []
        current_chunk = ""

        for para in paragraphs:
            para = para.strip()
            if not para:
                continue

            # If adding this paragraph would exceed max_size, save current chunk
            if current_chunk and len(current_chunk) + len(para) + 2 > max_size:
                if len(current_chunk) >= min_size:
                    chunks.append(current_chunk)
                    current_chunk = para
                else:
                    # Current chunk too small, try to add paragraph anyway
                    current_chunk += "\n\n" + para
            else:
                if current_chunk:
                    current_chunk += "\n\n" + para
                else:
                    current_chunk = para

            # If a single paragraph is too large, split it by sentences
            if len(current_chunk) > max_size:
                # Save what we have so far if it's large enough
                if len(current_chunk) - len(para) >= min_size:
                    saved = current_chunk[:current_chunk.rfind(para)]
                    if saved.strip():
                        chunks.append(saved.strip())
                    current_chunk = para

                # If paragraph itself is too large, split by sentences
                if len(current_chunk) > max_size:
                    sentences = re.split(r'([.!?]\s+)', current_chunk)
                    temp_chunk = ""
                    for i in range(0, len(sentences), 2):
                        sentence = sentences[i] + (sentences[i+1] if i+1 < len(sentences) else "")
                        if len(temp_chunk) + len(sentence) > max_size and temp_chunk:
                            if len(temp_chunk) >= min_size:
                                chunks.append(temp_chunk.strip())
                                temp_chunk = sentence
                            else:
                                temp_chunk += sentence
                        else:
                            temp_chunk += sentence
                    current_chunk = temp_chunk

        # Don't forget the last chunk
        if current_chunk and len(current_chunk.strip()) >= min_size:
            chunks.append(current_chunk.strip())
        elif current_chunk:
            # If last chunk is too small, append to previous or create anyway
            if chunks:
                chunks[-1] += "\n\n" + current_chunk
            else:
                chunks.append(current_chunk.strip())

        return chunks if chunks else [text]

    @staticmethod
    def _extract_page_numbers_from_position(
        combined_text: str,
        start_pos: int,
        end_pos: int,
        page_descriptions: list[str]
    ) -> list[int]:
        """
        Extract page numbers based on position in combined_text.
        Looks for <!-- Page X --> comments in the range [start_pos, end_pos].
        Returns sorted list of unique page numbers.
        """
        import re
        page_pattern = re.compile(r'<!--\s*Page\s+(\d+)\s*-->')

        # Extract the section text from combined_text
        section_text = combined_text[start_pos:end_pos]

        # Find all page comments in this section
        matches = page_pattern.findall(section_text)
        if matches:
            pages = sorted(set(int(m) for m in matches))
            return pages

        # Fallback: infer page numbers based on position
        # Calculate approximate page boundaries
        if not page_descriptions:
            return []

        # Find where each page marker starts in combined_text
        page_starts: list[int] = []
        for i, _desc in enumerate(page_descriptions, start=1):
            # Try both formats: with and without spaces, just in case
            page_marker = f"<!-- Page {i} -->"
            marker_pos = combined_text.find(page_marker)
            if marker_pos == -1:
                # Try alternative format if needed, or just assume sequential if markers missing?
                # For now, if marker missing, we might lose sync.
                pass
            if marker_pos != -1:
                page_starts.append(marker_pos)

        if not page_starts:
            # If no markers found, maybe it's not using markers?
            return []

        # Find which pages overlap with this section.
        # Page i is defined as the range [marker_i, marker_{i+1}) in combined_text.
        pages: list[int] = []
        for idx, page_start in enumerate(page_starts):
            page_end = page_starts[idx + 1] if idx + 1 < len(page_starts) else len(combined_text)
            # Check overlap: start < end and end > start
            if start_pos < page_end and end_pos > page_start:
                pages.append(idx + 1)

        return sorted(set(pages)) if pages else []

    @staticmethod
    def _chunk_id_for_section(file_id: str, ordinal: int, section_path: Optional[str], sub_index: Optional[int] = None) -> str:
        """Generate a chunk ID for a section."""
        import xxhash
        key = f"{file_id}:{ordinal}:{section_path or 'root'}"
        if sub_index is not None:
            key += f":{sub_index}"
        digest = xxhash.xxh64()
        digest.update(key.encode('utf-8'))
        return digest.hexdigest()

    @staticmethod
    def _to_snapshot(file_id: str, payload: ChunkPayload) -> ChunkSnapshot:
        return ChunkSnapshot(
            chunk_id=payload.chunk_id,
            file_id=file_id,
            ordinal=payload.ordinal,
            text=payload.text,
            snippet=payload.snippet,
            token_count=payload.token_count,
            char_count=payload.char_count,
            section_path=payload.section_path,
            metadata=payload.metadata,
            created_at=payload.created_at,
        )

    @staticmethod
    def _fingerprint(path: Path) -> str:
        digest = hashlib.sha1()
        digest.update(str(path.resolve()).encode("utf-8"))
        return digest.hexdigest()

    @staticmethod
    def _checksum(path: Path) -> str:
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(8192), b""):
                digest.update(chunk)
        return digest.hexdigest()

    async def _mark_folder_indexed(self, folder_id: str) -> None:
        folder = self.storage.get_folder(folder_id)
        if not folder:
            return
        now = dt.datetime.now(dt.timezone.utc)
        updated = folder.copy(update={"last_indexed_at": now, "updated_at": now})
        self.storage.upsert_folder(updated)
