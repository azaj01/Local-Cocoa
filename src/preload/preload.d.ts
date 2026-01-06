import type {
    FileListResponse,
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
    ActivityLog,
    ActivityTimelineResponse,
    ChatSession,
    ConversationMessage,
    ChunkSnapshot,
} from '../main/types';

type RunIndexOptions = {
    mode?: 'rescan' | 'reindex';
    scope?: 'global' | 'folder' | 'email' | 'notes';
    folders?: string[];
    refreshEmbeddings?: boolean;
    dropCollection?: boolean;
    purgeFolders?: string[];
};

declare global {
    interface Window {
        api?: {
            pickFolders: () => Promise<string[]>;
            listFolders: () => Promise<FolderRecord[]>;
            addFolder: (path: string, label?: string, scanMode?: 'full' | 'manual') => Promise<FolderRecord>;
            removeFolder: (folderId: string) => Promise<{ id: string }>;
            runIndex: (options?: RunIndexOptions) => Promise<IndexProgressUpdate>;
            indexFolder: (folderId: string) => Promise<IndexProgressUpdate>;
            indexFile: (path: string) => Promise<IndexProgressUpdate>;
            indexStatus: () => Promise<IndexProgressUpdate>;
            indexSummary: () => Promise<IndexSummary>;
            pauseIndexing: () => Promise<IndexProgressUpdate>;
            resumeIndexing: () => Promise<IndexProgressUpdate>;
            indexInventory: (options?: { folderId?: string; limit?: number; offset?: number }) => Promise<IndexInventory>;
            listFiles: (limit?: number, offset?: number) => Promise<FileListResponse>;
            getFile: (fileId: string) => Promise<import('./types').FileRecord | null>;
            getChunk: (chunkId: string) => Promise<ChunkSnapshot | null>;
            listFileChunks: (fileId: string) => Promise<ChunkSnapshot[]>;
            getChunkHighlight?: (chunkId: string, zoom?: number) => Promise<string>;
            openFile: (filePath: string) => Promise<{ path: string }>;
            deleteFile: (fileId: string) => Promise<{ id: string }>;
            search: (query: string, limit?: number) => Promise<SearchResponse>;
            searchStream: (query: string, limit: number, callbacks: {
                onData: (chunk: string) => void;
                onError: (error: string) => void;
                onDone: () => void;
            }) => () => void;
            ask: (query: string, limit?: number, mode?: 'qa' | 'chat', searchMode?: 'auto' | 'knowledge' | 'direct') => Promise<QaResponse>;
            askStream: (query: string, limit: number, mode: 'qa' | 'chat', callbacks: {
                onData: (chunk: string) => void;
                onError: (error: string) => void;
                onDone: () => void;
            }, searchMode?: 'auto' | 'knowledge' | 'direct') => () => void;
            health: () => Promise<HealthStatus>;
            listNotes: () => Promise<NoteSummary[]>;
            createNote: (payload: NoteDraftPayload) => Promise<NoteSummary>;
            getNote: (noteId: string) => Promise<NoteContent>;
            updateNote: (noteId: string, payload: NoteDraftPayload) => Promise<NoteContent>;
            deleteNote: (noteId: string) => Promise<{ id: string }>;
            showSpotlightWindow: () => Promise<unknown>;
            toggleSpotlightWindow: () => Promise<unknown>;
            hideSpotlightWindow: () => void;
            spotlightFocusFile: (fileId: string) => void;
            spotlightOpenFile: (fileId: string) => void;
            onSpotlightFocusFile: (callback: (payload: { fileId: string }) => void) => () => void;
            onSpotlightOpenFile: (callback: (payload: { fileId: string }) => void) => () => void;
            onSpotlightTabSwitch: (callback: (payload: { tab: 'search' | 'notes' }) => void) => () => void;
            notifyNotesChanged: () => void;
            onNotesChanged: (callback: () => void) => () => void;
            modelStatus: () => Promise<ModelStatusSummary>;
            downloadModels: () => Promise<ModelStatusSummary>;
            redownloadModel: (assetId: string) => Promise<ModelStatusSummary>;
            getModelConfig: () => Promise<any>;
            setModelConfig: (config: any) => Promise<any>;
            addModel: (descriptor: any) => Promise<any>;
            pickFile: (options?: { filters?: { name: string; extensions: string[] }[] }) => Promise<string | null>;
            onModelDownloadEvent?: (callback: (event: ModelDownloadEvent) => void) => () => void;
            ingestScreenshot?: (image: Uint8Array) => Promise<ActivityLog>;
            getActivityTimeline?: (start?: string, end?: string, summary?: boolean) => Promise<ActivityTimelineResponse>;
            deleteActivityLog?: (logId: string) => Promise<void>;
            captureScreen?: () => Promise<Uint8Array>;
            readImage: (filePath: string) => Promise<string>;
            listChatSessions: (limit?: number, offset?: number) => Promise<ChatSession[]>;
            createChatSession: (title?: string) => Promise<ChatSession>;
            getChatSession: (sessionId: string) => Promise<ChatSession>;
            deleteChatSession: (sessionId: string) => Promise<{ id: string }>;
            updateChatSession: (sessionId: string, title: string) => Promise<ChatSession>;
            addChatMessage: (sessionId: string, message: Partial<ConversationMessage>) => Promise<ConversationMessage>;
            exportLogs: () => Promise<{ exported: boolean; path: string | null; error?: string }>;
            getLogsPath: () => Promise<string>;
        };
    }
}

export { };
