export type FileKind =
    | 'document'
    | 'image'
    | 'presentation'
    | 'spreadsheet'
    | 'audio'
    | 'video'
    | 'archive'
    | 'code'
    | 'book'
    | 'other';

export type FileIndexStatus = 'pending' | 'indexed' | 'error';

export interface FailedFile {
    path: string;
    reason: string;
    timestamp: string;
}

export interface FolderRecord {
    id: string;
    label: string;
    path: string;
    createdAt: string;
    updatedAt: string;
    lastIndexedAt: string | null;
    enabled: boolean;
    failedFiles?: FailedFile[];
    indexedCount?: number;
}

export interface MonitoredFolder extends FolderRecord { }

export interface FileRecord {
    id: string;
    folderId: string;
    path: string;
    name: string;
    extension: string;
    size: number;
    modifiedAt: string;
    createdAt: string;
    kind: FileKind;
    summary?: string | null;
    metadata?: Record<string, unknown>;
    // Index status tracking
    indexStatus?: FileIndexStatus;
    errorReason?: string | null;
    errorAt?: string | null;
}

export interface IndexedFile extends FileRecord {
    location: string;
    fullPath: string;
}

export interface ChunkSnapshot {
    chunkId: string;
    fileId: string;
    ordinal: number;
    text: string;
    snippet: string;
    tokenCount: number;
    charCount: number;
    sectionPath?: string | null;
    metadata: Record<string, unknown>;
    createdAt: string;
}

export interface IndexResultSnapshot {
    files: IndexedFile[];
    startedAt: string;
    completedAt: string;
    totalCount: number;
    totalSize: number;
    byKind: Record<FileKind, number>;
    byLocation: Record<string, number>;
}

export interface IndexProgressUpdate {
    status: 'idle' | 'running' | 'paused' | 'failed' | 'completed';
    startedAt?: string | null;
    completedAt?: string | null;
    processed: number;
    failed?: number;
    failedItems?: FailedFile[];
    total?: number | null;
    message?: string | null;
    lastError?: string | null;
}

export interface IndexingItem {
    folderId: string;
    folderPath: string;
    filePath: string;
    fileId?: string | null;  // File ID for reliable matching
    fileName?: string | null;  // File name for fallback matching
    status: 'pending' | 'processing';
    startedAt?: string | null;
    progress?: number | null;

    // Optional richer details
    kind?: string | null;
    stage?: string | null;
    detail?: string | null;
    stepCurrent?: number | null;
    stepTotal?: number | null;
    recentEvents?: Array<{ ts: string; type?: string; message: string; [key: string]: any }>;
}

export interface IndexInventory {
    files: FileRecord[];
    total: number;
    indexing: IndexingItem[];
    progress: IndexProgressUpdate;
}

export interface IndexSummary {
    filesIndexed: number;
    totalSizeBytes: number;
    foldersIndexed: number;
    lastCompletedAt: string | null;
}

export interface ServiceStatus {
    name: string;
    status: 'online' | 'offline' | 'unknown';
    latencyMs?: number | null;
    details?: string | null;
}

export interface HealthStatus {
    status: 'idle' | 'indexing' | 'ready' | 'degraded';
    indexedFiles: number;
    watchedFolders: number;
    message?: string | null;
    services?: ServiceStatus[];
}

export interface FileListResponse {
    files: FileRecord[];
    total: number;
}

export interface SearchHit {
    fileId: string;
    score: number;
    summary?: string | null;
    snippet?: string | null;
    metadata: Record<string, unknown>;
    chunkId?: string | null;
    // Chunk analysis results from LLM
    analysisComment?: string | null;
    hasAnswer?: boolean;
    analysisConfidence?: number;
}

export interface AgentStepFile {
    fileId: string;
    label: string;
    score?: number | null;
}

export interface AgentStep {
    id: string;
    title: string;
    detail?: string | null;
    status?: 'running' | 'complete' | 'skipped' | 'error';
    queries?: string[];
    items?: string[];
    files?: AgentStepFile[];
    durationMs?: number | null;
}

export interface AgentDiagnostics {
    steps: AgentStep[];
    summary?: string | null;
}

export interface SearchResponse {
    query: string;
    hits: SearchHit[];
    rewrittenQuery?: string | null;
    queryVariants?: string[];
    strategy?: 'vector' | 'hybrid' | 'lexical';
    latencyMs?: number | null;
    diagnostics?: AgentDiagnostics;
}

export interface QaResponse {
    answer: string;
    hits: SearchHit[];
    latencyMs: number;
    rewrittenQuery?: string | null;
    queryVariants?: string[];
    diagnostics?: AgentDiagnostics;
}

export interface NoteSummary {
    id: string;
    title: string;
    updatedAt: string;
    preview?: string | null;
}

export interface NoteContent extends NoteSummary {
    markdown: string;
    createdAt: string;
}

export interface NoteDraftPayload {
    title?: string | null;
    body?: string | null;
}

export interface ModelAssetStatus {
    id: string;
    label: string;
    path: string;
    exists: boolean;
    sizeBytes: number | null;
    optional?: boolean;
    mmprojId?: string;
}

