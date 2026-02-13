/**
 * Plugin Data Management System
 * Allows plugins to register their own data refresh handlers
 */

import { useCallback, useEffect, useRef } from 'react';

export interface PluginDataHandler {
    pluginId: string;
    refreshData: () => Promise<void>;
    cleanup?: () => void;
}

// Global registry for plugin data handlers
const pluginDataHandlers = new Map<string, PluginDataHandler>();

/**
 * Register a plugin's data refresh handler
 * This should be called by each plugin during initialization
 */
export function registerPluginDataHandler(handler: PluginDataHandler): void {
    pluginDataHandlers.set(handler.pluginId, handler);
    console.log(`[PluginData] Registered data handler for plugin: ${handler.pluginId}`);
}

/**
 * Unregister a plugin's data refresh handler
 */
export function unregisterPluginDataHandler(pluginId: string): void {
    const handler = pluginDataHandlers.get(pluginId);
    if (handler?.cleanup) {
        handler.cleanup();
    }
    pluginDataHandlers.delete(pluginId);
    console.log(`[PluginData] Unregistered data handler for plugin: ${pluginId}`);
}

/**
 * Get a plugin's data refresh handler
 */
export function getPluginDataHandler(pluginId: string): PluginDataHandler | undefined {
    return pluginDataHandlers.get(pluginId);
}

/**
 * Hook to manage plugin data refresh based on active tab
 * This hook will automatically call the active plugin's refreshData function
 */
export function usePluginData(activePluginId: string | null) {
    const lastActivePluginRef = useRef<string | null>(null);
    const refreshIntervalRef = useRef<number | null>(null);

    const refreshActivePluginData = useCallback(async () => {
        if (!activePluginId) return;
        
        const handler = pluginDataHandlers.get(activePluginId);
        if (handler) {
            try {
                await handler.refreshData();
            } catch (error) {
                console.error(`[PluginData] Failed to refresh data for plugin ${activePluginId}:`, error);
            }
        }
    }, [activePluginId]);

    // Refresh data when active plugin changes
    useEffect(() => {
        if (activePluginId && activePluginId !== lastActivePluginRef.current) {
            console.log(`[PluginData] Active plugin changed to: ${activePluginId}`);
            lastActivePluginRef.current = activePluginId;
            
            // Immediate refresh
            void refreshActivePluginData();
            
            // Set up periodic refresh (every 10 seconds)
            if (refreshIntervalRef.current !== null) {
                window.clearInterval(refreshIntervalRef.current);
            }
            
            refreshIntervalRef.current = window.setInterval(() => {
                void refreshActivePluginData();
            }, 10000);
        }
        
        return () => {
            if (refreshIntervalRef.current !== null) {
                window.clearInterval(refreshIntervalRef.current);
                refreshIntervalRef.current = null;
            }
        };
    }, [activePluginId, refreshActivePluginData]);

    return {
        refreshActivePluginData
    };
}
