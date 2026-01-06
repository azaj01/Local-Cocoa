[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0, HelpMessage = "The root directory")]
    [string]$ROOT_DIR,

    [Parameter(Mandatory = $true, Position = 1, HelpMessage = "The directory to download models to")]
    [string]$MODEL_DIR
)

$ErrorActionPreference = "Stop"

# Define the mirror URLs
$HF_MAIN_URL = "https://huggingface.co"
$HF_CN_1 = "https://hf-mirror.com"  # You can use actual Chinese mirrors here

$WGET_BIN = $env:WGET_BIN -or "wget"
$WGET_PROGRESS = $env:WGET_PROGRESS -or "dot:mega"

# Create the target directory
New-Item -ItemType Directory -Force -Path $MODEL_DIR

# Emit progress to standard output
function Emit-Progress {
    param (
        [string]$Event,
        [string]$Asset,
        [string]$Detail = ""
    )
    Write-Host "::MODEL_PROGRESS::$Event::$Asset::$Detail"
}

# Ensure wget is installed
function Ensure-Wget {
    if (-not (Get-Command $WGET_BIN -ErrorAction SilentlyContinue)) {
        Write-Error "wget is required but was not found in PATH."
        Emit-Progress "error" "bootstrap" "wget_missing"
        exit 1
    }
}

# Check if file has a payload (is non-empty)
function File-HasPayload {
    param (
        [string]$Target
    )
    if (-not (Test-Path $Target)) {
        return $false
    }
    $size = (Get-Item $Target).length
    return $size -gt 0
}

# Check site accessibility
function Check-Site-Accessibility {
    param (
        [string]$Url
    )
    try {
        $response = Invoke-WebRequest -Uri $Url -Method Head -TimeoutSec 5 -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            Write-Host "Site $Url is accessible."
            return $true
        }
    }
    catch {
        Write-Host "Site $Url is not accessible."
        return $false
    }
}

# Download asset from a URL
function Download-Asset {
    param (
        [string]$AssetId,
        [string]$Label,
        [string]$Target,
        [string]$Url
    )

    Emit-Progress "check" $AssetId $Target
    if (File-HasPayload $Target) {
        Write-Host "$Label already exists and is not empty, skipping download."
        Emit-Progress "skip" $AssetId "exists"
        return
    }

    # Create directory for the target file
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Target)

    Write-Host "Downloading $Label..."
    Emit-Progress "download-start" $AssetId $Url
    Invoke-WebRequest -Uri $Url -OutFile $Target -ProgressVariable prog | Out-Null
    Emit-Progress "download-complete" $AssetId $Target
}

# Ensure wget is available
Ensure-Wget

# Check if the Hugging Face main site is accessible
if (Check-Site-Accessibility $HF_MAIN_URL) {
    $SOURCE_URL = $HF_MAIN_URL
}
elseif (Check-Site-Accessibility $HF_CN_1) {
    $SOURCE_URL = $HF_CN_1
}
else {
    Write-Error "No accessible Hugging Face mirrors found."
    exit 1
}

# Model download paths
$EMBED_FILE = Join-Path $MODEL_DIR "Qwen3-Embedding-0.6B-Q4_K_M.gguf"
Download-Asset "embedding" "Qwen3-Embedding-0.6B-Q4_K_M.gguf" $EMBED_FILE `
    "$SOURCE_URL/enacimie/Qwen3-Embedding-0.6B-Q4_K_M-GGUF/resolve/main/qwen3-embedding-0.6b-q4_k_m.gguf"

$RERANK_FILE = Join-Path $MODEL_DIR "bge-reranker-v2-m3-q8_0.gguf"
Download-Asset "reranker" "bge-reranker-v2-m3-q8_0.gguf" $RERANK_FILE `
    "$SOURCE_URL/klnstpr/bge-reranker-v2-m3-Q8_0-GGUF/resolve/main/bge-reranker-v2-m3-q8_0.gguf"

$VLM_DIR = Join-Path $MODEL_DIR "qwenvl"
New-Item -ItemType Directory -Force -Path $VLM_DIR

$VLM_MODEL_FILE = Join-Path $VLM_DIR "Qwen3VL-2B-Instruct-Q4_K_M.gguf"
Download-Asset "vlm" "Qwen3VL-2B-Instruct-Q4_K_M.gguf" $VLM_MODEL_FILE `
    "$SOURCE_URL/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/main/Qwen3VL-2B-Instruct-Q4_K_M.gguf"

$VLM_MMPROJ_FILE = Join-Path $VLM_DIR "mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf"
Download-Asset "vlm-mmproj" "mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf" $VLM_MMPROJ_FILE `
    "$SOURCE_URL/Qwen/Qwen3-VL-2B-Instruct-GGUF/resolve/main/mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf"

