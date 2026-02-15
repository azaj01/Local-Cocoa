/**
 * useEtaEstimator – Estimates remaining time for each indexing stage.
 *
 * Uses an EWMA (exponentially-weighted moving average) of file-processing rate
 * to smooth out per-poll jitter and produce a stable ETA.
 *
 * Returns formatted ETA strings for each stage, the overall active stage,
 * and a helper for per-file ETA based on the currently-processing IndexingItem.
 */

import { useRef, useMemo } from 'react';
import type { StagedIndexProgress, StageProgress } from '../../electron/backendClient';
import type { IndexingItem } from '../types';

// ─── Types ─────────────────────────────────────────────────────────────────────

type StageName = 'fast_text' | 'fast_embed' | 'deep';

interface StageSnapshot {
    /** done-count when we first started tracking this stage */
    startDone: number;
    /** Date.now() when we first started tracking */
    startTime: number;
    /** EWMA-smoothed rate (files / ms) */
    rate: number;
    /** done-count on the previous tick (for detecting resets) */
    prevDone: number;
}

export interface StageEta {
    /** Remaining seconds (null if not enough data) */
    remainingSeconds: number | null;
    /** Human-readable string: "~3 min", "< 1 min", "Estimating…" */
    label: string;
    /** The stage this ETA belongs to */
    stage: StageName;
}

