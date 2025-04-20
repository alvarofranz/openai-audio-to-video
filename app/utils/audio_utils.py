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
    1) Removes silent time gaps by aligning each segment's .start to the end of
       the previous segment, if there's a gap.
    2) Accumulates segments until we reach or exceed 'words_per_scene' words,
       then breaks at that segment boundary to start a new chunk.
    3) Keeps a final leftover chunk even if it's under 'words_per_scene',
       so the last portion is not merged or omitted.
    """
    segments = whisper_data.segments
    if not segments:
        return []

    # --- 1) Remove silent time gaps between segments ---
    last_end = 0.0
    for seg in segments:
        if seg.start > last_end:
            gap = seg.start - last_end
            seg.start = last_end
            seg.end -= gap
        last_end = seg.end

    # --- 2) Accumulate segments into chunks until we reach/exceed words_per_scene ---
    chunks = []
    current_chunk = []
    current_word_count = 0
    chunk_start = None

    for seg in segments:
        seg_text = seg.text.strip()
        seg_words = seg_text.split()
        seg_word_count = len(seg_words)

        # Mark chunk_start the first time we add a segment
        if chunk_start is None:
            chunk_start = seg.start

        # If adding this segment crosses the threshold and we already
        # have something in current_chunk, flush that chunk now.
        if current_word_count + seg_word_count >= words_per_scene and current_word_count > 0:
            # Close out the current chunk at the previous segment boundary
            chunk_text = " ".join(s.text.strip() for s in current_chunk)
            chunk_end = current_chunk[-1].end

            chunks.append({
                "start": chunk_start,
                "end": chunk_end,
                "text": chunk_text
            })

            # Start a new chunk with the current segment
            current_chunk = [seg]
            current_word_count = seg_word_count
            chunk_start = seg.start
        else:
            # Still below threshold, so accumulate
            current_chunk.append(seg)
            current_word_count += seg_word_count

    # --- 3) Flush any leftover as a final chunk, even if under threshold ---
    if current_chunk:
        chunk_text = " ".join(s.text.strip() for s in current_chunk)
        chunk_end = current_chunk[-1].end
        chunks.append({
            "start": chunk_start,
            "end": chunk_end,
            "text": chunk_text
        })

    return chunks
