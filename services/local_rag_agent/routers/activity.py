from __future__ import annotations

import datetime as dt
from typing import Optional

from fastapi import APIRouter, UploadFile, File, HTTPException
import logging

from ..context import get_activity_service
from ..models import ActivityTimelineResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/activity", tags=["activity"])


@router.post("/ingest")
async def ingest_screenshot(file: UploadFile = File(...)):
    logger.info("Received screenshot ingestion request")
    service = get_activity_service()
    content = await file.read()
    if not content:
        logger.warning("Received empty file for ingestion")
        raise HTTPException(status_code=400, detail="Empty file")

    log = await service.ingest_screenshot(content)
    logger.info(f"Ingestion successful: {log.id}")
    return log


@router.get("/timeline", response_model=ActivityTimelineResponse)
async def get_timeline(
    start: Optional[str] = None,
    end: Optional[str] = None,
    summary: bool = False
):
    logger.info(f"Received timeline request: start={start}, end={end}, summary={summary}")
    service = get_activity_service()

    start_dt = dt.datetime.fromisoformat(start) if start else None
    end_dt = dt.datetime.fromisoformat(end) if end else None

    # Default to today if not specified
    if not start_dt and not end_dt:
        now = dt.datetime.now(dt.timezone.utc)
        start_dt = now.replace(hour=0, minute=0, second=0, microsecond=0)
        end_dt = now.replace(hour=23, minute=59, second=59, microsecond=999999)

    return await service.get_timeline(start_dt, end_dt, generate_summary=summary)


@router.delete("/timeline")
async def delete_timeline(
    start: Optional[str] = None,
    end: Optional[str] = None
):
    logger.info(f"Received timeline deletion request: start={start}, end={end}")
    service = get_activity_service()

    start_dt = dt.datetime.fromisoformat(start) if start else None
    end_dt = dt.datetime.fromisoformat(end) if end else None

    count = await service.delete_logs(start_dt, end_dt)
    return {"deleted": count}


@router.delete("/{log_id}")
async def delete_activity_log(log_id: str):
    logger.info(f"Received activity log deletion request: id={log_id}")
    service = get_activity_service()
    deleted = await service.delete_log(log_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Activity log not found")
    return {"deleted": True}
