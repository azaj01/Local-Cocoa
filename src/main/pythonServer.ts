import { spawn, ChildProcess, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { config } from './config';
import { createDebugLogger } from './debug';

export class PythonServer {
    private process: ChildProcess | null = null;
    private executablePath: string;
    private scriptPath: string;

    constructor() {
        this.scriptPath = config.paths.backendScript;
        
        // In production, look for the PyInstaller bundle
        if (!config.isDev) {
            const resourcesPath = process.resourcesPath;
            // PyInstaller creates a folder with the executable inside
            // On Windows it's .exe, on macOS/Linux no extension
            const exeName = process.platform === 'win32' ? 'local_rag_server.exe' : 'local_rag_server';
            const bundlePath = path.join(resourcesPath, 'local_rag_dist', 'local_rag_server', exeName);
            if (fs.existsSync(bundlePath)) {
                this.executablePath = bundlePath;
            } else {
                // Fallback to the shell/ps1 script
                this.executablePath = '';
            }
        } else {
            this.executablePath = '';
        }
    }

    async start(envOverrides: Record<string, string> = {}): Promise<void> {
        const debugLog = createDebugLogger('PythonServer');

        if (this.process) {
            console.log('[Backend] Python server already running');
            return;
        }

        // In dev mode, we usually run the backend separately via npm script.
        if (config.isDev) {
            console.log('[Backend] Dev mode: Skipping Python server start');
            return;
        }

        const port = config.ports.backend;

        // Kill any existing process on the backend port
        try {
            if (process.platform === 'win32') {
                const output = execSync(`netstat -ano | findstr :${port}`).toString();
                const lines = output.split('\n');
                for (const line of lines) {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length > 4 && parts[1].endsWith(`:${port}`)) {
                        const pid = parts[parts.length - 1];
                        if (pid && pid !== '0') {
                            execSync(`taskkill /F /PID ${pid}`);
                        }
                    }
                }
            } else {
                const pid = execSync(`lsof -t -i:${port}`).toString().trim();
                if (pid) {
                    execSync(`kill -9 ${pid}`);
                }
            }
        } catch (e) {
            // No existing process found - this is expected
        }

        debugLog(`Starting from ${this.scriptPath}`);

        const userDataPath = app.getPath('userData');
        const ragHome = path.join(userDataPath, 'local_rag');
        const milvusUri = path.join(ragHome, 'rag.milvus.db');

        // Ensure the directory exists
        if (!fs.existsSync(ragHome)) {
            console.log(`[Backend] Creating directory: ${ragHome}`);
            fs.mkdirSync(ragHome, { recursive: true });
        }

        // Force kill any process holding the database file
        try {
            if (process.platform !== 'win32') {
                const pids = execSync(`lsof -t "${milvusUri}"`).toString().trim().split('\n');
                for (const pid of pids) {
                    if (pid) {
                        execSync(`kill -9 ${pid}`);
                    }
                }
            }
        } catch (e) {
            // Ignore if no process found
        }

        // Clean up potential lock files from crashed sessions
        const lockFile = `${milvusUri}.lock`;
        if (fs.existsSync(lockFile)) {
            try {
                fs.unlinkSync(lockFile);
            } catch (e) {
                // ignore
            }
        }

        // Ensure PATH includes common system directories
        // This is important when launched from Finder (double-click .app) where PATH is minimal
        const systemPath = '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';
        const existingPath = process.env.PATH || '';
        const fullPath = existingPath ? `${existingPath}:${systemPath}` : systemPath;

        // Ensure logs directory exists in user data path
        const logsDir = path.join(userDataPath, 'logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }

        const env = {
            ...process.env,
            ...envOverrides,
            // Ensure essential environment variables are set for GUI-launched apps
            PATH: fullPath,
            HOME: process.env.HOME || app.getPath('home'),
            TMPDIR: process.env.TMPDIR || app.getPath('temp'),
            // Locale settings to avoid encoding issues
            LANG: process.env.LANG || 'en_US.UTF-8',
            LC_ALL: process.env.LC_ALL || 'en_US.UTF-8',
            // App-specific environment variables (use absolute paths for packaged apps)
            LOCAL_RAG_PORT: config.ports.backend.toString(),
            LOCAL_RAG_HOME: ragHome,
            LOCAL_MILVUS_URI: milvusUri,
            LOCAL_QDRANT_PATH: path.join(ragHome, 'qdrant_data'),
            LOCAL_AGENT_LOG_PATH: path.join(logsDir, 'local_agent.log'),
            LOCAL_LLM_URL: process.env.LOCAL_LLM_URL ?? `http://127.0.0.1:${config.ports.vlm}`,
            LOCAL_VISION_URL: process.env.LOCAL_VISION_URL ?? `http://127.0.0.1:${config.ports.vlm}`,
            LOCAL_EMBEDDING_URL: process.env.LOCAL_EMBEDDING_URL ?? `http://127.0.0.1:${config.ports.embedding}`,
            LOCAL_RERANK_URL: process.env.LOCAL_RERANK_URL ?? `http://127.0.0.1:${config.ports.reranker}`,
            PYTHONUNBUFFERED: '1'
        };

        try {
            if (this.executablePath && fs.existsSync(this.executablePath)) {
                // Use PyInstaller executable directly
                debugLog(`Using PyInstaller executable: ${this.executablePath}`);
                this.process = spawn(this.executablePath, [], {
                    env,
                    stdio: ['ignore', 'pipe', 'pipe']
                });
            } else if (process.platform === 'win32') {
                // Windows fallback to PowerShell script
                this.process = spawn('powershell.exe', ['-ExecutionPolicy', 'Bypass', '-File', this.scriptPath], {
                    env,
                    stdio: ['ignore', 'pipe', 'pipe']
                });
            } else {
                // Unix fallback to shell script
                debugLog(`Using shell script: ${this.scriptPath}`);
                this.process = spawn('/bin/bash', [this.scriptPath], {
                    env,
                    stdio: ['ignore', 'pipe', 'pipe']
                });
            }
            debugLog(`Spawned PID: ${this.process?.pid}`);
        } catch (spawnError: any) {
            debugLog(`ERROR: ${spawnError.message}`);
            throw spawnError;
        }

        this.process.stdout?.on('data', (data) => {
            debugLog(`stdout: ${data.toString().trim()}`);
        });

        this.process.stderr?.on('data', (data) => {
            debugLog(`stderr: ${data.toString().trim()}`);
        });

        this.process.on('error', (err) => {
            debugLog(`ERROR: ${err.message}`);
            this.process = null;
        });

        this.process.on('close', (code) => {
            if (code !== 0) {
                debugLog(`Exited with code ${code}`);
            }
            this.process = null;
        });

        // Wait for the backend to be ready (key file created)
        const keyPath = path.join(ragHome, 'local_key.txt');
        await this.waitForReady(keyPath, port, debugLog);
    }

    private async waitForReady(keyPath: string, port: number, debugLog: (msg: string) => void, timeoutMs: number = 30000): Promise<void> {
        const startTime = Date.now();
        const checkInterval = 500;

        while (Date.now() - startTime < timeoutMs) {
            if (!this.process) {
                debugLog('Backend exited unexpectedly');
                throw new Error('Backend process exited unexpectedly');
            }

            if (fs.existsSync(keyPath)) {
                try {
                    const response = await fetch(`http://127.0.0.1:${port}/health`, {
                        method: 'GET',
                        signal: AbortSignal.timeout(2000)
                    });
                    if (response.ok || response.status === 403) {
                        debugLog('Backend ready');
                        return;
                    }
                } catch (e) {
                    // Server not ready yet
                }
            }

            await new Promise(resolve => setTimeout(resolve, checkInterval));
        }

        debugLog('Timeout waiting for backend');
    }

    stop() {
        if (this.process) {
            console.log('Stopping Python server...');
            if (process.platform === 'win32') {
                // On Windows, we might need to kill the process tree
                execSync(`taskkill /pid ${this.process.pid} /T /F`);
            } else {
                this.process.kill('SIGKILL');
            }
            this.process = null;
        }
    }
}
