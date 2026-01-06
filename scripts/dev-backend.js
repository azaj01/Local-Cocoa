const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const dotenv = require('dotenv');
const dotenvExpand = require('dotenv-expand');

const isWin = os.platform() === 'win32';
const rootDir = path.resolve(__dirname, '..');
const venvDir = path.join(rootDir, '.venv');

// Load .env configuration
dotenvExpand.expand(dotenv.config({ path: path.join(rootDir, 'config', `.env`) }));
dotenvExpand.expand(dotenv.config({ path: path.join(rootDir, 'config', `.env.dev`) }));

// Determine Python executable path
let pythonPath;
if (isWin) {
    // Try standard venv path first
    pythonPath = path.join(venvDir, 'Scripts', 'python.exe');
    
    // If not found, check if user used 'python -m venv' which might put it in root or bin? 
    // Standard Windows venv is .venv/Scripts/python.exe
    if (!fs.existsSync(pythonPath)) {
        // Fallback: maybe they named it differently or it's not created yet
        // Try to find python in path
        console.warn(`Virtual environment python not found at ${pythonPath}.`);
    }
} else {
    pythonPath = path.join(venvDir, 'bin', 'python');
}

// Fallback to system python if venv doesn't exist (though venv is recommended)
if (!fs.existsSync(pythonPath)) {
    console.warn(`Virtual environment not found at ${pythonPath}. Trying system python...`);
    // On Windows, 'python' usually refers to the global python launcher or executable
    // We need to make sure we are using the one that has the dependencies installed.
    // If the user installed deps globally, 'python' is fine.
    // If they installed in a venv but we can't find it, this will fail.
    pythonPath = isWin ? 'python' : 'python3';
}

// Environment variables
const env = {
    ...process.env,
    LOCAL_PDF_MODE: 'vision',
    LOCAL_VISION_URL: 'http://127.0.0.1:8007',
    LOCAL_LLM_URL: 'http://127.0.0.1:8007',
    LOCAL_EMBEDDING_URL: 'http://127.0.0.1:8005',
    LOCAL_RERANK_URL: 'http://127.0.0.1:8006',
    PYTHONUNBUFFERED: '1',
    PYTHONPATH: path.join(rootDir, 'services') // Absolute path is safer
};

// Arguments for uvicorn
const args = [
    '-m', 'uvicorn',
    'local_rag_agent.app:app',
    '--host', '127.0.0.1',
    '--port', '8890',
    '--reload'
];

console.log(`Starting backend with: ${pythonPath} ${args.join(' ')}`);

const child = spawn(pythonPath, args, {
    env: env,
    stdio: 'inherit',
    cwd: rootDir
});

child.on('error', (err) => {
    console.error('Failed to start backend process:', err);
});

child.on('exit', (code) => {
    process.exit(code);
});
