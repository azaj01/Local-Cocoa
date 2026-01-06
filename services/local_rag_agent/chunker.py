from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass
import os
from typing import Iterable, List, Optional, Tuple

import xxhash  # type: ignore[import]

try:
    import tiktoken  # type: ignore[import]
except ImportError:  # pragma: no cover - optional dependency
    tiktoken = None  # type: ignore[assignment]


# Patterns for structure detection
SECTION_PATTERN = re.compile(r"^(#+)\s+(.*)$", flags=re.MULTILINE)
LIST_PATTERN = re.compile(r"^\s*([\-*+]|\d+\.)\s+", flags=re.MULTILINE)
SENTENCE_END_PATTERN = re.compile(r'([.!?。！？；;]+)\s+')
CODE_BLOCK_PATTERN = re.compile(r'```[\s\S]*?```', flags=re.MULTILINE)
TABLE_ROW_PATTERN = re.compile(r'^\s*\|.*\|\s*$', flags=re.MULTILINE)
PARAGRAPH_SPLIT = re.compile(r'\n\s*\n+')
LIST_ITEM_PATTERN = re.compile(r'^(\s*)([-*+]|\d+\.)\s+', flags=re.MULTILINE)


@dataclass
class ChunkPayload:
    chunk_id: str
    file_id: str
    ordinal: int
    text: str
    snippet: str
    token_count: int
    char_count: int
    section_path: Optional[str]
    metadata: dict
    created_at: dt.datetime


@dataclass
class SemanticBlock:
    """Represents a semantic unit (paragraph, list, code block, table, etc.)"""
    text: str
    block_type: str  # 'paragraph', 'list', 'code', 'table', 'heading'
    start_offset: int
    end_offset: int


