#!/usr/bin/env python3
import os
import sys
import shutil
import time
import pprint
import uuid  # for generating a short unique ID

from dotenv import load_dotenv
from openai import OpenAI
import requests

# MoviePy v2 import
from moviepy import *

import config

def log(msg: str):
    """Simple logger."""
    print(f"[create_video] {msg}")

def pretty_print_api_response(response_data):
    """Pretty print JSON responses from OpenAI calls."""
    pp = pprint.PrettyPrinter(indent=2, width=100)
    pp.pprint(response_data)

def transcribe_audio(client, audio_path: str):
    """
    Use OpenAI's new method to transcribe audio:
      client.audio.transcriptions.create(...)
    Returns a 'TranscriptionVerbose' object with .text and .segments.
    """
    log(f"Transcribing audio with Whisper: {audio_path}")
    with open(audio_path, "rb") as f:
        response = client.audio.transcriptions.create(
            model="whisper-1",
            file=f,
            response_format="verbose_json",
        )
    return response  # TranscriptionVerbose object

def chunk_transcript(whisper_data, words_per_scene: int):
    """
    Splits the transcribed text into chunks of ~words_per_scene words each.
    We read each segment from whisper_data.segments,
    collecting start/end/txt for each chunk.
    Returns a list of dicts:
      [
        {
          "start": float,
          "end": float,
          "text": "chunk text"
        },
        ...
      ]
    """
    segments = whisper_data.segments
    chunks = []
    current_chunk_words = []
    current_chunk_start = None
    current_word_count = 0

    def flush_chunk(start_t, end_t, words_list):
        if not words_list:
            return None
        return {
            "start": start_t,
            "end": end_t,
            "text": " ".join(words_list)
        }

    for seg in segments:
        seg_text = seg.text.strip()
        seg_start = seg.start
        seg_end = seg.end

        seg_words = seg_text.split()
        for w in seg_words:
            if current_chunk_start is None:
                current_chunk_start = seg_start
            current_chunk_words.append(w)
            current_word_count += 1

            if current_word_count >= words_per_scene:
                chunk = flush_chunk(current_chunk_start, seg_end, current_chunk_words)
                if chunk:
                    chunks.append(chunk)
                current_chunk_words = []
                current_chunk_start = None
                current_word_count = 0

    # Flush remainder
    if current_chunk_words:
        last_seg_end = segments[-1].end
        chunk = flush_chunk(current_chunk_start, last_seg_end, current_chunk_words)
        if chunk:
            chunks.append(chunk)

    return chunks

def generate_image_for_scene(client, scene_text: str, index: int, output_folder: str):
    """
    Generates a DALL·E 3 image at 1792×1024, saves it to scene_{index}.png,
    and returns the local path.
    """
    prompt = f"{config.IMAGE_PROMPT_STARTER} {scene_text}"
    log(f"Generating image for scene #{index}:\n---\n{prompt}\n---")

    try:
        response = client.images.generate(
            model="dall-e-3",
            prompt=prompt,
            n=1,
            size="1792x1024"
        )
        pretty_print_api_response(response)

        image_url = response.data[0].url
        img_data = requests.get(image_url).content
        image_path = os.path.join(output_folder, f"scene_{index}.png")
        with open(image_path, "wb") as file:
            file.write(img_data)

        return image_path
    except Exception as e:
        log(f"Error generating image for scene #{index}: {e}")
        return None

def create_video_from_scenes(chunks, images_folder: str, audio_path: str, output_path: str):
    """
    Builds a final MP4 video:
      - 1792×1024 resolution
      - Scenes concatenated with method="chain" (no crossfade).
      - 2s fadein at start of entire final video, 2s fadeout at end.
    """
    log("Loading audio for final video...")
    audio_clip = AudioFileClip(audio_path)

    scene_clips = []
    for i, chunk in enumerate(chunks):
        scene_duration = chunk["end"] - chunk["start"]
        if scene_duration < 0.1:
            scene_duration = 0.1

        image_path = os.path.join(images_folder, f"scene_{i}.png")
        if not os.path.isfile(image_path):
            log(f"Warning: Missing image for scene #{i}, skipping.")
            continue

        # Build an ImageClip with:
        # .with_duration(...) → sets how long it's shown
        # .resized(...) → scale to 1792×1024
        img_clip = (
            ImageClip(image_path)
            .with_duration(scene_duration)
            .resized((1792, 1024))
        )
        scene_clips.append(img_clip)

    if not scene_clips:
        log("No scene clips found. Cannot build video.")
        return

    # Simple chain concatenation
    log("Concatenating scene clips with method='chain' (no crossfade).")
    final_clip = concatenate_videoclips(scene_clips, method="chain")

    # Attach the audio track
    final_clip = final_clip.with_audio(audio_clip)


    log(f"Writing final video to: {output_path} (1792×1024, 24fps)")
    final_clip.write_videofile(
        filename=output_path,
        fps=24,
        codec="libx264",
        audio_codec="aac",
        threads=4
    )

def main():
    """Orchestrate everything: parse input, transcribe, generate images, create video."""
    if len(sys.argv) < 2:
        print("Usage: python create_video.py /path/to/audio.mp3")
        sys.exit(1)

    audio_input = os.path.abspath(sys.argv[1])
    if not os.path.isfile(audio_input):
        print(f"Audio file not found: {audio_input}")
        sys.exit(1)

    # Load environment
    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        print("OPENAI_API_KEY not found in .env")
        sys.exit(1)

    # Initialize OpenAI client
    client = OpenAI(api_key=api_key)

    # Create a sibling folder "video-<audio_basename>-<uniqueid>"
    base_name = os.path.splitext(os.path.basename(audio_input))[0]
    unique_id = str(uuid.uuid4())[:5]  # short 5-char ID
    parent_dir = os.path.dirname(audio_input)
    video_folder = os.path.join(parent_dir, f"video-{base_name}-{unique_id}")
    os.makedirs(video_folder, exist_ok=True)

    # 1) Transcribe
    whisper_data = transcribe_audio(client, audio_input)

    # 2) Save transcript
    transcript_file = os.path.join(video_folder, "transcript.txt")
    with open(transcript_file, "w", encoding="utf-8") as f:
        for seg in whisper_data.segments:
            st = seg.start
            et = seg.end
            txt = seg.text.strip().replace("\n", " ")
            line = f"{st:.2f} --> {et:.2f}: {txt}\n"
            f.write(line)

    # 3) Copy (not move) audio into the new folder
    new_audio_path = os.path.join(video_folder, os.path.basename(audio_input))
    if os.path.abspath(audio_input) != os.path.abspath(new_audio_path):
        shutil.copy2(audio_input, new_audio_path)

    # 4) Chunk transcript => Scenes
    chunks = chunk_transcript(whisper_data, config.WORDS_PER_SCENE)
    log(f"Created {len(chunks)} scenes (text chunks).")

    # 5) Generate images
    images_folder = os.path.join(video_folder, "images")
    os.makedirs(images_folder, exist_ok=True)

    for i, chunk in enumerate(chunks):
        scene_text = chunk["text"]
        generate_image_for_scene(client, scene_text, i, images_folder)
        time.sleep(config.WAIT_BETWEEN_IMAGE_GENERATION)

    # 6) Create final video (chain method)
    output_video_path = os.path.join(video_folder, f"{base_name}.mp4")
    create_video_from_scenes(chunks, images_folder, new_audio_path, output_video_path)

    log("All done!")

if __name__ == "__main__":
    main()
