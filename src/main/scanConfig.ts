/**
 * Centralized Scan Configuration Module
 * 
 * Manages:
 * - Default scan directories by OS
 * - Exclusion rules (directories and patterns)
 * - Supported file types (excluding Code)
 * - Persistence of user preferences
 */

import os from 'os';
import path from 'path';
import fs from 'fs';
import type { FileKind } from '../types/files';

// ============================================
// Types
// ============================================

export type ScanMode = 'smart' | 'custom';

export type FileOrigin = 'downloaded' | 'synced' | 'created_here' | 'unknown';

export interface ScanDirectory {
    path: string;
    label: string;
    isDefault: boolean;
    isCloudSync?: boolean; // iCloud, OneDrive, Dropbox, etc.
}

export interface ScanScope {
    mode: ScanMode;
    directories: ScanDirectory[];
    useRecommendedExclusions: boolean;
    customExclusions: string[];
}

export interface ScanSettings {
    scope: ScanScope;
    lastScanAt?: string;
}

// ============================================
// File Types Configuration (Code type REMOVED)
// ============================================

// Supported file types for scanning - Code type intentionally excluded
export const SCAN_FILE_TYPES: Record<string, { kind: FileKind; extensions: string[]; label: string }> = {
    document: {
        kind: 'document',
        label: 'Documents',
        extensions: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'pages'],
    },
    spreadsheet: {
        kind: 'spreadsheet',
        label: 'Spreadsheets',
        extensions: ['xls', 'xlsx', 'csv', 'numbers', 'ods'],
    },
    presentation: {
        kind: 'presentation',
        label: 'Presentations',
        extensions: ['ppt', 'pptx', 'key', 'odp'],
    },
    image: {
        kind: 'image',
        label: 'Images',
        extensions: ['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp', 'bmp', 'ico', 'tiff', 'heic', 'heif', 'raw', 'cr2', 'nef'],
    },
    video: {
        kind: 'video',
        label: 'Videos',
        extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm', 'flv', 'wmv', 'm4v', 'mpg', 'mpeg', '3gp'],
    },
    audio: {
        kind: 'audio',
        label: 'Audio',
        extensions: ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma', 'aiff', 'alac'],
    },
    archive: {
        kind: 'archive',
        label: 'Archives',
        extensions: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'dmg', 'iso'],
    },
    book: {
        kind: 'book',
        label: 'Books',
        extensions: ['epub', 'mobi', 'azw', 'azw3', 'fb2'],
    },
};

// Build extension to kind mapping
export function getExtensionToKindMap(): Map<string, FileKind> {
    const map = new Map<string, FileKind>();
    for (const [, config] of Object.entries(SCAN_FILE_TYPES)) {
        for (const ext of config.extensions) {
            map.set(ext.toLowerCase(), config.kind);
        }
    }
    return map;
}

// Check if extension is a supported type (excludes code)
export function isSupportedFileType(extension: string): boolean {
    const ext = extension.toLowerCase().replace(/^\./, '');
    const map = getExtensionToKindMap();
    return map.has(ext);
}

// Get file kind from extension (only supported types)
export function getFileKindFromExtension(extension: string): FileKind | null {
    const ext = extension.toLowerCase().replace(/^\./, '');
    const map = getExtensionToKindMap();
    return map.get(ext) || null;
}

// ============================================
// Exclusion Rules Configuration
// ============================================

// macOS system directories to exclude
const MACOS_SYSTEM_EXCLUSIONS = [
    '/System',
    '/Library',
    '/private',
    '/usr',
    '/bin',
    '/sbin',
    '/opt',
    '/var',
    '/etc',
    '/tmp',
    '/cores',
    '/Volumes', // Exclude other mounted volumes by default
];

// macOS user library exclusions
const MACOS_USER_EXCLUSIONS = [
    '~/Library',
    '~/Applications',
    '~/.Trash',
    '~/Library/Caches',
    '~/Library/Containers',
    '~/Library/Application Support',
    '~/Library/Logs',
    '~/Library/Saved Application State',
];

// Windows system directories to exclude
const WINDOWS_SYSTEM_EXCLUSIONS = [
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\Program Files (x86)',
    'C:\\ProgramData',
    'C:\\$Recycle.Bin',
    'C:\\System Volume Information',
    'C:\\Recovery',
    'C:\\MSOCache',
];

