"""
Configuration for MCP Server
"""

from __future__ import annotations

import os
import platform
from pathlib import Path


def _get_env_int(name: str, default: int) -> int:
    value = os.getenv(name)
    if not value:
        return default
    try:
        return int(value)
    except ValueError:
        return default


def _get_env_float(name: str, default: float) -> float:
    value = os.getenv(name)
    if not value:
        return default
    try:
        return float(value)
    except ValueError:
        return default


def _get_env_bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def get_default_data_dir() -> Path:
    """Get the default Local Cocoa data directory based on platform."""
    system = platform.system()
    home = Path.home()

    if system == "Darwin":
        return home / "Library" / "Application Support" / "Local Cocoa" / "local_rag"
    elif system == "Windows":
        appdata = os.getenv("APPDATA", str(home / "AppData" / "Roaming"))
        return Path(appdata) / "local-cocoa" / "local_rag"
    else:
        return home / ".config" / "local-cocoa" / "local_rag"


def get_api_key() -> str:
    """
    Get the API key for authenticating with the Local Cocoa backend.

    Priority:
    1. LOCAL_COCOA_API_KEY environment variable
    2. Development path: runtime/local_rag/local_key.txt
    3. Production path: system data directory
    """
    # Check environment variable first
    env_key = os.getenv("LOCAL_COCOA_API_KEY")
    if env_key:
        return env_key

    # Try development path first (when running from project directory)
    # This file is at: services/mcp_server/config.py
    project_root = Path(__file__).parent.parent.parent
    dev_key_file = project_root / "runtime" / "local_rag" / "local_key.txt"
    if dev_key_file.exists():
        try:
            return dev_key_file.read_text().strip()
        except Exception:
            pass

    # Fall back to production path
    data_dir = get_default_data_dir()
    key_file = data_dir / "local_key.txt"

    if key_file.exists():
        try:
            return key_file.read_text().strip()
        except Exception:
            pass

    raise ValueError(
        "No API key found. Set LOCAL_COCOA_API_KEY environment variable "
        f"or ensure {key_file} exists."
    )


def get_backend_url() -> str:
    """Get the backend URL for the Local Cocoa API."""
    return os.getenv("LOCAL_COCOA_BACKEND_URL", "http://127.0.0.1:8890")


def get_request_timeouts() -> dict[str, float]:
    """Get MCP client timeouts."""
    return {
        "connect": max(_get_env_float("LOCAL_COCOA_MCP_CONNECT_TIMEOUT", 2.0), 0.1),
        "read": max(_get_env_float("LOCAL_COCOA_MCP_READ_TIMEOUT", 15.0), 1.0),
        "qa": max(_get_env_float("LOCAL_COCOA_MCP_QA_TIMEOUT", 40.0), 5.0),
        "health": max(_get_env_float("LOCAL_COCOA_MCP_HEALTH_TIMEOUT", 2.0), 0.1),
    }


def get_retry_config() -> tuple[int, float]:
    """Get retry count and delay for transient connection errors."""
    retries = max(_get_env_int("LOCAL_COCOA_MCP_RETRIES", 1), 0)
    delay = max(_get_env_float("LOCAL_COCOA_MCP_RETRY_DELAY", 0.5), 0.0)
    return retries, delay


def get_max_response_chars() -> int:
    """Get the maximum characters allowed in MCP responses."""
    return max(_get_env_int("LOCAL_COCOA_MCP_MAX_RESPONSE_CHARS", 12000), 1000)


def get_max_file_chars() -> int:
    """Get the maximum characters allowed when returning full file content."""
    return max(_get_env_int("LOCAL_COCOA_MCP_MAX_FILE_CHARS", 20000), 2000)


def get_health_cache_ttl() -> float:
    """Get cache TTL for backend health checks."""
    return max(_get_env_float("LOCAL_COCOA_MCP_HEALTH_CACHE_TTL", 5.0), 0.0)


def get_search_multi_path_default() -> bool:
    """Default to multi-path search for MCP if enabled."""
    return _get_env_bool("LOCAL_COCOA_MCP_SEARCH_MULTIPATH", False)
