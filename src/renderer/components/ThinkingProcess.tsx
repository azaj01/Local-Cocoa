import { useState, useEffect, useRef } from 'react';
import { cn } from '../lib/utils';
import { 
    ChevronDown, 
    ChevronRight, 
    Search, 
    GitBranch, 
    FileText, 
    Sparkles,
    CheckCircle2,
    Loader2,
    Layers,
    Zap,
    Brain
} from 'lucide-react';
import type { ThinkingStep, ThinkingStepStatus, ThinkingStepHit } from '../types';

interface ThinkingStepNodeProps {
    step: ThinkingStep;
    isLast: boolean;
    depth?: number;
    onHitClick?: (hit: ThinkingStepHit) => void;
}

function getStepIcon(type: ThinkingStep['type'], status: ThinkingStepStatus) {
    const iconClass = cn(
        "h-4 w-4 transition-all duration-300",
        status === 'running' && "animate-pulse"
    );

    switch (type) {
        case 'decompose':
            return <GitBranch className={iconClass} />;
        case 'subquery':
            return <Search className={iconClass} />;
        case 'search':
            return <FileText className={iconClass} />;
        case 'analyze':
            return <Brain className={iconClass} />;
        case 'merge':
            return <Layers className={iconClass} />;
        case 'synthesize':
            return <Sparkles className={iconClass} />;
        default:
            return <Zap className={iconClass} />;
    }
}

function getStatusColor(status: ThinkingStepStatus, type: ThinkingStep['type']) {
    switch (status) {
        case 'complete':
            if (type === 'synthesize') return 'bg-gradient-to-br from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/30';
            if (type === 'merge') return 'bg-gradient-to-br from-blue-500 to-cyan-500 text-white shadow-lg shadow-blue-500/30';
            return 'bg-gradient-to-br from-green-500 to-emerald-500 text-white shadow-lg shadow-green-500/30';
        case 'running':
            return 'bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-orange-500/30 animate-pulse';
        case 'error':
            return 'bg-gradient-to-br from-red-500 to-rose-500 text-white shadow-lg shadow-red-500/30';
        default:
            return 'bg-muted text-muted-foreground';
    }
}

function getLineColor(status: ThinkingStepStatus) {
    switch (status) {
        case 'complete':
            return 'bg-gradient-to-b from-green-400 to-green-500';
        case 'running':
            return 'bg-gradient-to-b from-orange-400 to-orange-300 animate-pulse';
        default:
            return 'bg-border';
    }
}

// Helper to check if a hit is relevant
// NOTE: Patterns are split into two categories:
// 1. Explicit markers (no_answer, no answer) - checked globally (LLM's explicit signal)
// 2. Contextual phrases - checked only in first sentence to avoid false positives
function isHitRelevant(hit: ThinkingStepHit): boolean {
    if (hit.hasAnswer === undefined) return false;
    if (!hit.hasAnswer) return false;
    const comment = hit.analysisComment?.toLowerCase() || '';
    
    // Explicit markers - check globally (LLM's clear signal)
    if (comment.includes('no_answer') || comment.includes('no answer')) {
        return false;
    }
    
    // Contextual patterns - only check in first sentence to avoid false positives
    const firstSentence = comment.split(/[.?!]\s/)[0] || comment;
    if (firstSentence.includes('not relevant') || firstSentence.includes('does not')) {
        return false;
    }
    return true;
}

// Get relevance badge for a hit
function RelevanceBadge({ hit }: { hit: ThinkingStepHit }) {
    if (hit.hasAnswer === undefined) {
        return null; // Not yet analyzed
    }
    
    const isRelevant = isHitRelevant(hit);
    const confidence = hit.analysisConfidence ?? 0;
    
    if (!isRelevant) {
        return (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                Not relevant
            </span>
        );
    }
    
    if (confidence >= 0.8) {
        return (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                High relevance
            </span>
        );
    }
    if (confidence >= 0.6) {
        return (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                Medium relevance
            </span>
        );
    }
    return (
        <span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400">
            Low relevance
        </span>
    );
}

