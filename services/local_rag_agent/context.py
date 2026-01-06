from __future__ import annotations

from .clients import EmbeddingClient, LlmClient, RerankClient, TranscriptionClient
from .config import settings
from .indexer import Indexer
from .notes_service import NotesService
from .activity_service import ActivityService
from .search_engine import SearchEngine
from .storage import IndexStorage
from .vector_store import vector_store

storage = IndexStorage(settings.db_path)
embedding_client = EmbeddingClient()
rerank_client = RerankClient()
llm_client = LlmClient()
transcription_client = TranscriptionClient() if settings.endpoints.transcription else None
indexer = Indexer(
    storage,
    embedding_client=embedding_client,
    llm_client=llm_client,
    transcription_client=transcription_client,
)
search_engine = SearchEngine(storage, embedding_client, rerank_client, llm_client, vectors=vector_store)
notes_service = NotesService(storage, indexer)
activity_service = ActivityService(storage, llm_client)


def get_storage() -> IndexStorage:
    return storage


def get_indexer() -> Indexer:
    return indexer


def get_embedding_client() -> EmbeddingClient:
    return embedding_client


def get_rerank_client() -> RerankClient:
    return rerank_client


def get_llm_client() -> LlmClient:
    return llm_client


def get_search_engine() -> SearchEngine:
    return search_engine


def get_transcription_client() -> TranscriptionClient | None:
    return transcription_client


def get_notes_service() -> NotesService:
    return notes_service


def get_activity_service() -> ActivityService:
    return activity_service
