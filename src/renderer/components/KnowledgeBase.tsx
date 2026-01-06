import { useState, CSSProperties } from 'react';
import { Search, Folder, StickyNote } from 'lucide-react';
import { cn } from '../lib/utils';
import { RetrievalPanel } from './RetrievalPanel';
import { IndexedFilesPanel } from './IndexedFilesPanel';
import { NotesWorkspace } from './NotesWorkspace';
import type {
    FolderRecord,
    IndexedFile,
    IndexResultSnapshot,
    IndexProgressUpdate,
    IndexingItem,
    NoteSummary,
    NoteContent,
} from '../types';

interface KnowledgeBaseProps {
    folders: FolderRecord[];
    folderStats?: Map<string, { indexed: number; pending: number }>;
    files: IndexedFile[];
    snapshot: IndexResultSnapshot | null;
    isIndexing: boolean;
    indexProgress?: IndexProgressUpdate | null;

    // Folder actions
    onAddFolder: () => Promise<void>;
    onAddFile?: () => Promise<void>;
    onRemoveFolder: (id: string) => Promise<void>;
    onRescanFolder: (id: string, mode?: 'fast' | 'fine') => Promise<void>;
    onReindexFolder: (id: string, mode?: 'fast' | 'fine') => Promise<void>;
    indexingItems?: IndexingItem[];

    // Notes props
    notes: NoteSummary[];
    selectedNoteId: string | null;
    selectedNote: NoteContent | null;
    notesLoading: boolean;
    notesSaving: boolean;
    onSelectNote: (noteId: string) => void;
    onCreateNote: () => void;
    onDeleteNote: (noteId: string) => void;
    onSaveNote: (noteId: string, payload: { title: string; body: string }) => void;
    notesPendingItems?: IndexingItem[];
    onRescanNotesIndex?: () => void;
    onReindexNotesIndex?: () => void;

    // File actions
    onSelectFile: (file: IndexedFile) => void;
    onOpenFile?: (file: IndexedFile) => void | Promise<void>;
    onAskAboutFile: (file: IndexedFile) => Promise<void>;
}

type Tab = 'search' | 'folders' | 'notes';

export function KnowledgeBase({
    folders,
    folderStats,
    files,
    snapshot,
    isIndexing,
    indexProgress,
    onAddFolder,
    onAddFile,
    onRemoveFolder,
    onRescanFolder,
    onReindexFolder,
    indexingItems,
    notes,
    selectedNoteId,
    selectedNote,
    notesLoading,
    notesSaving,
    onSelectNote,
    onCreateNote,
    onDeleteNote,
    onSaveNote,
    notesPendingItems,
    onRescanNotesIndex,
    onReindexNotesIndex,
    onSelectFile,
    onOpenFile,
    onAskAboutFile
}: KnowledgeBaseProps) {
    const [activeTab, setActiveTab] = useState<Tab>('folders');
    const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
    const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

    return (
        <div className="flex h-full flex-col bg-background">
            {/* Header Region - Draggable */}
            <div className="flex-none border-b px-6 pt-8 pb-0" style={dragStyle}>
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-lg font-semibold tracking-tight">File System</h2>
                        <p className="text-xs text-muted-foreground">Manage your files, and notes</p>
                    </div>
                </div>

                {/* Tabs - Non-draggable */}
                <div className="flex items-center gap-6" style={noDragStyle}>
                    <button
                        onClick={() => setActiveTab('folders')}
                        className={cn(
                            "flex items-center gap-2 py-3 text-sm font-medium border-b-2 transition-colors",
                            activeTab === 'folders'
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <Folder className="h-4 w-4" />
                        Files
                    </button>
                    <button
                        onClick={() => setActiveTab('notes')}
                        className={cn(
                            "flex items-center gap-2 py-3 text-sm font-medium border-b-2 transition-colors",
                            activeTab === 'notes'
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <StickyNote className="h-4 w-4" />
                        Notes
                    </button>
                    <button
                        onClick={() => setActiveTab('search')}
                        className={cn(
                            "flex items-center gap-2 py-3 text-sm font-medium border-b-2 transition-colors",
                            activeTab === 'search'
                                ? "border-primary text-primary"
                                : "border-transparent text-muted-foreground hover:text-foreground"
                        )}
                    >
                        <Search className="h-4 w-4" />
                        Search
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden p-6">
                <div className="h-full w-full">
                    {activeTab === 'search' && (
                        <RetrievalPanel
                            files={files}
                            snapshot={snapshot}
                            isIndexing={isIndexing}
                            onSelectFile={onSelectFile}
                            onOpenFile={onOpenFile}
                            onAskAboutFile={onAskAboutFile}
                        />
                    )}

                    {activeTab === 'folders' && (
                        <IndexedFilesPanel
                            folders={folders}
                            files={files}
                            indexingItems={indexingItems}
                            isIndexing={isIndexing}
                            onAddFolder={onAddFolder}
                            onAddFile={onAddFile}
                            onRemoveFolder={onRemoveFolder}
                            onReindexFolder={onReindexFolder}
                            onSelectFile={onSelectFile}
                            onOpenFile={onOpenFile}
                        />
                    )}

                    {activeTab === 'notes' && (
                        <NotesWorkspace
                            notes={notes}
                            selectedNoteId={selectedNoteId}
                            selectedNote={selectedNote}
                            loading={notesLoading}
                            saving={notesSaving}
                            onSelectNote={onSelectNote}
                            onCreateNote={onCreateNote}
                            onDeleteNote={onDeleteNote}
                            onSaveNote={onSaveNote}
                            pendingItems={notesPendingItems}
                            onRescanIndex={onRescanNotesIndex}
                            onReindexIndex={onReindexNotesIndex}
                            indexingBusy={isIndexing}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}
