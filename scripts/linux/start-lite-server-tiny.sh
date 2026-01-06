#!/usr/bin/env bash
set -euo pipefail

# Lightweight launcher for the local RAG helper services.
# Starts only the llama.cpp based endpoints needed by the desktop app.

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$ROOT_DIR/runtime"
LOG_DIR="$RUNTIME_DIR/logs"
MODEL_ROOT="${MODEL_ROOT:-$RUNTIME_DIR/local-cocoa-models/pretrained}"
MODEL_BOOTSTRAP_SCRIPT="$ROOT_DIR/script/download_tiny_models.sh"

LLAMA_SERVER_BIN="$ROOT_DIR/runtime/llama-cpp/bin/llama-server"
THREADS="${LLAMA_THREADS:-4}"
NGL="${LLAMA_NGL:-999}"
CTX_TOKENS="${LLAMA_CTX:-${LLAMA_CONTEXT_TOKENS:-${LOCAL_LLM_CONTEXT_TOKENS:-32768}}}"

if ! [[ "$CTX_TOKENS" =~ ^[0-9]+$ ]]; then
    echo "Invalid LLAMA context token value: $CTX_TOKENS" >&2
    exit 1
fi

PROMPT_CACHE_FLAGS=()
PROMPT_CACHE_SETTING="${LLAMA_PROMPT_CACHE:-0}"
if [[ "$PROMPT_CACHE_SETTING" == "0" || "$PROMPT_CACHE_SETTING" == "false" ]]; then
    PROMPT_CACHE_FLAGS+=(--cache-ram 0)
elif [[ -n "$PROMPT_CACHE_SETTING" ]]; then
    PROMPT_CACHE_FLAGS+=(--cache-ram "$PROMPT_CACHE_SETTING")
fi
if [[ -n "${LLAMA_PROMPT_CACHE_PATH:-}" ]]; then
    PROMPT_CACHE_FLAGS+=(--prompt-cache "${LLAMA_PROMPT_CACHE_PATH}")
fi

SERVICE_HOST="${SERVICE_HOST:-127.0.0.1}"

EMBED_MODEL="${EMBED_MODEL_PATH:-$MODEL_ROOT/Qwen3-Embedding-0.6B-Q4_K_M.gguf}"
EMBED_PORT="${EMBED_PORT:-8005}"

RERANK_MODEL="${RERANK_MODEL_PATH:-$MODEL_ROOT/bge-reranker-v2-m3-q8_0.gguf}"
RERANK_PORT="${RERANK_PORT:-8006}"
RERANK_N_UBATCH="${RERANK_N_UBATCH:-2048}"

VLM_MODEL="${VLM_MODEL_PATH:-$MODEL_ROOT/qwenvl/Qwen3VL-2B-Instruct-Q4_K_M.gguf}"
VLM_MMPROJ="${VLM_MMPROJ_PATH:-$MODEL_ROOT/qwenvl/mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf}"
VLM_PORT="${VLM_PORT:-8007}"

mkdir -p "$LOG_DIR"
mkdir -p "$MODEL_ROOT"

declare -a CLEANUP_LABELS=()
declare -a CLEANUP_PIDS=()
LAST_PID=""
CLEANED_UP=0

check_exists() {
    if [[ ! -f "$1" ]]; then
        echo "Missing required file: $1" >&2
        exit 1
    fi
}

check_exec() {
    if [[ ! -x "$1" ]]; then
        echo "Missing executable permission or binary: $1" >&2
        exit 1
    fi
}

start_once() {
    local name="$1"
    local match="$2"
    shift 2

    LAST_PID=""

    if pgrep -f "$match" >/dev/null 2>&1; then
        echo "$name already running"
        return 0
    fi

    echo "Starting $name"
    "$@" &
    LAST_PID=$!

    sleep 1
    if ! kill -0 "$LAST_PID" >/dev/null 2>&1; then
        echo "Failed to start $name (pid $LAST_PID). Check logs in $LOG_DIR." >&2
        LAST_PID=""
        return 1
    fi
}

register_service() {
    CLEANUP_LABELS+=("$1")
    CLEANUP_PIDS+=("$2")
}

