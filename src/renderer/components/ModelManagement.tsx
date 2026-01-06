import { useEffect, useMemo, useState, CSSProperties } from 'react';
import { Download, Check, AlertCircle, Cpu, HardDrive, Box, RotateCcw, Activity, Save, CheckCircle2 } from 'lucide-react';
import { useModelStatus } from '../hooks/useModelStatus';
import { useModelConfig } from '../hooks/useModelConfig';
import { useWorkspaceData } from '../hooks/useWorkspaceData';
import { cn } from '../lib/utils';
import type { ModelAssetStatus } from '../types';

interface ModelGroup {
    id: string;
    label: string;
    assets: ModelAssetStatus[];
    ready: boolean;
}

function groupAssets(assets: ModelAssetStatus[]): ModelGroup[] {
    const groups: Record<string, ModelGroup> = {};

    assets.forEach(asset => {
        let groupId = 'other';
        let groupLabel = 'Other Assets';

        if (asset.id.includes('vlm') || asset.id.includes('mmproj')) {
            groupId = 'vlm';
            groupLabel = 'Vision Language Model (VLM)';
        } else if (asset.id.includes('embedding')) {
            groupId = 'embedding';
            groupLabel = 'Embedding Model';
        } else if (asset.id.includes('reranker') || asset.id.includes('bge')) {
            groupId = 'reranker';
            groupLabel = 'Reranker Model';
        }

        if (!groups[groupId]) {
            groups[groupId] = {
                id: groupId,
                label: groupLabel,
                assets: [],
                ready: true
            };
        }

        groups[groupId].assets.push(asset);
        if (!asset.exists) {
            groups[groupId].ready = false;
        }
    });

    // Sort assets within groups
    Object.values(groups).forEach(group => {
        group.assets.sort((a, b) => a.label.localeCompare(b.label));
    });

    // Sort order: VLM first, then Embedding, then Reranker, then others
    const order = ['vlm', 'embedding', 'reranker', 'other'];
    return Object.values(groups).sort((a, b) => {
        const aIdx = order.indexOf(a.id);
        const bIdx = order.indexOf(b.id);
        return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    });
}

