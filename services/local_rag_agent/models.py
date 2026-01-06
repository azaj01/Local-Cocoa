from __future__ import annotations

import base64
import datetime as dt
from pathlib import Path
from typing import Any, Iterable, List, Literal, Optional

from pydantic import BaseModel, Field, field_serializer

FileKind = Literal[
    "document",
    "spreadsheet",
    "presentation",
    "image",
    "audio",
    "video",
    "archive",
    "other",
]

FileIndexStatus = Literal[
    "pending",    # File discovered but not yet indexed
    "indexed",    # Successfully indexed
    "error",      # Failed to index
]

SUPPORTED_EXTENSIONS: dict[str, FileKind] = {
    "pdf": "document",
    "doc": "document",
    "docx": "document",
    "txt": "document",
    "md": "document",
    "rtf": "document",
    "pages": "document",
    "xls": "spreadsheet",
    "xlsx": "spreadsheet",
    "numbers": "spreadsheet",
    "csv": "spreadsheet",
    "ppt": "presentation",
    "pptx": "presentation",
    "key": "presentation",
    "png": "image",
    "jpg": "image",
    "jpeg": "image",
    "gif": "image",
    "heic": "image",
    "webp": "image",
    "bmp": "image",
    "svg": "image",
    "mp3": "audio",
    "wav": "audio",
    "m4a": "audio",
    "flac": "audio",
    "mp4": "video",
    "mov": "video",
    "avi": "video",
    "mkv": "video",
    "zip": "archive",
    "rar": "archive",
    "7z": "archive",
    "tar": "archive",
    "gz": "archive",
}


def infer_kind(path: Path) -> FileKind:
    suffix = path.suffix.lower().lstrip(".")
    return SUPPORTED_EXTENSIONS.get(suffix, "other")


class FailedFile(BaseModel):
    path: Path
    reason: str
    timestamp: dt.datetime

    @field_serializer("path", when_used="json")
    def _serialize_path(self, value: Path) -> str:
        return str(value)


class FolderRecord(BaseModel):
    id: str
    path: Path
    label: str
    created_at: dt.datetime
    updated_at: dt.datetime
    last_indexed_at: Optional[dt.datetime] = None
    enabled: bool = True
    failed_files: list[FailedFile] = Field(default_factory=list)
    indexed_count: int = 0
    # Scan mode: 'full' = scan entire folder on refresh (default)
    #            'manual' = only scan when explicitly requested (for single-file indexing)
    scan_mode: Literal["full", "manual"] = "full"


class FolderCreate(BaseModel):
    path: Path
    label: Optional[str] = None
    scan_mode: Literal["full", "manual"] = "full"


class FolderListResponse(BaseModel):
    folders: list[FolderRecord]


class FileRecord(BaseModel):
    id: str
    folder_id: str
    path: Path
    name: str
    extension: str
    size: int
    modified_at: dt.datetime
    created_at: dt.datetime
    kind: FileKind
    hash: str
    mime_type: Optional[str] = None
    checksum_sha256: Optional[str] = None
    duration_seconds: Optional[float] = None
    page_count: Optional[int] = None
    summary: Optional[str] = None
    preview_image: Optional[bytes] = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    embedding_vector: Optional[list[float]] = None
    embedding_determined_at: Optional[dt.datetime] = None
    # Index status tracking
    index_status: FileIndexStatus = "pending"
    error_reason: Optional[str] = None
    error_at: Optional[dt.datetime] = None

    @field_serializer("preview_image", when_used="json")
    def _serialize_preview_image(self, value: Optional[bytes]) -> Optional[str]:
        if value is None:
            return None
        return base64.b64encode(value).decode("ascii")


class FileListResponse(BaseModel):
    files: list[FileRecord]
    total: int


class ChunkSnapshot(BaseModel):
    chunk_id: str
    file_id: str
    ordinal: int
    text: str
    snippet: str
    token_count: int
    char_count: int
    section_path: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    created_at: dt.datetime


