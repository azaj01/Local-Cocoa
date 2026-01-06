import { contextBridge, ipcRenderer } from 'electron';

import type {
    FileListResponse,
    FileRecord,
    FolderRecord,
    HealthStatus,
    IndexInventory,
    IndexProgressUpdate,
    IndexSummary,
    NoteContent,
    NoteDraftPayload,
    NoteSummary,
    QaResponse,
    SearchResponse,
    ModelStatusSummary,
    ModelDownloadEvent,
    ChatSession,
    ConversationMessage,
    ChunkSnapshot,
    ScannedFile,
    ScanProgress,
    ScanDirectory,
    ScanSettings,
    ScanOptions,
    FolderNode,
    FileKind,
} from '../types/files';

type SpotlightFilePayload = { fileId: string };
type RunIndexOptions = {
    mode?: 'rescan' | 'reindex';
    scope?: 'global' | 'folder' | 'email' | 'notes';
    folders?: string[];
    files?: string[];
    refreshEmbeddings?: boolean;
    dropCollection?: boolean;
    purgeFolders?: string[];
    indexing_mode?: 'fast' | 'fine';
};

const api = {
    pickFolders: (): Promise<string[]> => ipcRenderer.invoke('folders:pick'),
    listFolders: (): Promise<FolderRecord[]> => ipcRenderer.invoke('folders:list'),
    addFolder: (path: string, label?: string, scanMode?: 'full' | 'manual'): Promise<FolderRecord> =>
        ipcRenderer.invoke('folders:add', { path, label, scanMode }),
    removeFolder: (folderId: string): Promise<{ id: string }> =>
        ipcRenderer.invoke('folders:remove', folderId),
    getLocalKey: (): Promise<string> => ipcRenderer.invoke('auth:get-local-key'),
    runIndex: (options?: RunIndexOptions): Promise<IndexProgressUpdate> =>
        ipcRenderer.invoke('index:run', options ?? {}),
    indexFolder: (folderId: string): Promise<IndexProgressUpdate> =>
        ipcRenderer.invoke('index:run', { folders: [folderId], mode: 'rescan' }),
    indexFile: (path: string): Promise<IndexProgressUpdate> =>
        ipcRenderer.invoke('index:run', { files: [path], mode: 'rescan' }),
    indexStatus: (): Promise<IndexProgressUpdate> => ipcRenderer.invoke('index:status'),
    indexSummary: (): Promise<IndexSummary> => ipcRenderer.invoke('index:summary'),
    pauseIndexing: (): Promise<IndexProgressUpdate> => ipcRenderer.invoke('index:pause'),
    resumeIndexing: (): Promise<IndexProgressUpdate> => ipcRenderer.invoke('index:resume'),
    indexInventory: (options?: { folderId?: string; limit?: number; offset?: number }): Promise<IndexInventory> =>
        ipcRenderer.invoke('index:list', options ?? {}),
    listFiles: (limit?: number, offset?: number): Promise<FileListResponse> =>
        ipcRenderer.invoke('files:list', { limit, offset }),
    getFile: (fileId: string): Promise<FileRecord | null> =>
        ipcRenderer.invoke('files:get', fileId),
    getChunk: (chunkId: string): Promise<ChunkSnapshot | null> =>
        ipcRenderer.invoke('files:get-chunk', chunkId),
    listFileChunks: (fileId: string): Promise<ChunkSnapshot[]> =>
        ipcRenderer.invoke('files:list-chunks', fileId),
    getChunkHighlight: (chunkId: string, zoom?: number): Promise<string> =>
        ipcRenderer.invoke('files:chunk-highlight', { chunkId, zoom }),
    openFile: (filePath: string): Promise<{ path: string }> =>
        ipcRenderer.invoke('files:open', { path: filePath }),
    deleteFile: (fileId: string): Promise<{ id: string }> => ipcRenderer.invoke('files:delete', fileId),
    search: (query: string, limit?: number): Promise<SearchResponse> =>
        ipcRenderer.invoke('search:query', { query, limit }),
    
    // Progressive/layered search with streaming results
    searchStream: (query: string, limit?: number, callbacks?: {
        onData: (chunk: string) => void;
        onError: (error: string) => void;
        onDone: () => void;
    }): () => void => {
        const dataChannel = 'search:stream-data';
        const errorChannel = 'search:stream-error';
        const doneChannel = 'search:stream-done';

        const onData = (_event: unknown, chunk: string) => callbacks?.onData(chunk);
        const onError = (_event: unknown, error: string) => callbacks?.onError(error);
        const onDone = (_event: unknown) => callbacks?.onDone();

        ipcRenderer.on(dataChannel, onData);
        ipcRenderer.on(errorChannel, onError);
        ipcRenderer.on(doneChannel, onDone);

        ipcRenderer.send('search:stream', { query, limit });

        return () => {
            ipcRenderer.removeListener(dataChannel, onData);
            ipcRenderer.removeListener(errorChannel, onError);
            ipcRenderer.removeListener(doneChannel, onDone);
        };
    },

    ask: (query: string, limit?: number, mode?: 'qa' | 'chat', searchMode?: 'auto' | 'knowledge' | 'direct'): Promise<QaResponse> =>
        ipcRenderer.invoke('qa:ask', { query, limit, mode, searchMode }),
    health: (): Promise<HealthStatus> => ipcRenderer.invoke('health:ping'),
    openExternal: (url: string): Promise<boolean> => ipcRenderer.invoke('system:open-external', url),
    getSystemSpecs: (): Promise<{ totalMemory: number; platform: string; arch: string; cpus: number }> =>
        ipcRenderer.invoke('system:specs'),
    saveImage: (options: { data: string; defaultName?: string; title?: string }): Promise<{ saved: boolean; path: string | null }> =>
        ipcRenderer.invoke('system:save-image', options),
    exportLogs: (): Promise<{ exported: boolean; path: string | null; error?: string }> =>
        ipcRenderer.invoke('system:export-logs'),
    getLogsPath: (): Promise<string> =>
        ipcRenderer.invoke('system:get-logs-path'),
    listNotes: (): Promise<NoteSummary[]> => ipcRenderer.invoke('notes:list'),
    createNote: (payload: NoteDraftPayload): Promise<NoteSummary> =>
        ipcRenderer.invoke('notes:create', payload),
    getNote: (noteId: string): Promise<NoteContent> => ipcRenderer.invoke('notes:get', { noteId }),
    updateNote: (noteId: string, payload: NoteDraftPayload): Promise<NoteContent> =>
        ipcRenderer.invoke('notes:update', { noteId, payload }),
    deleteNote: (noteId: string): Promise<{ id: string }> =>
        ipcRenderer.invoke('notes:delete', { noteId }),
    showSpotlightWindow: (): Promise<unknown> => ipcRenderer.invoke('spotlight:show'),
    toggleSpotlightWindow: (): Promise<unknown> => ipcRenderer.invoke('spotlight:toggle'),
    hideSpotlightWindow: (): void => {
        ipcRenderer.send('spotlight:hide');
    },
    spotlightFocusFile: (fileId: string): void => {
        const payload: SpotlightFilePayload = { fileId };
        ipcRenderer.send('spotlight:focus-request', payload);
    },
    spotlightOpenFile: (fileId: string): void => {
        const payload: SpotlightFilePayload = { fileId };
        ipcRenderer.send('spotlight:open-request', payload);
    },
    onSpotlightFocusFile: (callback: (payload: SpotlightFilePayload) => void): (() => void) => {
        const channel = 'spotlight:focus';
        const listener = (_event: unknown, payload: SpotlightFilePayload) => {
            callback(payload);
        };
        ipcRenderer.on(channel, listener);
        return () => {
            ipcRenderer.removeListener(channel, listener);
        };
    },
    onSpotlightOpenFile: (callback: (payload: SpotlightFilePayload) => void): (() => void) => {
        const channel = 'spotlight:open';
        const listener = (_event: unknown, payload: SpotlightFilePayload) => {
            callback(payload);
        };
        ipcRenderer.on(channel, listener);
        return () => {
            ipcRenderer.removeListener(channel, listener);
        };
    },
    onSpotlightTabSwitch: (callback: (payload: { tab: 'search' | 'notes' }) => void): (() => void) => {
        const channel = 'spotlight:switch-tab';
        const listener = (_event: unknown, payload: { tab: 'search' | 'notes' }) => {
            callback(payload);
        };
        ipcRenderer.on(channel, listener);
        return () => {
            ipcRenderer.removeListener(channel, listener);
        };
    },
    // Notify all windows that notes have changed
    notifyNotesChanged: (): void => {
        ipcRenderer.send('notes:changed');
    },
    onNotesChanged: (callback: () => void): (() => void) => {
        const channel = 'notes:refresh';
        const listener = () => callback();
        ipcRenderer.on(channel, listener);
        return () => {
            ipcRenderer.removeListener(channel, listener);
        };
    },
    modelStatus: (): Promise<ModelStatusSummary> => ipcRenderer.invoke('models:status'),
    downloadModels: (): Promise<ModelStatusSummary> => ipcRenderer.invoke('models:download'),
    redownloadModel: (assetId: string): Promise<ModelStatusSummary> => ipcRenderer.invoke('models:redownload', assetId),
    getModelConfig: (): Promise<any> => ipcRenderer.invoke('models:get-config'),
    setModelConfig: (config: any): Promise<any> => ipcRenderer.invoke('models:set-config', config),
    addModel: (descriptor: any): Promise<any> => ipcRenderer.invoke('models:add', descriptor),
    pickFile: (options?: { filters?: { name: string; extensions: string[] }[] }): Promise<string | null> =>
        ipcRenderer.invoke('files:pick-one', options),
    pickFiles: (options?: { filters?: { name: string; extensions: string[] }[] }): Promise<string[]> =>
        ipcRenderer.invoke('files:pick-multiple', options),
    onModelDownloadEvent: (callback: (event: ModelDownloadEvent) => void) => {
        const subscription = (_event: any, payload: ModelDownloadEvent) => callback(payload);
        ipcRenderer.on('models:progress', subscription);
        return () => ipcRenderer.removeListener('models:progress', subscription);
    },

    ingestScreenshot: (image: Uint8Array) => ipcRenderer.invoke('activity:ingest', { image }),
    getActivityTimeline: (start?: string, end?: string, summary?: boolean) => ipcRenderer.invoke('activity:timeline', { start, end, summary }),
    deleteActivityLog: (logId: string) => ipcRenderer.invoke('activity:delete', { logId }),
    captureScreen: () => ipcRenderer.invoke('activity:capture'),
    readImage: (filePath: string): Promise<string> => ipcRenderer.invoke('files:read-image', { filePath }),
    askStream: (query: string, limit?: number, mode?: 'qa' | 'chat', callbacks?: {
        onData: (chunk: string) => void;
        onError: (error: string) => void;
        onDone: () => void;
    }, searchMode?: 'auto' | 'knowledge' | 'direct'): () => void => {
        const dataChannel = 'qa:stream-data';
        const errorChannel = 'qa:stream-error';
        const doneChannel = 'qa:stream-done';

        const onData = (_event: unknown, chunk: string) => callbacks?.onData(chunk);
        const onError = (_event: unknown, error: string) => callbacks?.onError(error);
        const onDone = (_event: unknown) => callbacks?.onDone();

        ipcRenderer.on(dataChannel, onData);
        ipcRenderer.on(errorChannel, onError);
        ipcRenderer.on(doneChannel, onDone);

        ipcRenderer.send('qa:ask-stream', { query, limit, mode, searchMode });

        return () => {
            ipcRenderer.removeListener(dataChannel, onData);
            ipcRenderer.removeListener(errorChannel, onError);
            ipcRenderer.removeListener(doneChannel, onDone);
        };
    },

    listChatSessions: (limit?: number, offset?: number): Promise<ChatSession[]> =>
        ipcRenderer.invoke('chat:list', { limit, offset }),
    createChatSession: (title?: string): Promise<ChatSession> =>
        ipcRenderer.invoke('chat:create', { title }),
    getChatSession: (sessionId: string): Promise<ChatSession> =>
        ipcRenderer.invoke('chat:get', { sessionId }),
    deleteChatSession: (sessionId: string): Promise<{ id: string }> =>
        ipcRenderer.invoke('chat:delete', { sessionId }),
    updateChatSession: (sessionId: string, title: string): Promise<ChatSession> =>
        ipcRenderer.invoke('chat:update', { sessionId, title }),
    addChatMessage: (sessionId: string, message: Partial<ConversationMessage>): Promise<ConversationMessage> =>
        ipcRenderer.invoke('chat:add-message', { sessionId, message }),

    // ========================================
    // Enhanced File System Scan APIs
    // ========================================
    
    // Get smart recommended directories based on OS
    getRecommendedDirectories: (): Promise<ScanDirectory[]> => 
        ipcRenderer.invoke('scan:get-recommended-directories'),
    
    // Get exclusion rules
    getExclusions: (): Promise<{ system: string[]; universal: string[] }> => 
        ipcRenderer.invoke('scan:get-exclusions'),
    
    // Load saved scan settings
    getScanSettings: (): Promise<ScanSettings> => 
        ipcRenderer.invoke('scan:get-settings'),
    
    // Save scan settings
    saveScanSettings: (settings: ScanSettings): Promise<{ success: boolean }> => 
        ipcRenderer.invoke('scan:save-settings', settings),
    
    // Pick directories dialog
    pickScanDirectories: (): Promise<ScanDirectory[]> => 
        ipcRenderer.invoke('scan:pick-directories'),
    
    // Build folder tree from scanned files
    buildFolderTree: (payload: { 
        files: ScannedFile[]; 
        rootPaths: string[]; 
        filterKind?: FileKind 
    }): Promise<FolderNode[]> => 
        ipcRenderer.invoke('scan:build-tree', payload),

    // Start scan with streaming results
    scanFiles: (options: {
        daysBack: number | null;
        dateFrom?: string | null; // ISO date string for year-based or custom ranges
        dateTo?: string | null; // ISO date string for year-based or custom ranges
        directories: string[];
        useRecommendedExclusions?: boolean;
        customExclusions?: string[];
        onProgress?: (progress: ScanProgress) => void;
        onFiles?: (files: ScannedFile[]) => void;
        onComplete?: (result: { files: ScannedFile[]; folderTree: FolderNode[]; partial: boolean }) => void;
        onError?: (error: string) => void;
    }): (() => void) => {
        const progressChannel = 'scan:progress';
        const filesChannel = 'scan:files';
        const doneChannel = 'scan:done';
        const errorChannel = 'scan:error';

        const onProgress = (_event: unknown, progress: ScanProgress) => options.onProgress?.(progress);
        const onFiles = (_event: unknown, files: ScannedFile[]) => options.onFiles?.(files);
        const onDone = (_event: unknown, result: { files: ScannedFile[]; folderTree: FolderNode[]; partial: boolean }) => 
            options.onComplete?.(result);
        const onError = (_event: unknown, error: string) => options.onError?.(error);

        ipcRenderer.on(progressChannel, onProgress);
        ipcRenderer.on(filesChannel, onFiles);
        ipcRenderer.on(doneChannel, onDone);
        ipcRenderer.on(errorChannel, onError);

        const scanOptions: ScanOptions = {
            daysBack: options.daysBack,
            dateFrom: options.dateFrom,
            dateTo: options.dateTo,
            directories: options.directories,
            useRecommendedExclusions: options.useRecommendedExclusions ?? true,
            customExclusions: options.customExclusions,
        };
        
        ipcRenderer.send('scan:start', scanOptions);

        return () => {
            ipcRenderer.removeListener(progressChannel, onProgress);
            ipcRenderer.removeListener(filesChannel, onFiles);
            ipcRenderer.removeListener(doneChannel, onDone);
            ipcRenderer.removeListener(errorChannel, onError);
            ipcRenderer.send('scan:cancel');
        };
    },

    cancelScan: (): void => {
        ipcRenderer.send('scan:cancel');
    },
};

contextBridge.exposeInMainWorld('api', api);

contextBridge.exposeInMainWorld('env', {
    LOG_LEVEL: process.env.LOG_LEVEL,
    APP_VERSION: process.env.APP_VERSION,
    APP_NAME: process.env.APP_NAME,
});

declare global {
    interface Window {
        api: typeof api;
        env: {
            LOG_LEVEL?: string;
            APP_VERSION?: string;
            APP_NAME?: string;
            [key: string]: any;
        };
    }
}
