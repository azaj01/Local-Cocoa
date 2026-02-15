import { useState, useEffect, useCallback } from 'react';
import type { SystemResourceStatus } from '../types';

/** Normalise snake_case response from backend → camelCase for frontend */
function mapStatus(raw: any): SystemResourceStatus {
    return {
        cpuPercent: raw.cpu_percent ?? 0,
        cpuCoreCount: raw.cpu_core_count ?? 1,
        gpuPercent: raw.gpu_percent ?? null,
        gpuMemoryPercent: raw.gpu_memory_percent ?? null,
        memoryPercent: raw.memory_percent ?? 0,
        memoryUsedGb: raw.memory_used_gb ?? 0,
        memoryTotalGb: raw.memory_total_gb ?? 0,
        memoryAvailableGb: raw.memory_available_gb ?? 0,
        onBattery: raw.on_battery ?? false,
        batteryPercent: raw.battery_percent ?? null,
        llamaCpuPercent: raw.llama_cpu_percent ?? 0,
        llamaMemoryMb: raw.llama_memory_mb ?? 0,
        throttled: raw.throttled ?? false,
        throttleReason: raw.throttle_reason ?? null,
    };
}

const POLL_INTERVAL_MS = 5_000;

/**
 * Polls the backend `/system/status` endpoint for live CPU/GPU/RAM/battery
 * metrics and the auto-throttle state.
 */
export function useSystemStatus() {
    const [status, setStatus] = useState<SystemResourceStatus | null>(null);
    const [error, setError] = useState<string | null>(null);

    const refresh = useCallback(async () => {
        try {
            const raw = await window.api.getSystemResourceStatus();
            setStatus(mapStatus(raw));
            setError(null);
        } catch (err) {
            setError(String(err));
        }
    }, []);

    useEffect(() => {
        // Immediate first fetch
        void refresh(); // eslint-disable-line react-hooks/set-state-in-effect -- initial data load on mount
        const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [refresh]);

    return { status, error, refresh };
}
