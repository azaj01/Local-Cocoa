import { spawn, ChildProcess, execSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { app } from 'electron';
import { config } from './config';
import { createDebugLogger } from './debug';

/**
 * MCP Server Manager
 *
 * Manages the MCP (Model Context Protocol) server that allows Claude Desktop
 * to interact with Local Cocoa's capabilities.
 */
export class MCPServer {
    private process: ChildProcess | null = null;
    private pythonPath: string = '';
    private serverPath: string;

    constructor() {
        // Path to the MCP server module
        if (config.isDev) {
            this.serverPath = path.join(config.projectRoot, 'services', 'mcp_server');
        } else {
            // In production, look for bundled MCP server
            this.serverPath = path.join(process.resourcesPath, 'mcp_server');
        }
    }

    /**
     * Find Python executable
     */
    private findPython(): string {
        const debugLog = createDebugLogger('MCPServer');

        // Check for virtual environment in project
        const venvPaths = [
            path.join(config.projectRoot, '.venv', 'bin', 'python'),
            path.join(config.projectRoot, '.venv', 'Scripts', 'python.exe'),
            path.join(config.projectRoot, 'venv', 'bin', 'python'),
            path.join(config.projectRoot, 'venv', 'Scripts', 'python.exe'),
        ];

        for (const venvPath of venvPaths) {
            if (fs.existsSync(venvPath)) {
                debugLog(`Found Python in venv: ${venvPath}`);
                return venvPath;
            }
        }

        // Fall back to system Python
        try {
            if (process.platform === 'win32') {
                execSync('python --version', { stdio: 'ignore' });
                return 'python';
            } else {
                execSync('python3 --version', { stdio: 'ignore' });
                return 'python3';
            }
        } catch {
            try {
                execSync('python --version', { stdio: 'ignore' });
                return 'python';
            } catch {
                throw new Error('Python not found. Please install Python 3.10+');
            }
        }
    }

    /**
     * Get the MCP server script path
     */
    getServerScriptPath(): string {
        return this.serverPath;
    }

    /**
     * Get the Python executable path used for MCP server
     */
    getPythonPath(): string {
        if (!this.pythonPath) {
            this.pythonPath = this.findPython();
        }
        return this.pythonPath;
    }

    /**
     * Start the MCP server
     */
    async start(): Promise<void> {
        const debugLog = createDebugLogger('MCPServer');

        if (this.process) {
            debugLog('MCP server already running');
            return;
        }

        // In dev mode, MCP server is typically started separately or on-demand
        if (config.isDev) {
            debugLog('Dev mode: MCP server available for manual start');
            return;
        }

        try {
            this.pythonPath = this.findPython();
            debugLog(`Using Python: ${this.pythonPath}`);
            debugLog(`MCP server path: ${this.serverPath}`);

            const userDataPath = app.getPath('userData');
            const ragHome = path.join(userDataPath, 'local_rag');
            const keyPath = path.join(ragHome, 'local_key.txt');

            // Read API key
            let apiKey = '';
            if (fs.existsSync(keyPath)) {
                apiKey = fs.readFileSync(keyPath, 'utf-8').trim();
            }

            const env = {
                ...process.env,
                LOCAL_COCOA_API_KEY: apiKey,
                LOCAL_COCOA_BACKEND_URL: `http://127.0.0.1:${config.ports.backend}`,
                PYTHONPATH: path.dirname(this.serverPath),
                PYTHONUNBUFFERED: '1',
            };

            this.process = spawn(this.pythonPath, ['-m', 'mcp_server'], {
                cwd: path.dirname(this.serverPath),
                env,
                stdio: ['pipe', 'pipe', 'pipe'],
            });

            debugLog(`MCP server started with PID: ${this.process.pid}`);

            this.process.stdout?.on('data', (data) => {
                debugLog(`stdout: ${data.toString().trim()}`);
            });

            this.process.stderr?.on('data', (data) => {
                debugLog(`stderr: ${data.toString().trim()}`);
            });

            this.process.on('error', (err) => {
                debugLog(`Error: ${err.message}`);
                this.process = null;
            });

            this.process.on('close', (code) => {
                if (code !== 0) {
                    debugLog(`Exited with code ${code}`);
                }
                this.process = null;
            });
        } catch (error: any) {
            debugLog(`Failed to start MCP server: ${error.message}`);
            throw error;
        }
    }

    /**
     * Stop the MCP server
     */
    stop(): void {
        const debugLog = createDebugLogger('MCPServer');

        if (this.process) {
            debugLog('Stopping MCP server...');
            if (process.platform === 'win32') {
                try {
                    execSync(`taskkill /pid ${this.process.pid} /T /F`, { stdio: 'ignore' });
                } catch {
                    // Ignore errors
                }
            } else {
                this.process.kill('SIGTERM');
            }
            this.process = null;
        }
    }

    /**
     * Check if the MCP server is running
     */
    isRunning(): boolean {
        return this.process !== null;
    }

    /**
     * Generate Claude Desktop configuration for this MCP server
     */
    generateClaudeConfig(): object {
        const pythonPath = this.getPythonPath();
        const userDataPath = app.getPath('userData');
        const ragHome = path.join(userDataPath, 'local_rag');
        const keyPath = path.join(ragHome, 'local_key.txt');

        // Read API key if available
        let apiKey = '';
        if (fs.existsSync(keyPath)) {
            apiKey = fs.readFileSync(keyPath, 'utf-8').trim();
        }

        return {
            "local-cocoa": {
                "command": pythonPath,
                "args": ["-m", "mcp_server"],
                "cwd": path.dirname(this.serverPath),
                "env": {
                    "LOCAL_COCOA_API_KEY": apiKey,
                    "LOCAL_COCOA_BACKEND_URL": `http://127.0.0.1:${config.ports.backend}`,
                    "PYTHONPATH": path.dirname(this.serverPath),
                    "PYTHONUNBUFFERED": "1"
                }
            }
        };
    }

    /**
     * Get the full Claude Desktop config file path
     */
    static getClaudeConfigPath(): string {
        if (process.platform === 'darwin') {
            return path.join(
                app.getPath('home'),
                'Library',
                'Application Support',
                'Claude',
                'claude_desktop_config.json'
            );
        } else if (process.platform === 'win32') {
            return path.join(
                process.env.APPDATA || '',
                'Claude',
                'claude_desktop_config.json'
            );
        } else {
            return path.join(
                app.getPath('home'),
                '.config',
                'Claude',
                'claude_desktop_config.json'
            );
        }
    }
}
