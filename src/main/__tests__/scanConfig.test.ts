/**
 * Tests for Scan Configuration Module
 * 
 * Tests:
 * - Exclusion matching
 * - File type classification
 * - Folder tree pruning logic
 * - Time window filtering
 */

import { describe, it, expect } from 'vitest';
import {
    shouldExcludeByName,
    shouldExcludeByPath,
    isSupportedFileType,
    getFileKindFromExtension,
    UNIVERSAL_DIR_EXCLUSIONS,
    getExtensionToKindMap,
} from '../scanConfig';

describe('Exclusion Matching', () => {
    describe('shouldExcludeByName', () => {
        it('should exclude node_modules', () => {
            expect(shouldExcludeByName('node_modules')).toBe(true);
        });

        it('should exclude .git', () => {
            expect(shouldExcludeByName('.git')).toBe(true);
        });

        it('should exclude __pycache__', () => {
            expect(shouldExcludeByName('__pycache__')).toBe(true);
        });

        it('should exclude venv', () => {
            expect(shouldExcludeByName('venv')).toBe(true);
        });

        it('should exclude dist', () => {
            expect(shouldExcludeByName('dist')).toBe(true);
        });

        it('should exclude build', () => {
            expect(shouldExcludeByName('build')).toBe(true);
        });

        it('should NOT exclude normal folders', () => {
            expect(shouldExcludeByName('Documents')).toBe(false);
            expect(shouldExcludeByName('Projects')).toBe(false);
            expect(shouldExcludeByName('my_project')).toBe(false);
        });
    });

    describe('shouldExcludeByPath', () => {
        const exclusions = ['/System', '/Library', '/Users/test/Library'];

        it('should exclude paths starting with excluded prefix', () => {
            expect(shouldExcludeByPath('/System/Library/CoreServices', exclusions)).toBe(true);
            expect(shouldExcludeByPath('/Library/Application Support', exclusions)).toBe(true);
        });

        it('should NOT exclude paths not in exclusions', () => {
            expect(shouldExcludeByPath('/Users/test/Documents', exclusions)).toBe(false);
            expect(shouldExcludeByPath('/Users/test/Desktop', exclusions)).toBe(false);
        });

        it('should handle case insensitive matching', () => {
            expect(shouldExcludeByPath('/SYSTEM/Something', exclusions)).toBe(true);
        });

        it('should handle Windows-style paths', () => {
            const winExclusions = ['C:\\Windows', 'C:\\Program Files'];
            expect(shouldExcludeByPath('C:\\Windows\\System32', winExclusions)).toBe(true);
            expect(shouldExcludeByPath('C:\\Users\\Test', winExclusions)).toBe(false);
        });
    });

    describe('UNIVERSAL_DIR_EXCLUSIONS', () => {
        it('should contain common development directories', () => {
            expect(UNIVERSAL_DIR_EXCLUSIONS).toContain('node_modules');
            expect(UNIVERSAL_DIR_EXCLUSIONS).toContain('.git');
            expect(UNIVERSAL_DIR_EXCLUSIONS).toContain('__pycache__');
            expect(UNIVERSAL_DIR_EXCLUSIONS).toContain('venv');
            expect(UNIVERSAL_DIR_EXCLUSIONS).toContain('.venv');
        });

        it('should contain build output directories', () => {
            expect(UNIVERSAL_DIR_EXCLUSIONS).toContain('dist');
            expect(UNIVERSAL_DIR_EXCLUSIONS).toContain('build');
            expect(UNIVERSAL_DIR_EXCLUSIONS).toContain('out');
            expect(UNIVERSAL_DIR_EXCLUSIONS).toContain('target');
        });
    });
});

