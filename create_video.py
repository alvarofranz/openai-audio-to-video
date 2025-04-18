#!/usr/bin/env python3
import os
import sys
import shutil
import time
import pprint
import uuid
import requests
import config
from dotenv import load_dotenv
from openai import OpenAI
from moviepy import *

def log(msg: str):
    """Simple logger."""
    print(f"[create_video] {msg}")

def pretty_print_api_response(response_data):
    """Pretty print JSON responses from OpenAI calls."""
    pp = pprint.PrettyPrinter(indent=2, width=100)
    pp.pprint(response_data)

def shorten_prompt_if_needed(prompt: str, max_length=4000) -> str:
    """
    If the prompt is too long (> 4000 chars), DALL·E3 may refuse it.
    We'll truncate it and append '...' to avoid 400 errors.
    """
    if len(prompt) <= max_length:
        return prompt
    return prompt[:max_length - 3].rstrip() + "..."

def preprocess_image_prompt(client, full_story, style_prefix, scene_text):
    """
    Uses gpt-4o to transform the raw 'scene_text' + story context
    into a refined image prompt. If the prompt is too large or fails,
    we fallback to a simpler style-based prompt.
    """
    try:
        completion = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "developer",
                    "content": (
                        "You are a prompt preprocessor specialized in generating prompts for images that will be part of a sequence in a larger story. You need to capture the style, an overview of the entire story for context, and the details for this specific image. Please produce a single final prompt for the image, capturing the style perfectly, the story essence, but focusing with great detail on the current scene. Do not mention anything in the prompt that may lead to text generation. Avoid using character personal names, focus on the visual descriptions. Also do not use dialogues or dialogue inciting words like 'asks' or 'says'. Focus on visual aspects and actions to make the scene is dynamic and captures the key details for the story but specifically for the current scene. It is very important to include all the style details blended into the prompt effectively, giving a clear detailed final prompt where you describe the background, the foreground, the perspective, some details, just like an artist would create a very dynamic and cinematic scene. Here are the three inputs:\n\n"
                        f"style:\n{style_prefix}\n\n"
                        f"story:\n{full_story}\n\n"
                        f"current sequence:\n{scene_text}"
                    ),
                },
                {
                    "role": "user",
                    "content": "Generate the final image prompt now (max length: 4000 characters).",
                },
            ],
        )
        refined_prompt = completion.choices[0].message.content.strip()
        # If it's too long for DALL·E3, truncate:
        refined_prompt = shorten_prompt_if_needed(refined_prompt, max_length=4000)
        return refined_prompt
    except Exception as e:
        log(f"Error calling GPT-4o for prompt preprocessing: {e}")
        # fallback if GPT-4o fails:
        fallback = f"{style_prefix} {scene_text}"
        return shorten_prompt_if_needed(fallback, max_length=4000)

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
    Splits the transcribed text into chunks of ~words_per_scene words each,
    using the segments' timestamps.
    Returns a list of dicts with:
      {
         "start": float,
         "end": float,
         "text": str
      }
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

def generate_image_for_scene(
    client,
    story_text: str,
    scene_text: str,
    index: int,
    output_folder: str
):
    """
    1) Calls 'preprocess_image_prompt' with GPT-4o to refine the scene prompt.
    2) Generates a DALL·E3 image at 1792×1024.
    3) Saves to scene_{index}.png.
    4) Returns the local path or None if error.
    """
    # 1) Refine the prompt
    final_prompt = preprocess_image_prompt(
        client=client,
        full_story=story_text,
        style_prefix=config.IMAGE_PROMPT_STARTER,
        scene_text=scene_text,
    )

    log(f"Generating image for scene #{index}:\n---\n{final_prompt}\n---")
    try:
        response = client.images.generate(
            model="dall-e-3",
            prompt=final_prompt,
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
    Builds a final MP4 video exactly matching the audio duration:
      - Each image is placed in the timeline from chunk.start to chunk.end
      - The final composite ends exactly at audio_clip.duration
      - 1792×1024 resolution
    """
    log("Loading audio for final video...")
    audio_clip = AudioFileClip(audio_path)
    total_duration = audio_clip.duration

    # Place each scene image at [chunk.start, chunk.end] in a CompositeVideoClip
    scene_clips = []
    for i, chunk in enumerate(chunks):
        scene_start = chunk["start"]
        scene_end = chunk["end"]
        if scene_end <= scene_start:
            continue

        image_path = os.path.join(images_folder, f"scene_{i}.png")
        if not os.path.isfile(image_path):
            log(f"Warning: Missing image for scene #{i}, skipping.")
            continue

        duration = scene_end - scene_start
        if duration < 0.1:
            duration = 0.1

        # Build an ImageClip spanning the chunk timeframe
        img_clip = (
            ImageClip(image_path)
            .with_duration(duration)
            .with_start(scene_start)
            .resized((1792, 1024))
        )
        scene_clips.append(img_clip)

    if not scene_clips:
        log("No scene clips found. Cannot build video.")
        return

    log("Building CompositeVideoClip timeline at 1792×1024.")
    final_clip = CompositeVideoClip(
        scene_clips,
        size=(1792, 1024)
    ).with_duration(total_duration)

    # Attach audio
    final_clip = final_clip.with_audio(audio_clip)

    log(f"Writing final video to: {output_path}")
    final_clip.write_videofile(
        filename=output_path,
        fps=24,
        codec="libx264",
        audio_codec="aac",
        threads=4
    )

def main():
    """Orchestrates the entire flow: parse input, transcribe, chunk, generate images, create video."""
    if len(sys.argv) < 2:
        print("Usage: python create_video.py /path/to/audio.mp3")
        sys.exit(1)

    audio_input = os.path.abspath(sys.argv[1])
    if not os.path.isfile(audio_input):
        print(f"Audio file not found: {audio_input}")
        sys.exit(1)

    # Load environment (OPENAI_API_KEY)
    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        print("OPENAI_API_KEY not found in .env")
        sys.exit(1)

    # Initialize OpenAI client
    client = OpenAI(api_key=api_key)

    # Create a sibling folder "video-from-<audio_basename>-<uniqueid>"
    base_name = os.path.splitext(os.path.basename(audio_input))[0]
    unique_id = str(uuid.uuid4())[:5]  # e.g. "ab123"
    parent_dir = os.path.dirname(audio_input)
    video_folder = os.path.join(parent_dir, f"video-from-{base_name}-{unique_id}")
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

    # 3) Copy audio into the new folder
    new_audio_path = os.path.join(video_folder, os.path.basename(audio_input))
    if os.path.abspath(audio_input) != os.path.abspath(new_audio_path):
        shutil.copy2(audio_input, new_audio_path)

    # 4) Chunk transcript => Scenes
    chunks = chunk_transcript(whisper_data, config.WORDS_PER_SCENE)
    log(f"Created {len(chunks)} scenes (text chunks).")

    # The entire story for GPT-4o context
    full_story_text = whisper_data.text.strip()

    # 5) Generate images
    images_folder = os.path.join(video_folder, "images")
    os.makedirs(images_folder, exist_ok=True)

    for i, chunk in enumerate(chunks):
        scene_text = chunk["text"]
        generate_image_for_scene(client, full_story_text, scene_text, i, images_folder)
        time.sleep(config.WAIT_BETWEEN_IMAGE_GENERATION)

    # 6) Create final video
    output_video_path = os.path.join(video_folder, f"{base_name}.mp4")
    create_video_from_scenes(chunks, images_folder, new_audio_path, output_video_path)

    log("All done!")

if __name__ == "__main__":
    main()
