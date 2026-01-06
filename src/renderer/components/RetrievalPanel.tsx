import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, FileText, Database, ChevronRight, Layers } from 'lucide-react';
import type { IndexResultSnapshot, IndexedFile, SearchResponse, SearchHit } from '../types';
import { LoadingDots } from './LoadingDots';
import { AgentProcess } from './AgentProcess';
import { cn } from '../lib/utils';

// Search stage labels
const STAGE_LABELS: Record<string, string> = {
    filename: 'Searching filenames...',
    summary: 'Searching summaries...',
    metadata: 'Searching metadata...',
    hybrid: 'Deep semantic search...',
    complete: 'Search complete'
};

// Score threshold for low relevance results
const LOW_SCORE_THRESHOLD = 0.3;

// Group hits by file
interface FileGroup {
    fileId: string;
    fileName: string;
    filePath: string;
    bestScore: number;
    chunks: SearchHit[];
    file?: IndexedFile;
    firstSeenMs?: number;
}

function groupHitsByFile(hits: SearchHit[], files: IndexedFile[], fileFirstSeenMs: Record<string, number>): FileGroup[] {
    const groups = new Map<string, FileGroup>();

    for (const hit of hits) {
        const fileId = hit.fileId;
        const file = files.find(f => f.id === fileId);
        const metadata = hit.metadata ?? {};
        const fileName = file?.name || String(metadata.name || metadata.file_name || 'Untitled');
        const filePath = file?.fullPath || String(metadata.path || metadata.file_path || '');

        if (!groups.has(fileId)) {
            groups.set(fileId, {
                fileId,
                fileName,
                filePath,
                bestScore: hit.score,
                chunks: [],
                file,
                firstSeenMs: fileFirstSeenMs[fileId],
            });
        }

        const group = groups.get(fileId)!;
        group.chunks.push(hit);
        if (hit.score > group.bestScore) {
            group.bestScore = hit.score;
        }
    }

    return Array.from(groups.values()).sort((a, b) => b.bestScore - a.bestScore);
}

interface RetrievalPanelProps {
    files: IndexedFile[];
    snapshot: IndexResultSnapshot | null;
    isIndexing: boolean;
    onSelectFile: (file: IndexedFile) => void;
    onOpenFile?: (file: IndexedFile) => void | Promise<void>;
    onAskAboutFile: (file: IndexedFile) => Promise<void>;
}

