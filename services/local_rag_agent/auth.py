from fastapi import Security, HTTPException, status
from fastapi.security.api_key import APIKeyHeader
from .context import get_storage
import secrets
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

API_KEY_NAME = "X-API-Key"
api_key_header = APIKeyHeader(name=API_KEY_NAME, auto_error=False)

async def verify_api_key(
    api_key_header: str = Security(api_key_header),
):
    if not api_key_header:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Missing API Key"
        )

    storage = get_storage()
    key_record = storage.get_api_key(api_key_header)
    
    if not key_record or not key_record.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Invalid or inactive API Key"
        )
    
    storage.update_api_key_usage(api_key_header)
    return key_record

def ensure_local_key(base_dir: Path):
    storage = get_storage()
    keys = storage.list_api_keys()
    local_key = next((k for k in keys if k.name == "local-key" and k.is_system), None)
    
    key_value = ""
    if not local_key:
        # Generate a secure random key
        new_key = f"sk-local-{secrets.token_urlsafe(32)}"
        logger.info("Generating initial local-key...")
        storage.create_api_key(new_key, "local-key", is_system=True)
        key_value = new_key
    else:
        key_value = local_key.key
    
    # Write to file for frontend to read
    # Ensure directory exists (important for packaged apps where directory may not exist yet)
    try:
        base_dir.mkdir(parents=True, exist_ok=True)
    except Exception as e:
        logger.warning(f"Failed to create directory {base_dir}: {e}")
    
    key_file = base_dir / "local_key.txt"
    try:
        with open(key_file, "w") as f:
            f.write(key_value)
        logger.info(f"Local key written to: {key_file}")
    except Exception as e:
        logger.warning(f"Failed to write local_key.txt to {key_file}: {e}")
    
    return key_value
