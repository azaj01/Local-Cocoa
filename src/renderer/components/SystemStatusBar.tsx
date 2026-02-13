import { useState } from 'react';
import { Cpu, HardDrive, Battery, BatteryCharging, Gauge, AlertTriangle, ChevronDown, ChevronUp, Activity } from 'lucide-react';
import { cn } from '../lib/utils';
import { useSkin } from './skin-provider';
import type { SystemResourceStatus } from '../types';

interface SystemStatusBarProps {
    status: SystemResourceStatus | null;
    /** Start collapsed (default true – hidden by default) */
    defaultCollapsed?: boolean;
}

/** Tiny horizontal bar showing a percentage fill. */
function MiniBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
    const pct = Math.min(100, Math.max(0, (value / max) * 100));
    return (
        <div className="h-1.5 w-12 rounded-full bg-secondary overflow-hidden">
            <div
                className={cn('h-full rounded-full transition-all duration-500', color)}
                style={{ width: `${pct}%` }}
            />
        </div>
    );
}

function barColor(pct: number): string {
    if (pct > 85) return 'bg-destructive';
    if (pct > 65) return 'bg-amber-500';
    return 'bg-emerald-500';
}

/**
 * Collapsible system status strip rendered just above the sidebar nav items.
 * Default: collapsed (shows a compact one-liner). Click to expand full metrics.
 */
export function SystemStatusBar({ status, defaultCollapsed = true }: SystemStatusBarProps) {
    const { skin } = useSkin();
    const isCocoaSkin = skin === 'local-cocoa';
    const [collapsed, setCollapsed] = useState(defaultCollapsed);

    if (!status) return null;

    const effectiveCpu = Math.max(0, status.cpuPercent - status.llamaCpuPercent);
    const hasGpu = status.gpuPercent !== null;
    const hasBattery = status.batteryPercent !== null;

    // Collapsed: thin clickable row
    if (collapsed) {
        return (
            <button
                onClick={() => setCollapsed(false)}
                className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2.5 py-1 text-[10px] transition-colors',
                    isCocoaSkin
                        ? 'text-[#a08050] hover:bg-[#3d2f1c]/30'
                        : 'text-muted-foreground hover:bg-accent/50',
                    status.throttled && (isCocoaSkin ? 'text-amber-400' : 'text-amber-600 dark:text-amber-400'),
                )}
            >
                <Activity className="h-3 w-3 shrink-0" />
                {status.throttled ? (
                    <span className="truncate flex items-center gap-1">
                        <AlertTriangle className="h-2.5 w-2.5" />
                        {status.throttleReason ?? 'Throttled'}
                    </span>
                ) : (
                    <span className="truncate tabular-nums">
                        CPU {effectiveCpu.toFixed(0)}% · MEM {status.memoryPercent.toFixed(0)}%
                        {hasGpu ? ` · GPU ${status.gpuPercent!.toFixed(0)}%` : ''}
                    </span>
                )}
                <ChevronDown className="h-2.5 w-2.5 ml-auto shrink-0" />
            </button>
        );
    }

    // Expanded: full metrics view
    return (
        <div
            className={cn(
                'px-2 pb-1 pt-0.5 space-y-1 text-[10px] select-none',
                isCocoaSkin ? 'text-[#a08050]' : 'text-muted-foreground',
            )}
        >
            {/* Collapse header */}
            <button
                onClick={() => setCollapsed(true)}
                className={cn(
                    'flex w-full items-center gap-2 rounded-md px-0.5 py-0.5 text-[10px] transition-colors',
                    isCocoaSkin ? 'hover:bg-[#3d2f1c]/30' : 'hover:bg-accent/50',
                )}
            >
                <Activity className="h-3 w-3 shrink-0" />
                <span className="text-[10px] font-medium">System</span>
                <ChevronUp className="h-2.5 w-2.5 ml-auto shrink-0" />
            </button>

            {/* Throttle banner */}
            {status.throttled && (
                <div
                    className={cn(
                        'flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium',
                        isCocoaSkin
                            ? 'bg-amber-900/40 text-amber-300'
                            : 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
                    )}
                >
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                    <span className="truncate">
                        {status.throttleReason ?? 'Indexing throttled'}
                    </span>
                </div>
            )}

            {/* Metric rows */}
            <div className="flex items-center gap-3 flex-wrap">
                {/* CPU */}
                <div className="inline-flex items-center gap-1" title={`CPU ${effectiveCpu.toFixed(0)}% (${status.cpuCoreCount} cores, llama ${status.llamaCpuPercent.toFixed(0)}%)`}>
                    <Cpu className="h-3 w-3 shrink-0" />
                    <MiniBar value={effectiveCpu} color={barColor(effectiveCpu)} />
                    <span className="w-7 text-right tabular-nums">{effectiveCpu.toFixed(0)}%</span>
                </div>

                {/* Memory */}
                <div className="inline-flex items-center gap-1" title={`RAM ${status.memoryUsedGb.toFixed(1)} / ${status.memoryTotalGb.toFixed(1)} GB (${status.memoryAvailableGb.toFixed(1)} GB free)`}>
                    <HardDrive className="h-3 w-3 shrink-0" />
                    <MiniBar value={status.memoryPercent} color={barColor(status.memoryPercent)} />
                    <span className="w-7 text-right tabular-nums">{status.memoryPercent.toFixed(0)}%</span>
                </div>

                {/* GPU (if available) */}
                {hasGpu && (
                    <div className="inline-flex items-center gap-1" title={`GPU ${status.gpuPercent!.toFixed(0)}%`}>
                        <Gauge className="h-3 w-3 shrink-0" />
                        <MiniBar value={status.gpuPercent!} color={barColor(status.gpuPercent!)} />
                        <span className="w-7 text-right tabular-nums">{status.gpuPercent!.toFixed(0)}%</span>
                    </div>
                )}

                {/* Battery */}
                {hasBattery && (
                    <div className="inline-flex items-center gap-1" title={status.onBattery ? 'On battery' : 'Plugged in'}>
                        {status.onBattery ? (
                            <Battery className="h-3 w-3 shrink-0" />
                        ) : (
                            <BatteryCharging className="h-3 w-3 shrink-0" />
                        )}
                        <span className="tabular-nums">{status.batteryPercent!.toFixed(0)}%</span>
                        {status.onBattery && (
                            <span className={cn(
                                'ml-0.5 text-[9px] font-medium uppercase',
                                isCocoaSkin ? 'text-amber-400' : 'text-amber-600 dark:text-amber-400'
                            )}>
                                BAT
                            </span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