export interface ModelStatusSummary {
    assets: ModelAssetStatus[];
    ready: boolean;
    missing: string[];
    lastCheckedAt: string;
}

export interface ModelDownloadEvent {
    state: 'idle' | 'checking' | 'downloading' | 'completed' | 'error';
    message?: string | null;
    percent?: number | null;
    assetId?: string | null;
    statuses?: ModelAssetStatus[];
    logLine?: string;
}

export interface ActivityLog {
    id: string;
    timestamp: string;
    description: string;
    short_description?: string | null;
}

export interface ActivityTimelineResponse {
    logs: ActivityLog[];
    summary?: string | null;
}

export type ThinkingStepStatus = 'pending' | 'running' | 'complete' | 'error';

export interface ThinkingStepHit {
    fileId: string;
    chunkId?: string | null;
    score: number;
    summary?: string | null;
    snippet?: string | null;
    metadata?: Record<string, unknown>;
    // Analysis results
    hasAnswer?: boolean;
    analysisComment?: string | null;
    analysisConfidence?: number;
}

export interface ThinkingStep {
    id: string;
    type: 'decompose' | 'subquery' | 'search' | 'analyze' | 'merge' | 'synthesize' | 'info';
    title: string;
    summary?: string;
    details?: string;
    status: ThinkingStepStatus;
    children?: ThinkingStep[];
    hits?: ThinkingStepHit[];
    subQuery?: string;
    subQueryAnswer?: string;  // Answer generated for this sub-query
    metadata?: {
        subQueryIndex?: number;
        totalSubQueries?: number;
        resultsCount?: number;
        relevantCount?: number;
        strategy?: string;
        sources?: string[];
    };
}

export interface AnalysisProgress {
    processedCount: number;
    totalCount: number;
    highQualityCount: number;
    batchNum: number;
    totalBatches: number;
    currentFiles?: string[];
    isProcessing?: boolean;
    isPreparing?: boolean;
    isComplete: boolean;
}

export interface ConversationMessage {
    role: 'user' | 'assistant';
    text: string;
    timestamp: string;
    meta?: string;
    references?: SearchHit[];
    steps?: AgentStep[];
    diagnosticsSummary?: string | null;
    thinkingSteps?: ThinkingStep[];
    isMultiPath?: boolean;
    analysisProgress?: AnalysisProgress;
}

export interface ChatSession {
    id: string;
    title: string;
    messages: ConversationMessage[];
    updatedAt: string;
}

export type IndexOperationMode = 'rescan' | 'reindex';
export type IndexScope = 'global' | 'folder' | 'notes';

export interface RunIndexOptions {
    mode?: IndexOperationMode;
    scope?: IndexScope;
    folders?: string[];
    refreshEmbeddings?: boolean;
    dropCollection?: boolean;
    purgeFolders?: string[];
    indexing_mode?: 'fast' | 'fine';
}

export interface SystemSpecs {
    totalMemory: number;
    platform: string;
    arch: string;
    cpus: number;
}

export interface ApiKey {
    key: string;
    name: string;
    created_at: string;
    last_used_at?: string | null;
    is_active: boolean;
    is_system: boolean;
}

// Scan feature types
export type ScanMode = 'smart' | 'custom';
export type FileOrigin = 'downloaded' | 'synced' | 'created_here' | 'unknown';
export type ScanStage = 'idle' | 'planning' | 'scanning' | 'building' | 'completed' | 'cancelled' | 'error';

export interface ScanDirectory {
    path: string;
    label: string;
    isDefault: boolean;
    isCloudSync?: boolean;
    selected?: boolean; // for UI state
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

export interface ScannedFile {
    path: string;
    name: string;
    extension: string;
    size: number;
    modifiedAt: string;
    createdAt: string;
    kind: FileKind;
    origin?: FileOrigin; // Downloaded, Synced, Created here, Unknown
    parentPath?: string; // For folder tree building
}

export interface ScanProgress {
    status: ScanStage;
    stage?: string; // Human readable stage name
    currentPath?: string;
    scannedCount: number; // Total files scanned
    matchedCount: number; // Files matching filters
    skippedCount: number; // Files skipped by exclusions
    totalEstimate?: number;
    startedAt?: string;
    completedAt?: string;
    error?: string;
}

export interface ScanOptions {
    daysBack: number | null; // null = all time (for relative time ranges)
    dateFrom?: string | null; // ISO date string for start of range (for year-based or custom)
    dateTo?: string | null; // ISO date string for end of range (for year-based or custom)
    directories: string[]; // specific directories to scan
    useRecommendedExclusions?: boolean;
    customExclusions?: string[];
}

// Folder tree node for hierarchical display
export interface FolderNode {
    path: string;
    name: string;
    fileCount: number; // Files matching current filter in this folder
    totalFileCount: number; // Total files in subtree
    totalSize: number; // Total size of files in subtree
    latestModified: string; // Max mtime in subtree
    children: FolderNode[];
    files: ScannedFile[];
    isExpanded?: boolean;
}