// Embedded hit item component
// Embedded hit item component - controlled by parent for accordion behavior
function EmbeddedHitItem({ 
    hit, 
    index, 
    isExpanded,
    onToggle,
    onHitClick 
}: { 
    hit: ThinkingStepHit; 
    index: number; 
    isExpanded: boolean;
    onToggle: () => void;
    onHitClick?: (hit: ThinkingStepHit) => void;
}) {
    const isRelevant = isHitRelevant(hit);
    const wasAnalyzed = hit.hasAnswer !== undefined;
    
    const name = (hit.metadata?.name as string) || hit.fileId?.split('/').pop() || 'Unknown';
    const path = (hit.metadata?.path as string) || hit.fileId;
    const pageNum = hit.metadata?.page_number || hit.metadata?.pageNumber;
    const pageDisplay = pageNum ? `Page ${pageNum}` : null;
    const hasExpandableContent = hit.analysisComment || hit.snippet;
    
    // Click on the main area: trigger preview AND toggle expand
    const handleMainClick = () => {
        // Trigger preview
        if (onHitClick) {
            onHitClick(hit);
        }
        // Toggle expand (accordion style - handled by parent)
        if (hasExpandableContent) {
            onToggle();
        }
    };
    
    // Toggle expand/collapse only (for the button)
    const handleToggleExpand = (e: React.MouseEvent) => {
        e.stopPropagation();
        onToggle();
    };
    
    return (
        <div className={cn(
            "rounded-lg border text-left transition-all",
            wasAnalyzed && isRelevant 
                ? "bg-card border-green-200 dark:border-green-800/50 hover:border-green-300 dark:hover:border-green-700" 
                : wasAnalyzed && !isRelevant
                    ? "bg-card border-red-200 dark:border-red-800/30 hover:border-red-300 dark:hover:border-red-700"
                    : "bg-card border-border hover:border-primary/30"
        )}>
            <div
                className="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors cursor-pointer hover:bg-muted/50"
                onClick={handleMainClick}
            >
                <div className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold",
                    wasAnalyzed && isRelevant 
                        ? "bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-400"
                        : wasAnalyzed && !isRelevant
                            ? "bg-red-100 text-red-600 dark:bg-red-900/50 dark:text-red-400"
                            : "bg-muted text-muted-foreground"
                )}>
                    {index + 1}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <p className="truncate text-xs font-medium text-foreground">{name}</p>
                        <RelevanceBadge hit={hit} />
                    </div>
                    <div className="flex items-center gap-2">
                        {path && <p className="truncate text-[10px] text-muted-foreground max-w-[150px]">{path}</p>}
                        {pageDisplay && (
                            <>
                                {path && <span className="text-[10px] text-muted-foreground">•</span>}
                                <p className="text-[10px] text-muted-foreground font-medium">{pageDisplay}</p>
                            </>
                        )}
                    </div>
                </div>
                
                {/* Expand/collapse toggle button */}
                {hasExpandableContent && (
                    <button
                        type="button"
                        onClick={handleToggleExpand}
                        className="p-1.5 rounded hover:bg-muted transition-colors shrink-0"
                        title={isExpanded ? "Collapse" : "Expand details"}
                    >
                        <ChevronDown className={cn(
                            "h-3.5 w-3.5 text-muted-foreground transition-transform duration-200",
                            isExpanded && "rotate-180"
                        )} />
                    </button>
                )}
            </div>
            
            {/* Analysis comment - with animation */}
            {isExpanded && hit.analysisComment && (
                <div className={cn(
                    "mx-2 mb-2 px-3 py-2 rounded-md border-l-2 animate-in slide-in-from-top-1 duration-150",
                    isRelevant
                        ? "border-green-400 dark:border-green-600 bg-green-50/50 dark:bg-green-900/10"
                        : "border-red-300 dark:border-red-700 bg-red-50/50 dark:bg-red-900/10"
                )}>
                    <p className={cn(
                        "text-[10px] leading-relaxed",
                        isRelevant
                            ? "text-green-700 dark:text-green-400"
                            : "text-red-600 dark:text-red-400"
                    )}>
                        <span className="font-medium">AI Analysis: </span>
                        {hit.analysisComment}
                    </p>
                </div>
            )}
            
            {/* Snippet preview - with animation */}
            {isExpanded && hit.snippet && (
                <div className="mx-2 mb-2 px-3 py-2 rounded-md bg-muted/30 border animate-in slide-in-from-top-1 duration-150">
                    <p className="text-[10px] text-muted-foreground font-mono leading-relaxed line-clamp-3">
                        {hit.snippet}
                    </p>
                </div>
            )}
        </div>
    );
}

