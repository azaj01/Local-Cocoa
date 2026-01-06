import { ipcMain, desktopCapturer, systemPreferences } from 'electron';
import {
    ingestScreenshot,
    getActivityTimeline,
    deleteActivityLog
} from '../backendClient';

export function registerActivityHandlers() {
    ipcMain.handle('activity:ingest', async (_event, payload: { image: Uint8Array }) => {
        if (!payload?.image) {
            throw new Error('Missing image data.');
        }
        return ingestScreenshot(payload.image);
    });

    ipcMain.handle('activity:timeline', async (_event, payload: { start?: string; end?: string; summary?: boolean }) => {
        return getActivityTimeline(payload?.start, payload?.end, payload?.summary);
    });

    ipcMain.handle('activity:delete', async (_event, payload: { logId: string }) => {
        if (!payload?.logId) {
            throw new Error('Missing log id.');
        }
        await deleteActivityLog(payload.logId);
        return { id: payload.logId };
    });

    ipcMain.handle('activity:capture', async () => {
        if (process.platform === 'darwin') {
            const status = systemPreferences.getMediaAccessStatus('screen');
            if (status !== 'granted') {
                console.warn('Screen access status:', status);
            }
        }

        try {
            const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 720 } });
            const primarySource = sources[0]; // Assuming primary screen for now
            if (!primarySource) {
                throw new Error('No screen source found.');
            }
            return primarySource.thumbnail.toJPEG(70); // Return JPEG bytes
        } catch (error) {
            console.error('Screen capture failed:', error);
            throw new Error('Screen capture failed. Please ensure Screen Recording permission is granted in System Settings.');
        }
    });
}