describe('File Type Classification', () => {
    describe('isSupportedFileType', () => {
        it('should support document types', () => {
            expect(isSupportedFileType('pdf')).toBe(true);
            expect(isSupportedFileType('doc')).toBe(true);
            expect(isSupportedFileType('docx')).toBe(true);
            expect(isSupportedFileType('txt')).toBe(true);
        });

        it('should support image types', () => {
            expect(isSupportedFileType('jpg')).toBe(true);
            expect(isSupportedFileType('jpeg')).toBe(true);
            expect(isSupportedFileType('png')).toBe(true);
            expect(isSupportedFileType('gif')).toBe(true);
            expect(isSupportedFileType('heic')).toBe(true);
        });

        it('should support video types', () => {
            expect(isSupportedFileType('mp4')).toBe(true);
            expect(isSupportedFileType('mov')).toBe(true);
            expect(isSupportedFileType('avi')).toBe(true);
        });

        it('should support audio types', () => {
            expect(isSupportedFileType('mp3')).toBe(true);
            expect(isSupportedFileType('wav')).toBe(true);
            expect(isSupportedFileType('flac')).toBe(true);
        });

        it('should support archive types', () => {
            expect(isSupportedFileType('zip')).toBe(true);
            expect(isSupportedFileType('rar')).toBe(true);
            expect(isSupportedFileType('7z')).toBe(true);
        });

        it('should NOT support code types (intentionally excluded)', () => {
            expect(isSupportedFileType('ts')).toBe(false);
            expect(isSupportedFileType('tsx')).toBe(false);
            expect(isSupportedFileType('js')).toBe(false);
            expect(isSupportedFileType('jsx')).toBe(false);
            expect(isSupportedFileType('py')).toBe(false);
            expect(isSupportedFileType('java')).toBe(false);
            expect(isSupportedFileType('cpp')).toBe(false);
            expect(isSupportedFileType('html')).toBe(false);
            expect(isSupportedFileType('css')).toBe(false);
        });

        it('should handle extension with or without dot', () => {
            expect(isSupportedFileType('.pdf')).toBe(true);
            expect(isSupportedFileType('pdf')).toBe(true);
        });

        it('should be case insensitive', () => {
            expect(isSupportedFileType('PDF')).toBe(true);
            expect(isSupportedFileType('Jpg')).toBe(true);
            expect(isSupportedFileType('MP4')).toBe(true);
        });
    });

    describe('getFileKindFromExtension', () => {
        it('should return correct kind for documents', () => {
            expect(getFileKindFromExtension('pdf')).toBe('document');
            expect(getFileKindFromExtension('docx')).toBe('document');
        });

        it('should return correct kind for images', () => {
            expect(getFileKindFromExtension('jpg')).toBe('image');
            expect(getFileKindFromExtension('png')).toBe('image');
        });

        it('should return correct kind for videos', () => {
            expect(getFileKindFromExtension('mp4')).toBe('video');
            expect(getFileKindFromExtension('mov')).toBe('video');
        });

        it('should return correct kind for audio', () => {
            expect(getFileKindFromExtension('mp3')).toBe('audio');
            expect(getFileKindFromExtension('wav')).toBe('audio');
        });

        it('should return null for code files (excluded)', () => {
            expect(getFileKindFromExtension('ts')).toBe(null);
            expect(getFileKindFromExtension('py')).toBe(null);
        });

        it('should return null for unknown extensions', () => {
            expect(getFileKindFromExtension('xyz')).toBe(null);
            expect(getFileKindFromExtension('unknown')).toBe(null);
        });
    });

    describe('getExtensionToKindMap', () => {
        it('should return a Map with all supported extensions', () => {
            const map = getExtensionToKindMap();
            expect(map).toBeInstanceOf(Map);
            expect(map.size).toBeGreaterThan(0);
        });

        it('should NOT contain code extensions', () => {
            const map = getExtensionToKindMap();
            expect(map.has('ts')).toBe(false);
            expect(map.has('js')).toBe(false);
            expect(map.has('py')).toBe(false);
        });

        it('should contain document extensions', () => {
            const map = getExtensionToKindMap();
            expect(map.has('pdf')).toBe(true);
            expect(map.get('pdf')).toBe('document');
        });
    });
});

describe('Time Window Filtering', () => {
    // Helper to create date strings
    const daysAgo = (days: number): Date => {
        const date = new Date();
        date.setDate(date.getDate() - days);
        return date;
    };

    it('should correctly calculate cutoff dates', () => {
        const now = new Date();

        // 24 hours ago
        const cutoff24h = daysAgo(1);
        expect(cutoff24h.getTime()).toBeLessThan(now.getTime());
        expect(now.getTime() - cutoff24h.getTime()).toBeCloseTo(24 * 60 * 60 * 1000, -3);

        // 7 days ago
        const cutoff7d = daysAgo(7);
        expect(now.getTime() - cutoff7d.getTime()).toBeCloseTo(7 * 24 * 60 * 60 * 1000, -3);
    });

    it('should filter files correctly by modification time', () => {
        const cutoffDate = daysAgo(7);

        const recentFile = { modifiedAt: daysAgo(3) };
        const oldFile = { modifiedAt: daysAgo(10) };

        expect(recentFile.modifiedAt >= cutoffDate).toBe(true);
        expect(oldFile.modifiedAt >= cutoffDate).toBe(false);
    });
});

// Note: Folder tree pruning tests would require mocking the file system
// and are better suited for integration tests
describe('Folder Tree Pruning (Logic)', () => {
    it('should correctly identify empty folders for pruning', () => {
        // Simulating the pruning logic
        const folderWithFiles = { fileCount: 5, children: [] };
        const folderWithChildren = { fileCount: 0, children: [{ fileCount: 3 }] };
        const emptyFolder = { fileCount: 0, children: [] };

        const shouldKeep = (folder: { fileCount: number; children: { fileCount: number }[] }) => {
            const totalFiles = folder.fileCount + folder.children.reduce((sum, c) => sum + c.fileCount, 0);
            return totalFiles > 0;
        };

        expect(shouldKeep(folderWithFiles)).toBe(true);
        expect(shouldKeep(folderWithChildren)).toBe(true);
        expect(shouldKeep(emptyFolder)).toBe(false);
    });
});

