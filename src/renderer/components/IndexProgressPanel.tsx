import { useState } from 'react';
import { Activity, FileText, Image as ImageIcon, Video, Music, X, Pause, Play, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../lib/utils';
import type { IndexProgressUpdate, IndexingItem } from '../types';

function basename(pathValue: string): string {
    const parts = (pathValue ?? '').split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] ?? pathValue;
}

function kindIcon(kind?: string | null) {
    switch ((kind ?? '').toLowerCase()) {
        case 'video':
            return <Video className="h-4 w-4 text-primary" />;
        case 'audio':
            return <Music className="h-4 w-4 text-primary" />;
        case 'image':
            return <ImageIcon className="h-4 w-4 text-primary" />;
        case 'document':
        default:
            return <FileText className="h-4 w-4 text-primary" />;
    }
}

function clampPercent(value: number | null | undefined): number {
    if (typeof value !== 'number' || Number.isNaN(value)) return 0;
    return Math.max(0, Math.min(100, Math.round(value)));
}

function extractPageLabel(text?: string | null): string | null {
    if (!text) return null;
    const match = text.match(/page\s+(\d+)/i);
    return match ? match[1] : null;
}

export function IndexProgressPanel({
    isIndexing,
    progress,
    indexingItems,
    onRemoveItem,
    onPauseIndexing,
    onResumeIndexing,
}: {
    isIndexing: boolean;
    progress: IndexProgressUpdate | null;
    indexingItems: IndexingItem[];
    onRemoveItem?: (filePath: string) => void;
    onPauseIndexing?: () => void;
    onResumeIndexing?: () => void;
}) {
    const [isPreviewExpanded, setIsPreviewExpanded] = useState(false);
    const processing = indexingItems.find((item) => item.status === 'processing') ?? null;
    const pendingCount = indexingItems.filter((item) => item.status === 'pending').length;
    const queueItems = indexingItems.slice(0, 50);

    const headerMessage =
        progress?.status === 'running'
            ? (progress?.message ?? 'Indexing…')
            : progress?.status === 'failed'
                ? (progress?.lastError ?? 'Indexing failed')
                : progress?.status === 'completed'
                    ? 'Indexing completed'
                    : 'Idle';

    const processed = progress?.processed ?? 0;
    const total = progress?.total ?? null;
    const failed = progress?.failed ?? 0;

    const previewEvents = processing?.recentEvents ?? [];
    const latestPreviewEvent = previewEvents.length ? previewEvents[previewEvents.length - 1] : null;
    const previewMessage = latestPreviewEvent?.message ?? processing?.detail ?? '';
    const previewPage = latestPreviewEvent?.page ?? extractPageLabel(previewMessage);
    const streamEvents = previewEvents.slice(-4).reverse();

    return (
        <div className="space-y-4">
            <div className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 overflow-hidden">
                    <div className="flex items-center gap-3 min-w-0 flex-1 overflow-hidden">
                        <div className="h-10 w-10 rounded bg-primary/10 flex items-center justify-center shrink-0">
                            <Activity className="h-5 w-5 text-primary" />
                        </div>
                        <div className="min-w-0 flex-1 overflow-hidden">
                            <p className="text-base font-semibold">Index Progress</p>
                            <p className="text-xs text-muted-foreground truncate" title={headerMessage}>{headerMessage}</p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                        <span className="rounded-full border bg-muted px-2.5 py-0.5">
                            {processed}{total ? ` / ${total}` : ''} processed
                        </span>
                        <span>{pendingCount ? `${pendingCount} queued` : isIndexing ? 'Working…' : 'Idle'}</span>
                        {failed ? (
                            <span className="rounded-full border border-destructive/40 bg-destructive/10 px-2.5 py-0.5 text-destructive">
                                {failed} failed
                            </span>
                        ) : null}
                        
                        {/* Pause/Resume Button */}
                        {isIndexing && progress?.status === 'running' && onPauseIndexing && (
                            <button
                                onClick={onPauseIndexing}
                                className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-0.5 text-amber-600 hover:bg-amber-500/20 transition-colors"
                                title="Pause indexing"
                            >
                                <Pause className="h-3 w-3" />
                                Pause
                            </button>
                        )}
                        {progress?.status === 'paused' && onResumeIndexing && (
                            <button
                                onClick={onResumeIndexing}
                                className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-0.5 text-primary hover:bg-primary/20 transition-colors"
                                title="Resume indexing"
                            >
                                <Play className="h-3 w-3" />
                                Resume
                            </button>
                        )}
                    </div>
                </div>

                {processing ? (
                    <div className="space-y-3">
                        <div className="flex flex-col gap-3">
                            <div className="flex items-start gap-3">
                                <div className="h-9 w-9 rounded bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                                    {kindIcon(processing.kind)}
                                </div>
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-foreground truncate">{basename(processing.filePath)}</p>
                                    <p
                                        className="text-[11px] text-muted-foreground font-mono truncate opacity-80"
                                        title={processing.filePath}
                                    >
                                        {processing.filePath}
                                    </p>
                                    <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1 flex-wrap">
                                        {processing.stage ? (
                                            <span className="uppercase tracking-wider text-[10px] font-semibold text-primary/80">
                                                {processing.stage.replace(/_/g, ' ')}
                                            </span>
                                        ) : null}
                                        {processing.detail ? <span className="text-foreground/80">— {processing.detail}</span> : null}
                                        {typeof processing.stepCurrent === 'number' && typeof processing.stepTotal === 'number' ? (
                                            <span className="text-muted-foreground">— {processing.stepCurrent}/{processing.stepTotal}</span>
                                        ) : null}
                                    </p>
                                </div>
                                <div className="text-xs text-muted-foreground shrink-0">
                                    <span className="rounded-full border bg-muted px-2.5 py-0.5">
                                        {clampPercent(processing.progress)}%
                                    </span>
                                </div>
                            </div>

                            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                                <div
                                    className={cn('h-full bg-primary transition-[width]')}
                                    style={{ width: `${clampPercent(processing.progress)}%` }}
                                />
                            </div>
                        </div>

                        {(previewMessage || streamEvents.length) ? (
                            <div className="grid gap-3">
                                {previewMessage ? (
                                    <div className="rounded-md border bg-background/80 p-3 min-w-0 overflow-hidden">
                                        <div className="flex items-center justify-between text-[11px] text-muted-foreground uppercase tracking-wider">
                                            <span>Now Processing</span>
                                            {previewPage ? <span className="text-primary">Page {previewPage}</span> : null}
                                        </div>
                                        <p
                                            className={cn(
                                                "mt-2 text-sm text-foreground leading-snug break-all",
                                                !isPreviewExpanded && "line-clamp-3"
                                            )}
                                            title={isPreviewExpanded ? undefined : previewMessage}
                                        >
                                            {previewMessage}
                                        </p>
                                        {previewMessage.length > 150 && (
                                            <button
                                                onClick={() => setIsPreviewExpanded(!isPreviewExpanded)}
                                                className="mt-2 flex items-center gap-1 text-[11px] text-primary hover:text-primary/80 transition-colors"
                                            >
                                                {isPreviewExpanded ? (
                                                    <>
                                                        <ChevronUp className="h-3 w-3" />
                                                        <span>Collapse</span>
                                                    </>
                                                ) : (
                                                    <>
                                                        <ChevronDown className="h-3 w-3" />
                                                        <span>View All</span>
                                                    </>
                                                )}
                                            </button>
                                        )}
                                    </div>
                                ) : null}

                                {streamEvents.length ? (
                                    <div className="rounded-md border bg-muted/20 p-3 min-w-0 overflow-hidden">
                                        <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Stream</p>
                                        <div className="mt-2 space-y-1.5">
                                            {streamEvents.map((evt, idx) => (
                                                <div key={`${evt.ts}-${idx}`} className="flex items-start gap-2 min-w-0">
                                                    <span className="text-primary">—</span>
                                                    <div className="flex-1 min-w-0">
                                                        <p
                                                            className="text-xs text-foreground/90 leading-snug line-clamp-2 break-all"
                                                            title={evt.message}
                                                        >
                                                            {evt.message}
                                                        </p>
                                                        <p className="text-[10px] text-muted-foreground">
                                                            {(evt.ts ?? '').split('T')[1]?.replace('Z', '')?.slice(0, 8) ?? ''}
                                                        </p>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </div>

            <div className="rounded-lg border bg-card p-4 text-card-foreground shadow-sm">
                <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold">Queue</p>
                    <p className="text-xs text-muted-foreground">{indexingItems.length} item(s)</p>
                </div>

                <div className="mt-3 divide-y">
                    {queueItems.length ? (
                        queueItems.map((item, idx) => (
                            <div key={`${item.filePath}-${idx}`} className="py-2 flex items-center justify-between gap-3 text-xs">
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="h-8 w-8 rounded bg-primary/10 flex items-center justify-center shrink-0">
                                        {kindIcon(item.kind)}
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-medium truncate text-sm">{basename(item.filePath)}</p>
                                        <p className="text-[11px] text-muted-foreground truncate font-mono">{item.folderPath}</p>
                                    </div>
                                </div>

                                <div className="flex items-center gap-2 shrink-0">
                                    <span className={cn(
                                        'rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wider',
                                        item.status === 'processing'
                                            ? 'border-primary/30 bg-primary/10 text-primary'
                                            : 'bg-muted text-muted-foreground'
                                    )}>
                                        {item.status}
                                    </span>
                                    {item.status === 'processing' ? (
                                        <span className="rounded-full border bg-muted px-2.5 py-0.5 text-[10px] text-muted-foreground">
                                            {clampPercent(item.progress)}%
                                        </span>
                                    ) : null}
                                    
                                    {/* Remove from queue button - only for pending items */}
                                    {item.status === 'pending' && onRemoveItem && (
                                        <button
                                            onClick={() => onRemoveItem(item.filePath)}
                                            className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                                            title="Remove from queue"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="py-8 text-center text-sm text-muted-foreground">
                            No indexing activity.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
