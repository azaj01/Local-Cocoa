import { useState, useCallback, useEffect } from 'react';
import type { NoteSummary, NoteContent } from '../types';

export function useNotesData() {
    const [notes, setNotes] = useState<NoteSummary[]>([]);
    const [notesCache, setNotesCache] = useState<Record<string, NoteContent>>({});
    const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
    const [isNoteLoading, setIsNoteLoading] = useState(false);
    const [isNoteSaving, setIsNoteSaving] = useState(false);

    const refreshNoteSummaries = useCallback(async () => {
        const api = window.api;
        if (!api?.listNotes) return [] as NoteSummary[];
        try {
            const items = await api.listNotes();
            setNotes(items);
            return items;
        } catch (error) {
            console.error('Failed to refresh notes list', error);
            return [] as NoteSummary[];
        }
    }, []);

    const handleSelectNote = useCallback(
        async (noteId: string) => {
            const api = window.api;
            setSelectedNoteId(noteId);
            if (!api?.getNote) {
                return;
            }
            if (notesCache[noteId]) {
                return;
            }
            setIsNoteLoading(true);
            try {
                const detail = await api.getNote(noteId);
                setNotesCache((prev) => ({ ...prev, [noteId]: detail }));
            } catch (error) {
                console.error('Failed to load note content', error);
            } finally {
                setIsNoteLoading(false);
            }
        },
        [notesCache]
    );

    const handleCreateNote = useCallback(async () => {
        const api = window.api;
        if (!api?.createNote) {
            console.warn('Notes bridge unavailable.');
            return;
        }
        const timestamp = new Date();
        const defaultTitle = `New note ${timestamp.toLocaleDateString()} ${timestamp.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit'
        })}`;
        try {
            const summary = await api.createNote({ title: defaultTitle });
            await refreshNoteSummaries();
            setSelectedNoteId(summary.id);
            try {
                const detail = await api.getNote(summary.id);
                setNotesCache((prev) => ({ ...prev, [summary.id]: detail }));
            } catch (detailError) {
                console.error('Failed to load new note content', detailError);
            }
        } catch (error) {
            console.error('Failed to create note', error);
        }
    }, [refreshNoteSummaries]);

    const handleSaveNote = useCallback(
        async (noteId: string, payload: { title: string; body: string }) => {
            const api = window.api;
            if (!api?.updateNote) {
                console.warn('Notes bridge unavailable.');
                return;
            }
            setIsNoteSaving(true);
            try {
                const updated = await api.updateNote(noteId, { title: payload.title, body: payload.body });
                setNotesCache((prev) => ({ ...prev, [noteId]: updated }));
                await refreshNoteSummaries();
            } catch (error) {
                console.error('Failed to save note', error);
            } finally {
                setIsNoteSaving(false);
            }
        },
        [refreshNoteSummaries]
    );

    const handleDeleteNote = useCallback(
        async (noteId: string) => {
            const api = window.api;
            if (!api?.deleteNote) {
                console.warn('Notes bridge unavailable.');
                return;
            }
            if (!window.confirm('Delete this note?')) {
                return;
            }
            try {
                await api.deleteNote(noteId);
                setNotesCache((prev) => {
                    const next = { ...prev };
                    delete next[noteId];
                    return next;
                });
                await refreshNoteSummaries();
                setSelectedNoteId((prev) => (prev === noteId ? null : prev));
            } catch (error) {
                console.error('Failed to delete note', error);
            }
        },
        [refreshNoteSummaries]
    );

    useEffect(() => {
        if (!notes.length) {
            setSelectedNoteId(null);
            return;
        }
        if (selectedNoteId && notes.some((note) => note.id === selectedNoteId)) {
            return;
        }
        const firstNote = notes[0];
        void handleSelectNote(firstNote.id);
    }, [notes, selectedNoteId, handleSelectNote]);

    // Listen for notes changes from other windows (e.g., spotlight)
    useEffect(() => {
        const api = window.api;
        if (!api?.onNotesChanged) return;

        const cleanup = api.onNotesChanged(() => {
            void refreshNoteSummaries();
        });

        return cleanup;
    }, [refreshNoteSummaries]);

    return {
        notes,
        selectedNoteId,
        selectedNote: selectedNoteId ? notesCache[selectedNoteId] ?? null : null,
        isNoteLoading,
        isNoteSaving,
        refreshNoteSummaries,
        handleSelectNote,
        handleCreateNote,
        handleSaveNote,
        handleDeleteNote
    };
}
