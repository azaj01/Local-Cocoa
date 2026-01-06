$ErrorActionPreference = "Stop"

Write-Host "Setting up Python environment..."

# Check if python is available
if (-not (Get-Command "python" -ErrorAction SilentlyContinue)) {
    Write-Error "Python is not installed or not in PATH. Please install Python 3.10+."
    exit 1
}

# Create venv if it doesn't exist
if (-not (Test-Path ".venv")) {
    Write-Host "Creating virtual environment..."
    python -m venv .venv
} else {
    Write-Host "Virtual environment already exists."
}

# Activate and install requirements
$pip = ".venv\Scripts\pip.exe"
if (-not (Test-Path $pip)) {
    # Try linux style path just in case
    $pip = ".venv\bin\pip"
}

if (-not (Test-Path $pip)) {
    Write-Error "Could not find pip in virtual environment. Something went wrong with venv creation."
    exit 1
}

Write-Host "Installing dependencies..."
& $pip install -r services/local_rag_agent/requirements.txt

Write-Host "Setup complete! You can now run 'npm run dev'."
