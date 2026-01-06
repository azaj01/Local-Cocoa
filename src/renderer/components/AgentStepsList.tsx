import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { AgentStep } from '../types';
import { cn } from '../lib/utils';

interface AgentStepsListProps {
    steps: AgentStep[];
    idPrefix: string;
    className?: string;
}

function summariseStep(step: AgentStep): string {
    const bits: string[] = [];
    if (step.detail) {
        bits.push(step.detail);
    }
    if (step.queries && step.queries.length) {
        bits.push(`${step.queries.length} quer${step.queries.length === 1 ? 'y' : 'ies'}`);
    }
    if (step.items && step.items.length) {
        bits.push(`${step.items.length} note${step.items.length === 1 ? '' : 's'}`);
    }
    if (step.files && step.files.length) {
        bits.push(`${step.files.length} file${step.files.length === 1 ? '' : 's'}`);
    }
    if (typeof step.durationMs === 'number') {
        bits.push(`${step.durationMs} ms`);
    }
    return bits.join(' · ');
}

function formatFileLabel(label: string): string {
    const normalised = label.replace(/\\/g, '/');
    const segments = normalised.split('/').filter(Boolean);
    return segments[segments.length - 1] ?? label;
}

export function AgentStepsList({ steps, idPrefix, className }: AgentStepsListProps) {
    const [activeKey, setActiveKey] = useState<string | null>(null);

    const keys = useMemo(
        () => steps.map((step, index) => `${idPrefix}-${step.id ?? 'step'}-${index}`),
        [idPrefix, steps]
    );

    const activeIndex = activeKey ? keys.indexOf(activeKey) : -1;
    const activeStep = activeIndex >= 0 ? steps[activeIndex] : null;

    if (!steps.length) {
        return null;
    }

    return (
        <div className={cn("space-y-2", className)}>
            <div className="space-y-1">
                {steps.map((step, index) => {
                    const key = keys[index];
                    const isActive = key === activeKey;
                    const summary = summariseStep(step) || 'No additional context';
                    return (
                        <button
                            key={key}
                            type="button"
                            onClick={() => setActiveKey(isActive ? null : key)}
                            className={cn(
                                "flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-[11px] transition-colors",
                                isActive
                                    ? "border-primary/50 bg-primary/5 text-foreground"
                                    : "border-transparent bg-muted/30 text-muted-foreground hover:bg-muted/50"
                            )}
                        >
                            <div className="min-w-0 pr-3">
                                <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-primary/80 line-clamp-1">{step.title}</p>
                                <p className="truncate text-xs opacity-80">{summary}</p>
                            </div>
                            {isActive ? (
                                <ChevronUp className="h-4 w-4 text-muted-foreground" />
                            ) : (
                                <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            )}
                        </button>
                    );
                })}
            </div>
            {activeStep ? (
                <div className="rounded-lg border bg-card p-3 text-[11px] text-card-foreground shadow-sm">
                    <div className="flex flex-wrap items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="font-semibold uppercase tracking-[0.3em] text-primary/80">{activeStep.title}</span>
                        {activeStep.status ? <span>{activeStep.status}</span> : null}
                        {typeof activeStep.durationMs === 'number' ? <span>{activeStep.durationMs} ms</span> : null}
                    </div>
                    {activeStep.detail ? (
                        <p className="mt-2 text-xs text-foreground/90">{activeStep.detail}</p>
                    ) : null}
                    {activeStep.files && activeStep.files.length ? (
                        <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
                            {activeStep.files.map((file) => (
                                <span
                                    key={`${activeKey}-${file.fileId}`}
                                    className="rounded-full border bg-muted px-2 py-1 text-muted-foreground"
                                >
                                    {formatFileLabel(file.label)}
                                    {typeof file.score === 'number' ? ` (${file.score.toFixed(2)})` : ''}
                                </span>
                            ))}
                        </div>
                    ) : null}
                    {activeStep.queries && activeStep.queries.length ? (
                        <div className="mt-3 space-y-1">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">Queries</p>
                            {activeStep.queries.map((query, queryIndex) => (
                                <p key={`${activeKey}-query-${queryIndex}`} className="rounded-md border bg-muted/30 px-2 py-1 text-xs text-foreground">
                                    {query}
                                </p>
                            ))}
                        </div>
                    ) : null}
                    {activeStep.items && activeStep.items.length ? (
                        <div className="mt-3 space-y-1">
                            <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">Notes</p>
                            {activeStep.items.map((item, itemIndex) => (
                                <p key={`${activeKey}-item-${itemIndex}`} className="rounded-md border bg-muted/30 px-2 py-1 text-xs text-foreground">
                                    {item}
                                </p>
                            ))}
                        </div>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
