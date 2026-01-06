import log from 'electron-log/main';
import { app } from 'electron';
import path from 'path';
import fs from 'fs';

log.initialize();

// Configure log levels
log.transports.file.level = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as any;
log.transports.console.level = (process.env.LOG_LEVEL ?? 'info').toLowerCase() as any;

// Configure log format for main process
log.transports.console.format = '[main] {m}-{d} {h}:{i}:{s} [{level}] {text}';
log.transports.file.format = '[main] {m}-{d} {h}:{i}:{s} [{level}] {text}';

// Configure log file location
// In production, use userData/logs directory (always writable)
// In development, use custom path if set via env, otherwise default
const getLogPath = (): string => {
    // Always use userData for logs - this works in both dev and prod
    const logsDir = path.join(app.getPath('userData'), 'logs');
    
    // Ensure logs directory exists
    if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true });
    }
    
    if (process.env.ELECTRON_LOG_PATH !== undefined) {
        const envPath = process.env.ELECTRON_LOG_PATH;
        // If path is relative, resolve it to userData/logs directory
        if (path.isAbsolute(envPath)) {
            return envPath;
        }
        // Extract just the filename and put it in the logs directory
        const fileName = path.basename(envPath);
        return path.join(logsDir, fileName);
    }
    
    return path.join(logsDir, 'main.log');
};

// Set the log file path
log.transports.file.resolvePathFn = getLogPath;

// Configure log rotation
log.transports.file.maxSize = 10 * 1024 * 1024; // 10 MB max file size

// Print the log file path so we know where it is
console.log('[Logger] Log file location:', log.transports.file.getFile().path);

// Overwrite console.log to use electron-log
Object.assign(console, log.functions);

// Export the logs directory path for use by other modules
export function getLogsDirectory(): string {
    return path.dirname(log.transports.file.getFile().path);
}

export default log;
