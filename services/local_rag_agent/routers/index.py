from __future__ import annotations

import asyncio
import datetime as dt
import logging
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status

from ..context import get_indexer, get_storage
from ..models import IndexInventory, IndexProgress, IndexRequest, IndexSummary

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/index", tags=["index"])


@router.get("/status", response_model=IndexProgress)
def get_status() -> IndexProgress:
    return get_indexer().status()


@router.post("/run", response_model=IndexProgress)
async def run_index(payload: IndexRequest, background: BackgroundTasks) -> IndexProgress:
    indexer = get_indexer()

    folders = payload.folders or []
    scope = payload.scope or ("folder" if folders else "global")
    if scope == "global" and folders:
        scope = "folder"

    if scope != "global" and not folders:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="folders are required for non-global rescan/reindex requests.",
        )

    mode = payload.mode or "rescan"
    purge_targets = list(payload.purge_folders or [])

    # Backwards compatibility: legacy flags imply a reindex.
    if payload.drop_collection:
        mode = "reindex"
        scope = "global"
    elif purge_targets and mode == "rescan":
        mode = "reindex"
        if scope == "global" and folders:
            scope = "folder"
    elif payload.refresh_embeddings and mode == "rescan" and not folders:
        mode = "reindex"

    effective_drop_collection = payload.drop_collection
    effective_refresh_embeddings = payload.refresh_embeddings

    if mode == "reindex":
        effective_refresh_embeddings = True
        if scope == "global":
            effective_drop_collection = True
            purge_targets = []
        else:
            effective_drop_collection = False
            purge_targets = folders if folders else purge_targets
    else:
        effective_drop_collection = False
        if scope != "global":
            purge_targets = []

    if effective_drop_collection and folders:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="drop_collection cannot be combined with targeted folders.",
        )

    effective_indexing_mode = payload.get_indexing_mode()

    async def task() -> None:
        logger.info(
            "Index job starting: mode=%s scope=%s indexing_mode=%s folders=%d files=%d drop_collection=%s refresh_embeddings=%s purge_folders=%d",
            mode,
            scope,
            effective_indexing_mode,
            len(folders or []),
            len(payload.files or []),
            bool(effective_drop_collection),
            bool(effective_refresh_embeddings),
            len(purge_targets or []),
        )
        try:
            await indexer.refresh(
                folders=folders if scope != "global" else None,
                files=payload.files,
                refresh_embeddings=effective_refresh_embeddings,
                drop_collection=effective_drop_collection,
                purge_folders=purge_targets,
                indexing_mode=effective_indexing_mode,
            )
        except Exception:  # noqa: BLE001
            logger.exception("Index job crashed")
            raise
        finally:
            status_snapshot = indexer.status()
            logger.info(
                "Index job finished: status=%s processed=%d failed=%d message=%s",
                status_snapshot.status,
                status_snapshot.processed,
                status_snapshot.failed,
                status_snapshot.message,
            )

    if indexer.status().status == "running":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Index job already running.")

    logger.info(
        "Index run requested: mode=%s scope=%s indexing_mode=%s folders=%d files=%d",
        mode,
        scope,
        effective_indexing_mode,
        len(folders or []),
        len(payload.files or []),
    )

    # Avoid a UX race where the response returns `idle` because the background task
    # hasn't acquired the indexer's lock yet (fast scans can finish before polling sees `running`).
    now = dt.datetime.now(dt.timezone.utc)
    indexer.progress = IndexProgress(
        status="running",
        started_at=now,
        completed_at=None,
        processed=0,
        failed=0,
        total=None,
        message="Starting indexing…",
    )

    background.add_task(task)
    return indexer.status()


@router.post("/reindex", response_model=IndexProgress)
async def hard_reindex(background: BackgroundTasks) -> IndexProgress:
    indexer = get_indexer()

    async def task() -> None:
        await indexer.refresh(refresh_embeddings=True, drop_collection=True)

    if indexer.status().status == "running":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Index job already running.")

    background.add_task(task)
    return indexer.status()


@router.post("/pause", response_model=IndexProgress)
def pause_index() -> IndexProgress:
    indexer = get_indexer()
    if indexer.status().status != "running":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Indexer is not running.")
    return indexer.pause()


@router.post("/resume", response_model=IndexProgress)
def resume_index() -> IndexProgress:
    indexer = get_indexer()
    if indexer.status().status != "paused":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Indexer is not paused.")
    return indexer.resume()


@router.get("/summary", response_model=IndexSummary)
async def get_summary() -> IndexSummary:
    storage = get_storage()
    loop = asyncio.get_running_loop()

    def _get_summary_data():
        files, folders = storage.counts()
        all_folders = storage.list_folders()
        last_completed = max(
            (folder.last_indexed_at for folder in all_folders if folder.last_indexed_at),
            default=None,
        )
        total_size = storage.total_size()
        return files, folders, last_completed, total_size

    files, folders, last_completed, total_size = await loop.run_in_executor(None, _get_summary_data)

    return IndexSummary(
        files_indexed=files,
        total_size_bytes=total_size,
        folders_indexed=folders,
        last_completed_at=last_completed,
    )


@router.get("/list", response_model=IndexInventory)
async def list_index_inventory(
        limit: int = Query(default=100, ge=1, le=500),
        offset: int = Query(default=0, ge=0),
        folder_id: str | None = None,
) -> IndexInventory:
    storage = get_storage()
    loop = asyncio.get_running_loop()

    files, total = await loop.run_in_executor(None, lambda: storage.list_files(limit=limit, offset=offset, folder_id=folder_id))

    indexer = get_indexer()
    indexing_items = indexer.indexing_items(folder_id=folder_id)
    return IndexInventory(files=files, total=total, indexing=indexing_items, progress=indexer.status())
