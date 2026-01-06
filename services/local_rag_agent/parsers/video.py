from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2

from ..config import settings
from .base import BaseParser, ParsedContent


@dataclass
class VideoSegment:
    """Represents a 30-second video segment with multiple frames."""
    frames: list[bytes]  # 8 frames uniformly sampled from this segment
    start_time: float    # Start timestamp in seconds
    end_time: float      # End timestamp in seconds
    segment_index: int   # Segment number (0, 1, 2, ...)


class VideoParser(BaseParser):
    extensions = {"mp4", "mov", "mkv", "avi", "webm"}

    def __init__(self, *, max_chars: int = 4000, segment_duration: int = 30, frames_per_segment: int = 8) -> None:
        """
        Initialize VideoParser.
        
        Args:
            max_chars: Maximum characters for text content
            segment_duration: Duration of each segment in seconds (default: 30)
            frames_per_segment: Number of frames to extract per segment (default: 8, including start and end frames)
        """
        super().__init__(max_chars=max_chars)
        self.segment_duration = segment_duration
        self.frames_per_segment = frames_per_segment

    def parse(self, path: Path) -> ParsedContent:
        capture = cv2.VideoCapture(str(path))
        if not capture.isOpened():
            raise RuntimeError(f"Unable to open video file: {path}")

        frame_total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
        duration = frame_total / fps if fps > 0 else 0.0
        
        # Divide video into segments
        segments: list[VideoSegment] = []
        segment_index = 0
        current_start = 0.0
        
        while current_start < duration:
            # Calculate segment boundaries
            segment_end = min(current_start + self.segment_duration, duration)
            
            # Extract frames uniformly from this segment (including start and end)
            segment_frames = self._extract_segment_frames(
                capture, current_start, segment_end, fps, frame_total
            )
            
            if segment_frames:
                segments.append(VideoSegment(
                    frames=segment_frames,
                    start_time=current_start,
                    end_time=segment_end,
                    segment_index=segment_index
                ))
                segment_index += 1
            
            current_start += self.segment_duration

        capture.release()

        metadata = {
            "source": "video",
            "segments_count": len(segments),
            "duration": duration,
            "fps": fps,
            "segment_duration": self.segment_duration,
            "frames_per_segment": self.frames_per_segment,
        }
        
        # Store all segments data
        attachments = {}
        if segments:
            # Store segment info for processing
            attachments["video_segments"] = [
                {
                    "frames": seg.frames,
                    "start_time": seg.start_time,
                    "end_time": seg.end_time,
                    "index": seg.segment_index,
                }
                for seg in segments
            ]
        
        # Use first frame of first segment as preview
        preview_image = segments[0].frames[0] if segments and segments[0].frames else None
        
        return ParsedContent(
            text="",
            metadata=metadata,
            preview_image=preview_image,
            duration_seconds=duration,
            attachments=attachments,
        )
    
    def _extract_segment_frames(
        self, capture: cv2.VideoCapture, start_time: float, end_time: float, fps: float, frame_total: int
    ) -> list[bytes]:
        """Extract uniformly distributed frames from a video segment."""
        start_frame = int(start_time * fps)
        end_frame = min(int(end_time * fps), frame_total - 1)
        
        if start_frame >= frame_total or start_frame >= end_frame:
            return []
        
        # Calculate frame indices to extract (uniformly distributed, including start and end)
        frames_in_segment = end_frame - start_frame + 1
        if frames_in_segment <= self.frames_per_segment:
            # If segment has fewer frames than requested, take all
            frame_indices = list(range(start_frame, end_frame + 1))
        else:
            # Uniformly sample frames_per_segment frames including start and end
            frame_indices = [
                start_frame + int(i * (end_frame - start_frame) / (self.frames_per_segment - 1))
                for i in range(self.frames_per_segment)
            ]
        
        extracted_frames = []
        # Use video-specific resolution (lower than images for faster processing)
        max_pixels = settings.video_max_pixels

        for frame_idx in frame_indices:
            capture.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            success, frame = capture.read()
            
            if success:
                # Resize if needed
                height, width = frame.shape[:2]
                if max_pixels > 0 and width * height > max_pixels:
                    ratio = (max_pixels / (width * height)) ** 0.5
                    new_width = int(width * ratio)
                    new_height = int(height * ratio)
                    frame = cv2.resize(frame, (new_width, new_height), interpolation=cv2.INTER_AREA)

                # Encode frame to JPEG
                _, buffer = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
                extracted_frames.append(buffer.tobytes())
        
        return extracted_frames
