import os
from dotenv import load_dotenv
from openai import OpenAI
from .global_utils import log, pretty_print_api_response

def transcribe_audio(client: OpenAI, audio_path: str):
    """
    Transcribes audio using Whisper, returning a 'TranscriptionVerbose' object
    with .text and .segments.
    """
    log(f"Transcribing audio with Whisper: {audio_path}", "audio_utils")
    with open(audio_path, "rb") as f:
        response = client.audio.transcriptions.create(
            model="whisper-1",
            file=f,
            response_format="verbose_json",
        )
    return response

def chunk_transcript(whisper_data, words_per_scene: int):
    """
    1) Removes silent time gaps by shifting each segment's start time to the
       previous segment's end if there's a gap.
    2) Accumulates segments into chunks that each have at least 'words_per_scene'
       words, unless it's the final leftover chunk.
    3) If the final leftover chunk still has fewer than 'words_per_scene' words,
       it is merged into the previous chunk. This avoids small partial chunks.
    """
    segments = whisper_data.segments
    if not segments:
        return []

    # --- 1) Remove silent time gaps between segments
    last_end = 0.0
    for seg in segments:
        if seg.start > last_end:
            # Shift this segment so it starts exactly where the previous ended
            gap = seg.start - last_end
            seg.start = last_end
            seg.end = seg.end - gap
        last_end = seg.end

    # --- 2) Accumulate segments into chunks
    chunks = []
    current_chunk = []
    current_word_count = 0
    chunk_start = None

    for seg in segments:
        seg_text = seg.text.strip()
        seg_words = seg_text.split()
        seg_word_count = len(seg_words)

        if chunk_start is None:
            chunk_start = seg.start

        # Keep adding segments until we reach or exceed words_per_scene
        if current_word_count + seg_word_count >= words_per_scene and current_word_count > 0:
            # Flush the current chunk
            chunk_text = " ".join(s.text.strip() for s in current_chunk)
            chunk_end = current_chunk[-1].end
            chunks.append({
                "start": chunk_start,
                "end": chunk_end,
                "text": chunk_text
            })
            # Start a new chunk with this segment
            current_chunk = [seg]
            current_word_count = seg_word_count
            chunk_start = seg.start
        else:
            # Keep accumulating
            current_chunk.append(seg)
            current_word_count += seg_word_count

    # Flush leftover chunk, if any
    if current_chunk:
        chunk_text = " ".join(s.text.strip() for s in current_chunk)
        chunk_end = current_chunk[-1].end
        chunks.append({
            "start": chunk_start,
            "end": chunk_end,
            "text": chunk_text
        })

    # --- 3) If final chunk has fewer than 'words_per_scene' words, merge with previous
    if len(chunks) > 1:
        last_chunk_words = len(chunks[-1]["text"].split())
        if last_chunk_words < words_per_scene:
            # Merge the last chunk with the previous chunk
            chunks[-2]["text"] += " " + chunks[-1]["text"]
            chunks[-2]["end"] = chunks[-1]["end"]
            chunks.pop()

    return chunks