export interface EtaEstimate {
    /** Per-stage ETAs keyed by stage name */
    stages: Record<StageName, StageEta>;
    /** ETA for the currently active stage (convenience) */
    active: StageEta | null;
    /** ETA label for the per-file processing item */
    fileEtaLabel: string | null;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

/** EWMA smoothing factor (0–1). Higher = more weight on recent observations. */
const ALPHA = 0.3;
/** Minimum elapsed ms before we trust the rate estimate. */
const MIN_ELAPSED_MS = 5_000;
/** Minimum rate (files/ms) below which we show "Estimating…". */
const MIN_RATE = 0.000_001; // ~1 file per 1 000 s
/** Maximum ETA we'll display (48 hours). */
const MAX_ETA_S = 48 * 3600;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function formatEta(seconds: number | null): string {
    if (seconds === null) return 'Estimating…';
    if (seconds <= 0) return '< 1 min';
    if (seconds < 60) return '< 1 min';
    if (seconds < 3600) {
        const m = Math.round(seconds / 60);
        return `~${m} min`;
    }
    if (seconds < MAX_ETA_S) {
        const h = Math.floor(seconds / 3600);
        const m = Math.round((seconds % 3600) / 60);
        return m > 0 ? `~${h}h ${m}m` : `~${h}h`;
    }
    return '> 1 day';
}

function computeStageEta(
    snapshot: StageSnapshot | undefined,
    stage: StageProgress,
    total: number,
    stageName: StageName,
): StageEta {
    if (!snapshot || snapshot.rate < MIN_RATE) {
        return { remainingSeconds: null, label: 'Estimating…', stage: stageName };
    }
    const done = stageName === 'deep'
        ? stage.done + (stage.skipped ?? 0) + stage.error
        : stage.done;
    const remaining = Math.max(0, total - done);
    if (remaining === 0) {
        return { remainingSeconds: 0, label: 'Done', stage: stageName };
    }
    const etaMs = remaining / snapshot.rate;
    const etaS = Math.min(MAX_ETA_S, etaMs / 1000);
    return { remainingSeconds: etaS, label: formatEta(etaS), stage: stageName };
}

/** Estimate per-file remaining time from its progress % and startedAt. */
function computeFileEta(item: IndexingItem | null): string | null {
    if (!item) return null;
    const pct = item.progress ?? 0;
    if (pct <= 0 || !item.startedAt) return null;
    const elapsed = Date.now() - new Date(item.startedAt).getTime();
    if (elapsed < 3000 || pct < 1) return null; // not enough data yet
    const totalEstMs = (elapsed / pct) * (100 - pct);
    const seconds = totalEstMs / 1000;
    return formatEta(seconds);
}

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useEtaEstimator(
    stageProgress: StagedIndexProgress | null | undefined,
    isIndexing: boolean,
    isPaused: boolean,
    processingItem: IndexingItem | null,
): EtaEstimate {
    const snapshots = useRef<Partial<Record<StageName, StageSnapshot>>>({});

    // eslint-disable-next-line react-hooks/purity -- Date.now() is inherently needed for ETA time tracking
    const nowRef = useRef(Date.now());
    nowRef.current = Date.now(); // eslint-disable-line react-hooks/purity

    /** Update snapshots and compute ETAs. Runs every render (cheap). */
    const estimate = useMemo<EtaEstimate>(() => {
        const empty: StageEta = { remainingSeconds: null, label: '', stage: 'fast_text' };
        const noData: EtaEstimate = {
            stages: {
                fast_text: { ...empty, stage: 'fast_text' },
                fast_embed: { ...empty, stage: 'fast_embed' },
                deep: { ...empty, stage: 'deep' },
            },
            active: null,
            fileEtaLabel: null,
        };

        if (!stageProgress || !isIndexing || stageProgress.total === 0) {
            // Reset snapshots when not indexing so a future run starts fresh
            snapshots.current = {};
            return noData;
        }

        const now = nowRef.current;
        const stageNames: StageName[] = ['fast_text', 'fast_embed', 'deep'];
        const total = stageProgress.total;

        // Update each stage snapshot
        for (const name of stageNames) {
            const sp = stageProgress[name];
            const done = name === 'deep'
                ? sp.done + (sp.skipped ?? 0) + sp.error
                : sp.done;

            const prev = snapshots.current[name];

            if (!prev) {
                // First observation
                snapshots.current[name] = {
                    startDone: done,
                    startTime: now,
                    rate: 0,
                    prevDone: done,
                };
                continue;
            }

            // Detect reset (e.g. new folder added, db cleared)
            if (done < prev.prevDone) {
                snapshots.current[name] = {
                    startDone: done,
                    startTime: now,
                    rate: 0,
                    prevDone: done,
                };
                continue;
            }

            // Don't accumulate time while paused
            if (isPaused) {
                prev.prevDone = done;
                continue;
            }

            const elapsedMs = now - prev.startTime;
            if (elapsedMs < MIN_ELAPSED_MS) {
                prev.prevDone = done;
                continue;
            }

            // Instantaneous rate since tracking start
            const delta = done - prev.startDone;
            if (delta > 0) {
                const instantRate = delta / elapsedMs;
                prev.rate = prev.rate > 0
                    ? prev.rate * (1 - ALPHA) + instantRate * ALPHA
                    : instantRate;
            }
            prev.prevDone = done;
        }

        // Build per-stage ETAs
        const stages: Record<StageName, StageEta> = {
            fast_text: computeStageEta(snapshots.current.fast_text, stageProgress.fast_text, total, 'fast_text'),
            fast_embed: computeStageEta(snapshots.current.fast_embed, stageProgress.fast_embed, total, 'fast_embed'),
            deep: computeStageEta(snapshots.current.deep, stageProgress.deep, total, 'deep'),
        };

        // Determine active stage
        let active: StageEta | null = null;
        const textPct = stageProgress.fast_text.percent;
        const embedPct = stageProgress.fast_embed.percent;
        const deepPct = stageProgress.deep.percent;
        if (textPct < 100) {
            active = stages.fast_text;
        } else if (stageProgress.semantic_enabled && embedPct < 100) {
            active = stages.fast_embed;
        } else if (stageProgress.deep_enabled && deepPct < 100) {
            active = stages.deep;
        }

        // Per-file ETA
        const fileEtaLabel = computeFileEta(processingItem);

        return { stages, active, fileEtaLabel };
    }, [stageProgress, isIndexing, isPaused, processingItem]);

    return estimate;
}

/** Re-export the formatter so other components can use it standalone. */
export { formatEta };