// Embedded hits panel for search steps - with accordion behavior
function EmbeddedHitsPanel({ hits, subQuery, onHitClick }: { 
    hits: ThinkingStepHit[]; 
    subQuery?: string;
    onHitClick?: (hit: ThinkingStepHit) => void;
}) {
    // Accordion state: track which item is expanded (null = none)
    const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
    
    const analyzedHits = hits.filter(h => h.hasAnswer !== undefined);
    const relevantHits = hits.filter(isHitRelevant);
    const hasAnalysis = analyzedHits.length > 0;
    
    // Sort hits: relevant first, then by confidence
    const sortedHits = [...hits].sort((a, b) => {
        const aRelevant = isHitRelevant(a);
        const bRelevant = isHitRelevant(b);
        if (aRelevant && !bRelevant) return -1;
        if (!aRelevant && bRelevant) return 1;
        return (b.analysisConfidence ?? 0) - (a.analysisConfidence ?? 0);
    });
    
    // Toggle accordion - if clicking same item, collapse it; otherwise expand the new one
    const handleToggle = (sortedIdx: number) => {
        setExpandedIndex(prev => prev === sortedIdx ? null : sortedIdx);
    };

    // Stop propagation to prevent parent collapse
    const handlePanelClick = (e: React.MouseEvent) => {
        e.stopPropagation();
    };

    return (
        <div 
            className="mt-2 rounded-lg border bg-card/50 overflow-hidden animate-in slide-in-from-top-2 duration-200"
            onClick={handlePanelClick}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b">
                <div className="flex items-center gap-2">
                    <Layers className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-medium text-foreground">Recalled Context</span>
                </div>
                <span className="text-[10px] text-muted-foreground">
                    {hasAnalysis ? (
                        <>
                            <span className="text-green-600 dark:text-green-400 font-medium">{relevantHits.length} relevant</span>
                            {' / '}
                            {hits.length} sources
                        </>
                    ) : (
                        `${hits.length} sources`
                    )}
                </span>
            </div>
            
            {/* Sub-query display */}
            {subQuery && (
                <div className="px-3 py-1.5 bg-blue-50/50 dark:bg-blue-900/10 border-b">
                    <p className="text-[10px] text-blue-700 dark:text-blue-400">
                        <span className="font-medium">Query: </span>
                        {subQuery}
                    </p>
                </div>
            )}
            
            {/* Hits list - accordion style */}
            <div className="p-2 space-y-1.5 max-h-[300px] overflow-y-auto">
                {sortedHits.map((hit, sortedIdx) => (
                    <EmbeddedHitItem 
                        key={hit.chunkId || hit.fileId || sortedIdx} 
                        hit={hit} 
                        index={hits.indexOf(hit)}
                        isExpanded={expandedIndex === sortedIdx}
                        onToggle={() => handleToggle(sortedIdx)}
                        onHitClick={onHitClick}
                    />
                ))}
            </div>
        </div>
    );
}

