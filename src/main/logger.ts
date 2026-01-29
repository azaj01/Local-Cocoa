import log from 'electron-log/main';
import path from 'path';
import fs from 'fs';
import { createSanitizingHook } from './logSanitizer';
import { config } from './config';

log.initialize();

// Add sanitizing hook for privacy protection
// This redacts sensitive data like API keys, passwords, emails, etc. from logs
log.hooks.push(createSanitizingHook());

// Configure log format for main process
log.transports.console.format = '[main] {m}-{d} {h}:{i}:{s} [{level}] {text}';
log.transports.file.format = '[main] {m}-{d} {h}:{i}:{s} [{level}] {text}';

/**
 * Update log settings
 */
export function updateLogSettings(): void {
    // TODO: if necessary, should support more log levels and update python backend too

    log.transports.file.level = config.logLevel as any;
    log.transports.console.level = config.logLevel as any;
    
    console.info(`[Logger] Log level set to ${config.logLevel}.`);

    if (config.paths.electronLogPath) {
        // Ensure logs directory exists
        if (!fs.existsSync(path.dirname(config.paths.electronLogPath))) {
            fs.mkdirSync(path.dirname(config.paths.electronLogPath), { recursive: true });
        }

        log.transports.file.resolvePathFn = () => config.paths.electronLogPath;

        // Configure log rotation
        log.transports.file.maxSize = 10 * 1024 * 1024; // 10 MB max file size

        // Print the log file path so we know where it is
        console.log('[Logger] Log file location:', log.transports.file.getFile().path);
    }

    // Overwrite console.log to use electron-log
    Object.assign(console, log.functions);
}

/**
 * Get the current log file path
 */
export function getDebugLogPath(): string {
    return log.transports.file.getFile().path;
}

/**
 * Clear the log file by deleting it.
 */
export function clearDebugLog(): void {
    try {
        const logFile = log.transports.file.getFile().path;
        if (fs.existsSync(logFile)) {
            fs.unlinkSync(logFile);
        }
    } catch {
        // ignore
    }
}


// Export the logs directory path for use by other modules
export function getLogsDirectory(): string {
    return path.dirname(log.transports.file.getFile().path);
}

export default log;

