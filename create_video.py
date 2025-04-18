#!/usr/bin/env python3
import os
import sys
import shutil
import pprint
import uuid
import requests
import config
import unicodedata
from dotenv import load_dotenv
from openai import OpenAI
# Import all moviepy modules at once - do not separate into multiple imports
from moviepy import *

def log(msg: str):
    """Simple logger."""
    print(f"[create_video] {msg}")

def pretty_print_api_response(response_data):
    """Pretty print JSON responses from OpenAI calls."""
    pp = pprint.PrettyPrinter(indent=2, width=100)
    pp.pprint(response_data)

def shorten_prompt_if_needed(prompt: str, max_bytes: int = 4000, encoding: str = "utf‑8"):
    """
    Truncate so that the UTF‑8 *byte* length ≤ `max_bytes`.
    Handles multi‑byte characters safely and appends '…'.
    """
    data = prompt.encode(encoding)
    if len(data) <= max_bytes:
        return prompt

    # Leave room for the 3 ASCII dots and an additional safety margin
    cut = data[: max_bytes - 10]

    # Trim off any partial multibyte sequence at the end
    while cut and (cut[-1] & 0b1100_0000) == 0b1000_0000:  # 10xxxxxx ⇒ continuation byte
        cut = cut[:-1]

    shortened = cut.decode(encoding, errors="ignore").rstrip()
    return f"{shortened}..."

def preprocess_story_data(client, full_story: str) -> str:
    """
    Calls the chat completion to extract 'story ingredients' from the story.
    Returns a list of relevant characters, scenarios, items, etc.
    """
    try:
        completion = client.chat.completions.create(
            model=config.TEXT_MODEL,
            messages=[
                {
                    "role": "developer",
                    "content": (
                        "You are a very visual story processor. You extract relevant visual details from a story and convert "
                        'them into a list of "ingredients" for a story, like characters, scenarios, elements, '
                        "so they are well visually described in a consistent way, with no room for confusion or ambiguity at all if someone else had to paint them with your given details. If an item or scenario is not "
                        "described in detail, but they are relevant to the story, make the visual details up based "
                        "on the story context, leave no room for ambiguous choices by the final painter. When choosing between male and female, you must also make clear choices based on the context. The output must be clearly defined. Each item can only be defined once. The expected output "
                        "should contain the final list of main scenarios, characters and items that are "
                        "most relevant to the story. For example:\n\n"
                        "-characters:\n"
                        "Peter: male, blue eyes, brown hair, 5 feet tall, 30 years old, wears a brown hat\n"
                        "Lucy: female, green eyes, blonde hair, 6 feet tall, 28 years old, wears a red dress\n"
                        "-scenarios:\n"
                        "forest: dark, dense, full of trees with autumn colors\n"
                        "-items:\n"
                        "sword: sharp, made of steel, 3 feet long, engraved with shiny runes\n\n"
                        "Here is the story that you need to extract information from, in the same language as the provided below. Detect the language and return the response in the same language.:\n\n"
                        f"{full_story}\n\n"
                    ),
                },
                {
                    "role": "user",
                    "content": "Generate the story context now.",
                },
            ],
            reasoning_effort="high",
        )
        # For debugging: show the first choice in a pretty form
        pretty_print_api_response(completion.choices[0])
        result = completion.choices[0].message.content.strip()
        return result
    except Exception as e:
        log(f"Error calling story data preprocessor: {e}")
        return ""  # fallback if error

def preprocess_image_prompt(
    client,
    full_story: str,
    story_ingredients: str,
    style_prefix: str,
    scene_text: str
) -> str:
    """
    Uses config.IMAGE_PREPROCESSING_PROMPT + style/story + story_ingredients + scene_text
    to produce a single final prompt for the image.
    """
    try:
        completion = client.chat.completions.create(
            model=config.TEXT_MODEL,
            messages=[
                {
                    "role": "developer",
                    "content": (
                        config.IMAGE_PREPROCESSING_PROMPT
                        + "\n"
                        f"image_style (important details):\n{style_prefix}\n\n"
                        f"story (context):\n{full_story}\n\n"
                        f"story_items_style (important details context):\n{story_ingredients}\n\n"
                        f"current_sequence (main focus for the final image, should be unique for current scene):\n{scene_text}"
                    ),
                },
                {
                    "role": "user",
                    "content": "Generate the final image prompt now.",
                },
            ],
            reasoning_effort="high",
        )
        # For debugging: show the first choice in a pretty form
        pretty_print_api_response(completion.choices[0])
        refined_prompt = completion.choices[0].message.content.strip()
        refined_prompt = shorten_prompt_if_needed(refined_prompt)
        return refined_prompt
    except Exception as e:
        log(f"Error calling GPT-4o for prompt preprocessing: {e}")
        # fallback
        fallback = f"{style_prefix} {scene_text}"
        return shorten_prompt_if_needed(fallback)

