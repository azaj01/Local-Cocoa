/**
 * IndexedFilesPanel Component
 * 
 * Displays all indexed files with:
 * - Collapsible folder groups
 * - Flat list view option
 * - Add folder functionality (register only, user chooses how to index)
 * - Individual file actions (reindex, delete, open)
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    Folder,
    FolderOpen,
    Plus,
    FileText,
    Trash2,
    ChevronDown,
    ChevronRight,
    ExternalLink,
    RefreshCw,
    Filter,
    LayoutList,
    FolderTree,
    Search,
    Clock,
    HardDrive,
    AlertTriangle,
    Loader2,
    ArrowUp,
    Check,
} from 'lucide-react';
import { cn } from '../lib/utils';
import type { FolderRecord, IndexedFile, IndexingItem } from '../types';

// ============================================
// Helper Functions
// ============================================

function formatBytes(size: number): string {
    if (!Number.isFinite(size) || size <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = size;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit += 1;
    }
    return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

function formatTimestamp(value: string | null | undefined): string {
    if (!value) return 'Never';
    try {
        return new Date(value).toLocaleString();
    } catch {
        return value;
    }
}

function formatRelativeTime(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        if (diffHours === 0) {
            const diffMins = Math.floor(diffMs / (1000 * 60));
            return diffMins <= 1 ? 'Just now' : `${diffMins}m ago`;
        }
        return `${diffHours}h ago`;
    } else if (diffDays === 1) {
        return 'Yesterday';
    } else if (diffDays < 7) {
        return `${diffDays}d ago`;
    } else if (diffDays < 30) {
        const weeks = Math.floor(diffDays / 7);
        return `${weeks}w ago`;
    } else {
        return date.toLocaleDateString();
    }
}

// ============================================
// Index Mode Types
// ============================================

type IndexMode = 'fast' | 'deep' | 'none' | 'error' | 'processing';

function getFileIndexMode(file: IndexedFile, processingFiles: Set<string>): IndexMode {
    if (processingFiles.has(file.fullPath)) return 'processing';
    
    if (file.indexStatus === 'error') return 'error';
    if (file.indexStatus === 'pending') return 'none';
    
    const metadata = file.metadata as Record<string, unknown> | undefined;
    if (!metadata) return 'none';
    
    const chunkStrategy = metadata.chunk_strategy as string | undefined;
    if (chunkStrategy) {
        if (chunkStrategy.includes('_fine')) return 'deep';
        if (chunkStrategy.includes('_fast')) return 'fast';
    }
    
    const pdfVisionMode = metadata.pdf_vision_mode as string | undefined;
    if (pdfVisionMode === 'fine') return 'deep';
    if (pdfVisionMode === 'fast') return 'fast';
    
    if (chunkStrategy) return 'fast';
    
    return 'none';
}

function IndexModeTag({ mode, errorReason }: { mode: IndexMode; errorReason?: string | null }) {
    if (mode === 'error') {
        return (
            <span 
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-destructive/10 text-destructive"
                title={errorReason || 'Failed to index'}
            >
                Error
            </span>
        );
    }
    if (mode === 'processing') {
        return (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 animate-pulse">
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                Indexing
            </span>
        );
    }
    if (mode === 'deep') {
        return (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400">
                Deep
            </span>
        );
    }
    if (mode === 'fast') {
        return (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
                Fast
            </span>
        );
    }
    return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            Pending
        </span>
    );
}

// ============================================
// Dropdown Component
// ============================================

function IndexDropdown({ 
    label, 
    options, 
    onSelect, 
    disabled,
    variant = 'default'
}: { 
    label: string;
    options: { label: string; value: string }[];
    onSelect: (value: string) => void;
    disabled?: boolean;
    variant?: 'default' | 'small';
}) {
    const [isOpen, setIsOpen] = useState(false);
    const [openUpward, setOpenUpward] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleToggle = () => {
        if (disabled) return;
        
        if (!isOpen && buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            setOpenUpward(spaceBelow < 100);
        }
        setIsOpen(!isOpen);
    };

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                ref={buttonRef}
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    handleToggle();
                }}
                disabled={disabled}
                className={cn(
                    "inline-flex items-center justify-center rounded-md border bg-background font-medium transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:pointer-events-none",
                    variant === 'small' ? "px-2 py-1 text-[11px] gap-1" : "px-3 py-1.5 text-xs gap-1.5"
                )}
            >
                {label}
                <ChevronDown className={cn("transition-transform", variant === 'small' ? "h-3 w-3" : "h-3.5 w-3.5", isOpen && "rotate-180")} />
            </button>
            {isOpen && (
                <div className={cn(
                    "absolute right-0 z-50 min-w-[120px] rounded-md border bg-popover p-1 shadow-md",
                    openUpward ? "bottom-full mb-1" : "top-full mt-1"
                )}>
                    {options.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                onSelect(option.value);
                                setIsOpen(false);
                            }}
                            className="w-full text-left rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ============================================
// Folder Group Component
// ============================================

interface FolderGroupProps {
    folder: FolderRecord;
    files: IndexedFile[];
    processingFiles: Set<string>;
    isExpanded: boolean;
    onToggle: () => void;
    onIndexAll: (folderId: string, mode: 'fast' | 'fine') => void;
    onIndexFile: (filePath: string, mode: 'fast' | 'fine') => void;
    onRemoveFolder: (folderId: string) => void;
    onSelectFile?: (file: IndexedFile) => void;
    onOpenFile: (file: IndexedFile) => void;
    onDeleteFile: (fileId: string) => void;
}

function FolderGroup({
    folder,
    files,
    processingFiles,
    isExpanded,
    onToggle,
    onIndexAll,
    onIndexFile,
    onRemoveFolder,
    onSelectFile,
    onOpenFile,
    onDeleteFile,
}: FolderGroupProps) {
    const [confirming, setConfirming] = useState(false);
    
    const indexedCount = files.filter(f => f.indexStatus === 'indexed' || !f.indexStatus).length;
    const errorCount = files.filter(f => f.indexStatus === 'error').length;
    const pendingCount = files.filter(f => f.indexStatus === 'pending').length;
    const total = files.length;
    const percent = total > 0 ? Math.round((indexedCount / total) * 100) : 0;
    
    return (
        <div className="rounded-lg border bg-card text-card-foreground shadow-sm">
            {/* Folder Header */}
            <div className="p-4">
                <div className="flex items-center justify-between gap-3">
                    <button
                        onClick={onToggle}
                        className="flex items-center gap-3 flex-1 min-w-0 text-left"
                    >
                        <div className="h-10 w-10 rounded bg-primary/10 flex items-center justify-center shrink-0">
                            {isExpanded ? (
                                <FolderOpen className="h-5 w-5 text-primary" />
                            ) : (
                                <Folder className="h-5 w-5 text-primary" />
                            )}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-base font-semibold truncate">{folder.label}</p>
                            <p className="text-xs text-muted-foreground font-mono truncate">{folder.path}</p>
                        </div>
                        {isExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                        ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                    </button>
                    
                    <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
                        <span className="rounded-full border bg-muted px-2.5 py-0.5">
                            {percent}% indexed
                        </span>
                        <span>{indexedCount} / {total} files</span>
                        {errorCount > 0 && (
                            <span className="text-destructive">{errorCount} failed</span>
                        )}
                    </div>
                </div>
                
                {/* Progress Bar */}
                <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                        className={cn(
                            "h-full transition-[width]",
                            errorCount > 0 ? "bg-destructive/70" : "bg-primary"
                        )}
                        style={{ width: `${percent}%` }}
                    />
                </div>
                
                {/* Actions */}
                <div className="mt-3 flex items-center justify-between gap-2 pt-3 border-t">
                    <div className="text-[10px] text-muted-foreground">
                        Last indexed: {formatTimestamp(folder.lastIndexedAt)}
                    </div>
                    <div className="flex items-center gap-2">
                        <IndexDropdown
                            label="Index All"
                            options={[
                                { label: 'Fast Index All', value: 'fast' },
                                { label: 'Deep Index All', value: 'fine' },
                            ]}
                            onSelect={(mode) => onIndexAll(folder.id, mode as 'fast' | 'fine')}
                        />
                        
                        {confirming ? (
                            <div className="flex gap-1">
                                <button
                                    type="button"
                                    onClick={() => {
                                        onRemoveFolder(folder.id);
                                        setConfirming(false);
                                    }}
                                    className="px-2 py-1 text-xs rounded-md bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                    Confirm
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setConfirming(false)}
                                    className="px-2 py-1 text-xs rounded-md border bg-background hover:bg-accent"
                                >
                                    Cancel
                                </button>
                            </div>
                        ) : (
                            <button
                                type="button"
                                onClick={() => setConfirming(true)}
                                className="inline-flex items-center px-2 py-1 text-xs rounded-md border border-destructive/50 text-destructive hover:bg-destructive hover:text-destructive-foreground transition-colors"
                            >
                                <Trash2 className="h-3 w-3 mr-1" />
                                Remove
                            </button>
                        )}
                    </div>
                </div>
            </div>
            
            {/* Expanded File List */}
            {isExpanded && files.length > 0 && (
                <div className="border-t px-4 py-3">
                    <div className="space-y-1 max-h-80 overflow-y-auto">
                        {files.map((file) => {
                            const mode = getFileIndexMode(file, processingFiles);
                            const isProcessing = mode === 'processing';
                            const isFast = mode === 'fast';
                            
                            return (
                                <div
                                    key={file.id}
                                    className={cn(
                                        "flex items-center justify-between p-2 rounded hover:bg-accent/50 group",
                                        mode === 'error' && "bg-destructive/5 border border-destructive/20",
                                        isProcessing && "bg-blue-50/50 dark:bg-blue-900/10"
                                    )}
                                >
                                    <button
                                        onClick={() => onSelectFile?.(file)}
                                        onDoubleClick={() => onOpenFile(file)}
                                        className="flex-1 flex items-center gap-2 min-w-0 text-left"
                                    >
                                        <FileText className={cn(
                                            "h-3.5 w-3.5 shrink-0",
                                            mode === 'error' ? "text-destructive" : "text-muted-foreground"
                                        )} />
                                        <span className="text-sm truncate">{file.name}</span>
                                    </button>
                                    
                                    <div className="flex items-center gap-2 shrink-0">
                                        <span className="text-[10px] text-muted-foreground uppercase hidden sm:inline">
                                            {file.extension}
                                        </span>
                                        <span className="text-[10px] text-muted-foreground hidden sm:inline">
                                            {formatBytes(file.size)}
                                        </span>
                                        
                                        <IndexModeTag mode={mode} errorReason={file.errorReason} />
                                        
                                        {isFast && !isProcessing && (
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onIndexFile(file.fullPath, 'fine');
                                                }}
                                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-100 text-violet-700 hover:bg-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:hover:bg-violet-900/50 transition-colors"
                                                title="Upgrade to Deep"
                                            >
                                                <ArrowUp className="h-3 w-3" />
                                                Deep
                                            </button>
                                        )}
                                        
                                        {!isProcessing && (
                                            <IndexDropdown
                                                label={mode === 'none' || mode === 'error' ? 'Index' : 'Reindex'}
                                                options={[
                                                    { label: 'Fast', value: 'fast' },
                                                    { label: 'Deep', value: 'fine' },
                                                ]}
                                                onSelect={(m) => onIndexFile(file.fullPath, m as 'fast' | 'fine')}
                                                variant="small"
                                            />
                                        )}
                                        
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onOpenFile(file);
                                            }}
                                            className="p-1 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <ExternalLink className="h-3 w-3 text-muted-foreground" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
            
            {isExpanded && files.length === 0 && (
                <div className="border-t px-4 py-6 text-center text-sm text-muted-foreground">
                    No files indexed in this folder yet. Click "Index All" to start.
                </div>
            )}
        </div>
    );
}

