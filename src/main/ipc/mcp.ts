import { ipcMain, shell } from 'electron';
import fs from 'fs';
import path from 'path';
import { MCPServer } from '../mcpServer';

let mcpServer: MCPServer | null = null;

/**
 * Initialize the MCP server instance
 */
export function initMCPServer(): MCPServer {
    if (!mcpServer) {
        mcpServer = new MCPServer();
    }
    return mcpServer;
}

/**
 * Get the MCP server instance
 */
export function getMCPServer(): MCPServer | null {
    return mcpServer;
}

/**
 * Register MCP-related IPC handlers
 */
export function registerMCPHandlers(): void {
    // Get Claude Desktop config for Local Cocoa MCP
    ipcMain.handle('mcp:get-claude-config', async () => {
        const server = initMCPServer();
        return server.generateClaudeConfig();
    });

    // Get Claude Desktop config file path
    ipcMain.handle('mcp:get-claude-config-path', async () => {
        return MCPServer.getClaudeConfigPath();
    });

    // Check if Claude Desktop config exists
    ipcMain.handle('mcp:check-claude-config', async () => {
        const configPath = MCPServer.getClaudeConfigPath();
        return fs.existsSync(configPath);
    });

    // Install MCP config to Claude Desktop
    ipcMain.handle('mcp:install-to-claude', async () => {
        const server = initMCPServer();
        const configPath = MCPServer.getClaudeConfigPath();
        const mcpConfig = server.generateClaudeConfig();

        try {
            // Ensure directory exists
            const configDir = path.dirname(configPath);
            if (!fs.existsSync(configDir)) {
                fs.mkdirSync(configDir, { recursive: true });
            }

            // Read existing config or create new
            let existingConfig: Record<string, unknown> = {};
            if (fs.existsSync(configPath)) {
                const content = fs.readFileSync(configPath, 'utf-8');
                existingConfig = JSON.parse(content);
            }

            // Merge MCP servers
            const mcpServers = existingConfig.mcpServers as Record<string, unknown> || {};
            Object.assign(mcpServers, mcpConfig);
            existingConfig.mcpServers = mcpServers;

            // Write back
            fs.writeFileSync(configPath, JSON.stringify(existingConfig, null, 2));

            return { success: true, path: configPath };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    // Remove MCP config from Claude Desktop
    ipcMain.handle('mcp:uninstall-from-claude', async () => {
        const configPath = MCPServer.getClaudeConfigPath();

        try {
            if (!fs.existsSync(configPath)) {
                return { success: true };
            }

            const content = fs.readFileSync(configPath, 'utf-8');
            const config = JSON.parse(content);

            // Remove local-cocoa from mcpServers
            if (config.mcpServers && config.mcpServers['local-cocoa']) {
                delete config.mcpServers['local-cocoa'];
            }

            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

            return { success: true };
        } catch (error: any) {
            return { success: false, error: error.message };
        }
    });

    // Check if MCP is installed in Claude Desktop
    ipcMain.handle('mcp:is-installed', async () => {
        const configPath = MCPServer.getClaudeConfigPath();

        try {
            if (!fs.existsSync(configPath)) {
                return false;
            }

            const content = fs.readFileSync(configPath, 'utf-8');
            const config = JSON.parse(content);

            return !!(config.mcpServers && config.mcpServers['local-cocoa']);
        } catch {
            return false;
        }
    });

    // Open Claude Desktop config file in editor
    ipcMain.handle('mcp:open-claude-config', async () => {
        const configPath = MCPServer.getClaudeConfigPath();
        if (fs.existsSync(configPath)) {
            shell.openPath(configPath);
            return true;
        }
        return false;
    });

    // Get MCP server status
    ipcMain.handle('mcp:get-status', async () => {
        const server = getMCPServer();
        return {
            initialized: !!server,
            running: server?.isRunning() ?? false,
            pythonPath: server?.getPythonPath() ?? null,
            serverPath: server?.getServerScriptPath() ?? null,
        };
    });

    // Copy config to clipboard (as JSON string)
    ipcMain.handle('mcp:copy-config', async () => {
        const server = initMCPServer();
        const config = server.generateClaudeConfig();
        return JSON.stringify({ mcpServers: config }, null, 2);
    });
}
