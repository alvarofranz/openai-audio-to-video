import os
from moviepy import *
from dotenv import load_dotenv
from openai import OpenAI
from .global_utils import log, pretty_print_api_response

def transcribe_audio(client: OpenAI, audio_path: str):
    log(f"Transcribing audio with Whisper: {audio_path}", "audio_utils")
    with open(audio_path, "rb") as f:
        response = client.audio.transcriptions.create(
            model="whisper-1",
            file=f,
            response_format="verbose_json",
        )
    return response

def chunk_transcript(whisper_data, words_per_scene: int):
    segments = whisper_data.segments
    chunks = []
    current_chunk = []
    current_word_count = 0
    chunk_start = None

    for seg in segments:
        seg_text = seg.text.strip()
        seg_word_count = len(seg_text.split())
        if chunk_start is None:
            chunk_start = seg.start

        if current_word_count + seg_word_count > words_per_scene and current_word_count > 0:
            chunk_text = " ".join([s.text.strip() for s in current_chunk])
            chunk_end = current_chunk[-1].end
            chunks.append({"start": chunk_start, "end": chunk_end, "text": chunk_text})
            current_chunk = [seg]
            current_word_count = seg_word_count
            chunk_start = seg.start
        else:
            current_chunk.append(seg)
            current_word_count += seg_word_count

    if current_chunk:
        chunk_text = " ".join([s.text.strip() for s in current_chunk])
        chunk_end = current_chunk[-1].end
        chunks.append({"start": chunk_start, "end": chunk_end, "text": chunk_text})

    return chunks
