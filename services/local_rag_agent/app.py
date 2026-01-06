from __future__ import annotations
from .routers import files, folders, health, index, notes, search, activity, chat, settings as settings_router, security
from .context import get_indexer, get_activity_service, get_storage
from .config import settings
from .models import FolderRecord
from .auth import verify_api_key, ensure_local_key

import asyncio
import logging
import hashlib
import datetime as dt
from pathlib import Path
import sys

# Force ProactorEventLoop on Windows to avoid "too many file descriptors" error
if sys.platform == 'win32':
    asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())

from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI(title="Local RAG Agent", version="1.0.0", dependencies=[Depends(verify_api_key)])

# Allow CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Health check might need to be public for some setups, but user requested all secured.
# If needed, we can move health.router inclusion before the dependencies are applied, 
# but FastAPI applies global dependencies to all routes.
# To make health public, we would need to override dependencies for that router.
# For now, we keep it secured as requested.

app.include_router(health.router)
app.include_router(folders.router)
app.include_router(index.router)
app.include_router(files.router)
app.include_router(search.router)
app.include_router(notes.router)
app.include_router(activity.router)
app.include_router(chat.router)
app.include_router(settings_router.router)
app.include_router(security.router)

_poll_task: asyncio.Task | None = None
_startup_refresh_task: asyncio.Task | None = None
_summary_task: asyncio.Task | None = None
logger = logging.getLogger(__name__)

SUMMARY_FOLDER = Path.home() / "local-cocoa-activity-summaries"


def _track_task(task: asyncio.Task, name: str) -> None:
    def _finalise(completed: asyncio.Task) -> None:
        try:
            completed.result()
        except asyncio.CancelledError:
            pass
        except Exception as exc:  # noqa: BLE001
            logger.warning("%s task failed: %s", name, exc)

    task.add_done_callback(_finalise)


async def _poll_loop(interval: int) -> None:
    indexer = get_indexer()
    while True:
        await asyncio.sleep(interval)
        # Use skip_pending_registration for poll refresh to avoid expensive DB operations
        # Use skip_recently_indexed_minutes to avoid re-scanning folders that were just indexed
        # Set to half the poll interval to ensure we eventually rescan
        skip_minutes = max(1, interval // 120)  # e.g., 90s poll -> skip if indexed <1 min ago
        await indexer.refresh(
            skip_pending_registration=True,
            skip_recently_indexed_minutes=skip_minutes
        )


async def _summary_loop(interval: int) -> None:
    activity_service = get_activity_service()
    while True:
        await asyncio.sleep(interval)
        try:
            summary, start, end = await activity_service.generate_summary_for_period(minutes=30)
            if summary:
                # Ensure folder exists (in case user deleted it)
                SUMMARY_FOLDER.mkdir(parents=True, exist_ok=True)

                filename = f"Activity_Summary_{start.strftime('%Y-%m-%d_%H-%M')}.md"
                file_path = SUMMARY_FOLDER / filename

                content = f"# Activity Summary\n\n**Period:** {start.strftime('%H:%M')} - {end.strftime('%H:%M')}\n\n## Summary\n{summary}"

                with open(file_path, "w") as f:
                    f.write(content)

                logger.info(f"Generated activity summary: {file_path}")
        except Exception as e:
            logger.error(f"Failed to generate activity summary: {e}")


@app.on_event("startup")
async def on_startup() -> None:
    global _poll_task, _startup_refresh_task, _summary_task

    # Ensure local-key exists and is written to file for frontend
    ensure_local_key(settings.base_dir)

    # Setup summary folder
    SUMMARY_FOLDER.mkdir(parents=True, exist_ok=True)
    storage = get_storage()

    # Register folder if not exists
    digest = hashlib.sha1()
    digest.update(str(SUMMARY_FOLDER.resolve()).encode("utf-8"))
    folder_id = digest.hexdigest()

    existing = storage.get_folder(folder_id)
    if not existing:
        now = dt.datetime.now(dt.timezone.utc)
        record = FolderRecord(
            id=folder_id,
            path=SUMMARY_FOLDER.resolve(),
            label="Activity Summaries",
            created_at=now,
            updated_at=now,
            enabled=True,
        )
        storage.upsert_folder(record)
        logger.info(f"Registered activity summary folder: {SUMMARY_FOLDER}")

    indexer = get_indexer()
    if settings.refresh_on_startup:
        # Launch initial refresh without blocking server startup so the API becomes responsive quickly.
        # Use skip_pending_registration=True to avoid expensive DB operations during startup
        # Use skip_recently_indexed_minutes=5 to skip folders that were indexed recently
        # (e.g., user just closed and reopened the app)
        _startup_refresh_task = asyncio.create_task(
            indexer.refresh(skip_pending_registration=True, skip_recently_indexed_minutes=5)
        )
        _track_task(_startup_refresh_task, "startup-refresh")
    if settings.poll_interval_seconds > 0:
        _poll_task = asyncio.create_task(_poll_loop(settings.poll_interval_seconds))
        _track_task(_poll_task, "poll-loop")

    # Start summary loop (30 minutes)
    _summary_task = asyncio.create_task(_summary_loop(30 * 60))
    _track_task(_summary_task, "summary-loop")


@app.on_event("shutdown")
async def on_shutdown() -> None:
    global _poll_task, _startup_refresh_task, _summary_task
    if _poll_task:
        _poll_task.cancel()
        try:
            await _poll_task
        except asyncio.CancelledError:
            pass
        _poll_task = None
    if _startup_refresh_task:
        _startup_refresh_task.cancel()
        try:
            await _startup_refresh_task
        except asyncio.CancelledError:
            pass
        _startup_refresh_task = None
    if _summary_task:
        _summary_task.cancel()
        try:
            await _summary_task
        except asyncio.CancelledError:
            pass
        _summary_task = None
