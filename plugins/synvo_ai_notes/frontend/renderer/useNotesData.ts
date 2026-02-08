/**
 * Notes Plugin Data Hook
 * Centralizes notes CRUD operations for consistent use across the plugin and core app.
 */

import { useState, useCallback } from 'react';
import type { NoteSummary, NoteContent } from '@/types';

export function useNotesData() {
    const [notes, setNotes] = useState<NoteSummary[]>([]);
    const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
    const [selectedNote, setSelectedNote] = useState<NoteContent | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const loadNotes = useCallback(async () => {
        const api = window.api;
        if (!api?.listNotes) return;

        setLoading(true);
        try {
            const notesList = await api.listNotes();
            setNotes(notesList);
        } catch (error) {
            console.error('[NotesPlugin] Failed to load notes:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    const handleSelectNote = useCallback(async (noteId: string) => {
        const api = window.api;
        if (!api?.getNote) return;

        setSelectedNoteId(noteId);
        setLoading(true);
        try {
            const note = await api.getNote(noteId);
            setSelectedNote(note);
        } catch (error) {
            console.error('[NotesPlugin] Failed to load note:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    const handleCreateNote = useCallback(async () => {
        const api = window.api;
        if (!api?.createNote) return;

        try {
            const now = new Date();
            const defaultTitle = `${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
            const newNote = await api.createNote({ title: defaultTitle, body: '' });
            await loadNotes();
            await handleSelectNote(newNote.id);
            api.notifyNotesChanged?.();
        } catch (error) {
            console.error('[NotesPlugin] Failed to create note:', error);
        }
    }, [loadNotes, handleSelectNote]);

    const handleSaveNote = useCallback(async (noteId: string, payload: { title: string; body: string }) => {
        const api = window.api;
        if (!api?.updateNote) return;

        setSaving(true);
        try {
            const updated = await api.updateNote(noteId, payload);
            setSelectedNote(updated);
            await loadNotes();
            api.notifyNotesChanged?.();
        } catch (error) {
            console.error('[NotesPlugin] Failed to save note:', error);
        } finally {
            setSaving(false);
        }
    }, [loadNotes]);

    const handleDeleteNote = useCallback(async (noteId: string) => {
        const api = window.api;
        if (!api?.deleteNote) return;

        try {
            await api.deleteNote(noteId);
            setSelectedNoteId(null);
            setSelectedNote(null);
            await loadNotes();
            api.notifyNotesChanged?.();
        } catch (error) {
            console.error('[NotesPlugin] Failed to delete note:', error);
        }
    }, [loadNotes]);

    const handleBackToNotesList = useCallback(() => {
        setSelectedNoteId(null);
        setSelectedNote(null);
        window.api?.notifyNotesChanged?.();
    }, []);

    return {
        notes,
        selectedNoteId,
        selectedNote,
        loading,
        saving,
        loadNotes,
        handleSelectNote,
        handleCreateNote,
        handleSaveNote,
        handleDeleteNote,
        handleBackToNotesList,
        setSelectedNoteId
    };
}