class IndexRequest(BaseModel):
    mode: Literal["rescan", "reindex"] = "rescan"
    scope: Literal["global", "folder", "email", "notes"] = "global"
    refresh_embeddings: bool = False
    folders: Optional[list[str]] = None
    files: Optional[list[str]] = None
    drop_collection: bool = False
    purge_folders: Optional[list[str]] = None
    indexing_mode: Optional[Literal["fast", "fine"]] = None  # None means use settings default
    
    def get_indexing_mode(self) -> Literal["fast", "fine"]:
        """Returns the indexing mode, using settings default if not explicitly set."""
        if self.indexing_mode is not None:
            return self.indexing_mode
        from .config import settings
        return settings.default_indexing_mode


class IndexProgress(BaseModel):
    status: Literal["idle", "running", "paused", "failed", "completed"]
    started_at: Optional[dt.datetime] = None
    completed_at: Optional[dt.datetime] = None
    processed: int = 0
    failed: int = 0
    total: Optional[int] = None
    message: Optional[str] = None
    last_error: Optional[str] = None
    failed_items: list[FailedFile] = Field(default_factory=list)


class IndexingItem(BaseModel):
    folder_id: str
    folder_path: Path
    file_path: Path
    file_id: Optional[str] = None  # File ID for reliable matching
    file_name: Optional[str] = None  # File name for fallback matching
    status: Literal["pending", "processing"]
    started_at: Optional[dt.datetime] = None
    progress: Optional[float] = None

    # Optional richer progress details for interactive UI
    kind: Optional[str] = None
    stage: Optional[str] = None
    detail: Optional[str] = None
    step_current: Optional[int] = None
    step_total: Optional[int] = None
    recent_events: list[dict[str, Any]] = Field(default_factory=list)


class IndexInventory(BaseModel):
    files: list[FileRecord]
    total: int
    indexing: list[IndexingItem] = Field(default_factory=list)
    progress: IndexProgress


class SearchHit(BaseModel):
    model_config = {"populate_by_name": True}
    
    file_id: str = Field(alias="fileId")
    score: float
    summary: Optional[str] = None
    snippet: Optional[str] = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    chunk_id: Optional[str] = Field(default=None, alias="chunkId")
    # Chunk analysis results from LLM
    analysis_comment: Optional[str] = Field(default=None, alias="analysisComment")
    has_answer: Optional[bool] = Field(default=None, alias="hasAnswer")
    analysis_confidence: Optional[float] = Field(default=None, alias="analysisConfidence")


class AgentStepFile(BaseModel):
    file_id: str
    label: str
    score: Optional[float] = None


class AgentStep(BaseModel):
    id: str
    title: str
    detail: Optional[str] = None
    status: Literal["running", "complete", "skipped", "error"] = "complete"
    queries: list[str] = Field(default_factory=list)
    items: list[str] = Field(default_factory=list)
    files: list[AgentStepFile] = Field(default_factory=list)
    duration_ms: Optional[int] = None


class AgentDiagnostics(BaseModel):
    steps: list[AgentStep] = Field(default_factory=list)
    summary: Optional[str] = None


class SubQueryResult(BaseModel):
    """Result from a single sub-query in multi-path retrieval."""
    sub_query: str
    hits: list[SearchHit] = Field(default_factory=list)
    strategy: str = "vector"


class SearchResponse(BaseModel):
    query: str
    hits: list[SearchHit]
    rewritten_query: Optional[str] = None
    query_variants: list[str] = Field(default_factory=list)
    strategy: Literal[
        "vector",
        "hybrid",
        "lexical",
        "mandatory_keywords",           # All query terms matched (>= 4 terms)
        "mandatory_plus_vector",        # Mandatory keywords + vector supplement
        "mandatory_keywords_only",      # Mandatory keywords only (embedding unavailable)
        "lexical_priority",             # High-quality keyword match found
        "multi_path",                   # Multi-path retrieval with query decomposition
    ] = "vector"
    latency_ms: Optional[int] = None
    diagnostics: Optional[AgentDiagnostics] = None
    # Multi-path retrieval fields
    sub_queries: list[str] = Field(default_factory=list)
    sub_query_results: list[SubQueryResult] = Field(default_factory=list)


class QaRequest(BaseModel):
    query: str
    mode: Literal["search", "qa", "chat"] = "qa"
    limit: int = 5
    search_mode: Literal["auto", "knowledge", "direct"] = "auto"