class ChunkingPipeline:
    """
    Produces hierarchical chunks with token metrics for downstream retrieval.
    
    This implementation uses semantic-aware chunking that:
    1. Prioritizes paragraph boundaries
    2. Respects sentence boundaries when splitting is needed
    3. Preserves lists, code blocks, and tables as complete units
    4. Merges small segments and splits large ones intelligently
    """

    def __init__(
        self,
        *,
        embedding_model: str = "text-embedding-3-large",
        chunk_tokens: int = 480,
        overlap_tokens: int = 80,
        min_chunk_tokens: int = 50,
    ) -> None:
        self.chunk_tokens = max(chunk_tokens, 64)
        self.overlap_tokens = max(min(overlap_tokens, self.chunk_tokens // 4), 0)
        self.min_chunk_tokens = max(min_chunk_tokens, 20)
        self.char_ratio = 4  # rough approximation characters per token
        self.tokenizer = None
        if tiktoken is not None:
            try:
                self.tokenizer = tiktoken.encoding_for_model(embedding_model)
            except Exception:
                self.tokenizer = None

    def build(
        self, 
        file_id: str, 
        text: str, 
        page_mapping: Optional[List[tuple[int, int, int]]] = None,
        chunk_tokens: Optional[int] = None,
        overlap_tokens: Optional[int] = None
    ) -> List[ChunkPayload]:
        """
        Build chunks from text with optional page mapping.
        Uses semantic-aware chunking for better retrieval quality.

        Args:
            file_id: Unique identifier for the file
            text: Full text content to chunk
            page_mapping: List of (start_offset, end_offset, page_num) tuples mapping text ranges to page numbers
            chunk_tokens: Optional override for chunk size in tokens
            overlap_tokens: Optional override for overlap size in tokens
        """
        now = dt.datetime.now(dt.timezone.utc)
        
        if not text or not text.strip():
            return []
        
        # Use instance defaults if not provided
        target_chunk_tokens = chunk_tokens if chunk_tokens is not None else self.chunk_tokens
        target_overlap_tokens = overlap_tokens if overlap_tokens is not None else self.overlap_tokens
        
        # Calculate target sizes in characters
        max_chunk_chars = target_chunk_tokens * self.char_ratio
        min_chunk_chars = self.min_chunk_tokens * self.char_ratio
        overlap_chars = target_overlap_tokens * self.char_ratio
        
        # Step 1: Split by markdown sections first
        sections = self._split_sections(text)
        
        payloads: List[ChunkPayload] = []
        ordinal = 0
        
        for section_path, section_body, section_start_offset in sections:
            if not section_body.strip():
                continue
            
            # Step 2: Within each section, perform semantic chunking
            chunks = self._semantic_chunk(
                section_body,
                max_chars=max_chunk_chars,
                min_chars=min_chunk_chars,
                overlap_chars=overlap_chars,
            )
            
            for chunk_text, rel_start, rel_end in chunks:
                clean_text = chunk_text.strip()
                if not clean_text:
                    continue
                    
                char_count = len(clean_text)
                token_count = self._token_count(clean_text)
                
                # Skip chunks that are too small (unless it's the only chunk)
                if token_count < self.min_chunk_tokens and len(chunks) > 1:
                    continue
                
                # Calculate absolute offsets
                abs_start = section_start_offset + rel_start
                abs_end = section_start_offset + rel_end
                
                chunk_id = self._chunk_id(file_id, ordinal, abs_start)
                snippet = clean_text[:400]

                metadata = {
                    "section_path": section_path,
                    "start_char": abs_start,
                    "end_char": abs_end,
                    "list_density": self._list_density(clean_text),
                }

                # Add page number(s) if page_mapping is available
                if page_mapping:
                    pages = self._get_pages_for_range(abs_start, abs_end, page_mapping)
                    if pages:
                        metadata["page_numbers"] = pages
                        metadata["page_start"] = pages[0]
                        metadata["page_end"] = pages[-1]

                payloads.append(
                    ChunkPayload(
                        chunk_id=chunk_id,
                        file_id=file_id,
                        ordinal=ordinal,
                        text=clean_text,
                        snippet=snippet,
                        token_count=token_count,
                        char_count=char_count,
                        section_path=section_path,
                        metadata=metadata,
                        created_at=now,
                    )
                )
                ordinal += 1
        
        # Post-process: merge consecutive small chunks to avoid fragmentation
        payloads = self._merge_small_chunks(payloads, min_chars=min_chunk_chars, max_chars=max_chunk_chars, page_mapping=page_mapping)
        
        return payloads

    def _semantic_chunk(
        self,
        text: str,
        max_chars: int,
        min_chars: int,
        overlap_chars: int,
    ) -> List[Tuple[str, int, int]]:
        """
        Perform semantic-aware chunking on text.
        
        Strategy:
        1. Parse text into semantic blocks (paragraphs, lists, code blocks, tables)
        2. Merge small adjacent blocks
        3. Split large blocks at sentence boundaries
        4. Add overlapping context at chunk boundaries
        """
        if not text:
            return []
        
        # Parse into semantic blocks
        blocks = self._parse_semantic_blocks(text)
        
        if not blocks:
            return [(text, 0, len(text))]
        
        # Merge and split blocks to meet size constraints
        chunks: List[Tuple[str, int, int]] = []
        current_chunk = ""
        current_start = 0
        
        for block in blocks:
            block_text = block.text
            block_len = len(block_text)
            
            # If block itself exceeds max size, split it
            if block_len > max_chars:
                # First, add current accumulated chunk if exists
                if current_chunk.strip():
                    chunks.append((current_chunk, current_start, current_start + len(current_chunk)))
                    current_chunk = ""
                
                # Split the large block
                sub_chunks = self._split_large_block(block, max_chars, min_chars)
                for sub_text, sub_rel_start, sub_rel_end in sub_chunks:
                    chunks.append((sub_text, block.start_offset + sub_rel_start, block.start_offset + sub_rel_end))
                
                # Reset current_start for next chunk
                if chunks:
                    current_start = chunks[-1][2]
                continue
            
            # Check if adding this block would exceed max size
            if current_chunk and len(current_chunk) + len(block_text) + 2 > max_chars:
                # Save current chunk if it meets minimum size
                if len(current_chunk.strip()) >= min_chars:
                    chunks.append((current_chunk, current_start, current_start + len(current_chunk)))
                    
                    # Add overlap: take last part of current chunk as context for next
                    overlap_text = self._get_overlap_text(current_chunk, overlap_chars)
                    current_chunk = overlap_text + "\n\n" + block_text if overlap_text else block_text
                    current_start = block.start_offset - len(overlap_text) if overlap_text else block.start_offset
                else:
                    # Current chunk too small, merge anyway
                    current_chunk += "\n\n" + block_text
            else:
                # Add block to current chunk
                if current_chunk:
                    current_chunk += "\n\n" + block_text
                else:
                    current_chunk = block_text
                    current_start = block.start_offset
        
        # Don't forget the last chunk
        if current_chunk.strip():
            chunks.append((current_chunk, current_start, current_start + len(current_chunk)))
        
        return chunks if chunks else [(text, 0, len(text))]

    def _parse_semantic_blocks(self, text: str) -> List[SemanticBlock]:
        """
        Parse text into semantic blocks: paragraphs, lists, code blocks, tables.
        """
        blocks: List[SemanticBlock] = []
        
        # Find code blocks first (they should not be split)
        code_blocks = list(CODE_BLOCK_PATTERN.finditer(text))
        code_ranges = [(m.start(), m.end()) for m in code_blocks]
        
        # Find table regions
        table_ranges = self._find_table_ranges(text)
        
        # Combine protected ranges (code + tables)
        protected_ranges = sorted(code_ranges + table_ranges, key=lambda x: x[0])
        
        # Process text, respecting protected ranges
        current_pos = 0
        
        while current_pos < len(text):
            # Check if we're in a protected range
            in_protected = False
            for start, end in protected_ranges:
                if start <= current_pos < end:
                    # Add the protected block
                    block_text = text[start:end]
                    block_type = 'code' if (start, end) in code_ranges else 'table'
                    blocks.append(SemanticBlock(
                        text=block_text,
                        block_type=block_type,
                        start_offset=start,
                        end_offset=end
                    ))
                    current_pos = end
                    in_protected = True
                    break
                elif current_pos < start:
                    # Process text up to the protected range
                    segment = text[current_pos:start]
                    blocks.extend(self._parse_paragraphs_and_lists(segment, current_pos))
                    current_pos = start
                    in_protected = True
                    break
            
            if not in_protected:
                # Find next protected range or end of text
                next_protected = len(text)
                for start, end in protected_ranges:
                    if start > current_pos:
                        next_protected = start
                        break
                
                # Process remaining text
                segment = text[current_pos:next_protected]
                blocks.extend(self._parse_paragraphs_and_lists(segment, current_pos))
                current_pos = next_protected
        
        return blocks

    def _parse_paragraphs_and_lists(self, text: str, base_offset: int) -> List[SemanticBlock]:
        """
        Parse text into paragraphs and lists.
        Lists are kept together as single blocks.
        """
        blocks: List[SemanticBlock] = []
        
        if not text.strip():
            return blocks
        
        # Split by paragraph breaks
        parts = PARAGRAPH_SPLIT.split(text)
        
        current_pos = 0
        i = 0
        while i < len(parts):
            part = parts[i]
            if not part.strip():
                current_pos += len(part) + 2  # +2 for the \n\n
                i += 1
                continue
            
            # Find actual position in original text
            part_start = text.find(part, current_pos)
            if part_start == -1:
                part_start = current_pos
            
            # Check if this is a list item
            if LIST_ITEM_PATTERN.match(part):
                # Collect consecutive list items
                list_parts = [part]
                j = i + 1
                while j < len(parts) and LIST_ITEM_PATTERN.match(parts[j].strip() if parts[j] else ""):
                    list_parts.append(parts[j])
                    j += 1
                
                list_text = "\n\n".join(list_parts)
                list_end = part_start + len(list_text)
                
                blocks.append(SemanticBlock(
                    text=list_text,
                    block_type='list',
                    start_offset=base_offset + part_start,
                    end_offset=base_offset + list_end
                ))
                
                i = j
                current_pos = list_end
            else:
                # Regular paragraph
                blocks.append(SemanticBlock(
                    text=part,
                    block_type='paragraph',
                    start_offset=base_offset + part_start,
                    end_offset=base_offset + part_start + len(part)
                ))
                i += 1
                current_pos = part_start + len(part)
        
        return blocks

    def _find_table_ranges(self, text: str) -> List[Tuple[int, int]]:
        """
        Find markdown table ranges in text.
        Tables start with a row containing | and continue until non-table lines.
        """
        ranges: List[Tuple[int, int]] = []
        lines = text.split('\n')
        
        in_table = False
        table_start = 0
        current_pos = 0
        
        for i, line in enumerate(lines):
            line_stripped = line.strip()
            is_table_row = line_stripped.startswith('|') and '|' in line_stripped[1:]
            is_separator = '---' in line_stripped and '|' in line_stripped
            
            if is_table_row or (in_table and is_separator):
                if not in_table:
                    table_start = current_pos
                    in_table = True
            else:
                if in_table:
                    # End of table
                    ranges.append((table_start, current_pos))
                    in_table = False
            
            current_pos += len(line) + 1  # +1 for newline
        
        # Handle table at end of text
        if in_table:
            ranges.append((table_start, len(text)))
        
        return ranges

    def _split_large_block(
        self, 
        block: SemanticBlock, 
        max_chars: int, 
        min_chars: int
    ) -> List[Tuple[str, int, int]]:
        """
        Split a large semantic block into smaller chunks.
        For code/tables: split at natural boundaries (blank lines, etc.)
        For paragraphs/lists: split at sentence boundaries
        """
        text = block.text
        
        if block.block_type in ('code', 'table'):
            # Split code/tables at blank lines within them
            return self._split_at_blank_lines(text, max_chars, min_chars)
        
        # For paragraphs and lists, split at sentence boundaries
        return self._split_at_sentences(text, max_chars, min_chars)

    def _split_at_sentences(
        self, 
        text: str, 
        max_chars: int, 
        min_chars: int
    ) -> List[Tuple[str, int, int]]:
        """
        Split text at sentence boundaries.
        """
        # Split into sentences
        sentences = self._split_into_sentences(text)
        
        chunks: List[Tuple[str, int, int]] = []
        current_chunk = ""
        current_start = 0
        
        for sentence, sent_start, sent_end in sentences:
            if not sentence.strip():
                continue
            
            # If adding this sentence exceeds max, save current and start new
            if current_chunk and len(current_chunk) + len(sentence) > max_chars:
                if len(current_chunk.strip()) >= min_chars:
                    chunks.append((current_chunk.strip(), current_start, current_start + len(current_chunk.rstrip())))
                    current_chunk = sentence
                    current_start = sent_start
                else:
                    # Too small, keep adding
                    current_chunk += sentence
            else:
                if not current_chunk:
                    current_start = sent_start
                current_chunk += sentence
        
        # Last chunk
        if current_chunk.strip():
            chunks.append((current_chunk.strip(), current_start, current_start + len(current_chunk.rstrip())))
        
        return chunks if chunks else [(text, 0, len(text))]

    def _split_into_sentences(self, text: str) -> List[Tuple[str, int, int]]:
        """
        Split text into sentences while preserving positions.
        Handles Chinese and English sentence endings.
        """
        sentences: List[Tuple[str, int, int]] = []
        
        # Pattern for sentence endings (including Chinese punctuation)
        pattern = re.compile(r'([.!?。！？；]+[\s\n]*)')
        
        last_end = 0
        for match in pattern.finditer(text):
            sentence_end = match.end()
            sentence = text[last_end:sentence_end]
            if sentence.strip():
                sentences.append((sentence, last_end, sentence_end))
            last_end = sentence_end
        
        # Remaining text
        if last_end < len(text):
            remaining = text[last_end:]
            if remaining.strip():
                sentences.append((remaining, last_end, len(text)))
        
        # If no sentence breaks found, return whole text as one sentence
        if not sentences:
            sentences.append((text, 0, len(text)))
        
        return sentences

    def _split_at_blank_lines(
        self, 
        text: str, 
        max_chars: int, 
        min_chars: int
    ) -> List[Tuple[str, int, int]]:
        """
        Split at blank lines (for code blocks and tables).
        """
        parts = re.split(r'(\n\s*\n)', text)
        
        chunks: List[Tuple[str, int, int]] = []
        current_chunk = ""
        current_start = 0
        current_pos = 0
        
        for part in parts:
            if current_chunk and len(current_chunk) + len(part) > max_chars:
                if len(current_chunk.strip()) >= min_chars:
                    chunks.append((current_chunk, current_start, current_start + len(current_chunk)))
                    current_chunk = part
                    current_start = current_pos
                else:
                    current_chunk += part
            else:
                if not current_chunk:
                    current_start = current_pos
                current_chunk += part
            current_pos += len(part)
        
        if current_chunk.strip():
            chunks.append((current_chunk, current_start, current_start + len(current_chunk)))
        
        return chunks if chunks else [(text, 0, len(text))]

    def _get_overlap_text(self, text: str, overlap_chars: int) -> str:
        """
        Get overlap text from the end of a chunk.
        Tries to end at a sentence boundary for better context.
        """
        if overlap_chars <= 0 or len(text) <= overlap_chars:
            return ""
        
        # Get the last overlap_chars
        overlap_region = text[-overlap_chars:]
        
        # Try to start at a sentence boundary
        sentences = self._split_into_sentences(overlap_region)
        if len(sentences) > 1:
            # Skip the first (potentially partial) sentence
            return "".join(s[0] for s in sentences[1:]).strip()
        
        # If no sentence boundary, try to start at a word boundary
        space_pos = overlap_region.find(' ')
        if space_pos > 0 and space_pos < len(overlap_region) // 2:
            return overlap_region[space_pos + 1:].strip()
        
        return overlap_region.strip()

    def _split_sections(self, text: str) -> List[tuple[Optional[str], str, int]]:
        """Split text by markdown headers, merging small sections to avoid fragmentation."""
        if not text:
            return [(None, "", 0)]
        matches = list(SECTION_PATTERN.finditer(text))
        if not matches:
            return [(None, text, 0)]
        
        raw_sections: List[tuple[Optional[str], str, int]] = []
        
        # Handle preamble (text before first header)
        first_match_start = matches[0].start()
        preamble = ""
        preamble_start = 0
        
        if first_match_start > 0:
            preamble = text[:first_match_start]
            # If preamble is substantial, treat it as its own section.
            # Otherwise (e.g. just a page marker), we'll merge it into the first section.
            if preamble.strip() and len(preamble) > 300:
                raw_sections.append((None, preamble, 0))
                preamble = ""  # Consumed
            else:
                preamble_start = 0

        for index, match in enumerate(matches):
            # Include the header in the section body so it gets chunked and highlighted
            start = match.start()
            end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
            heading_level = len(match.group(1))
            heading_text = match.group(2).strip()
            section_marker = f"{heading_level}:{heading_text}"
            
            # If this is the first section and we have a short preamble to merge
            if index == 0 and preamble:
                body = preamble + text[start:end]
                raw_sections.append((section_marker, body, preamble_start))
            else:
                body = text[start:end]
                raw_sections.append((section_marker, body, start))
        
        # Merge small sections (those with only headers, no substantial content)
        # This prevents fragmentation when documents have many consecutive headings
        # Use a relatively high threshold to ensure meaningful chunks
        min_section_chars = self.min_chunk_tokens * self.char_ratio  # Same as min_chunk_chars
        merged_sections: List[tuple[Optional[str], str, int]] = []
        pending_body = ""
        pending_path: Optional[str] = None
        pending_start = 0
        
        for section_path, section_body, section_start in raw_sections:
            if pending_body:
                # We have pending content, add current section to it
                combined_body = pending_body + "\n" + section_body
                
                # Check if combined section now has enough content
                if len(combined_body.strip()) >= min_section_chars:
                    merged_sections.append((pending_path, combined_body, pending_start))
                    pending_body = ""
                    pending_path = None
                else:
                    # Still too small, keep accumulating
                    pending_body = combined_body
            else:
                # No pending content - check if this section is too small
                if len(section_body.strip()) < min_section_chars:
                    # This section is too small, start accumulating
                    pending_body = section_body
                    pending_path = section_path
                    pending_start = section_start
                else:
                    # Section is big enough
                    merged_sections.append((section_path, section_body, section_start))
        
        # Handle remaining pending content
        if pending_body:
            if merged_sections:
                # Append to last section
                last_path, last_body, last_start = merged_sections[-1]
                merged_sections[-1] = (last_path, last_body + "\n" + pending_body, last_start)
            else:
                # No sections yet, add pending as is
                merged_sections.append((pending_path, pending_body, pending_start))
        
        return merged_sections if merged_sections else [(None, text, 0)]

    # Legacy method for backward compatibility
    def _window(self, text: str, chunk_tokens: Optional[int] = None, overlap_tokens: Optional[int] = None) -> Iterable[tuple[str, int, int]]:
        """
        Legacy sliding window method. Kept for backward compatibility.
        New code should use _semantic_chunk instead.
        """
        if not text:
            return []
        
        ct = chunk_tokens if chunk_tokens is not None else self.chunk_tokens
        ot = overlap_tokens if overlap_tokens is not None else self.overlap_tokens
        
        window = ct * self.char_ratio
        overlap = ot * self.char_ratio
        pointer = 0
        length = len(text)
        while pointer < length:
            end = min(pointer + window, length)
            chunk = text[pointer:end]
            yield chunk, pointer, end
            if end >= length:
                break
            pointer = max(end - overlap, pointer + 1)

    def _token_count(self, text: str) -> int:
        if self.tokenizer is None:
            return max(len(text) // self.char_ratio, 1)
        try:
            return len(self.tokenizer.encode(text))
        except Exception:
            return max(len(text) // self.char_ratio, 1)

    @staticmethod
    def _chunk_id(file_id: str, ordinal: int, start_offset: int) -> str:
        digest = xxhash.xxh64()
        digest.update(f"{file_id}:{ordinal}:{start_offset}")
        return digest.hexdigest()

    @staticmethod
    def _list_density(text: str) -> float:
        if not text:
            return 0.0
        list_matches = LIST_PATTERN.findall(text)
        if not list_matches:
            return 0.0
        lines = [line for line in text.splitlines() if line.strip()]
        if not lines:
            return 0.0
        return min(len(list_matches) / len(lines), 1.0)

    @staticmethod
    def _get_pages_for_range(start: int, end: int, page_mapping: List[tuple[int, int, int]]) -> List[int]:
        """
        Find all page numbers that overlap with the given character range.

        Args:
            start: Start character offset
            end: End character offset
            page_mapping: List of (start_offset, end_offset, page_num) tuples

        Returns:
            Sorted list of unique page numbers that overlap with the range
        """
        pages = set()
        for page_start, page_end, page_num in page_mapping:
            # Check if ranges overlap
            if start < page_end and end > page_start:
                pages.add(page_num)
        return sorted(pages)

    def _merge_small_chunks(
        self,
        payloads: List[ChunkPayload],
        min_chars: int,
        max_chars: int,
        page_mapping: Optional[List[tuple[int, int, int]]] = None,
    ) -> List[ChunkPayload]:
        """
        Merge consecutive small chunks to avoid fragmentation.
        
        This is especially important for documents with many short sections
        (like cover pages with multiple headings).
        
        Strategy:
        - Scan through chunks and identify small ones (below min_chars)
        - Merge consecutive small chunks together
        - Also merge a small chunk with the next chunk if they fit within max_chars
        - Preserve page boundaries when possible
        """
        if len(payloads) <= 1:
            return payloads
        
        merged: List[ChunkPayload] = []
        pending: Optional[ChunkPayload] = None
        
        for payload in payloads:
            if pending is None:
                # Check if current chunk is small
                if payload.char_count < min_chars:
                    pending = payload
                else:
                    merged.append(payload)
            else:
                # We have a pending small chunk
                combined_chars = pending.char_count + payload.char_count + 2  # +2 for separator
                
                # Merge conditions:
                # 1. Combined size fits within max_chars
                # 2. OR current payload is also small (merge small chunks together)
                should_merge = (combined_chars <= max_chars) or (payload.char_count < min_chars and combined_chars <= max_chars * 1.5)
                
                if should_merge:
                    # Merge pending with current
                    combined_text = pending.text + "\n\n" + payload.text
                    combined_token_count = self._token_count(combined_text)
                    
                    # Update metadata
                    new_metadata = pending.metadata.copy()
                    new_metadata["start_char"] = pending.metadata.get("start_char", 0)
                    new_metadata["end_char"] = payload.metadata.get("end_char", len(combined_text))
                    
                    # Merge section paths if different
                    pending_section = pending.section_path or ""
                    current_section = payload.section_path or ""
                    if pending_section and current_section and pending_section != current_section:
                        combined_section = f"{pending_section} | {current_section}"
                    else:
                        combined_section = pending_section or current_section
                    
                    # Update page numbers
                    if page_mapping:
                        pages = self._get_pages_for_range(
                            new_metadata["start_char"], 
                            new_metadata["end_char"], 
                            page_mapping
                        )
                        if pages:
                            new_metadata["page_numbers"] = pages
                            new_metadata["page_start"] = pages[0]
                            new_metadata["page_end"] = pages[-1]
                    
                    # Create merged payload
                    merged_payload = ChunkPayload(
                        chunk_id=pending.chunk_id,  # Keep original ID
                        file_id=pending.file_id,
                        ordinal=pending.ordinal,
                        text=combined_text,
                        snippet=combined_text[:400],
                        token_count=combined_token_count,
                        char_count=len(combined_text),
                        section_path=combined_section,
                        metadata=new_metadata,
                        created_at=pending.created_at,
                    )
                    
                    # If still small, keep as pending for potential further merging
                    if merged_payload.char_count < min_chars:
                        pending = merged_payload
                    else:
                        merged.append(merged_payload)
                        pending = None
                else:
                    # Cannot merge, add pending as is and check current
                    merged.append(pending)
                    if payload.char_count < min_chars:
                        pending = payload
                    else:
                        merged.append(payload)
                        pending = None
        
        # Don't forget remaining pending chunk
        if pending is not None:
            # Try to merge with last chunk if possible
            if merged and merged[-1].char_count + pending.char_count + 2 <= max_chars:
                last = merged.pop()
                combined_text = last.text + "\n\n" + pending.text
                combined_token_count = self._token_count(combined_text)
                
                new_metadata = last.metadata.copy()
                new_metadata["end_char"] = pending.metadata.get("end_char", last.metadata.get("end_char", 0) + len(pending.text))
                
                if page_mapping:
                    pages = self._get_pages_for_range(
                        new_metadata.get("start_char", 0),
                        new_metadata["end_char"],
                        page_mapping
                    )
                    if pages:
                        new_metadata["page_numbers"] = pages
                        new_metadata["page_start"] = pages[0]
                        new_metadata["page_end"] = pages[-1]
                
                merged.append(ChunkPayload(
                    chunk_id=last.chunk_id,
                    file_id=last.file_id,
                    ordinal=last.ordinal,
                    text=combined_text,
                    snippet=combined_text[:400],
                    token_count=combined_token_count,
                    char_count=len(combined_text),
                    section_path=last.section_path,
                    metadata=new_metadata,
                    created_at=last.created_at,
                ))
            else:
                merged.append(pending)
        
        # Re-number ordinals
        for i, payload in enumerate(merged):
            payload.ordinal = i
        
        return merged


DEFAULT_CHUNK_TOKENS = max(int(os.getenv("LOCAL_RAG_CHUNK_TOKENS", 320)), 64)
DEFAULT_CHUNK_OVERLAP = max(int(os.getenv("LOCAL_RAG_CHUNK_OVERLAP", 40)), 0)

chunking_pipeline = ChunkingPipeline(chunk_tokens=DEFAULT_CHUNK_TOKENS, overlap_tokens=DEFAULT_CHUNK_OVERLAP)