def transcribe_audio(client, audio_path: str):
    """
    Use OpenAI's method to transcribe audio with Whisper.
    Returns a 'TranscriptionVerbose' object with .text and .segments.
    """
    log(f"Transcribing audio with Whisper: {audio_path}")
    with open(audio_path, "rb") as f:
        response = client.audio.transcriptions.create(
            model="whisper-1",
            file=f,
            response_format="verbose_json",
        )
    return response

def chunk_transcript(whisper_data, words_per_scene: int):
    """
    Splits the transcribed text into chunks of ~words_per_scene words each.
    Returns a list of dicts with: {"start", "end", "text"}.
    """
    segments = whisper_data.segments
    if not segments:
        log("Warning: No segments found in whisper_data.segments.")
        return []

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
    output_folder: str,
    story_ingredients: str = ""
):
    """
    1) Calls 'preprocess_image_prompt' to build a final prompt for the image.
    2) Generates a DALL·E3 image at config.VIDEO_WIDTH x config.VIDEO_HEIGHT.
    3) Saves to scene_{index}.png.
    4) Returns the local path or None if error.
    """
    final_prompt = preprocess_image_prompt(
        client=client,
        full_story=story_text,
        story_ingredients=story_ingredients,
        style_prefix=config.IMAGE_PROMPT_STYLE,
        scene_text=scene_text
    )

    log(f"Generating image for scene #{index}:\n---\n{final_prompt}\n---")
    try:
        response = client.images.generate(
            model="dall-e-3",
            prompt=shorten_prompt_if_needed(final_prompt, 4000),
            n=1,
            quality="hd",
            size=f"{config.VIDEO_WIDTH}x{config.VIDEO_HEIGHT}"
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
    Builds the final MP4 video, placing each chunk's image from chunk.start to chunk.end.
    """
    log("Loading audio for final video...")
    audio_clip = AudioFileClip(audio_path)
    total_duration = audio_clip.duration

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

        img_clip = (
            ImageClip(image_path)
            .with_duration(duration)
            .with_start(scene_start)
            .resized((config.VIDEO_WIDTH, config.VIDEO_HEIGHT))
        )
        scene_clips.append(img_clip)

    if not scene_clips:
        log("No scene clips found. Cannot build video.")
        return

    log(f"Building CompositeVideoClip timeline at {config.VIDEO_WIDTH}x{config.VIDEO_HEIGHT}.")
    final_clip = CompositeVideoClip(
        scene_clips,
        size=(config.VIDEO_WIDTH, config.VIDEO_HEIGHT)
    ).with_duration(total_duration)

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
    """
    If you run this directly: python create_video.py /path/to/audio.mp3
    """
    if len(sys.argv) < 2:
        print("Usage: python create_video.py /path/to/audio.mp3")
        sys.exit(1)

    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        print("OPENAI_API_KEY not found in .env")
        sys.exit(1)

    client = OpenAI(api_key=api_key)

    audio_input = os.path.abspath(sys.argv[1])
    if not os.path.isfile(audio_input):
        print(f"Audio file not found: {audio_input}")
        sys.exit(1)

    base_name = os.path.splitext(os.path.basename(audio_input))[0]
    unique_id = str(uuid.uuid4())[:5]
    parent_dir = os.path.dirname(audio_input)

    # We'll store everything in: app/static/tmp/<base_name-unique_id>
    video_folder = os.path.join("app", "static", "tmp", f"{base_name}-{unique_id}")
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

    # 3) Copy audio
    new_audio_path = os.path.join(video_folder, os.path.basename(audio_input))
    if os.path.abspath(audio_input) != os.path.abspath(new_audio_path):
        shutil.copy2(audio_input, new_audio_path)

    # 4) Chunk transcript
    chunks = chunk_transcript(whisper_data, config.WORDS_PER_SCENE)
    log(f"Created {len(chunks)} scenes.")

    # The raw full story
    full_story_text = whisper_data.text.strip()

    # 4.5) Preprocess the full story to extract 'story_ingredients'
    story_ingredients = preprocess_story_data(client, full_story_text)
    log("Story ingredients:\n" + story_ingredients)

    # 5) Generate images
    images_folder = os.path.join(video_folder, "images")
    os.makedirs(images_folder, exist_ok=True)

    for i, chunk in enumerate(chunks):
        generate_image_for_scene(
            client=client,
            story_text=full_story_text,
            scene_text=chunk["text"],
            index=i,
            output_folder=images_folder,
            story_ingredients=story_ingredients
        )

    # 6) Create final video
    output_video_path = os.path.join(video_folder, f"{base_name}.mp4")
    create_video_from_scenes(chunks, images_folder, new_audio_path, output_video_path)

    log("All done!")