Emit-Progress "all-complete" "all" "done"
Write-Host "All required models downloaded."

# Now copying the rest of the directories and files as described in your second script section

# Find Python and check if it's available
$PYTHON_BIN = Get-Command python -ErrorAction SilentlyContinue
if (-not $PYTHON_BIN) {
    $PYTHON_BIN = Get-Command py -ErrorAction SilentlyContinue
}

if (-not $PYTHON_BIN) {
    Write-Error "Python not found. Please install Python."
    exit 1
}

Write-Host "Using Python: $($PYTHON_BIN.Source)"

# Prepare directories
$SOURCE_DIR = Join-Path $ROOT_DIR "services\local_rag_agent"
$DIST_DIR = Join-Path $ROOT_DIR "runtime\local_rag_dist"
$PACKAGE_NAME = "local_rag_agent"

if (-not (Test-Path $SOURCE_DIR)) {
    Write-Error "Source package not found: $SOURCE_DIR"
    exit 1
}

# Clean old dist directory
if (Test-Path $DIST_DIR) {
    Remove-Item -Path $DIST_DIR -Recurse -Force
}
New-Item -ItemType Directory -Path $DIST_DIR | Out-Null

# Copy source
$DEST_PACKAGE_DIR = Join-Path $DIST_DIR $PACKAGE_NAME
New-Item -ItemType Directory -Path $DEST_PACKAGE_DIR | Out-Null
Copy-Item -Path "$SOURCE_DIR\*" -Destination $DEST_PACKAGE_DIR -Recurse -Force -Exclude "__pycache__", "*.pyc", ".mypy_cache", ".pytest_cache", ".DS_Store"

# Handle requirements file
if (Test-Path (Join-Path $SOURCE_DIR "requirements.txt")) {
    Copy-Item -Path (Join-Path $SOURCE_DIR "requirements.txt") -Destination (Join-Path $DIST_DIR "requirements.txt")
}

# Handle llama-cpp binaries
$LLAMA_CPP_SRC = Join-Path $ROOT_DIR "runtime\llama-cpp"
$LLAMA_CPP_DEST = Join-Path $DIST_DIR "llama-cpp"
if (Test-Path $LLAMA_CPP_SRC) {
    New-Item -ItemType Directory -Path $LLAMA_CPP_DEST | Out-Null
    Get-ChildItem -Path $LLAMA_CPP_SRC -Include "*.exe", "*.dll", "LICENSE*" -Recurse | Copy-Item -Destination $LLAMA_CPP_DEST
    Write-Host "Copied llama-cpp binaries into $LLAMA_CPP_DEST."
} else {
    Write-Warning "llama-cpp not found at $LLAMA_CPP_SRC; skipping binary bundle."
}

# Create venv
Write-Host "Creating venv..."
& $PYTHON_BIN -m venv (Join-Path $DIST_DIR "venv")

$VENV_PY = Join-Path $DIST_DIR "venv\Scripts\python.exe"
$VENV_PIP = Join-Path $DIST_DIR "venv\Scripts\pip.exe"

# Install dependencies
Write-Host "Installing dependencies..."
& $VENV_PY -m pip install --upgrade pip wheel
if (Test-Path (Join-Path $DIST_DIR "requirements.txt")) {
    & $VENV_PIP install -r (Join-Path $DIST_DIR "requirements.txt")
}

# Freeze lockfile
& $VENV_PIP freeze > (Join-Path $DIST_DIR "requirements.lock")

# Compile all Python files
& $VENV_PY -m compileall $DIST_DIR

# Create run.ps1
$RUN_PS1 = Join-Path $DIST_DIR "run.ps1"
$RUN_PS1_CONTENT = @"
`$ErrorActionPreference = "Stop"
`$ROOT_DIR = `$PSScriptRoot
`$VENV_DIR = Join-Path `$ROOT_DIR "venv"
`$PYTHON_BIN = Join-Path `$VENV_DIR "Scripts\python.exe"
`$UVICORN_BIN = Join-Path `$VENV_DIR "Scripts\uvicorn.exe"

if (-not (Test-Path `$PYTHON_BIN)) {
    Write-Error "Virtualenv missing or incomplete."
    exit 1
}

`$env:PYTHONPATH = `$ROOT_DIR
& `$UVICORN_BIN local_rag_agent.app:app --host 127.0.0.1 --port 8890 @args
"@
Set-Content -Path $RUN_PS1 -Value $RUN_PS1_CONTENT

Write-Host "Packaged $PACKAGE_NAME into $DIST_DIR"

