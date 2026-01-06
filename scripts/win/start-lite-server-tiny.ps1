$ErrorActionPreference = "Stop"

# Lightweight launcher for the local RAG helper services.
# Starts only the llama.cpp based endpoints needed by the desktop app.

$ROOT_DIR = $PSScriptRoot

$LOG_DIR = Join-Path $RUNTIME_DIR "logs"
$MODEL_ROOT = if ($env:MODEL_ROOT) { $env:MODEL_ROOT } else { Join-Path $RUNTIME_DIR "local-cocoa-models\pretrained" }
$MODEL_BOOTSTRAP_SCRIPT = Join-Path $ROOT_DIR "scripts\win\download_tiny_models.ps1" # We might need a ps1 version of this too if it does complex things

$LLAMA_SERVER_BIN = Join-Path $RUNTIME_DIR "llama-cpp\bin\llama-server.exe"
$THREADS = if ($env:LLAMA_THREADS) { $env:LLAMA_THREADS } else { 4 }
$NGL = if ($env:LLAMA_NGL) { $env:LLAMA_NGL } else { 999 }
$CTX_TOKENS = if ($env:LLAMA_CTX) { $env:LLAMA_CTX } else { if ($env:LLAMA_CONTEXT_TOKENS) { $env:LLAMA_CONTEXT_TOKENS } else { if ($env:LOCAL_LLM_CONTEXT_TOKENS) { $env:LOCAL_LLM_CONTEXT_TOKENS } else { 32768 } } }

if ($CTX_TOKENS -notmatch '^\d+$') {
    Write-Error "Invalid LLAMA context token value: $CTX_TOKENS"
    exit 1
}

$PROMPT_CACHE_FLAGS = @()
$PROMPT_CACHE_SETTING = if ($env:LLAMA_PROMPT_CACHE) { $env:LLAMA_PROMPT_CACHE } else { "0" }
if ($PROMPT_CACHE_SETTING -eq "0" -or $PROMPT_CACHE_SETTING -eq "false") {
    $PROMPT_CACHE_FLAGS += "--cache-ram", "0"
}
elseif ($PROMPT_CACHE_SETTING) {
    $PROMPT_CACHE_FLAGS += "--cache-ram", "$PROMPT_CACHE_SETTING"
}
if ($env:LLAMA_PROMPT_CACHE_PATH) {
    $PROMPT_CACHE_FLAGS += "--prompt-cache", "$env:LLAMA_PROMPT_CACHE_PATH"
}

$SERVICE_HOST = if ($env:SERVICE_HOST) { $env:SERVICE_HOST } else { "127.0.0.1" }

$EMBED_MODEL = if ($env:EMBED_MODEL_PATH) { $env:EMBED_MODEL_PATH } else { Join-Path $MODEL_ROOT "Qwen3-Embedding-0.6B-Q4_K_M.gguf" }
$EMBED_PORT = if ($env:EMBED_PORT) { $env:EMBED_PORT } else { 8005 }

$RERANK_MODEL = if ($env:RERANK_MODEL_PATH) { $env:RERANK_MODEL_PATH } else { Join-Path $MODEL_ROOT "bge-reranker-v2-m3-q8_0.gguf" }
$RERANK_PORT = if ($env:RERANK_PORT) { $env:RERANK_PORT } else { 8006 }
$RERANK_N_UBATCH = if ($env:RERANK_N_UBATCH) { $env:RERANK_N_UBATCH } else { 2048 }

$VLM_MODEL = if ($env:VLM_MODEL_PATH) { $env:VLM_MODEL_PATH } else { Join-Path $MODEL_ROOT "qwenvl\Qwen3VL-2B-Instruct-Q4_K_M.gguf" }
$VLM_MMPROJ = if ($env:VLM_MMPROJ_PATH) { $env:VLM_MMPROJ_PATH } else { Join-Path $MODEL_ROOT "qwenvl\mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf" }
$VLM_PORT = if ($env:VLM_PORT) { $env:VLM_PORT } else { 8007 }

New-Item -ItemType Directory -Force -Path $LOG_DIR | Out-Null
New-Item -ItemType Directory -Force -Path $MODEL_ROOT | Out-Null

$CLEANUP_JOBS = @()

