from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path

from .base import BaseParser, ParsedContent


class AudioParser(BaseParser):
    extensions = {"mp3", "wav", "m4a", "flac", "aac", "ogg"}

    def __init__(self, *, ffmpeg_binary: str = "ffmpeg", max_chars: int = 4000) -> None:
        super().__init__(max_chars=max_chars)
        self.ffmpeg_binary = ffmpeg_binary

    def parse(self, path: Path) -> ParsedContent:
        with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
            cmd = [
                self.ffmpeg_binary,
                "-y",
                "-i",
                str(path),
                "-ar",
                "16000",
                "-ac",
                "1",
                "-f",
                "wav",
                tmp.name,
            ]
            subprocess.run(cmd, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            audio_bytes = Path(tmp.name).read_bytes()

        metadata = {"source": "audio"}
        return ParsedContent(
            text="",
            metadata=metadata,
            preview_image=None,
            duration_seconds=None,
            attachments={"audio_wav": audio_bytes},
        )