// Windows user exclusions
const WINDOWS_USER_EXCLUSIONS = [
    '%USERPROFILE%\\AppData',
    '%USERPROFILE%\\AppData\\Local\\Temp',
    '%USERPROFILE%\\AppData\\Local\\Microsoft',
    '%USERPROFILE%\\AppData\\LocalLow',
];

// Universal directory name patterns to exclude (any OS)
export const UNIVERSAL_DIR_EXCLUSIONS = [
    'node_modules',
    '.git',
    '.svn',
    '.hg',
    '__pycache__',
    '.cache',
    '.npm',
    '.yarn',
    '.pnpm',
    'vendor',
    'build',
    'dist',
    '.next',
    '.nuxt',
    '.venv',
    'venv',
    'env',
    '.env',
    '.tox',
    'target', // Rust/Java build
    'out',
    'bin',
    'obj',
    '.idea',
    '.vscode',
    '.gradle',
    '.m2',
    'Pods', // iOS
    'DerivedData', // Xcode
    '.Spotlight-V100',
    '.fseventsd',
    '.Trashes',
    '.TemporaryItems',
    '.DocumentRevisions-V100',
];

// Get system exclusions based on platform
export function getSystemExclusions(): string[] {
    const platform = process.platform;
    const home = os.homedir();

    if (platform === 'darwin') {
        const userExclusions = MACOS_USER_EXCLUSIONS.map(p =>
            p.replace('~', home)
        );
        return [...MACOS_SYSTEM_EXCLUSIONS, ...userExclusions];
    } else if (platform === 'win32') {
        const userProfile = process.env.USERPROFILE || home;
        const userExclusions = WINDOWS_USER_EXCLUSIONS.map(p =>
            p.replace('%USERPROFILE%', userProfile)
        );
        return [...WINDOWS_SYSTEM_EXCLUSIONS, ...userExclusions];
    }

    // Linux fallback
    return ['/proc', '/sys', '/dev', '/run', '/snap', '/boot', '/lost+found'];
}

// Check if a directory name should be excluded (universal patterns)
export function shouldExcludeByName(dirName: string): boolean {
    return UNIVERSAL_DIR_EXCLUSIONS.includes(dirName);
}

// Check if a full path should be excluded by system rules
export function shouldExcludeByPath(fullPath: string, exclusions: string[]): boolean {
    const normalizedPath = fullPath.replace(/\\/g, '/').toLowerCase();

    for (const exclusion of exclusions) {
        const normalizedExclusion = exclusion.replace(/\\/g, '/').toLowerCase();
        if (normalizedPath.startsWith(normalizedExclusion) || normalizedPath === normalizedExclusion) {
            return true;
        }
    }

    return false;
}

// ============================================
// Default Scan Directories (Smart Recommendations)
// ============================================

// Known cloud sync directory patterns
const CLOUD_SYNC_PATTERNS = {
    icloud: {
        mac: ['~/Library/Mobile Documents/com~apple~CloudDocs'],
        win: [],
        label: 'iCloud Drive',
    },
    onedrive: {
        mac: ['~/OneDrive', '~/Library/CloudStorage/OneDrive-*'],
        win: ['%USERPROFILE%\\OneDrive'],
        label: 'OneDrive',
    },
    dropbox: {
        mac: ['~/Dropbox'],
        win: ['%USERPROFILE%\\Dropbox'],
        label: 'Dropbox',
    },
    googledrive: {
        mac: ['~/Google Drive', '~/Library/CloudStorage/GoogleDrive-*'],
        win: ['%USERPROFILE%\\Google Drive'],
        label: 'Google Drive',
    },
};

// Check if a directory exists
function directoryExists(dirPath: string): boolean {
    try {
        return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
    } catch {
        return false;
    }
}

// Expand path with home directory
function expandPath(p: string): string {
    const home = os.homedir();
    return p
        .replace('~', home)
        .replace('%USERPROFILE%', process.env.USERPROFILE || home);
}

