import os
import uuid

from flask import Blueprint, render_template, request, jsonify
from dotenv import load_dotenv
from openai import OpenAI

from app.utils.audio_utils import transcribe_audio, chunk_transcript
from app.utils.video_utils import create_video_from_scenes
from app.utils.prompt_utils import (
    generate_image_for_scene,
    preprocess_image_prompt,
    preprocess_story_data,
    generate_title_and_description
)

# Import your default values
from defaults import (
    WORDS_PER_SCENE,
    TEXT_MODEL,
    VIDEO_SIZE,
    IMAGE_PROMPT_STYLE,
    CHARACTERS_PROMPT_STYLE,
    IMAGE_PREPROCESSING_PROMPT
)

main_bp = Blueprint("main", __name__)

CURRENT_JOBS = {}

@main_bp.route("/", methods=["GET"])
def index():
    """
    Pass the defaults from defaults.py into the template,
    so index.html can auto-populate those fields.
    """
    return render_template(
        "index.html",
        default_words_per_scene=WORDS_PER_SCENE,
        default_text_model=TEXT_MODEL,
        default_video_size=VIDEO_SIZE,
        default_image_prompt_style=IMAGE_PROMPT_STYLE,
        default_characters_prompt_style=CHARACTERS_PROMPT_STYLE,
        default_image_preprocessing_prompt=IMAGE_PREPROCESSING_PROMPT
    )

@main_bp.route("/upload-audio", methods=["POST"])
def upload_audio():
    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        return jsonify({"error": "OPENAI_API_KEY not set"}), 500
    client = OpenAI(api_key=api_key)

    file = request.files.get("audio")
    if not file:
        return jsonify({"error": "No file uploaded"}), 400

    # Grab user input
    words_per_scene = request.form.get("words_per_scene", "40").strip()
    text_model = request.form.get("text_model", "o4-mini").strip()
    size = request.form.get("size", "1792x1024").strip()
    image_prompt_style = request.form.get("image_prompt_style", "")
    characters_prompt_style = request.form.get("characters_prompt_style", "")
    image_preprocessing_prompt = request.form.get("image_preprocessing_prompt", "")

    # Parse size or fallback
    try:
        width_str, height_str = size.lower().split("x")
        video_width = int(width_str)
        video_height = int(height_str)
    except:
        video_width = 1792
        video_height = 1024

    # Parse words_per_scene or fallback
    try:
        wps = int(words_per_scene)
    except:
        wps = 40

    # Build a short unique folder name based on the audio file
    audio_basename = os.path.splitext(os.path.basename(file.filename))[0]
    short_uniq = str(uuid.uuid4())[:6]
    job_id = f"{audio_basename}-{short_uniq}"

    # Projects folder
    job_folder = os.path.join("app", "static", "projects", job_id)
    os.makedirs(job_folder, exist_ok=True)

    # Save the audio file
    audio_path = os.path.join(job_folder, file.filename)
    file.save(audio_path)

    # Transcribe
    try:
        whisper_data = transcribe_audio(client, audio_path)
    except Exception as e:
        return jsonify({"error": f"Failed to transcribe audio: {str(e)}"}), 500

    full_text = whisper_data.text.strip()

    # Title & description
    td = generate_title_and_description(client, full_text, text_model)

    # Story ingredients
    story_ingredients = preprocess_story_data(client, full_text, text_model, characters_prompt_style)

    # Chunk transcript
    chunks = chunk_transcript(whisper_data, wps)
    if not chunks:
        return jsonify({"error": "No scenes could be created."}), 500

    # Store everything in memory
    CURRENT_JOBS[job_id] = {
        "audio_path": audio_path,
        "full_text": full_text,
        "chunks": chunks,
        "images": [None]*len(chunks),
        "prompts": [None]*len(chunks),
        "title": td["title"],
        "description": td["description"],
        "job_folder": job_folder,
        "story_ingredients": story_ingredients,
        "characters_prompt_style": characters_prompt_style,
        "words_per_scene": wps,
        "text_model": text_model,
        "video_width": video_width,
        "video_height": video_height,
        "image_prompt_style": image_prompt_style,
        "image_preprocessing_prompt": image_preprocessing_prompt
    }

    # Return initial job info
    return jsonify({
        "job_id": job_id,
        "title": td["title"],
        "description": td["description"],
        "story_ingredients": story_ingredients,
        "chunks": [
            {
                "index": i,
                "raw_text": c["text"],
                "start": c["start"],
                "end": c["end"]
            } for i, c in enumerate(chunks)
        ]
    })

