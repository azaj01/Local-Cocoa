from __future__ import annotations

import datetime as dt
import logging
import uuid
from typing import Optional

from .clients import LlmClient
from .models import ActivityLog, ActivityTimelineResponse
from .storage import IndexStorage

logger = logging.getLogger(__name__)


class ActivityService:
    def __init__(self, storage: IndexStorage, llm_client: LlmClient) -> None:
        self.storage = storage
        self.llm_client = llm_client

    async def ingest_screenshot(self, image_bytes: bytes) -> ActivityLog:
        """
        Analyze the screenshot using Vision LLM and store the description.
        The image itself is NOT stored.
        """
        now = dt.datetime.now(dt.timezone.utc)

        # Use Vision LLM to describe the screen
        try:
            # We ask for two parts: a short summary (title) and a detailed description.
            # Since we can't easily enforce JSON with all models, we'll ask for a specific format.
            prompt = (
                "Analyze this screenshot. Provide two outputs:\n"
                "1. A very short summary (max 10 words) of the active task.\n"
                "2. A detailed description of the screen content, visible text, and context.\n\n"
                "Format your response exactly like this:\n"
                "Summary: [Your short summary]\n"
                "Description: [Your detailed description]"
            )

            raw_response = await self.llm_client.describe_frames(
                frames=[image_bytes],
                prompt=prompt,
                system="You are an activity tracker. Your job is to log what the user is doing based on their screen content."
            )

            # Parse the response
            lines = raw_response.strip().split('\n')
            short_desc = "Activity detected"
            long_desc = raw_response

            summary_prefix = "Summary:"
            desc_prefix = "Description:"

            parsed_summary = None
            parsed_desc = []

            current_section = None

            for line in lines:
                line = line.strip()
                if not line:
                    continue

                if line.startswith(summary_prefix):
                    parsed_summary = line[len(summary_prefix):].strip()
                    current_section = "summary"
                elif line.startswith(desc_prefix):
                    desc_start = line[len(desc_prefix):].strip()
                    if desc_start:
                        parsed_desc.append(desc_start)
                    current_section = "description"
                else:
                    if current_section == "description":
                        parsed_desc.append(line)
                    elif current_section == "summary" and not parsed_summary:
                        parsed_summary = line

            if parsed_summary:
                short_desc = parsed_summary

            if parsed_desc:
                long_desc = " ".join(parsed_desc)
            elif not parsed_summary:
                # Fallback if parsing failed completely but we have text
                long_desc = raw_response
                # Try to take first sentence as short desc
                first_sentence = raw_response.split('.')[0]
                if len(first_sentence) < 100:
                    short_desc = first_sentence
                else:
                    short_desc = first_sentence[:97] + "..."

            logger.info(f"Activity Ingest: Short: {short_desc}, Long: {long_desc[:50]}...")

        except Exception as e:
            logger.error("Failed to describe screenshot: %s", e)
            short_desc = "Analysis failed"
            long_desc = "Screen capture failed analysis."

        log_entry = ActivityLog(
            id=uuid.uuid4().hex,
            timestamp=now,
            description=long_desc,
            short_description=short_desc
        )

        self.storage.insert_activity_log(log_entry)
        logger.info(f"Activity Ingest: Saved log entry {log_entry.id} at {now}")
        return log_entry

    async def get_timeline(self, start: Optional[dt.datetime], end: Optional[dt.datetime], generate_summary: bool = False) -> ActivityTimelineResponse:
        logs = self.storage.list_activity_logs(start, end, limit=5000)  # Cap at 5000 for safety
        logger.info(f"Activity Timeline: Found {len(logs)} logs between {start} and {end}")

        summary = None
        if generate_summary and logs:
            summary = await self._generate_high_level_summary(logs)
            logger.info(f"Activity Timeline: Generated summary: {summary}")

        return ActivityTimelineResponse(logs=logs, summary=summary)

    async def delete_logs(self, start: Optional[dt.datetime], end: Optional[dt.datetime]) -> int:
        count = self.storage.delete_activity_logs(start, end)
        logger.info(f"Activity Timeline: Deleted {count} logs between {start} and {end}")
        return count

    async def delete_log(self, log_id: str) -> bool:
        deleted = self.storage.delete_activity_log(log_id)
        if deleted:
            logger.info(f"Activity Timeline: Deleted log {log_id}")
        else:
            logger.warning(f"Activity Timeline: Failed to delete log {log_id} (not found)")
        return deleted

    async def _generate_high_level_summary(self, logs: list[ActivityLog]) -> str:
        """
        Generate a summary of the activities. Handles large context by chunking if necessary.
        """
        if not logs:
            return "No activity recorded."

        # Prepare text representation
        lines = [f"[{log.timestamp.strftime('%H:%M')}] {log.description}" for log in logs]
        full_text = "\n".join(lines)

        # Simple estimation: 1 token ~= 4 chars. 32k tokens ~= 128k chars.
        # If text is too long, we need multi-stage summarization.
        MAX_CHARS_PER_CHUNK = 20000  # Conservative chunk size for intermediate summaries

        if len(full_text) > MAX_CHARS_PER_CHUNK:
            return await self._multi_stage_summary(lines, MAX_CHARS_PER_CHUNK)

        return await self._single_stage_summary(full_text)

    async def _single_stage_summary(self, text: str) -> str:
        prompt = (
            "Below is a log of user activity on their computer screen over a period of time.\n"
            "Generate a comprehensive and professional timeline summary of what the user worked on.\n"
            "Focus on identifying distinct tasks, projects, and workflows.\n"
            "Highlight key achievements, transitions between contexts, and the duration of major activities.\n"
            "Format the output using Markdown. Use headers (##, ###) for sections, bullet points for lists, and bold text for emphasis.\n\n"
            f"{text}"
        )
        messages = [
            {"role": "system", "content": "You are a professional productivity analyst summarizing work activity."},
            {"role": "user", "content": prompt}
        ]
        return await self.llm_client.chat_complete(messages)

    async def _multi_stage_summary(self, lines: list[str], chunk_size: int) -> str:
        # 1. Chunk the lines
        chunks = []
        current_chunk = []
        current_length = 0

        for line in lines:
            if current_length + len(line) > chunk_size:
                chunks.append("\n".join(current_chunk))
                current_chunk = []
                current_length = 0
            current_chunk.append(line)
            current_length += len(line) + 1

        if current_chunk:
            chunks.append("\n".join(current_chunk))

        # 2. Summarize each chunk
        intermediate_summaries = []
        for i, chunk in enumerate(chunks):
            prompt = (
                f"Summarize this segment of activity logs (Part {i+1}/{len(chunks)}):\n\n"
                f"{chunk}"
            )
            messages = [
                {"role": "system", "content": "Summarize the user's activity logs concisely."},
                {"role": "user", "content": prompt}
            ]
            summary = await self.llm_client.chat_complete(messages)
            intermediate_summaries.append(summary)

        # 3. Final summary
        combined_summaries = "\n\n".join(intermediate_summaries)
        final_prompt = (
            "Below are summaries of activity segments throughout the day. "
            "Create a cohesive narrative summary of the entire period.\n"
            "Format the output using Markdown. Use headers (##, ###) for sections, bullet points for lists, and bold text for emphasis.\n\n"
            f"{combined_summaries}"
        )
        messages = [
            {"role": "system", "content": "You are a helpful assistant summarizing work activity."},
            {"role": "user", "content": final_prompt}
        ]
        return await self.llm_client.chat_complete(messages)

    async def generate_summary_for_period(self, minutes: int = 30) -> tuple[str | None, dt.datetime, dt.datetime]:
        end = dt.datetime.now(dt.timezone.utc)
        start = end - dt.timedelta(minutes=minutes)
        logs = self.storage.list_activity_logs(start, end, limit=5000)
        if not logs:
            return None, start, end

        summary = await self._generate_high_level_summary(logs)
        return summary, start, end
