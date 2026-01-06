import { ipcMain, shell, app, dialog } from 'electron';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { createWriteStream } from 'fs';
import archiver from 'archiver';
import { getHealth } from '../backendClient';
import { WindowManager } from '../windowManager';
import { getLogsDirectory } from '../logger';

export function registerSystemHandlers(windowManager: WindowManager) {
    ipcMain.handle('health:ping', async () => getHealth());

    ipcMain.handle('auth:get-local-key', async () => {
        let ragHome = process.env.LOCAL_RAG_HOME;
        if (!ragHome) {
             const userDataPath = app.getPath('userData');
             ragHome = path.join(userDataPath, 'local_rag');
        }
        
        const keyPath = path.join(ragHome, 'local_key.txt');
        try {
            if (fs.existsSync(keyPath)) {
                return fs.readFileSync(keyPath, 'utf-8').trim();
            }
        } catch (e) {
            console.error('Failed to read local key:', e);
        }
        return null;
    });

    ipcMain.handle('system:open-external', async (_event, url: string) => {
        if (!url || typeof url !== 'string') {
            throw new Error('Missing url.');
        }
        await shell.openExternal(url);
        return true;
    });

    ipcMain.handle('system:specs', async () => {
        return {
            totalMemory: os.totalmem(),
            platform: os.platform(),
            arch: os.arch(),
            cpus: os.cpus().length
        };
    });

    ipcMain.handle('spotlight:show', async () => {
        await windowManager.showSpotlightWindow();
        return true;
    });

    ipcMain.handle('spotlight:toggle', async () => {
        await windowManager.toggleSpotlightWindow();
        return true;
    });

    ipcMain.on('spotlight:hide', () => {
        windowManager.hideSpotlightWindow();
    });

    ipcMain.on('spotlight:focus-request', (_event, payload: { fileId?: string }) => {
        if (!payload?.fileId) {
            return;
        }
        windowManager.hideSpotlightWindow();
        windowManager.focusMainWindow();
        windowManager.mainWindow?.webContents.send('spotlight:focus', { fileId: payload.fileId });
    });

    ipcMain.on('spotlight:open-request', (_event, payload: { fileId?: string }) => {
        if (!payload?.fileId) {
            return;
        }
        windowManager.hideSpotlightWindow();
        windowManager.focusMainWindow();
        windowManager.mainWindow?.webContents.send('spotlight:open', { fileId: payload.fileId });
    });

    // Broadcast notes changed to all windows
    ipcMain.on('notes:changed', () => {
        windowManager.broadcast('notes:refresh');
    });

    // Save image to file with dialog
    ipcMain.handle('system:save-image', async (_event, options: { 
        data: string; // base64 data URL
        defaultName?: string;
        title?: string;
    }) => {
        const { data, defaultName = 'image.png', title = 'Save Image' } = options;
        
        const mainWindow = windowManager.mainWindow;
        if (!mainWindow) {
            throw new Error('No main window available');
        }
        
        const result = await dialog.showSaveDialog(mainWindow, {
            title,
            defaultPath: path.join(app.getPath('downloads'), defaultName),
            filters: [
                { name: 'PNG Image', extensions: ['png'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });
        
        if (result.canceled || !result.filePath) {
            return { saved: false, path: null };
        }
        
        // Extract base64 data from data URL
        const base64Data = data.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        
        await fs.promises.writeFile(result.filePath, buffer);
        
        return { saved: true, path: result.filePath };
    });

    // Export logs - collects all log files and creates a zip archive
    ipcMain.handle('system:export-logs', async () => {
        const mainWindow = windowManager.mainWindow;
        if (!mainWindow) {
            throw new Error('No main window available');
        }

        // Collect all log file paths
        const logFiles: { path: string; name: string }[] = [];
        
        // 1. Electron main process log from userData/logs
        const logsDir = getLogsDirectory();
        if (fs.existsSync(logsDir)) {
            const files = fs.readdirSync(logsDir);
            for (const file of files) {
                if (file.endsWith('.log') || file.endsWith('.old.log')) {
                    logFiles.push({
                        path: path.join(logsDir, file),
                        name: `electron/${file}`
                    });
                }
            }
        }
        
        // 2. Backend logs from local_rag directory
        const ragHome = path.join(app.getPath('userData'), 'local_rag');
        if (fs.existsSync(ragHome)) {
            const logsSubdir = path.join(ragHome, 'logs');
            if (fs.existsSync(logsSubdir)) {
                const files = fs.readdirSync(logsSubdir);
                for (const file of files) {
                    if (file.endsWith('.log')) {
                        logFiles.push({
                            path: path.join(logsSubdir, file),
                            name: `backend/${file}`
                        });
                    }
                }
            }
        }
        
        // 3. Also check for old-style logs in userData directly
        const userDataLogFiles = ['main.log', 'renderer.log'];
        for (const logFile of userDataLogFiles) {
            const logPath = path.join(app.getPath('userData'), logFile);
            if (fs.existsSync(logPath)) {
                logFiles.push({
                    path: logPath,
                    name: `electron/${logFile}`
                });
            }
        }

        if (logFiles.length === 0) {
            return { 
                exported: false, 
                path: null, 
                error: 'No log files found' 
            };
        }

        // Generate default filename with timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const defaultName = `LocalCocoa-logs-${timestamp}.zip`;

        // Show save dialog
        const result = await dialog.showSaveDialog(mainWindow, {
            title: 'Export Logs',
            defaultPath: path.join(app.getPath('downloads'), defaultName),
            filters: [
                { name: 'ZIP Archive', extensions: ['zip'] }
            ]
        });

        if (result.canceled || !result.filePath) {
            return { exported: false, path: null };
        }

        // Create zip archive
        const zipPath = result.filePath;
        const output = createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        return new Promise<{ exported: boolean; path: string | null; error?: string }>((resolve) => {
            output.on('close', () => {
                console.log(`[Logs] Exported ${logFiles.length} log files to ${zipPath} (${archive.pointer()} bytes)`);
                // Open the folder containing the zip file
                shell.showItemInFolder(zipPath);
                resolve({ exported: true, path: zipPath });
            });

            archive.on('error', (err) => {
                console.error('[Logs] Error creating archive:', err);
                resolve({ exported: false, path: null, error: err.message });
            });

            archive.pipe(output);

            // Add each log file to the archive
            for (const logFile of logFiles) {
                if (fs.existsSync(logFile.path)) {
                    archive.file(logFile.path, { name: logFile.name });
                }
            }

            // Add system info as a text file
            const systemInfo = [
                `Local Cocoa Log Export`,
                `====================`,
                ``,
                `Export Time: ${new Date().toISOString()}`,
                `App Version: ${app.getVersion()}`,
                `Platform: ${os.platform()} ${os.release()}`,
                `Architecture: ${os.arch()}`,
                `Node Version: ${process.versions.node}`,
                `Electron Version: ${process.versions.electron}`,
                `Total Memory: ${Math.round(os.totalmem() / 1024 / 1024 / 1024)} GB`,
                `Free Memory: ${Math.round(os.freemem() / 1024 / 1024 / 1024)} GB`,
                `CPUs: ${os.cpus().length}`,
                ``,
                `Log Files Included:`,
                ...logFiles.map(f => `  - ${f.name}`)
            ].join('\n');
            
            archive.append(systemInfo, { name: 'system-info.txt' });

            archive.finalize();
        });
    });

    // Get logs directory path (for UI to show location)
    ipcMain.handle('system:get-logs-path', async () => {
        return getLogsDirectory();
    });
}