// Get smart recommended directories based on OS
export function getSmartRecommendedDirectories(): ScanDirectory[] {
    const platform = process.platform;
    const home = os.homedir();
    const directories: ScanDirectory[] = [];

    if (platform === 'darwin') {
        // macOS defaults
        const macDefaults = [
            { path: path.join(home, 'Desktop'), label: 'Desktop' },
            { path: path.join(home, 'Documents'), label: 'Documents' },
            { path: path.join(home, 'Downloads'), label: 'Downloads' },
            { path: path.join(home, 'Pictures'), label: 'Pictures' },
            { path: path.join(home, 'Movies'), label: 'Movies' },
            { path: path.join(home, 'Music'), label: 'Music' },
        ];

        for (const dir of macDefaults) {
            if (directoryExists(dir.path)) {
                directories.push({
                    path: dir.path,
                    label: dir.label,
                    isDefault: true,
                });
            }
        }

        // Check for iCloud Drive
        const icloudPath = path.join(home, 'Library/Mobile Documents/com~apple~CloudDocs');
        if (directoryExists(icloudPath)) {
            directories.push({
                path: icloudPath,
                label: 'iCloud Drive',
                isDefault: false, // Not selected by default (can be large)
                isCloudSync: true,
            });
        }

    } else if (platform === 'win32') {
        // Windows defaults
        const userProfile = process.env.USERPROFILE || home;
        const winDefaults = [
            { path: path.join(userProfile, 'Desktop'), label: 'Desktop' },
            { path: path.join(userProfile, 'Documents'), label: 'Documents' },
            { path: path.join(userProfile, 'Downloads'), label: 'Downloads' },
            { path: path.join(userProfile, 'Pictures'), label: 'Pictures' },
            { path: path.join(userProfile, 'Videos'), label: 'Videos' },
            { path: path.join(userProfile, 'Music'), label: 'Music' },
        ];

        for (const dir of winDefaults) {
            if (directoryExists(dir.path)) {
                directories.push({
                    path: dir.path,
                    label: dir.label,
                    isDefault: true,
                });
            }
        }

        // Check for OneDrive
        const onedrivePath = path.join(userProfile, 'OneDrive');
        if (directoryExists(onedrivePath)) {
            directories.push({
                path: onedrivePath,
                label: 'OneDrive',
                isDefault: false,
                isCloudSync: true,
            });
        }
    } else {
        // Linux
        const linuxDefaults = [
            { path: path.join(home, 'Desktop'), label: 'Desktop' },
            { path: path.join(home, 'Documents'), label: 'Documents' },
            { path: path.join(home, 'Downloads'), label: 'Downloads' },
            { path: path.join(home, 'Pictures'), label: 'Pictures' },
            { path: path.join(home, 'Videos'), label: 'Videos' },
            { path: path.join(home, 'Music'), label: 'Music' },
        ];

        for (const dir of linuxDefaults) {
            if (directoryExists(dir.path)) {
                directories.push({
                    path: dir.path,
                    label: dir.label,
                    isDefault: true,
                });
            }
        }
    }

    // Check for common cloud sync directories
    for (const [, syncConfig] of Object.entries(CLOUD_SYNC_PATTERNS)) {
        const patterns = platform === 'darwin' ? syncConfig.mac :
            platform === 'win32' ? syncConfig.win :
                syncConfig.mac; // fallback to mac patterns for linux

        if (!patterns) continue;

        for (const pattern of patterns) {
            const expanded = expandPath(pattern);
            // Handle glob patterns (simplified - just check base path)
            const basePath = expanded.replace(/\*.*$/, '');
            if (directoryExists(basePath) || directoryExists(expanded)) {
                const existingPath = directoryExists(expanded) ? expanded : basePath;
                // Only add if not already in list
                if (!directories.some(d => d.path === existingPath)) {
                    directories.push({
                        path: existingPath,
                        label: syncConfig.label,
                        isDefault: false,
                        isCloudSync: true,
                    });
                }
            }
        }
    }

    return directories;
}

// ============================================
// Origin/Source Detection
// ============================================

// Known download directories
function getDownloadDirectories(): string[] {
    const home = os.homedir();
    const platform = process.platform;

    if (platform === 'darwin') {
        return [
            path.join(home, 'Downloads'),
        ];
    } else if (platform === 'win32') {
        const userProfile = process.env.USERPROFILE || home;
        return [
            path.join(userProfile, 'Downloads'),
        ];
    }
    return [path.join(home, 'Downloads')];
}

