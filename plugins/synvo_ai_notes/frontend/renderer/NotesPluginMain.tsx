import { useEffect, useCallback } from 'react';
import { NotesWorkspace } from './NotesWorkspace';
import { useNotesData } from './useNotesData';
import { useNotesPluginData } from '../hooks/useNotesPluginData';

interface NotesPluginMainProps {
    isIndexing: boolean;
    refreshData: () => Promise<void>;
}

export function NotesPluginMain({
    isIndexing,
    refreshData
}: NotesPluginMainProps) {
    const {
        notes,
        selectedNoteId,
        selectedNote,
        loading: notesLoading,
        saving: notesSaving,
        loadNotes,
        handleSelectNote,
        handleCreateNote,
        handleSaveNote,
        handleDeleteNote,
    } = useNotesData();

    const {
        noteIndexingItems,
        loading: dataLoading,
        refreshData: _refreshPluginData
    } = useNotesPluginData();

    // Load notes on mount
    useEffect(() => {
        void loadNotes();
    }, [loadNotes]);

    const handleRescanNotes = useCallback(async () => {
        const api = (window as any).api;
        if (!api?.runStagedIndex) return;
        try {
            // We'd ideally need the notes folder ID here
            // For now we'll just trigger a general refresh or wait for full implementation
            await refreshData();
        } catch (error) {
            console.error('Failed to rescan notes', error);
        }
    }, [refreshData]);

    return (
        <div className="h-full w-full overflow-hidden p-6 bg-background">
            <NotesWorkspace
                notes={notes}
                selectedNoteId={selectedNoteId}
                selectedNote={selectedNote}
                loading={notesLoading || dataLoading}
                saving={notesSaving}
                onSelectNote={handleSelectNote}
                onCreateNote={handleCreateNote}
                onDeleteNote={handleDeleteNote}
                onSaveNote={handleSaveNote}
                pendingItems={noteIndexingItems}
                onRescanIndex={handleRescanNotes}
                indexingBusy={isIndexing}
            />
        </div>
    );
}
