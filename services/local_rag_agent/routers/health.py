from __future__ import annotations

import asyncio
import time
import httpx
from fastapi import APIRouter

from ..config import settings
from ..context import get_indexer, get_storage
from ..models import HealthResponse, ServiceStatus

router = APIRouter(tags=["health"])


async def check_service(name: str, url: str | None) -> ServiceStatus:
    if not url:
        return ServiceStatus(name=name, status="unknown", details="URL not configured")

    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            # Try /health first
            target = url.rstrip("/") + "/health"
            try:
                response = await client.get(target)
                if response.status_code == 404:
                    raise httpx.HTTPStatusError("Not Found", request=response.request, response=response)
            except httpx.HTTPStatusError:
                # Fallback to root
                target = url.rstrip("/")
                response = await client.get(target)

            if 200 <= response.status_code < 500:  # Accept even 4xx as "online" (service is reachable)
                latency = (time.perf_counter() - start) * 1000
                return ServiceStatus(name=name, status="online", latency_ms=latency)
            else:
                return ServiceStatus(name=name, status="offline", details=f"HTTP {response.status_code}")
    except Exception as e:
        return ServiceStatus(name=name, status="offline", details=str(e))


@router.get("/health", response_model=HealthResponse)
async def read_health() -> HealthResponse:
    storage = get_storage()
    indexer = get_indexer()

    # Run blocking DB call in thread pool
    loop = asyncio.get_running_loop()
    files, folders = await loop.run_in_executor(None, storage.counts)

    status = "ready" if files else "idle"
    progress = indexer.status()
    if progress.status in ("running", "paused"):
        status = "indexing"
    message = progress.last_error if progress.last_error else progress.message
    if progress.status == "paused":
        message = message or "Indexing paused."

    # Check services
    checks = [
        check_service("Embedding", settings.endpoints.embedding),
        check_service("Reranker", settings.endpoints.rerank),
    ]
    if settings.endpoints.vision:
        checks.append(check_service("Vision/LLM", settings.endpoints.vision))

    services = await asyncio.gather(*checks)

    # Downgrade status if services are offline
    if any(s.status == "offline" for s in services):
        status = "degraded"
        if not message:
            message = "Some AI services are offline."

    return HealthResponse(
        status=status,
        indexed_files=files,
        watched_folders=folders,
        message=message,
        services=list(services)
    )
