import { useState, useEffect } from 'react';
import { CheckCircle2, Circle, FileText, Search, Brain, Database } from 'lucide-react';
import { cn } from '../lib/utils';
import type { AgentStep, AgentStepFile } from '../types';

interface AgentProcessProps {
    steps: AgentStep[];
    isComplete?: boolean;
    className?: string;
    onFileClick?: (file: AgentStepFile) => void;
    autoHide?: boolean;
}

export function AgentProcess({ steps, isComplete = true, className, onFileClick, autoHide = false }: AgentProcessProps) {
    const [isExpanded, setIsExpanded] = useState(true);

    useEffect(() => {
        if (autoHide && isComplete) {
            const timer = setTimeout(() => {
                setIsExpanded(false);
            }, 1500); // Delay slightly to let user see completion
            return () => clearTimeout(timer);
        }
    }, [autoHide, isComplete]);

    if (!steps || steps.length === 0) return null;

    // Calculate summary stats for the collapsed view
    const totalFiles = steps.reduce((acc, step) => acc + (step.files?.length || 0), 0);
    const lastStep = steps[steps.length - 1];

    const summaryText = isComplete
        ? `${totalFiles} chunks retrieved via vector strategy`
        : (lastStep?.title || 'Processing...');

    return (
        <div className={cn("rounded-lg border bg-card overflow-hidden mb-4 transition-all duration-300 ease-in-out", className)}>
            <div className="flex items-center justify-between bg-card px-4 py-3 border-b border-transparent data-[expanded=true]:border-border" data-expanded={isExpanded}>
                <div className="flex items-center gap-3">
                    <div className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors",
                        isComplete ? "border-primary/20 bg-primary/5 text-primary" : "border-muted bg-muted/20 text-muted-foreground"
                    )}>
                        {isComplete ? (
                            <CheckCircle2 className="h-4 w-4" />
                        ) : (
                            <div className="h-3 w-3 rounded-full bg-primary animate-pulse" />
                        )}
                    </div>
                    <div className="flex flex-col items-start">
                        <span className="text-sm font-medium">Retrieval Diagnostics</span>
                        <span className="text-xs text-muted-foreground">
                            {summaryText}
                        </span>
                    </div>
                </div>
                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="text-xs font-medium text-primary hover:underline focus:outline-none"
                >
                    {isExpanded ? 'Hide details' : 'Show details'}
                </button>
            </div>

            {isExpanded && (
                <div className="bg-background p-4 space-y-6 animate-in slide-in-from-top-2 duration-200">
                    <div className="relative">
                        {/* Vertical line connecting steps */}
                        <div className="absolute left-[15px] top-3 bottom-3 w-px bg-border" />

                        {steps.map((step, index) => {
                            const Icon = getStepIcon(step.id);
                            const isLast = index === steps.length - 1;
                            const isActive = !isComplete && isLast;

                            return (
                                <div key={step.id + index} className="relative flex gap-4 mb-6 last:mb-0 group">
                                    <div className={cn(
                                        "relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-background transition-colors",
                                        isActive
                                            ? "border-primary text-primary ring-4 ring-primary/10"
                                            : "border-primary/30 text-primary"
                                    )}>
                                        <Icon className="h-4 w-4" />
                                    </div>
                                    <div className="flex-1 min-w-0 pt-1">
                                        <div className="flex items-center justify-between mb-1">
                                            <h4 className="text-sm font-medium leading-none">{step.title}</h4>
                                            {step.durationMs && (
                                                <span className="text-[10px] text-muted-foreground font-mono bg-muted/30 px-1.5 py-0.5 rounded">
                                                    {step.durationMs}ms
                                                </span>
                                            )}
                                        </div>
                                        {step.detail && (
                                            <p className="text-xs text-muted-foreground mb-2">
                                                {step.detail}
                                            </p>
                                        )}

                                        {/* Step Content (Files, Queries, etc) */}
                                        {step.queries && step.queries.length > 0 && (
                                            <div className="flex flex-wrap gap-2 mb-2">
                                                {step.queries.map((q, i) => (
                                                    <span key={i} className="inline-flex items-center rounded-full border bg-muted/30 px-2.5 py-0.5 text-[10px] text-muted-foreground">
                                                        <Search className="mr-1.5 h-3 w-3 opacity-70" />
                                                        {q}
                                                    </span>
                                                ))}
                                            </div>
                                        )}

                                        {step.files && step.files.length > 0 && (
                                            <div className="space-y-1.5 mt-2">
                                                {step.files.slice(0, 5).map((file, i) => (
                                                    <button
                                                        key={i}
                                                        onClick={() => onFileClick?.(file)}
                                                        className={cn(
                                                            "flex w-full items-center gap-3 text-xs text-muted-foreground bg-muted/10 rounded-md px-3 py-2 transition-all border border-transparent",
                                                            onFileClick ? "hover:bg-muted/30 hover:border-border hover:text-foreground cursor-pointer" : ""
                                                        )}
                                                    >
                                                        <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
                                                        <span className="truncate font-mono text-[11px]">{file.label}</span>
                                                        {file.score && (
                                                            <span className="ml-auto font-mono text-[10px] opacity-50">
                                                                {file.score.toFixed(2)}
                                                            </span>
                                                        )}
                                                    </button>
                                                ))}
                                                {step.files.length > 5 && (
                                                    <div className="text-[10px] text-muted-foreground pl-1 pt-1">
                                                        + {step.files.length - 5} more files
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

function getStepIcon(id: string) {
    if (id.includes('rewrite')) return Brain;
    if (id.includes('search') || id.includes('vector') || id.includes('lexical')) return Search;
    if (id.includes('rerank')) return Database;
    if (id.includes('answer')) return FileText;
    return Circle;
}