class QaResponse(BaseModel):
    answer: str
    hits: list[SearchHit]
    latency_ms: int
    rewritten_query: Optional[str] = None
    query_variants: list[str] = Field(default_factory=list)
    diagnostics: Optional[AgentDiagnostics] = None


class ServiceStatus(BaseModel):
    name: str
    status: Literal["online", "offline", "unknown"]
    latency_ms: Optional[float] = None
    details: Optional[str] = None


class HealthResponse(BaseModel):
    status: Literal["idle", "indexing", "ready", "degraded"]
    indexed_files: int
    watched_folders: int
    message: Optional[str] = None
    services: List[ServiceStatus] = Field(default_factory=list)


class FolderContentsResponse(BaseModel):
    folder: FolderRecord
    files: list[FileRecord]


class IndexSummary(BaseModel):
    files_indexed: int
    total_size_bytes: int
    folders_indexed: int
    last_completed_at: Optional[dt.datetime]


class SearchPreview(BaseModel):
    files: list[FileRecord]


class VectorDocument(BaseModel):
    doc_id: str
    vector: list[float]
    metadata: dict[str, Any]


class IngestArtifact(BaseModel):
    record: FileRecord
    text: str
    chunks: List[ChunkSnapshot] = Field(default_factory=list)
    page_mapping: List[tuple[int, int, int]] = Field(default_factory=list)  # For PDF page tracking


class NoteCreate(BaseModel):
    title: str | None = None
    body: str | None = None


class NoteRecord(BaseModel):
    id: str
    title: str
    path: Path
    created_at: dt.datetime
    updated_at: dt.datetime

    @field_serializer("path", when_used="json")
    def _serialize_path(self, value: Path) -> str:
        return str(value)


class NoteSummary(BaseModel):
    id: str
    title: str
    updated_at: dt.datetime
    preview: Optional[str] = None


class NoteContent(BaseModel):
    id: str
    title: str
    markdown: str
    created_at: dt.datetime
    updated_at: dt.datetime


class ActivityLog(BaseModel):
    id: str
    timestamp: dt.datetime
    description: str
    short_description: Optional[str] = None


class ActivityTimelineRequest(BaseModel):
    start: Optional[dt.datetime] = None
    end: Optional[dt.datetime] = None
    limit: int = 1000


class ActivityTimelineResponse(BaseModel):
    logs: list[ActivityLog]
    summary: Optional[str] = None


class ChatMessage(BaseModel):
    model_config = {"populate_by_name": True}
    
    id: str
    session_id: str
    role: Literal["user", "assistant", "system"]
    content: str
    timestamp: dt.datetime
    meta: Optional[str] = None
    references: Optional[list[SearchHit]] = None
    # Multi-path thinking steps
    is_multi_path: Optional[bool] = Field(default=None, alias="isMultiPath")
    thinking_steps: Optional[list[dict[str, Any]]] = Field(default=None, alias="thinkingSteps")


class ChatSession(BaseModel):
    id: str
    title: str
    created_at: dt.datetime
    updated_at: dt.datetime
    messages: list[ChatMessage] = Field(default_factory=list)


class ChatSessionCreate(BaseModel):
    title: Optional[str] = "New Chat"


class ChatMessageCreate(BaseModel):
    model_config = {"populate_by_name": True}
    
    role: Literal["user", "assistant", "system"]
    content: str
    meta: Optional[str] = None
    references: Optional[list[SearchHit]] = None
    # Multi-path thinking steps
    is_multi_path: Optional[bool] = Field(default=None, alias="isMultiPath")
    thinking_steps: Optional[list[dict[str, Any]]] = Field(default=None, alias="thinkingSteps")


class ApiKey(BaseModel):
    key: str
    name: str
    created_at: dt.datetime
    last_used_at: Optional[dt.datetime] = None
    is_active: bool = True
    is_system: bool = False


def chunked(iterable: Iterable, size: int) -> Iterable[list]:
    bucket: list = []
    for item in iterable:
        bucket.append(item)
        if len(bucket) >= size:
            yield bucket
            bucket = []
    if bucket:
        yield bucket
