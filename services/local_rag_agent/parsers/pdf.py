from __future__ import annotations

import logging
from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover
    fitz = None

from .base import BaseParser, ParsedContent

logger = logging.getLogger(__name__)


class PdfParser(BaseParser):
    extensions = {"pdf"}

    def parse(self, path: Path) -> ParsedContent:

        if not fitz:
            raise ImportError("PyMuPDF (fitz) is not installed. Please install it with `pip install pymupdf`.")

        doc = fitz.open(str(path))

        try:
            if doc.is_encrypted:
                doc.authenticate("")

            texts: list[str] = []
            page_texts: list[str] = []
            # List of (start_offset, end_offset, page_num) in the concatenated full_text.
            page_mapping: list[tuple[int, int, int]] = []


            total_pages = len(doc)
            cursor = 0

            for page_index, page in enumerate(doc, start=1):
                # Use sort=True for better reading order
                text = page.get_text("text", sort=True) or ""
                page_texts.append(text)
                texts.append(text)

                start = cursor
                cursor += len(text)
                
                # Include separator in the page range so there are no gaps
                if page_index < total_pages:
                    cursor += 2  # "\n\n"
                
                end = cursor
                page_mapping.append((start, end, page_index))

            md = self.md
            result = md.convert(str(path))
            text = result.text_content

            metadata = {
                "source": "pdf",
                "pages": 0,
                "page_texts": text,
                "preview": self._truncate(text),
            }
        
            return ParsedContent(
                text=text,
                metadata=metadata,
                page_count=total_pages,
                page_mapping=page_mapping,
            )

        finally:
            doc.close()
