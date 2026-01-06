#!/usr/bin/env bash
set -euo pipefail

# MODEL_DIR is the directory to download models to. Must pass this as a parameter
MODEL_DIR=$1

# Define the mirror URLs
HF_MAIN_URL="https://huggingface.co"
HF_CN_1="https://hf-mirror.com"

WGET_BIN="${WGET_BIN:-wget}"
WGET_PROGRESS="${WGET_PROGRESS:-dot:mega}"

mkdir -p "$MODEL_DIR"

emit_progress() {
  local event="$1"
  local asset="$2"
  local detail="${3:-}"
  printf '::MODEL_PROGRESS::%s::%s::%s\n' "$event" "$asset" "$detail"
}

ensure_wget() {
  if ! command -v "$WGET_BIN" >/dev/null 2>&1; then
    echo "wget is required but was not found in PATH." >&2
    emit_progress "error" "bootstrap" "wget_missing"
    exit 1
  fi
}

file_has_payload() {
  local target="$1"
  if [[ ! -f "$target" ]]; then
    return 1
  fi
  local size
  size=$(stat -c%s "$target" 2>/dev/null || stat -f%z "$target" 2>/dev/null || echo 0)
  [[ "$size" -gt 0 ]]
}

check_site_accessibility() {
  local url="$1"
  # Try to reach the site by sending a simple request (if status code 200, it's accessible)
  if curl --head --silent --fail "$url" > /dev/null; then
    echo "Site $url is accessible."
    return 0
  else
    echo "Site $url is not accessible."
    return 1
  fi
}

download_asset() {
  local asset_id="$1"
  local label="$2"
  local target="$3"
  local url="$4"

  emit_progress "check" "$asset_id" "$target"
  if file_has_payload "$target"; then
    echo "$label already exists and is not empty, skipping download."
    emit_progress "skip" "$asset_id" "exists"
    return
  fi

  mkdir -p "$(dirname "$target")"
  echo "Downloading $label..."
  emit_progress "download-start" "$asset_id" "$url"
  "$WGET_BIN" --progress="$WGET_PROGRESS" -O "$target" "$url"
  emit_progress "download-complete" "$asset_id" "$target"
}

ensure_wget

# Check if the Hugging Face main site is accessible
if check_site_accessibility "$HF_MAIN_URL"; then
  SOURCE_URL="$HF_MAIN_URL"
else
  # Try China mirrors if Hugging Face main site is not accessible
  if check_site_accessibility "$HF_CN_1"; then
    SOURCE_URL="$HF_CN_1"
  else
    echo "No accessible Hugging Face mirrors found."
    exit 1
  fi
fi

# Qwen3-Embedding-0.6B-Q4_K_M.gguf
EMBED_FILE="$MODEL_DIR/Qwen3-Embedding-0.6B-Q4_K_M.gguf"
download_asset "embedding" "Qwen3-Embedding-0.6B-Q4_K_M.gguf" "$EMBED_FILE" \
  "${SOURCE_URL}/enacimie/Qwen3-Embedding-0.6B-Q4_K_M-GGUF/resolve/main/qwen3-embedding-0.6b-q4_k_m.gguf"

# Qwen3-Embedding-0.6B-f16.gguf (~1.51 GB, highest precision)
EMBED_F16_FILE="$MODEL_DIR/Qwen3-Embedding-0.6B-f16.gguf"
download_asset "embedding-f16" "Qwen3-Embedding-0.6B-f16.gguf" "$EMBED_F16_FILE" \
  "${SOURCE_URL}/Qwen/Qwen3-Embedding-0.6B-GGUF/resolve/main/Qwen3-Embedding-0.6B-f16.gguf"

# bge-reranker-v2-m3-q8_0.gguf (BGE reranker)
RERANK_FILE="$MODEL_DIR/bge-reranker-v2-m3-q8_0.gguf"
download_asset "reranker" "bge-reranker-v2-m3-q8_0.gguf" "$RERANK_FILE" \
  "${SOURCE_URL}/klnstpr/bge-reranker-v2-m3-Q8_0-GGUF/resolve/main/bge-reranker-v2-m3-q8_0.gguf"

VLM_DIR="$MODEL_DIR/qwenvl"
mkdir -p "$VLM_DIR"

# Qwen3VL-2B-Instruct-Q4_K_M.gguf
VLM_MODEL_FILE="$VLM_DIR/Qwen3VL-2B-Instruct-Q4_K_M.gguf"
download_asset "vlm" "Qwen3VL-2B-Instruct-Q4_K_M.gguf" "$VLM_MODEL_FILE" \
  "${SOURCE_URL}/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/main/Qwen3VL-2B-Instruct-Q4_K_M.gguf"

# mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf
VLM_MMPROJ_FILE="$VLM_DIR/mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf"
download_asset "vlm-mmproj" "mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf" "$VLM_MMPROJ_FILE" \
  "${SOURCE_URL}/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/main/mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf"

emit_progress "all-complete" "all" "done"
echo "All required models downloaded."