export function ModelManagement() {
    const { modelStatus, handleManualModelDownload, handleRedownloadModel, modelDownloadEvent } = useModelStatus();
    const { config, loading, updateConfig } = useModelConfig();
    const { health, systemSpecs } = useWorkspaceData();

    const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties;

    const isDownloading = modelDownloadEvent?.state === 'downloading';

    const totalMemory = systemSpecs?.totalMemory ?? 0;
    const GB = 1024 * 1024 * 1024;

    let maxAllowedContext = 32768;
    if (totalMemory > 0) {
        if (totalMemory < 22 * GB) {
            maxAllowedContext = 8192;
        } else if (totalMemory < 30 * GB) {
            maxAllowedContext = 16384;
        }
    }

    const rangeClassName =
        'h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2';
    
    // State for save success message
    const [showSaveSuccess, setShowSaveSuccess] = useState(false);
    
    const allowedContextSizes = useMemo(() => {
        return [2048, 4096, 8192, 16384, 32768].filter((value) => value <= maxAllowedContext);
    }, [maxAllowedContext]);

    const visionOptions = useMemo(() => {
        return [
            { value: 200704, label: 'Low (448×448)' },
            { value: 501760, label: 'Medium (700×700)' },
            { value: 1003520, label: 'High (1280×720)' },
            { value: 2073600, label: 'Ultra (1920×1080)' }
        ];
    }, []);

    const discreteSummaryTokens = useMemo(() => [128, 256, 512, 1024], []);
    const discreteSearchLimits = useMemo(() => [9, 15, 30, 60], []);
    const discreteSnippetLengths = useMemo(() => [1000, 2000, 4000, 8000], []);

    const [contextSizeIdx, setContextSizeIdx] = useState(0);
    const [visionIdx, setVisionIdx] = useState(2);
    const [qaContextLimitDraft, setQaContextLimitDraft] = useState(5);
    const [summaryTokensIdx, setSummaryTokensIdx] = useState(1);
    const [searchLimitIdx, setSearchLimitIdx] = useState(1);
    const [snippetLengthIdx, setSnippetLengthIdx] = useState(1);

    const [embedBatchSizeDraft, setEmbedBatchSizeDraft] = useState(10);
    const [embedBatchDelayDraft, setEmbedBatchDelayDraft] = useState(10);
    const [visionBatchDelayDraft, setVisionBatchDelayDraft] = useState(200);

    useEffect(() => {
        if (!config) return;

        const currentContextSize = allowedContextSizes.includes(config.contextSize)
            ? config.contextSize
            : allowedContextSizes[0] ?? 4096;
        setContextSizeIdx(Math.max(0, allowedContextSizes.indexOf(currentContextSize)));

        const currentVision = typeof config.visionMaxPixels === 'number' ? config.visionMaxPixels : 1003520;
        const nextVisionIdx = visionOptions.findIndex((opt) => opt.value === currentVision);
        setVisionIdx(nextVisionIdx >= 0 ? nextVisionIdx : 2);

        setQaContextLimitDraft(typeof config.qaContextLimit === 'number' ? config.qaContextLimit : 5);

        const summaryValue = typeof config.summaryMaxTokens === 'number' ? config.summaryMaxTokens : 256;
        const nextSummaryIdx = discreteSummaryTokens.indexOf(summaryValue);
        setSummaryTokensIdx(nextSummaryIdx >= 0 ? nextSummaryIdx : 1);

        const searchValue = typeof config.searchResultLimit === 'number' ? config.searchResultLimit : 15;
        const nextSearchIdx = discreteSearchLimits.indexOf(searchValue);
        setSearchLimitIdx(nextSearchIdx >= 0 ? nextSearchIdx : 1);

        const snippetValue = typeof config.maxSnippetLength === 'number' ? config.maxSnippetLength : 2000;
        const nextSnippetIdx = discreteSnippetLengths.indexOf(snippetValue);
        setSnippetLengthIdx(nextSnippetIdx >= 0 ? nextSnippetIdx : 1);

        setEmbedBatchSizeDraft(typeof config.embedBatchSize === 'number' ? config.embedBatchSize : 10);
        setEmbedBatchDelayDraft(typeof config.embedBatchDelayMs === 'number' ? config.embedBatchDelayMs : 10);
        setVisionBatchDelayDraft(typeof config.visionBatchDelayMs === 'number' ? config.visionBatchDelayMs : 200);
    }, [
        allowedContextSizes,
        config?.contextSize,
        config?.embedBatchDelayMs,
        config?.embedBatchSize,
        config?.maxSnippetLength,
        config?.qaContextLimit,
        config?.searchResultLimit,
        config?.summaryMaxTokens,
        config?.visionBatchDelayMs,
        config?.visionMaxPixels,
        discreteSearchLimits,
        discreteSnippetLengths,
        discreteSummaryTokens,
        visionOptions
    ]);

    // Hide save success message when window loses focus (user switches tabs)
    useEffect(() => {
        const handleBlur = () => {
            setShowSaveSuccess(false);
        };

        window.addEventListener('blur', handleBlur);
        return () => {
            window.removeEventListener('blur', handleBlur);
        };
    }, []);

    // Auto-scroll to download button if models are missing
    useEffect(() => {
        if (modelStatus && !modelStatus.ready && !isDownloading) {
            const downloadSection = document.getElementById('model-download-section');
            if (downloadSection) {
                downloadSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, [modelStatus, isDownloading]);

    useEffect(() => {
        if (config && config.contextSize > maxAllowedContext) {
            updateConfig({ contextSize: 4096 });
        }
    }, [maxAllowedContext, config, updateConfig]);

    const handleContextSizeChange = (newSize: number) => {
        let recommendedPixels = 1003520; // Default High (1280x720)
        
        if (newSize <= 2048) {
            recommendedPixels = 200704; // Low (448x448)
        } else if (newSize <= 4096) {
            recommendedPixels = 501760; // Medium (700x700)
        } else {
            recommendedPixels = 1003520; // High (1280x720)
        }

        updateConfig({ 
            contextSize: newSize,
            visionMaxPixels: recommendedPixels
        });
    };

    if (!modelStatus || !config) {
        return (
            <div className="flex h-40 items-center justify-center text-muted-foreground">
                <div className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    <span>Loading model information...</span>
                </div>
            </div>
        );
    }

    const modelGroups = groupAssets(modelStatus.assets);
    const vlmModels = modelStatus.assets.filter(a => a.id.includes('vlm') && !a.id.includes('mmproj'));
    
    // Get available embedding models (those that exist)
    const embeddingModels = modelStatus.assets.filter(a => 
        a.id.includes('embedding') && a.exists
    );
    const currentEmbeddingModelId = config.activeEmbeddingModelId || 'embedding-q4';

    const commitContextSize = (nextIdx: number) => {
        const selected = allowedContextSizes[nextIdx];
        if (!selected || selected === config.contextSize) return;
        handleContextSizeChange(selected);
    };

    const commitVisionMaxPixels = (nextIdx: number) => {
        const selected = visionOptions[nextIdx]?.value;
        if (!selected || selected === config.visionMaxPixels) return;
        updateConfig({ visionMaxPixels: selected });
    };

    const commitDiscrete = (kind: 'summary' | 'search' | 'snippet', nextIdx: number) => {
        if (kind === 'summary') {
            const selected = discreteSummaryTokens[nextIdx];
            if (!selected || selected === config.summaryMaxTokens) return;
            updateConfig({ summaryMaxTokens: selected });
        }
        if (kind === 'search') {
            const selected = discreteSearchLimits[nextIdx];
            if (!selected || selected === config.searchResultLimit) return;
            updateConfig({ searchResultLimit: selected });
        }
        if (kind === 'snippet') {
            const selected = discreteSnippetLengths[nextIdx];
            if (!selected || selected === config.maxSnippetLength) return;
            updateConfig({ maxSnippetLength: selected });
        }
    };

    const commitIndexingPerf = () => {
        const next: Record<string, number> = {};
        if (embedBatchSizeDraft !== (config.embedBatchSize ?? 10)) next.embedBatchSize = embedBatchSizeDraft;
        if (embedBatchDelayDraft !== (config.embedBatchDelayMs ?? 10)) next.embedBatchDelayMs = embedBatchDelayDraft;
        if (visionBatchDelayDraft !== (config.visionBatchDelayMs ?? 200)) next.visionBatchDelayMs = visionBatchDelayDraft;
        if (qaContextLimitDraft !== (config.qaContextLimit ?? 5)) next.qaContextLimit = qaContextLimitDraft;
        if (Object.keys(next).length) updateConfig(next as any);
    };

    return (
        <div className="flex h-full flex-col bg-background">
            <div className="flex items-center justify-between border-b px-6 py-4 pt-12" style={dragStyle}>
                <div>
                    <h2 className="text-sm font-semibold">Models</h2>
                    <p className="text-xs text-muted-foreground">Configure model, context, and indexing defaults</p>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-8">
                <div className="space-y-4">
                    <h3 className="text-sm font-medium">System Health</h3>
                    <div className="rounded-lg border bg-card p-4 space-y-3">
                        {health?.services?.map((service) => (
                            <div key={service.name} className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Activity className="h-4 w-4 text-muted-foreground" />
                                    <span className="text-sm font-medium">{service.name}</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span
                                        className={cn(
                                            'h-2 w-2 rounded-full',
                                            service.status === 'online' ? 'bg-emerald-500' : 'bg-red-500'
                                        )}
                                    />
                                    <span className="text-xs text-muted-foreground">
                                        {service.status === 'online'
                                            ? `${Math.round(service.latencyMs || 0)}ms`
                                            : service.details || 'Offline'}
                                    </span>
                                </div>
                            </div>
                        ))}
                        {(!health?.services || health.services.length === 0) && (
                            <div className="flex items-center justify-center py-2">
                                <span className="text-xs text-muted-foreground">{health?.message || 'Checking services...'}</span>
                            </div>
                        )}
                    </div>
                </div>




                {/* Embedding Model Selection */}
                {embeddingModels.length > 1 && (
                    <div className="space-y-4">
                        <h3 className="text-sm font-medium">Active Embedding Model</h3>
                        <div className="rounded-lg border bg-card p-4">
                            <p className="text-xs text-muted-foreground mb-3">
                                Select which embedding model to use for indexing and search. Changing this will restart the embedding service.
                            </p>
                            <div className="space-y-2">
                                {embeddingModels.map((model) => {
                                    const isActive = model.id === currentEmbeddingModelId;
                                    return (
                                        <button
                                            key={model.id}
                                            onClick={() => {
                                                if (!isActive) {
                                                    updateConfig({ activeEmbeddingModelId: model.id });
                                                }
                                            }}
                                            className={cn(
                                                "w-full flex items-center justify-between rounded-lg border p-3 transition-colors",
                                                isActive 
                                                    ? "border-primary bg-primary/5" 
                                                    : "border-input hover:bg-muted/50"
                                            )}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={cn(
                                                    "h-3 w-3 rounded-full border-2",
                                                    isActive 
                                                        ? "border-primary bg-primary" 
                                                        : "border-muted-foreground"
                                                )} />
                                                <div className="text-left">
                                                    <p className="text-sm font-medium">{model.label}</p>
                                                    <p className="text-xs text-muted-foreground font-mono">
                                                        {model.path.split('/').pop()}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                {model.sizeBytes && (
                                                    <span className="text-xs text-muted-foreground font-mono">
                                                        {(model.sizeBytes / 1024 / 1024).toFixed(1)} MB
                                                    </span>
                                                )}
                                                {isActive && (
                                                    <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                                                        Active
                                                    </span>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                <div className="space-y-4" id="model-download-section">
                    <h3 className="text-sm font-medium">Model Assets</h3>
                    <div className="rounded-lg border bg-card p-4">
                        <div className="mb-4 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <HardDrive className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm font-medium">Installed Models</span>
                            </div>
                            <button
                                onClick={() => handleManualModelDownload()}
                                disabled={isDownloading}
                                className={cn(
                                    "inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
                                    "bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 py-2",
                                    !modelStatus.ready && !isDownloading && "animate-pulse ring-2 ring-primary ring-offset-2"
                                )}
                            >
                                {isDownloading ? (
                                    <>
                                        <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                        Downloading...
                                    </>
                                ) : (
                                    <>
                                        <Download className="mr-2 h-4 w-4" />
                                        Update Models
                                    </>
                                )}
                            </button>
                        </div>

                        <div className="space-y-6">
                    {modelGroups.map((group) => (
                        <div key={group.id} className="space-y-3">
                            <div className="flex items-center gap-2 pb-2 border-b">
                                <Box className="h-4 w-4 text-muted-foreground" />
                                <h3 className="text-sm font-medium">{group.label}</h3>
                                <div className={cn(
                                    "ml-auto text-[10px] uppercase tracking-wider px-2 py-0.5 rounded-full",
                                    group.ready ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"
                                )}>
                                    {group.ready ? "Installed" : "Not Installed"}
                                </div>
                            </div>
                            <div className="grid gap-3">
                                {group.assets.map((asset) => {
                                    const isDownloadingThis = isDownloading && modelDownloadEvent?.assetId === asset.id;
                                    const disableRedownload = isDownloading && !isDownloadingThis;
                                    return (
                                        <div
                                            key={asset.id}
                                            className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 transition-colors hover:bg-muted/50"
                                        >
                                            <div className="flex items-center justify-between w-full">
                                                <div className="flex items-start gap-3">
                                                    <div className={cn(
                                                        "mt-1.5 h-2 w-2 rounded-full shrink-0",
                                                        asset.exists ? "bg-emerald-500" : "bg-amber-500"
                                                    )} />
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-medium leading-none truncate">{asset.label}</p>
                                                        <p className="mt-1 text-xs text-muted-foreground font-mono truncate max-w-[300px]" title={asset.path}>
                                                            {asset.path.split('/').pop()}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-4 shrink-0">
                                                    {asset.sizeBytes && (
                                                        <span className="text-xs text-muted-foreground font-mono">
                                                            {(asset.sizeBytes / 1024 / 1024).toFixed(1)} MB
                                                        </span>
                                                    )}
                                                    {asset.exists ? (
                                                        <Check className="h-4 w-4 text-emerald-500" />
                                                    ) : (
                                                        <AlertCircle className="h-4 w-4 text-amber-500" />
                                                    )}
                                                </div>
                                            </div>
                                            {asset.exists && (
                                                <div className="flex items-center justify-end">
                                                    <button
                                                        onClick={() => handleRedownloadModel(asset.id)}
                                                        disabled={disableRedownload}
                                                        className={cn(
                                                            "inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs font-medium text-muted-foreground transition-colors",
                                                            "hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
                                                        )}
                                                        title="Remove the current file and download a fresh copy"
                                                    >
                                                        {isDownloadingThis ? (
                                                            <div className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                                                        ) : (
                                                            <RotateCcw className="h-3.5 w-3.5" />
                                                        )}
                                                        Force Redownload
                                                    </button>
                                                </div>
                                            )}
                                            {isDownloadingThis && (
                                                <div className="w-full">
                                                    <div className="flex items-center justify-between mb-1.5">
                                                        <span className="text-xs text-muted-foreground">{modelDownloadEvent.message}</span>
                                                        <span className="text-xs font-medium">{Math.round(modelDownloadEvent.percent ?? 0)}%</span>
                                                    </div>
                                                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-background/50">
                                                        <div
                                                            className="h-full bg-primary transition-all duration-300 ease-in-out"
                                                            style={{ width: `${modelDownloadEvent.percent ?? 0}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>

                {modelDownloadEvent?.message && !modelDownloadEvent.assetId && (
                    <div className="mt-6 rounded-lg border bg-muted/50 p-4">
                        <div className="flex items-center justify-between mb-2">
                            <span className="text-sm font-medium">{modelDownloadEvent.message}</span>
                            {modelDownloadEvent.percent !== null && modelDownloadEvent.percent !== undefined && (
                                <span className="text-sm text-muted-foreground">{Math.round(modelDownloadEvent.percent)}%</span>
                            )}
                        </div>
                        {modelDownloadEvent.percent !== null && (
                            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                                <div
                                    className="h-full bg-primary transition-all duration-300 ease-in-out"
                                    style={{ width: `${modelDownloadEvent.percent}%` }}
                                />
                            </div>
                        )}
                    </div>
                )}
                    </div>
                </div>
            </div>
        </div>
    );
}
