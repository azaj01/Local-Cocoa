import { useEffect, useMemo, useState } from 'react';
import type { AgentStep, SearchHit, ThinkingStep, ThinkingStepHit } from '../types';
import { AgentProcess } from './AgentProcess';
import { ThinkingProcess } from './ThinkingProcess';
import { cn } from '../lib/utils';

type RawResult = {
    answer?: string;
    question?: string;
    hits?: SearchHit[];
    thinking_steps?: ThinkingStep[];
    thinkingSteps?: ThinkingStep[];
    diagnostics?: {
        steps?: Array<Record<string, any>>;
        summary?: string | null;
    };
    latency_ms?: number;
    latencyMs?: number;
    rewritten_query?: string | null;
    rewrittenQuery?: string | null;
    query_variants?: string[];
    queryVariants?: string[];
};

interface BenchmarkResultViewerProps {
    onReferenceOpen?: (reference: SearchHit) => void;
}

export function BenchmarkResultViewer({ onReferenceOpen }: BenchmarkResultViewerProps) {
    const [folders, setFolders] = useState<string[]>([]);
    const [files, setFiles] = useState<string[]>([]);
    const [selectedFolder, setSelectedFolder] = useState<string>('');
    const [selectedFile, setSelectedFile] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<RawResult | null>(null);
    const [error, setError] = useState<string | null>(null);

    const loadFolders = async (options?: { keepSelection?: boolean }) => {
        if (!window.api?.benchmarkListResultFolders) {
            setError('Benchmark results API is not available.');
            return;
        }
        try {
            setIsLoading(true);
            const folderList = await window.api.benchmarkListResultFolders();
            setFolders(folderList);
            const shouldKeep = options?.keepSelection && selectedFolder && folderList.includes(selectedFolder);
            setSelectedFolder(shouldKeep ? selectedFolder : (folderList[0] ?? ''));
            setError(null);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load benchmark folders.';
            setError(message);
        } finally {
            setIsLoading(false);
        }
    };

    const loadFiles = async (folder: string, options?: { keepSelection?: boolean }) => {
        if (!window.api?.benchmarkListResultFiles) {
            setError('Benchmark results API is not available.');
            return;
        }
        if (!folder) {
            setFiles([]);
            setSelectedFile('');
            return;
        }
        try {
            setIsLoading(true);
            const fileList = await window.api.benchmarkListResultFiles(folder);
            setFiles(fileList);
            const shouldKeep = options?.keepSelection && selectedFile && fileList.includes(selectedFile);
            setSelectedFile(shouldKeep ? selectedFile : (fileList[0] ?? ''));
            setError(null);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load benchmark result files.';
            setError(message);
        } finally {
            setIsLoading(false);
        }
    };

    const loadResult = async (folder: string, file: string) => {
        if (!window.api?.benchmarkReadResultFile) {
            setError('Benchmark results API is not available.');
            return;
        }
        if (!folder || !file) {
            setResult(null);
            return;
        }
        try {
            setIsLoading(true);
            const content = await window.api.benchmarkReadResultFile(folder, file);
            const parsed = JSON.parse(content) as RawResult;
            setResult(parsed);
            setError(null);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to parse benchmark result JSON.';
            setError(message);
            setResult(null);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadFolders();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        loadFiles(selectedFolder);
        setResult(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedFolder]);

    useEffect(() => {
        if (selectedFolder && selectedFile) {
            loadResult(selectedFolder, selectedFile);
        }
    }, [selectedFolder, selectedFile]);

    const hits = useMemo(() => {
        if (!result?.hits) return [];
        return result.hits.map((hit) => ({
            ...hit,
            metadata: hit.metadata ?? {}
        }));
    }, [result]);

    const steps = useMemo<AgentStep[]>(() => {
        const rawSteps = result?.diagnostics?.steps ?? [];
        const filesFromHits = hits.map((hit) => {
            const metadata = hit.metadata ?? {};
            const labelCandidate =
                (typeof metadata.name === 'string' && metadata.name) ||
                (typeof metadata.label === 'string' && metadata.label) ||
                (typeof metadata.path === 'string' && metadata.path) ||
                (typeof hit.summary === 'string' && hit.summary) ||
                hit.fileId;
            return {
                fileId: hit.fileId,
                label: String(labelCandidate ?? hit.fileId),
                score: typeof hit.score === 'number' ? hit.score : null
            };
        });

        const parseQueriesFromDetail = (detail?: string) => {
            if (!detail) return [];
            const marker = 'Searching:';
            const index = detail.indexOf(marker);
            if (index === -1) return [];
            return detail
                .slice(index + marker.length)
                .split(',')
                .map((query) => query.trim())
                .filter(Boolean);
        };

        const hasFiles = rawSteps.some((step) => (step.files?.length ?? 0) > 0);

        return rawSteps.map((step, index) => ({
            id: String(step.id ?? `step_${index}`),
            title: String(step.title ?? step.id ?? `Step ${index + 1}`),
            detail: step.detail ?? undefined,
            status: step.status ?? undefined,
            queries: step.queries && step.queries.length > 0
                ? step.queries
                : parseQueriesFromDetail(step.detail),
            items: step.items ?? undefined,
            files: step.files?.map((file: any) => ({
                fileId: String(file.fileId ?? file.file_id ?? ''),
                label: String(file.label ?? file.name ?? file.path ?? file.fileId ?? 'Unknown'),
                score: typeof file.score === 'number' ? file.score : null
            })) ?? ((hasFiles || filesFromHits.length === 0) ? undefined : filesFromHits),
            durationMs: step.durationMs ?? step.duration_ms ?? null
        }));
    }, [result, hits]);

    const thinkingSteps = useMemo<ThinkingStep[]>(() => {
        const raw = result?.thinkingSteps ?? result?.thinking_steps ?? [];
        if (!Array.isArray(raw)) return [];
        return raw.map((step: any, index: number) => ({
            id: String(step.id ?? `thinking_${index}`),
            type: step.type ?? 'info',
            title: String(step.title ?? step.id ?? `Step ${index + 1}`),
            summary: step.summary ?? undefined,
            details: step.details ?? step.detail ?? undefined,
            status: 'complete',
            hits: Array.isArray(step.hits) ? step.hits : undefined,
            subQuery: step.subQuery ?? undefined,
            subQueryAnswer: step.subQueryAnswer ?? undefined,
            timestampMs: step.timestampMs ?? step.timestamp_ms ?? undefined,
            metadata: step.metadata ?? undefined
        })) as ThinkingStep[];
    }, [result]);

    const _rewrittenQuery = result?.rewrittenQuery ?? result?.rewritten_query ?? null;
    const _queryVariants = result?.queryVariants ?? result?.query_variants ?? [];

    const selectedFileIndex = useMemo(() => files.indexOf(selectedFile), [files, selectedFile]);
    const hasPrevFile = selectedFileIndex > 0;
    const hasNextFile = selectedFileIndex >= 0 && selectedFileIndex < files.length - 1;
    const canUseNext = !!selectedFolder && !isLoading && files.length > 0;

    const refreshResults = async (options?: { advanceToNext?: boolean }) => {
        if (!window.api?.benchmarkListResultFolders || !window.api?.benchmarkListResultFiles) {
            setError('Benchmark results API is not available.');
            return;
        }
        const currentFolder = selectedFolder;
        const currentFile = selectedFile;
        try {
            setIsLoading(true);
            const folderList = await window.api.benchmarkListResultFolders();
            setFolders(folderList);
            const nextFolder = currentFolder && folderList.includes(currentFolder)
                ? currentFolder
                : (folderList[0] ?? '');
            setSelectedFolder(nextFolder);
            if (!nextFolder) {
                setFiles([]);
                setSelectedFile('');
                return;
            }
            const fileList = await window.api.benchmarkListResultFiles(nextFolder);
            setFiles(fileList);
            let nextFile = '';
            if (options?.advanceToNext) {
                const currentIndex = currentFile ? fileList.indexOf(currentFile) : -1;
                const nextIndex = currentIndex + 1;
                if (nextIndex >= 0 && nextIndex < fileList.length) {
                    nextFile = fileList[nextIndex];
                } else if (currentIndex >= 0) {
                    nextFile = fileList[currentIndex] ?? '';
                } else {
                    nextFile = fileList[0] ?? '';
                }
            } else {
                nextFile = currentFile && fileList.includes(currentFile) ? currentFile : (fileList[0] ?? '');
            }
            setSelectedFile(nextFile);
            if (nextFile) {
                await loadResult(nextFolder, nextFile);
            } else {
                setResult(null);
            }
            setError(null);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to load benchmark results.';
            setError(message);
        } finally {
            setIsLoading(false);
        }
    };

    const goToPrevFile = () => {
        if (!hasPrevFile) return;
        setSelectedFile(files[selectedFileIndex - 1]);
    };

    const goToNextFile = async () => {
        if (!hasNextFile) {
            await refreshResults({ advanceToNext: true });
            return;
        }
        setSelectedFile(files[selectedFileIndex + 1]);
    };

    return (
        <div className="h-full overflow-y-auto p-6">
            <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
                <div className="rounded-lg border bg-card p-4">
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
                        <label className="flex flex-col gap-2 text-xs text-muted-foreground">
                            Result folder
                            <select
                                value={selectedFolder}
                                onChange={(e) => setSelectedFolder(e.target.value)}
                                className="h-9 rounded-md border bg-background px-2 text-xs text-foreground"
                            >
                                <option value="">Select a folder...</option>
                                {folders.map((folder) => (
                                    <option key={folder} value={folder}>
                                        {folder}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="flex flex-col gap-2 text-xs text-muted-foreground">
                            Result file
                            <div className="flex items-center gap-2">
                                <select
                                    value={selectedFile}
                                    onChange={(e) => setSelectedFile(e.target.value)}
                                    className="h-9 flex-1 rounded-md border bg-background px-2 text-xs text-foreground"
                                    disabled={!selectedFolder}
                                >
                                    <option value="">Select a JSON file...</option>
                                    {files.map((file) => (
                                        <option key={file} value={file}>
                                            {file}
                                        </option>
                                    ))}
                                </select>
                                <button
                                    type="button"
                                    onClick={goToPrevFile}
                                    className="h-9 rounded-md border px-3 text-[11px] font-medium text-foreground hover:bg-muted"
                                    disabled={!selectedFolder || isLoading || !hasPrevFile}
                                >
                                    Prev
                                </button>
                                <button
                                    type="button"
                                    onClick={goToNextFile}
                                    className="h-9 rounded-md border px-3 text-[11px] font-medium text-foreground hover:bg-muted"
                                    disabled={!canUseNext}
                                >
                                    Next
                                </button>
                            </div>
                        </label>
                    </div>
                    {error && (
                        <div className="mt-2 text-xs text-destructive">
                            {error}
                        </div>
                    )}
                    <p className="mt-2 hidden text-[11px] text-muted-foreground lg:block">
                        Select a run folder under benchmark/results, then choose the JSON result you want to render.
                    </p>
                </div>

                {result && (
                    <>
                        <div className="rounded-lg border bg-card p-4">
                            <h3 className="mb-2 text-sm font-medium">Question</h3>
                            <p className={cn("text-sm leading-relaxed", !result.question && "text-muted-foreground")}>
                                {result.question?.trim() || 'No question available.'}
                            </p>
                        </div>

                        <div className="rounded-lg border bg-card p-4">
                            <h3 className="mb-2 text-sm font-medium">Answer</h3>
                            <p className={cn("text-sm leading-relaxed", !result.answer && "text-muted-foreground")}>
                                {result.answer?.trim() || 'No answer returned.'}
                            </p>
                        </div>

                        {thinkingSteps.length > 0 ? (
                            <ThinkingProcess
                                steps={thinkingSteps}
                                isComplete={true}
                                onHitClick={(hit: ThinkingStepHit) => {
                                    if (!onReferenceOpen) return;
                                    onReferenceOpen({
                                        fileId: hit.fileId,
                                        score: hit.score ?? 0,
                                        summary: hit.summary,
                                        snippet: hit.snippet,
                                        metadata: hit.metadata ?? {},
                                        chunkId: hit.chunkId ?? null,
                                        hasAnswer: hit.hasAnswer,
                                        analysisComment: hit.analysisComment,
                                        analysisConfidence: hit.analysisConfidence
                                    });
                                }}
                            />
                        ) : (
                            steps.length > 0 && (
                                <AgentProcess
                                    steps={steps}
                                    isComplete={true}
                                    autoHide={false}
                                    onFileClick={(file) => {
                                        if (onReferenceOpen && file.fileId) {
                                            onReferenceOpen({
                                                fileId: file.fileId,
                                                score: file.score ?? 0,
                                                metadata: { name: file.label }
                                            });
                                        }
                                    }}
                                    recalledReferences={hits}
                                    onReferenceOpen={onReferenceOpen}
                                />
                            )
                        )}

                    </>
                )}
            </div>
        </div>
    );
}