function ThinkingStepNode({ step, isLast, depth = 0, onHitClick }: ThinkingStepNodeProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const hasHits = step.hits && step.hits.length > 0;
    const hasAnswer = !!step.subQueryAnswer;
    const hasDetails = step.details || step.metadata?.sources?.length || hasHits || hasAnswer;
    const nodeRef = useRef<HTMLDivElement>(null);

    // Auto-scroll when step becomes running
    useEffect(() => {
        if (step.status === 'running' && nodeRef.current) {
            nodeRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }, [step.status]);
    
    // Auto-expand search steps that have hits, or analyze steps that have answers
    useEffect(() => {
        if (hasHits && step.type === 'search' && step.status === 'complete') {
            setIsExpanded(true);
        }
        if (hasAnswer && step.type === 'analyze' && step.status === 'complete') {
            setIsExpanded(true);
        }
    }, [hasHits, hasAnswer, step.type, step.status]);

    return (
        <div ref={nodeRef} className="relative">
            {/* Vertical connecting line */}
            {!isLast && (
                <div 
                    className={cn(
                        "absolute left-[15px] top-[32px] w-[2px] transition-all duration-500",
                        isExpanded && hasHits ? "bottom-0" : "-bottom-2",
                        getLineColor(step.status)
                    )}
                />
            )}

            <div 
                className={cn(
                    "flex items-start gap-3 py-2 group",
                    hasDetails && "cursor-pointer"
                )}
                onClick={() => hasDetails && setIsExpanded(!isExpanded)}
            >
                {/* Node circle */}
                <div 
                    className={cn(
                        "relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all duration-300",
                        getStatusColor(step.status, step.type)
                    )}
                >
                    {step.status === 'running' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        getStepIcon(step.type, step.status)
                    )}
                    
                    {/* Pulse ring for running status */}
                    {step.status === 'running' && (
                        <span className="absolute inset-0 rounded-full animate-ping bg-orange-400/50" />
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pt-1">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn(
                            "text-sm font-medium transition-colors",
                            step.status === 'complete' ? "text-foreground" : 
                            step.status === 'running' ? "text-orange-600 dark:text-orange-400" :
                            "text-muted-foreground"
                        )}>
                            {step.title}
                        </span>
                        
                        {/* Status badges */}
                        {step.metadata?.resultsCount !== undefined && (
                            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                                {step.metadata.resultsCount} results
                            </span>
                        )}
                        {step.metadata?.relevantCount !== undefined && (
                            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                                {step.metadata.relevantCount} relevant
                            </span>
                        )}
                        {step.metadata?.strategy && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                                {step.metadata.strategy}
                            </span>
                        )}
                        
                        {/* Expand indicator */}
                        {hasDetails && (
                            <button className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 hover:bg-muted rounded">
                                {isExpanded ? (
                                    <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                                ) : (
                                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                                )}
                            </button>
                        )}
                    </div>
                    
                    {/* Summary */}
                    {step.summary && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {step.summary}
                        </p>
                    )}

                    {/* Expanded content */}
                    {isExpanded && (
                        <div 
                            className="mt-2 overflow-hidden animate-in slide-in-from-top-2 duration-200"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Sub-query answer panel for analyze steps */}
                            {hasAnswer && (
                                <div className="rounded-lg border bg-gradient-to-br from-purple-50/50 to-blue-50/50 dark:from-purple-900/10 dark:to-blue-900/10 border-purple-200/50 dark:border-purple-800/30 overflow-hidden">
                                    <div className="flex items-center gap-2 px-3 py-2 bg-purple-100/30 dark:bg-purple-900/20 border-b border-purple-200/30 dark:border-purple-800/30">
                                        <Sparkles className="h-3.5 w-3.5 text-purple-600 dark:text-purple-400" />
                                        <span className="text-xs font-medium text-purple-700 dark:text-purple-400">Sub-query Answer</span>
                                    </div>
                                    {step.subQuery && (
                                        <div className="px-3 py-1.5 bg-muted/30 border-b">
                                            <p className="text-[10px] text-muted-foreground">
                                                <span className="font-medium">Query: </span>
                                                {step.subQuery}
                                            </p>
                                        </div>
                                    )}
                                    <div className="p-3">
                                        <p className="text-xs text-foreground leading-relaxed">
                                            {step.subQueryAnswer}
                                        </p>
                                    </div>
                                    {/* Sources for this answer */}
                                    {step.metadata?.sources && step.metadata.sources.length > 0 && (
                                        <div className="px-3 pb-2 flex flex-wrap gap-1.5">
                                            {step.metadata.sources.map((source, idx) => (
                                                <span 
                                                    key={idx}
                                                    className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded bg-purple-100/50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 truncate max-w-[150px]"
                                                    title={source}
                                                >
                                                    <FileText className="h-2.5 w-2.5 shrink-0" />
                                                    {source.split('/').pop()}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}
                            
                            {/* Embedded hits panel */}
                            {hasHits && (
                                <EmbeddedHitsPanel 
                                    hits={step.hits!} 
                                    subQuery={step.subQuery}
                                    onHitClick={onHitClick}
                                />
                            )}
                            
                            {/* Details */}
                            {step.details && (
                                <div className="mt-2 p-3 rounded-lg bg-muted/50 border text-xs font-mono whitespace-pre-wrap text-muted-foreground max-h-[200px] overflow-y-auto">
                                    {step.details}
                                </div>
                            )}
                            
                            {/* Sources (if no hits and no answer) */}
                            {!hasHits && !hasAnswer && step.metadata?.sources && step.metadata.sources.length > 0 && (
                                <div className="mt-2 space-y-1">
                                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Sources</span>
                                    <div className="flex flex-wrap gap-1.5">
                                        {step.metadata.sources.map((source, idx) => (
                                            <span 
                                                key={idx}
                                                className="inline-flex items-center gap-1 text-[10px] px-2 py-1 rounded-md bg-card border text-muted-foreground truncate max-w-[200px]"
                                                title={source}
                                            >
                                                <FileText className="h-3 w-3 shrink-0" />
                                                {source.split('/').pop()}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Nested children */}
            {step.children && step.children.length > 0 && (
                <div className="ml-6 pl-4 border-l-2 border-dashed border-muted">
                    {step.children.map((child, idx) => (
                        <ThinkingStepNode 
                            key={child.id} 
                            step={child} 
                            isLast={idx === step.children!.length - 1}
                            depth={depth + 1}
                            onHitClick={onHitClick}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

interface ThinkingProcessProps {
    steps: ThinkingStep[];
    isComplete?: boolean;
    className?: string;
    onHitClick?: (hit: ThinkingStepHit) => void;
}

export function ThinkingProcess({ steps, isComplete = false, className, onHitClick }: ThinkingProcessProps) {
    const [isCollapsed, setIsCollapsed] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Auto-collapse when complete (with delay)
    useEffect(() => {
        if (isComplete && steps.length > 0) {
            const timer = setTimeout(() => setIsCollapsed(true), 2000);
            return () => clearTimeout(timer);
        }
    }, [isComplete, steps.length]);

    if (!steps || steps.length === 0) return null;

    return (
        <div 
            ref={containerRef}
            className={cn(
                "relative rounded-xl border bg-gradient-to-br from-card to-card/50 overflow-hidden transition-all duration-500",
                isCollapsed ? "max-h-[52px]" : "max-h-[2000px]",
                className
            )}
        >
            {/* Header */}
            <div 
                className={cn(
                    "flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors",
                    isCollapsed ? "hover:bg-muted/30" : "border-b bg-muted/20"
                )}
                onClick={() => setIsCollapsed(!isCollapsed)}
            >
                <div className={cn(
                    "flex h-7 w-7 items-center justify-center rounded-lg transition-all duration-300",
                    isComplete 
                        ? "bg-gradient-to-br from-green-500 to-emerald-500 text-white shadow-md shadow-green-500/20" 
                        : "bg-gradient-to-br from-orange-400 to-amber-500 text-white shadow-md shadow-orange-500/20"
                )}>
                    {isComplete ? (
                        <CheckCircle2 className="h-4 w-4" />
                    ) : (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                </div>
                <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold text-foreground">
                        {isComplete ? 'Multi-Path Retrieval Complete' : 'Multi-Path Retrieval in Progress'}
                    </span>
                    <span className="ml-2 text-xs text-muted-foreground">
                        {steps.length} steps
                    </span>
                </div>
                <button className="p-1 hover:bg-muted rounded transition-colors">
                    {isCollapsed ? (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    ) : (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                </button>
            </div>

            {/* Steps timeline */}
            <div className={cn(
                "px-4 pb-4 pt-2 transition-all duration-300",
                isCollapsed && "opacity-0"
            )}>
                {steps.map((step, idx) => (
                    <ThinkingStepNode 
                        key={step.id} 
                        step={step} 
                        isLast={idx === steps.length - 1}
                        onHitClick={onHitClick}
                    />
                ))}
            </div>

            {/* Glow effect when running */}
            {!isComplete && (
                <div className="absolute inset-0 pointer-events-none">
                    <div className="absolute -inset-1 bg-gradient-to-r from-orange-500/10 via-transparent to-orange-500/10 blur-xl animate-pulse" />
                </div>
            )}
        </div>
    );
}