export function RetrievalPanel({
    files,
    snapshot,
    isIndexing,
    onSelectFile,
    onOpenFile
}: RetrievalPanelProps) {
    const [fileQuery, setFileQuery] = useState('');
    const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [strategyLabel, setStrategyLabel] = useState('Vector search');
    const [searchStage, setSearchStage] = useState<string | null>(null);
    const [fileFirstSeenMs, setFileFirstSeenMs] = useState<Record<string, number>>({});
    const [showDiagnostics, setShowDiagnostics] = useState(false);
    const [showLowRelevance, setShowLowRelevance] = useState(false);
    const searchRequestIdRef = useRef(0);
    const cancelStreamRef = useRef<(() => void) | null>(null);
    const searchActive = fileQuery.trim().length > 0;

    // Progressive stream search
    const runStreamSearch = useCallback((query: string) => {
        const trimmed = query.trim();
        const requestId = ++searchRequestIdRef.current;

        // Cancel any ongoing stream
        if (cancelStreamRef.current) {
            cancelStreamRef.current();
            cancelStreamRef.current = null;
        }

        if (!trimmed) {
            setSearchHits([]);
            setSearchLoading(false);
            setSearchError(null);
            setSearchStage(null);
            setFileFirstSeenMs({});
            setStrategyLabel('Vector search');
            return;
        }

        const api = window.api;
        if (!api?.searchStream && !api?.search) {
            setSearchError('Desktop bridge unavailable.');
            return;
        }

        setSearchLoading(true);
        setSearchError(null);
        setSearchHits([]);
        setFileFirstSeenMs({});
        setSearchStage(null);

        if (api.searchStream) {
            let buffer = '';
            let accumulatedHits: SearchHit[] = [];
            let latestStage = '';
            const fileTimings: Record<string, number> = {};

            const cancel = api.searchStream(trimmed, 20, {
                onData: (chunk) => {
                    if (searchRequestIdRef.current !== requestId) return;
                    buffer += chunk;
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const msg = JSON.parse(line);
                            const stage = msg.stage as string;
                            const hits = msg.hits as SearchHit[];
                            const done = msg.done as boolean;
                            const stageLatencyMs = msg.latencyMs as number;
                            latestStage = stage;

                            if (hits && hits.length > 0) {
                                for (const hit of hits) {
                                    if (!fileTimings[hit.fileId]) {
                                        fileTimings[hit.fileId] = stageLatencyMs;
                                    }
                                }
                                setFileFirstSeenMs({ ...fileTimings });
                                accumulatedHits = [...accumulatedHits, ...hits];
                                setSearchHits([...accumulatedHits]);
                                setSearchStage(stage);
                            } else if (!done) {
                                setSearchStage(stage);
                            }

                            if (done) {
                                setStrategyLabel(latestStage.replace(/_/g, ' '));
                                setSearchStage(null);
                                setSearchLoading(false);
                                cancelStreamRef.current = null;
                            }
                        } catch (e) {
                            console.error('Failed to parse search stream line', e);
                        }
                    }
                },
                onError: (err) => {
                    if (searchRequestIdRef.current !== requestId) return;
                    setSearchError(err);
                    setSearchLoading(false);
                    setSearchStage(null);
                    cancelStreamRef.current = null;
                },
                onDone: () => {
                    if (searchRequestIdRef.current !== requestId) return;
                    setSearchLoading(false);
                    setSearchStage(null);
                    cancelStreamRef.current = null;
                }
            });
            cancelStreamRef.current = cancel;
        } else if (api.search) {
            // Fallback to non-streaming
            api.search(trimmed, 20)
                .then((response) => {
                    if (searchRequestIdRef.current !== requestId) return;
                    setSearchHits(response.hits || []);
                    setStrategyLabel(response.strategy?.replace(/_/g, ' ') || 'Vector search');
                    setSearchLoading(false);
                })
                .catch((error) => {
                    if (searchRequestIdRef.current !== requestId) return;
                    setSearchError(error instanceof Error ? error.message : 'Search failed.');
                    setSearchLoading(false);
                });
        }
    }, []);

    // Debounced search trigger
    useEffect(() => {
        const handle = window.setTimeout(() => {
            runStreamSearch(fileQuery);
        }, 200);
        return () => {
            window.clearTimeout(handle);
        };
    }, [fileQuery, runStreamSearch]);

    // Group hits by file
    const fileGroups = useMemo(() => 
        groupHitsByFile(searchHits, files, fileFirstSeenMs),
        [searchHits, files, fileFirstSeenMs]
    );

    // Split into high/low score groups
    const highScoreGroups = useMemo(() => 
        fileGroups.filter(g => g.bestScore >= LOW_SCORE_THRESHOLD),
        [fileGroups]
    );
    const lowScoreGroups = useMemo(() => 
        fileGroups.filter(g => g.bestScore < LOW_SCORE_THRESHOLD),
        [fileGroups]
    );

    return (
        <div className="flex h-full flex-col gap-6 max-w-5xl mx-auto overflow-y-auto pb-8">
            <section className="space-y-4">
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-semibold tracking-tight">Retrieval</h2>
                        <p className="text-sm text-muted-foreground">Search across your indexed files</p>
                    </div>
                    {!searchLoading && fileGroups.length > 0 && (
                        <span className="rounded-full border border-primary/20 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary capitalize">
                            {strategyLabel}
                        </span>
                    )}
                </div>

                <div className="relative">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                        type="search"
                        value={fileQuery}
                        onChange={(event) => setFileQuery(event.target.value)}
                        placeholder="Search names, metadata, or paths..."
                        className="w-full rounded-lg border bg-background pl-10 pr-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                    />
                </div>

                {/* Progressive search stage indicator */}
                {searchLoading && searchStage && (
                    <div className="flex items-center gap-3">
                        <div className="flex gap-1">
                            {['filename', 'summary', 'metadata', 'hybrid'].map((stage) => {
                                const stageOrder = ['filename', 'summary', 'metadata', 'hybrid'];
                                const currentIdx = stageOrder.indexOf(searchStage);
                                const stageIdx = stageOrder.indexOf(stage);
                                const isActive = stage === searchStage;
                                const isComplete = stageIdx < currentIdx;
                                
                                return (
                                    <div
                                        key={stage}
                                        className={cn(
                                            "h-1.5 w-10 rounded-full transition-all duration-300",
                                            isActive && "bg-primary animate-pulse",
                                            isComplete && "bg-primary",
                                            !isActive && !isComplete && "bg-muted"
                                        )}
                                    />
                                );
                            })}
                        </div>
                        <span className="text-xs text-muted-foreground">
                            {STAGE_LABELS[searchStage] || 'Searching...'}
                        </span>
                    </div>
                )}

                {/* Results count */}
                {searchActive && fileGroups.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                        {fileGroups.length} file{fileGroups.length === 1 ? '' : 's'} · {searchHits.length} chunk{searchHits.length === 1 ? '' : 's'}
                    </div>
                )}

                {searchError && (
                    <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                        {searchError}
                    </div>
                )}

                <div className="space-y-2">
                    {!searchActive ? (
                        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center text-muted-foreground">
                            <Search className="mb-2 h-8 w-8 opacity-50" />
                            <p className="text-sm">Start typing to search your files</p>
                            <div className="text-xs opacity-70 mt-2">
                                {isIndexing ? (
                                    <span>Indexing in background — see Progress in the sidebar.</span>
                                ) : (
                                    'Index is up to date'
                                )}
                            </div>
                        </div>
                    ) : searchLoading && fileGroups.length === 0 ? (
                        <div className="flex items-center justify-center p-8">
                            <LoadingDots label="Searching" />
                        </div>
                    ) : fileGroups.length === 0 && !searchLoading ? (
                        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center text-muted-foreground">
                            <p className="text-sm">No matches found</p>
                        </div>
                    ) : (
                        <div className="grid gap-3">
                            {/* High score results */}
                            {highScoreGroups.map((group) => (
                                <div
                                    key={group.fileId}
                                    className="group rounded-lg border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent/5"
                                >
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2 mb-1">
                                                <FileText className="h-4 w-4 text-primary" />
                                                <h3 className="font-medium truncate text-card-foreground">
                                                    {group.fileName}
                                                </h3>
                                                {group.file?.extension && (
                                                    <span className="text-xs text-muted-foreground uppercase px-1.5 py-0.5 rounded bg-muted">
                                                        {group.file.extension}
                                                    </span>
                                                )}
                                                {group.chunks.length > 1 && (
                                                    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                                                        <Layers className="h-3 w-3" />
                                                        {group.chunks.length}
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-xs text-muted-foreground truncate mb-2">
                                                {group.filePath}
                                            </p>
                                            {group.chunks[0]?.snippet && (
                                                <p className="text-sm text-muted-foreground line-clamp-2 bg-muted/30 p-2 rounded">
                                                    {group.chunks[0].snippet}
                                                </p>
                                            )}
                                        </div>
                                        <div className="flex flex-col items-end gap-2">
                                            <div className="flex items-center gap-2">
                                                {typeof group.firstSeenMs === 'number' && (
                                                    <span className="text-[10px] font-mono text-muted-foreground/60">
                                                        {(group.firstSeenMs / 1000).toFixed(2)}s
                                                    </span>
                                                )}
                                                <span className="text-xs font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                                                    {group.bestScore.toFixed(2)}
                                                </span>
                                            </div>
                                            <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => group.file && onSelectFile(group.file)}
                                                    className="text-xs font-medium text-primary hover:underline"
                                                >
                                                    Inspect
                                                </button>
                                                {group.file && (
                                                    <button
                                                        onClick={() => onOpenFile?.(group.file!)}
                                                        className="text-xs font-medium text-primary hover:underline"
                                                    >
                                                        Open
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}

                            {/* Low score results - collapsed */}
                            {lowScoreGroups.length > 0 && (
                                <details className="mt-2" open={showLowRelevance}>
                                    <summary 
                                        className="cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors py-2 flex items-center gap-2"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            setShowLowRelevance(!showLowRelevance);
                                        }}
                                    >
                                        <ChevronRight className={cn("h-3 w-3 transition-transform", showLowRelevance && "rotate-90")} />
                                        {lowScoreGroups.length} low relevance result{lowScoreGroups.length === 1 ? '' : 's'}
                                    </summary>
                                    <div className="mt-2 grid gap-2 opacity-60">
                                        {lowScoreGroups.map((group) => (
                                            <div
                                                key={group.fileId}
                                                className="group rounded-lg border bg-card/50 p-3 transition-colors hover:bg-card"
                                            >
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="flex items-center gap-2 min-w-0">
                                                        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                        <span className="truncate text-xs text-foreground">
                                                            {group.fileName}
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-2 shrink-0">
                                                        {typeof group.firstSeenMs === 'number' && (
                                                            <span className="text-[9px] text-muted-foreground/50 font-mono">
                                                                {(group.firstSeenMs / 1000).toFixed(2)}s
                                                            </span>
                                                        )}
                                                        <span className="text-[9px] text-muted-foreground/70 font-mono">
                                                            {group.bestScore.toFixed(2)}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </details>
                            )}
                        </div>
                    )}
                </div>
            </section>
        </div>
    );
}
