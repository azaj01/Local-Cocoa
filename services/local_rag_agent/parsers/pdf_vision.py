from __future__ import annotations

from pathlib import Path

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None

from ..vision import render_pdf_images
from .base import BaseParser, ParsedContent


class PdfVisionParser(BaseParser):
    """
    PDF parser that converts each page to an image for VLM processing.
    Each page will be stored as an attachment and processed by the vision model.
    """
    extensions = {"pdf"}

    def parse(self, path: Path) -> ParsedContent:
        """
        Parse PDF by converting each page to an image.

        Returns ParsedContent with:
        - text: Empty or placeholder (VLM will generate the actual text)
        - attachments: Dict of page images {f"page_{num}": bytes}
        - page_count: Number of pages
        - page_mapping: Empty list (will be populated per-page after VLM processing)
        """
        try:
            # Use centralized vision processor to render images
            # Returns dict { "page_1": bytes, ... }
            attachments = render_pdf_images(path)
        except Exception as e:
            raise ImportError(
                f"Failed to convert PDF to images: {e}. "
                "Ensure 'pymupdf' is installed (pip install pymupdf)."
            )

        # Also extract text to support hybrid mode / fallback
        page_texts = []
        if fitz:
            try:
                doc = fitz.open(str(path))
                if doc.is_encrypted:
                    doc.authenticate("")
                for page in doc:
                    page_texts.append(page.get_text("text", sort=True) or "")
                doc.close()
            except Exception:
                pass

        page_count = len(attachments)

        # Placeholder text - VLM will generate actual content
        placeholder_text = f"PDF document with {page_count} pages (VLM processing pending)"

        metadata = {
            "source": "pdf_vision",
            "pages": page_count,
            "processing_mode": "vision",
            "page_texts": page_texts,
        }

        return ParsedContent(
            text=placeholder_text,
            metadata=metadata,
            page_count=page_count,
            attachments=attachments,
            page_mapping=[]  # Will be set after VLM processing
        )
