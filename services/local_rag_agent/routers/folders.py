from __future__ import annotations

import asyncio
import datetime as dt
import hashlib
from pathlib import Path

from fastapi import APIRouter, HTTPException, Response, status

from ..context import get_storage, get_indexer
from ..models import FolderContentsResponse, FolderCreate, FolderListResponse, FolderRecord

router = APIRouter(prefix="/folders", tags=["folders"])


def _folder_id(path: Path) -> str:
    digest = hashlib.sha1()
    digest.update(str(path.resolve()).encode("utf-8"))
    return digest.hexdigest()


@router.get("", response_model=FolderListResponse)
async def list_folders() -> FolderListResponse:
    storage = get_storage()
    loop = asyncio.get_running_loop()
    folders = await loop.run_in_executor(None, storage.list_folders)
    return FolderListResponse(folders=folders)


@router.post("", response_model=FolderRecord, status_code=status.HTTP_201_CREATED)
async def add_folder(payload: FolderCreate) -> FolderRecord:
    storage = get_storage()
    resolved = payload.path.expanduser().resolve()
    if not resolved.exists() or not resolved.is_dir():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Folder does not exist or is not a directory.")

    loop = asyncio.get_running_loop()
    existing = await loop.run_in_executor(None, lambda: storage.folder_by_path(resolved))
    if existing:
        # If existing folder is 'manual' but we're now adding as 'full', upgrade it
        if existing.scan_mode == "manual" and payload.scan_mode == "full":
            existing.scan_mode = "full"
            existing.updated_at = dt.datetime.now(dt.timezone.utc)
            await loop.run_in_executor(None, lambda: storage.upsert_folder(existing))
        return existing

    now = dt.datetime.now(dt.timezone.utc)
    record = FolderRecord(
        id=_folder_id(resolved),
        path=resolved,
        label=payload.label or resolved.name,
        created_at=now,
        updated_at=now,
        enabled=True,
        scan_mode=payload.scan_mode,
    )
    await loop.run_in_executor(None, lambda: storage.upsert_folder(record))
    return record


@router.delete("/{folder_id}", status_code=status.HTTP_204_NO_CONTENT, response_class=Response)
async def remove_folder(folder_id: str) -> Response:
    storage = get_storage()
    indexer = get_indexer()
    loop = asyncio.get_running_loop()
    folder = await loop.run_in_executor(None, lambda: storage.get_folder(folder_id))
    if not folder:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found.")
    
    # Cancel any ongoing indexing for this folder
    indexer.cancel_folder(folder_id)
    
    # Remove vectors
    await loop.run_in_executor(None, lambda: indexer.vector_store.delete_by_filter(folder_id=folder_id))
    
    await loop.run_in_executor(None, lambda: storage.remove_folder(folder_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{folder_id}", response_model=FolderRecord)
async def get_folder(folder_id: str) -> FolderRecord:
    storage = get_storage()
    loop = asyncio.get_running_loop()
    folder = await loop.run_in_executor(None, lambda: storage.get_folder(folder_id))
    if not folder:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found.")
    return folder


@router.get("/{folder_id}/files", response_model=FolderContentsResponse)
async def get_folder_files(folder_id: str) -> FolderContentsResponse:
    storage = get_storage()
    loop = asyncio.get_running_loop()
    folder = await loop.run_in_executor(None, lambda: storage.get_folder(folder_id))
    if not folder:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Folder not found.")
    files = await loop.run_in_executor(None, lambda: storage.folder_files(folder_id))
    return FolderContentsResponse(folder=folder, files=files)