// Known cloud sync directories
function getSyncDirectories(): string[] {
    const dirs: string[] = [];
    const recommended = getSmartRecommendedDirectories();
    for (const dir of recommended) {
        if (dir.isCloudSync) {
            dirs.push(dir.path);
        }
    }
    return dirs;
}

/**
 * Detect file origin based on path and metadata
 * This is a best-effort detection - not 100% reliable
 * 
 * Limitations:
 * - macOS quarantine/where-from attributes require native modules (xattr)
 * - Windows Zone.Identifier requires ADS reading which is complex
 * - We use path-based heuristics as primary method
 */
export function detectFileOrigin(filePath: string): FileOrigin {
    const normalizedPath = filePath.replace(/\\/g, '/');

    // Check if in Downloads directory
    const downloadDirs = getDownloadDirectories();
    for (const dlDir of downloadDirs) {
        const normalizedDlDir = dlDir.replace(/\\/g, '/');
        if (normalizedPath.startsWith(normalizedDlDir)) {
            return 'downloaded';
        }
    }

    // Check if in cloud sync directory
    const syncDirs = getSyncDirectories();
    for (const syncDir of syncDirs) {
        const normalizedSyncDir = syncDir.replace(/\\/g, '/');
        if (normalizedPath.startsWith(normalizedSyncDir)) {
            return 'synced';
        }
    }

    // Check common user directories (likely created here)
    const home = os.homedir();
    const userCreatedPatterns = [
        path.join(home, 'Desktop'),
        path.join(home, 'Documents'),
        path.join(home, 'Projects'),
        path.join(home, 'Work'),
    ];

    for (const pattern of userCreatedPatterns) {
        const normalizedPattern = pattern.replace(/\\/g, '/');
        if (normalizedPath.startsWith(normalizedPattern)) {
            // In user directory but not Downloads or Sync - likely created here
            return 'created_here';
        }
    }

    return 'unknown';
}

// ============================================
// Settings Persistence
// ============================================

const SETTINGS_FILE = 'scan_settings.json';

function getSettingsPath(): string {
    const platform = process.platform;
    const home = os.homedir();

    if (platform === 'darwin') {
        return path.join(home, 'Library/Application Support/local-cocoa', SETTINGS_FILE);
    } else if (platform === 'win32') {
        const appData = process.env.APPDATA || path.join(home, 'AppData/Roaming');
        return path.join(appData, 'local-cocoa', SETTINGS_FILE);
    }
    return path.join(home, '.config/local-cocoa', SETTINGS_FILE);
}

export function loadScanSettings(): ScanSettings | null {
    try {
        const settingsPath = getSettingsPath();
        if (fs.existsSync(settingsPath)) {
            const content = fs.readFileSync(settingsPath, 'utf-8');
            return JSON.parse(content) as ScanSettings;
        }
    } catch (error) {
        console.error('Failed to load scan settings:', error);
    }
    return null;
}

export function saveScanSettings(settings: ScanSettings): void {
    try {
        const settingsPath = getSettingsPath();
        const dir = path.dirname(settingsPath);

        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    } catch (error) {
        console.error('Failed to save scan settings:', error);
    }
}

export function getDefaultScanSettings(): ScanSettings {
    const smartDirs = getSmartRecommendedDirectories();

    return {
        scope: {
            mode: 'smart',
            directories: smartDirs.filter(d => d.isDefault), // Only default directories initially
            useRecommendedExclusions: true,
            customExclusions: [],
        },
    };
}

// ============================================
// Exports for use by scan IPC handlers
// ============================================

export const scanConfigModule = {
    SCAN_FILE_TYPES,
    UNIVERSAL_DIR_EXCLUSIONS,
    getExtensionToKindMap,
    isSupportedFileType,
    getFileKindFromExtension,
    getSystemExclusions,
    shouldExcludeByName,
    shouldExcludeByPath,
    getSmartRecommendedDirectories,
    detectFileOrigin,
    loadScanSettings,
    saveScanSettings,
    getDefaultScanSettings,
};