function Start-Once {
    param (
        [string]$Name,
        [string]$Match,
        [string[]]$Args
    )

    # Simple check if port is in use (approximate check for running service)
    # Parsing $Match to find port would be better but this is a quick port
    if ($Match -match "--port (\d+)") {
        $port = $Matches[1]
        $tcpConnection = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
        if ($tcpConnection) {
            Write-Host "$Name already running on port $port"
            return
        }
    }

    Write-Host "Starting $Name"
    $job = Start-Process -FilePath $LLAMA_SERVER_BIN -ArgumentList $Args -PassThru -NoNewWindow -RedirectStandardOutput (Join-Path $LOG_DIR "$($Name -replace ' ','').log") -RedirectStandardError (Join-Path $LOG_DIR "$($Name -replace ' ','').err.log")
    
    Start-Sleep -Seconds 1
    if ($job.HasExited) {
        Write-Error "Failed to start $Name. Check logs in $LOG_DIR."
        return
    }
    $script:CLEANUP_JOBS += $job
}

function Cleanup {
    Write-Host "`nStopping services..."
    foreach ($job in $script:CLEANUP_JOBS) {
        if (-not $job.HasExited) {
            Stop-Process -Id $job.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

# Register cleanup on exit
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -SupportEvent -Action { Cleanup }

function Check-Exists {
    param ([string]$Path)
    if (-not (Test-Path $Path)) {
        Write-Error "Missing required file: $Path"
        exit 1
    }
}

function Check-Exec {
    param ([string]$Path)
    if (-not (Test-Path $Path)) {
        Write-Error "Missing executable: $Path"
        exit 1
    }
}

# Ensure models (simplified version of bash script logic)
# We assume models are present or user runs download script manually for now, 
# or we could try to run the bash script via git bash if available.
if (-not (Test-Path $EMBED_MODEL) -or -not (Test-Path $RERANK_MODEL) -or -not (Test-Path $VLM_MODEL)) {
    Write-Host "Detected missing model files. Please run download_tiny_models.sh (using Git Bash) to fetch them."
    # Attempt to run bash script if bash is in path
    if (Get-Command "bash" -ErrorAction SilentlyContinue) {
        Write-Host "Attempting to run download_tiny_models.sh..."
        bash $MODEL_BOOTSTRAP_SCRIPT
    }
    else {
        Write-Error "Bash not found. Cannot auto-download models."
        exit 1
    }
}

Check-Exec $LLAMA_SERVER_BIN
Check-Exists $EMBED_MODEL
Check-Exists $RERANK_MODEL
Check-Exists $VLM_MODEL
Check-Exists $VLM_MMPROJ

Start-Once -Name "Embedding server" -Match "--port $EMBED_PORT" -Args "-m", "$EMBED_MODEL", "--embedding", "--pooling", "cls", "--host", "$SERVICE_HOST", "--port", "$EMBED_PORT", "-c", "$CTX_TOKENS", "-t", "$THREADS", "-ngl", "$NGL", $PROMPT_CACHE_FLAGS

Start-Once -Name "Reranker server" -Match "--port $RERANK_PORT" -Args "-m", "$RERANK_MODEL", "--reranking", "--host", "$SERVICE_HOST", "--port", "$RERANK_PORT", "-c", "$CTX_TOKENS", "-t", "$THREADS", "-ngl", "$NGL", "-ub", "$RERANK_N_UBATCH", $PROMPT_CACHE_FLAGS

Start-Once -Name "Vision-language server" -Match "--port $VLM_PORT" -Args "-m", "$VLM_MODEL", "--mmproj", "$VLM_MMPROJ", "--host", "$SERVICE_HOST", "--port", "$VLM_PORT", "-c", "$CTX_TOKENS", "-t", "$THREADS", "-ngl", "$NGL", $PROMPT_CACHE_FLAGS

$env:LOCAL_LLM_URL = "http://$SERVICE_HOST:$VLM_PORT"
$env:LOCAL_EMBEDDING_URL = "http://$SERVICE_HOST:$EMBED_PORT"
$env:LOCAL_RERANK_URL = "http://$SERVICE_HOST:$RERANK_PORT"
$env:LOCAL_VISION_URL = "http://$SERVICE_HOST:$VLM_PORT"
$env:LOCAL_MILVUS_DIM = if ($env:LOCAL_MILVUS_DIM) { $env:LOCAL_MILVUS_DIM } else { "1024" }
$env:LOCAL_EMBEDDING_MODEL = if ($env:LOCAL_EMBEDDING_MODEL) { $env:LOCAL_EMBEDDING_MODEL } else { "Qwen3-Embedding-0.6B-Q4_K_M" }

Write-Host "`nLite services running..."
Write-Host "LOCAL_LLM_URL=$env:LOCAL_LLM_URL"
Write-Host "LOCAL_EMBEDDING_URL=$env:LOCAL_EMBEDDING_URL"
Write-Host "LOCAL_RERANK_URL=$env:LOCAL_RERANK_URL"
Write-Host "LOCAL_VISION_URL=$env:LOCAL_VISION_URL"

Write-Host "Press Ctrl+C to stop."
while ($true) {
    Start-Sleep -Seconds 1
}
