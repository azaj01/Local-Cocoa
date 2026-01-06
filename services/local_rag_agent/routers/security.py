from fastapi import APIRouter, HTTPException, Depends
from ..models import ApiKey
from ..context import get_storage
from ..auth import verify_api_key
import secrets

router = APIRouter(prefix="/security", tags=["security"])

@router.get("/keys", response_model=list[ApiKey])
async def list_keys(current_key: ApiKey = Depends(verify_api_key)):
    storage = get_storage()
    return storage.list_api_keys()

@router.post("/keys", response_model=ApiKey)
async def create_key(name: str, current_key: ApiKey = Depends(verify_api_key)):
    storage = get_storage()
    # Generate a new key
    new_key_str = f"sk-{secrets.token_urlsafe(32)}"
    return storage.create_api_key(new_key_str, name)

@router.delete("/keys/{key}")
async def delete_key(key: str, current_key: ApiKey = Depends(verify_api_key)):
    storage = get_storage()
    target_key = storage.get_api_key(key)
    if not target_key:
        raise HTTPException(status_code=404, detail="Key not found")
    
    if target_key.is_system:
        raise HTTPException(status_code=400, detail="Cannot delete system keys")
    
    if target_key.key == current_key.key:
        raise HTTPException(status_code=400, detail="Cannot delete the key currently in use")

    success = storage.delete_api_key(key)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to delete key")
    return {"status": "deleted"}