cleanup() {
    if [[ $CLEANED_UP -eq 1 ]]; then
        return
    fi
    CLEANED_UP=1

    if [[ ${#CLEANUP_PIDS[@]} -gt 0 ]]; then
        echo
        echo "Stopping services..."
        local idx pid label
        for idx in "${!CLEANUP_PIDS[@]}"; do
            pid="${CLEANUP_PIDS[$idx]}"
            label="${CLEANUP_LABELS[$idx]}"
            if kill -0 "$pid" >/dev/null 2>&1; then
                echo "- $label (pid $pid)"
                kill "$pid" >/dev/null 2>&1 || true
            fi
        done

        wait "${CLEANUP_PIDS[@]}" 2>/dev/null || true

        for idx in "${!CLEANUP_PIDS[@]}"; do
            pid="${CLEANUP_PIDS[$idx]}"
            label="${CLEANUP_LABELS[$idx]}"
            if kill -0 "$pid" >/dev/null 2>&1; then
                echo "- Forcing $label (pid $pid)"
                kill -9 "$pid" >/dev/null 2>&1 || true
            fi
        done
    fi
}

trap 'cleanup; exit 0' SIGINT SIGTERM
trap cleanup EXIT

missing_model_entries=()

record_missing_model() {
    local label="$1"
    local path="$2"
    local optional="${3:-0}"
    if [[ -z "$path" ]]; then
        return
    fi
    if [[ ! -s "$path" ]]; then
        if [[ "$optional" != "1" ]]; then
            missing_model_entries+=("$label at $path")
        fi
    fi
}

ensure_model_files() {
    local attempt
    for attempt in 1 2; do
        missing_model_entries=()
        record_missing_model "Embedding model" "$EMBED_MODEL"
        record_missing_model "Reranker model" "$RERANK_MODEL"
        record_missing_model "VLM model" "$VLM_MODEL"
        record_missing_model "VLM mmproj" "$VLM_MMPROJ"

        if [[ ${#missing_model_entries[@]} -eq 0 ]]; then
            return
        fi

        if [[ $attempt -eq 2 ]]; then
            echo "Missing required model files despite download attempt:" >&2
            local entry
            for entry in "${missing_model_entries[@]}"; do
                echo " - $entry" >&2
            done
            exit 1
        fi

        if [[ ! -f "$MODEL_BOOTSTRAP_SCRIPT" ]]; then
            echo "Download helper not found at $MODEL_BOOTSTRAP_SCRIPT" >&2
            exit 1
        fi

        echo "Detected missing model files. Running bootstrap script to fetch them..."
        MODEL_DIR="$MODEL_ROOT" bash "$MODEL_BOOTSTRAP_SCRIPT"
    done
}

ensure_model_files

check_exec "$LLAMA_SERVER_BIN"
check_exists "$EMBED_MODEL"
check_exists "$RERANK_MODEL"
check_exists "$VLM_MODEL"
check_exists "$VLM_MMPROJ"
if ! [[ "$RERANK_N_UBATCH" =~ ^[0-9]+$ ]]; then
    echo "Invalid reranker micro-batch value: $RERANK_N_UBATCH" >&2
    exit 1
fi

start_once "Embedding server" "--port $EMBED_PORT --embedding" \
    nohup "$LLAMA_SERVER_BIN" \
        -m "$EMBED_MODEL" \
        --embedding \
        --pooling cls \
        --host "$SERVICE_HOST" \
        --port "$EMBED_PORT" \
        -c "$CTX_TOKENS" \
        -t "$THREADS" \
        -ngl "$NGL" \
        "${PROMPT_CACHE_FLAGS[@]}" \
        >"$LOG_DIR/embedding-lite.log" 2>&1
if [[ -n "$LAST_PID" ]]; then
    register_service "Embedding server" "$LAST_PID"
fi

start_once "Reranker server" "--port $RERANK_PORT --reranking" \
    nohup "$LLAMA_SERVER_BIN" \
        -m "$RERANK_MODEL" \
        --reranking \
        --host "$SERVICE_HOST" \
        --port "$RERANK_PORT" \
        -c "$CTX_TOKENS" \
        -t "$THREADS" \
        -ngl "$NGL" \
    -ub "$RERANK_N_UBATCH" \
        "${PROMPT_CACHE_FLAGS[@]}" \
        >"$LOG_DIR/reranker-lite.log" 2>&1
if [[ -n "$LAST_PID" ]]; then
    register_service "Reranker server" "$LAST_PID"
fi

start_once "Vision-language server" "--port $VLM_PORT --mmproj" \
    nohup "$LLAMA_SERVER_BIN" \
        -m "$VLM_MODEL" \
        --mmproj "$VLM_MMPROJ" \
        --host "$SERVICE_HOST" \
        --port "$VLM_PORT" \
        -c "$CTX_TOKENS" \
        -t "$THREADS" \
        -ngl "$NGL" \
        "${PROMPT_CACHE_FLAGS[@]}" \
        >"$LOG_DIR/vlm-lite.log" 2>&1
if [[ -n "$LAST_PID" ]]; then
    register_service "Vision-language server" "$LAST_PID"
fi

export LOCAL_LLM_URL="http://$SERVICE_HOST:$VLM_PORT"
export LOCAL_EMBEDDING_URL="http://$SERVICE_HOST:$EMBED_PORT"
export LOCAL_RERANK_URL="http://$SERVICE_HOST:$RERANK_PORT"
export LOCAL_VISION_URL="http://$SERVICE_HOST:$VLM_PORT"
export LOCAL_MILVUS_DIM="${LOCAL_MILVUS_DIM:-1024}"
export LOCAL_EMBEDDING_MODEL="${LOCAL_EMBEDDING_MODEL:-Qwen3-Embedding-0.6B-Q4_K_M}"

echo
echo "Lite services running (Ctrl+C to stop):"
for label in "${CLEANUP_LABELS[@]}"; do
    echo "- $label"
done
echo
echo "LOCAL_LLM_URL=$LOCAL_LLM_URL (using VLM for all LLM tasks)"
printf 'LOCAL_EMBEDDING_URL=%s\n' "$LOCAL_EMBEDDING_URL"
printf 'LOCAL_RERANK_URL=%s\n' "$LOCAL_RERANK_URL"
printf 'LOCAL_VISION_URL=%s\n' "$LOCAL_VISION_URL"
printf 'LOCAL_MILVUS_DIM=%s\n' "$LOCAL_MILVUS_DIM"
printf 'LOCAL_EMBEDDING_MODEL=%s\n' "$LOCAL_EMBEDDING_MODEL"

echo
while true; do
    sleep 3600
done