// ============================================
// Main Component
// ============================================

interface IndexedFilesPanelProps {
    folders: FolderRecord[];
    files: IndexedFile[];
    indexingItems?: IndexingItem[];
    isIndexing?: boolean;
    onAddFolder: () => Promise<void>;
    onAddFile?: () => Promise<void>;
    onRemoveFolder: (folderId: string) => Promise<void>;
    onReindexFolder: (folderId: string, mode?: 'fast' | 'fine') => Promise<void>;
    onSelectFile?: (file: IndexedFile) => void;
    onOpenFile?: (file: IndexedFile) => void | Promise<void>;
    onDeleteFile?: (fileId: string) => Promise<void>;
    className?: string;
}

type ViewMode = 'folders' | 'flat';

export function IndexedFilesPanel({
    folders,
    files,
    indexingItems = [],
    isIndexing,
    onAddFolder,
    onAddFile,
    onRemoveFolder,
    onReindexFolder,
    onSelectFile,
    onOpenFile,
    onDeleteFile,
    className,
}: IndexedFilesPanelProps) {
    const [isAddingFolder, setIsAddingFolder] = useState(false);
    const [isAddingFile, setIsAddingFile] = useState(false);
    const [viewMode, setViewMode] = useState<ViewMode>('folders');
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [processingFiles, setProcessingFiles] = useState<Set<string>>(new Set());

    // Track which files are being processed
    useEffect(() => {
        const processingPaths: string[] = [];
        for (const item of indexingItems) {
            if (item.status === 'processing' || item.status === 'pending') {
                processingPaths.push(item.filePath);
            }
        }
        // Only update if the set of paths has actually changed
        setProcessingFiles(prev => {
            const prevPaths = Array.from(prev).sort().join(',');
            const newPaths = processingPaths.sort().join(',');
            if (prevPaths === newPaths) {
                return prev; // Return same reference to avoid re-render
            }
            return new Set(processingPaths);
        });
    }, [indexingItems]);

    // Group files by folder
    const filesByFolder = useMemo(() => {
        const map = new Map<string, IndexedFile[]>();
        for (const file of files) {
            const existing = map.get(file.folderId) || [];
            existing.push(file);
            map.set(file.folderId, existing);
        }
        return map;
    }, [files]);

    // Filter files by search
    const filteredFiles = useMemo(() => {
        if (!searchQuery.trim()) return files;
        const query = searchQuery.toLowerCase();
        return files.filter(f => 
            f.name.toLowerCase().includes(query) ||
            f.fullPath.toLowerCase().includes(query)
        );
    }, [files, searchQuery]);

    // Stats
    const totalFiles = files.length;
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    const indexedCount = files.filter(f => f.indexStatus === 'indexed' || !f.indexStatus).length;
    const errorCount = files.filter(f => f.indexStatus === 'error').length;

    const handleAddFolder = async () => {
        setIsAddingFolder(true);
        try {
            await onAddFolder();
        } finally {
            setIsAddingFolder(false);
        }
    };

    const handleAddFile = async () => {
        if (!onAddFile) return;
        setIsAddingFile(true);
        try {
            await onAddFile();
        } finally {
            setIsAddingFile(false);
        }
    };

    const handleIndexAll = useCallback(async (folderId: string, mode: 'fast' | 'fine') => {
        await onReindexFolder(folderId, mode);
    }, [onReindexFolder]);

    const handleIndexFile = useCallback(async (filePath: string, mode: 'fast' | 'fine') => {
        const api = window.api;
        if (!api?.runIndex) return;
        
        setProcessingFiles(prev => new Set(prev).add(filePath));
        
        try {
            await api.runIndex({
                mode: 'rescan',
                files: [filePath],
                indexing_mode: mode,
            });
        } catch (error) {
            console.error('Failed to index file:', error);
        } finally {
            setProcessingFiles(prev => {
                const next = new Set(prev);
                next.delete(filePath);
                return next;
            });
        }
    }, []);

    const handleOpenFile = useCallback(async (file: IndexedFile) => {
        if (onOpenFile) {
            await onOpenFile(file);
        } else {
            const api = window.api;
            if (api?.openFile) {
                await api.openFile(file.fullPath);
            }
        }
    }, [onOpenFile]);

    const handleDeleteFile = useCallback(async (fileId: string) => {
        if (onDeleteFile) {
            await onDeleteFile(fileId);
        }
    }, [onDeleteFile]);

    const toggleFolder = useCallback((folderId: string) => {
        setExpandedFolders(prev => {
            const next = new Set(prev);
            if (next.has(folderId)) {
                next.delete(folderId);
            } else {
                next.add(folderId);
            }
            return next;
        });
    }, []);

    return (
        <div className={cn("flex h-full flex-col gap-4", className)}>
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
                        <HardDrive className="h-5 w-5 text-primary" />
                        Indexed Files
                    </h2>
                    <p className="text-sm text-muted-foreground mt-1">
                        {totalFiles} files · {formatBytes(totalSize)}
                        {errorCount > 0 && <span className="text-destructive ml-2">· {errorCount} errors</span>}
                    </p>
                </div>
                
                <div className="flex items-center gap-2">
                    {onAddFile && (
                        <button
                            onClick={handleAddFile}
                            disabled={isAddingFile}
                            className="inline-flex items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50 transition-colors"
                        >
                            <FileText className="h-4 w-4" />
                            {isAddingFile ? 'Adding...' : 'Add File'}
                        </button>
                    )}
                    <button
                        onClick={handleAddFolder}
                        disabled={isAddingFolder}
                        className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                        <Plus className="h-4 w-4" />
                        {isAddingFolder ? 'Adding...' : 'Add Folder'}
                    </button>
                </div>
            </div>

            {/* Toolbar */}
            <div className="flex items-center gap-3">
                {/* Search */}
                <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search files..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border bg-background outline-none focus:ring-2 focus:ring-primary/20"
                    />
                </div>
                
                {/* View Mode Toggle */}
                <div className="flex items-center rounded-lg border bg-muted/30 p-1">
                    <button
                        onClick={() => setViewMode('folders')}
                        className={cn(
                            "p-1.5 rounded transition-colors",
                            viewMode === 'folders' ? "bg-background shadow-sm" : "hover:bg-background/50"
                        )}
                        title="Group by folder"
                    >
                        <FolderTree className="h-4 w-4" />
                    </button>
                    <button
                        onClick={() => setViewMode('flat')}
                        className={cn(
                            "p-1.5 rounded transition-colors",
                            viewMode === 'flat' ? "bg-background shadow-sm" : "hover:bg-background/50"
                        )}
                        title="Flat list"
                    >
                        <LayoutList className="h-4 w-4" />
                    </button>
                </div>
                
                {/* Indexing Status */}
                {isIndexing && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        Indexing...
                    </div>
                )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto">
                {folders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center p-8">
                        <div className="h-16 w-16 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                            <Folder className="h-8 w-8 text-muted-foreground/50" />
                        </div>
                        <p className="text-sm font-medium mb-2">No folders added</p>
                        <p className="text-xs text-muted-foreground mb-4">
                            Add a folder to start indexing your files
                        </p>
                        <div className="flex items-center gap-2">
                            {onAddFile && (
                                <button
                                    onClick={handleAddFile}
                                    disabled={isAddingFile}
                                    className="inline-flex items-center gap-2 rounded-lg border bg-background px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50"
                                >
                                    <FileText className="h-4 w-4" />
                                    Add File
                                </button>
                            )}
                            <button
                                onClick={handleAddFolder}
                                disabled={isAddingFolder}
                                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                            >
                                <Plus className="h-4 w-4" />
                                Add Folder
                            </button>
                        </div>
                    </div>
                ) : viewMode === 'folders' ? (
                    <div className="space-y-3">
                        {folders.map((folder) => (
                            <FolderGroup
                                key={folder.id}
                                folder={folder}
                                files={filesByFolder.get(folder.id) || []}
                                processingFiles={processingFiles}
                                isExpanded={expandedFolders.has(folder.id)}
                                onToggle={() => toggleFolder(folder.id)}
                                onIndexAll={handleIndexAll}
                                onIndexFile={handleIndexFile}
                                onRemoveFolder={onRemoveFolder}
                                onSelectFile={onSelectFile}
                                onOpenFile={handleOpenFile}
                                onDeleteFile={handleDeleteFile}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="rounded-lg border bg-card">
                        <div className="px-4 py-2 border-b bg-muted/30 text-xs text-muted-foreground">
                            {filteredFiles.length} {filteredFiles.length === 1 ? 'file' : 'files'}
                        </div>
                        <div className="divide-y max-h-[calc(100vh-300px)] overflow-y-auto">
                            {filteredFiles.map((file) => {
                                const mode = getFileIndexMode(file, processingFiles);
                                const isProcessing = mode === 'processing';
                                const isFast = mode === 'fast';
                                
                                return (
                                    <div
                                        key={file.id}
                                        className={cn(
                                            "flex items-center justify-between px-4 py-3 hover:bg-accent/50 group",
                                            mode === 'error' && "bg-destructive/5"
                                        )}
                                    >
                                        <button
                                            onClick={() => onSelectFile?.(file)}
                                            onDoubleClick={() => handleOpenFile(file)}
                                            className="flex-1 flex items-center gap-3 min-w-0 text-left"
                                        >
                                            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-medium truncate">{file.name}</p>
                                                <p className="text-xs text-muted-foreground truncate">{file.fullPath}</p>
                                            </div>
                                        </button>
                                        
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="text-xs text-muted-foreground hidden sm:inline">
                                                {formatBytes(file.size)}
                                            </span>
                                            <span className="text-xs text-muted-foreground hidden sm:inline">
                                                {formatRelativeTime(file.modifiedAt)}
                                            </span>
                                            
                                            <IndexModeTag mode={mode} errorReason={file.errorReason} />
                                            
                                            {isFast && !isProcessing && (
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleIndexFile(file.fullPath, 'fine');
                                                    }}
                                                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-100 text-violet-700 hover:bg-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:hover:bg-violet-900/50 transition-colors"
                                                >
                                                    <ArrowUp className="h-3 w-3" />
                                                    Deep
                                                </button>
                                            )}
                                            
                                            {!isProcessing && (
                                                <IndexDropdown
                                                    label={mode === 'none' || mode === 'error' ? 'Index' : 'Reindex'}
                                                    options={[
                                                        { label: 'Fast', value: 'fast' },
                                                        { label: 'Deep', value: 'fine' },
                                                    ]}
                                                    onSelect={(m) => handleIndexFile(file.fullPath, m as 'fast' | 'fine')}
                                                    variant="small"
                                                />
                                            )}
                                            
                                            <button
                                                onClick={() => handleOpenFile(file)}
                                                className="p-1 rounded hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}


