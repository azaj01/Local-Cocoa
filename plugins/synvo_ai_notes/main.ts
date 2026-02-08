/**
 * Notes Plugin - Main Process Entry Point
 * Registers IPC handlers for notes management functionality
 */

import { ipcMain } from 'electron';
import {
    listNotes,
    createNote,
    getNote,
    updateNote,
    deleteNote
} from '../../src/main/backendClient';
import { NoteDraftPayload } from '../../src/main/types';

export function registerHandlers() {
    ipcMain.handle('notes:list', async () => listNotes());

    ipcMain.handle('notes:create', async (_event, payload: NoteDraftPayload | undefined) => {
        return createNote(payload ?? {});
    });

    ipcMain.handle('notes:get', async (_event, payload: { noteId: string }) => {
        const noteId = payload?.noteId;
        if (!noteId) {
            throw new Error('Missing note id.');
        }
        return getNote(noteId);
    });

    ipcMain.handle('notes:update', async (_event, payload: { noteId: string; payload?: NoteDraftPayload }) => {
        const noteId = payload?.noteId;
        if (!noteId) {
            throw new Error('Missing note id.');
        }
        return updateNote(noteId, payload?.payload ?? {});
    });

    ipcMain.handle('notes:delete', async (_event, payload: { noteId: string }) => {
        const noteId = payload?.noteId;
        if (!noteId) {
            throw new Error('Missing note id.');
        }
        await deleteNote(noteId);
        return { id: noteId };
    });

    console.log('[Notes Plugin] IPC handlers registered');
}