@main_bp.route("/preprocess-chunk", methods=["POST"])
def preprocess_chunk():
    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        return jsonify({"error": "OPENAI_API_KEY not set"}), 500
    client = OpenAI(api_key=api_key)

    data = request.json
    job_id = data.get("job_id")
    chunk_index = data.get("chunk_index")
    job_data = CURRENT_JOBS.get(job_id)
    if not job_data:
        return jsonify({"error": "No such job"}), 400

    try:
        raw_text = job_data["chunks"][chunk_index]["text"]
    except (IndexError, KeyError):
        return jsonify({"error": "Invalid chunk index"}), 400

    final_prompt = preprocess_image_prompt(
        client=client,
        full_story=job_data["full_text"],
        story_ingredients=job_data["story_ingredients"],
        style_prefix=job_data["image_prompt_style"],
        scene_text=raw_text,
        text_model=job_data["text_model"],
        image_preprocessing_prompt=job_data["image_preprocessing_prompt"],
        characters_prompt_style=job_data["characters_prompt_style"]
    )
    job_data["prompts"][chunk_index] = final_prompt
    return jsonify({"preprocessed_prompt": final_prompt})

@main_bp.route("/generate-image", methods=["POST"])
def generate_image_route():
    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        return jsonify({"error": "OPENAI_API_KEY not set"}), 500
    client = OpenAI(api_key=api_key)

    data = request.json
    job_id = data.get("job_id")
    scene_index = data.get("scene_index")
    new_prompt = data.get("new_prompt", "")
    job_data = CURRENT_JOBS.get(job_id)
    if not job_data:
        return jsonify({"error": "No such job"}), 400

    images_folder = os.path.join(job_data["job_folder"], "images")
    os.makedirs(images_folder, exist_ok=True)

    job_data["prompts"][scene_index] = new_prompt
    image_path = generate_image_for_scene(
        client=client,
        story_text=job_data["full_text"],
        scene_text=new_prompt,
        index=scene_index,
        output_folder=images_folder,
        story_ingredients=job_data["story_ingredients"],
        image_prompt_style=job_data["image_prompt_style"],
        image_preprocessing_prompt=job_data["image_preprocessing_prompt"],
        text_model=job_data["text_model"],
        width=job_data["video_width"],
        height=job_data["video_height"],
        characters_prompt_style=job_data["characters_prompt_style"]
    )
    if not image_path:
        return jsonify({"error": "Failed to generate image"}), 500

    job_data["images"][scene_index] = image_path

    rel_path = image_path.split("app/static/")[-1]
    image_url = f"/static/{rel_path}"
    return jsonify({"image_url": image_url})

@main_bp.route("/create-video", methods=["POST"])
def create_video_endpoint():
    data = request.json
    job_id = data.get("job_id")
    job_data = CURRENT_JOBS.get(job_id)
    if not job_data:
        return jsonify({"error": "No such job"}), 400

    chunks = job_data["chunks"]
    audio_path = job_data["audio_path"]
    images_folder = os.path.join(job_data["job_folder"], "images")
    output_video_path = os.path.join(job_data["job_folder"], f"{job_id}.mp4")

    try:
        create_video_from_scenes(
            chunks,
            images_folder,
            audio_path,
            output_video_path,
            job_data["video_width"],
            job_data["video_height"]
        )
    except Exception as e:
        return jsonify({"error": f"Failed to create video: {str(e)}"}), 500

    job_data["video_path"] = output_video_path
    rel_path = output_video_path.split("app/static/")[-1]
    return jsonify({"video_url": f"/static/{rel_path}"})

@main_bp.route("/cancel-job", methods=["POST"])
def cancel_job():
    data = request.json
    job_id = data.get("job_id")
    if job_id in CURRENT_JOBS:
        del CURRENT_JOBS[job_id]
    return jsonify({"status": "cancelled"})
