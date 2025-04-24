import os
import uuid
import base64

from flask import Blueprint, render_template, request, jsonify
from dotenv import load_dotenv
from openai import OpenAI

from app.utils.global_utils import log, pretty_print_api_response
from app.utils.audio_utils import transcribe_audio, chunk_transcript
from app.utils.video_utils import create_video_from_scenes
from app.utils.prompt_utils import (
    preprocess_image_prompt,
    preprocess_story_data,
    generate_title_and_description,
    image_prompts_adjustment,
    generate_or_edit_image
)
from app.utils.image_utils import process_local_image

from defaults import (
    WORDS_PER_SCENE,
    TEXT_MODEL,
    IMAGES_AI_REQUESTED_SIZE,
    VIDEO_SIZE,
    IMAGE_PROMPT_STYLE,
    CHARACTERS_PROMPT_STYLE,
    IMAGE_PREPROCESSING_PROMPT,
    FADE_IN,
    FADE_OUT,
    CROSSFADE_DUR,
    IMAGES_AI_QUALITY
)

main_bp = Blueprint("main", __name__)
CURRENT_JOBS = {}

@main_bp.route("/", methods=["GET"])
def index():
    return render_template(
        "index.html",
        default_words_per_scene=WORDS_PER_SCENE,
        default_text_model=TEXT_MODEL,
        default_video_size=VIDEO_SIZE,
        default_images_ai_requested_size=IMAGES_AI_REQUESTED_SIZE,
        default_image_prompt_style=IMAGE_PROMPT_STYLE,
        default_characters_prompt_style=CHARACTERS_PROMPT_STYLE,
        default_image_preprocessing_prompt=IMAGE_PREPROCESSING_PROMPT,
        default_fade_in=FADE_IN,
        default_fade_out=FADE_OUT,
        default_crossfade_dur=CROSSFADE_DUR,
        default_image_quality=IMAGES_AI_QUALITY,
    )

@main_bp.route("/upload-audio", methods=["POST"])
def upload_audio():
    """
    1) Saves the audio file.
    2) Transcribes using Whisper.
    3) Returns the job_id + raw transcription immediately
       so the UI can display audio + transcript right away.
    """
    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        return jsonify({"error": "OPENAI_API_KEY not set"}), 500

    client = OpenAI(api_key=api_key)
    file = request.files.get("audio")
    if not file:
        return jsonify({"error": "No file uploaded"}), 400

    words_per_scene_str = request.form.get("words_per_scene", f"{WORDS_PER_SCENE}").strip()
    text_model = request.form.get("text_model", TEXT_MODEL).strip()
    images_ai_size_str = request.form.get("images_ai_requested_size", IMAGES_AI_REQUESTED_SIZE).strip()
    video_size_str = request.form.get("video_size", VIDEO_SIZE).strip()
    image_prompt_style = request.form.get("image_prompt_style", "")
    characters_prompt_style = request.form.get("characters_prompt_style", "")
    image_preprocessing_prompt = request.form.get("image_preprocessing_prompt", "")
    fade_in_str = request.form.get("fade_in", f"{FADE_IN}").strip()
    fade_out_str = request.form.get("fade_out", f"{FADE_OUT}").strip()
    crossfade_str = request.form.get("crossfade_dur", f"{CROSSFADE_DUR}").strip()
    images_ai_quality = request.form.get("images_ai_quality", IMAGES_AI_QUALITY).strip()

    try:
        wps = int(words_per_scene_str)
    except:
        wps = WORDS_PER_SCENE

    try:
        iwidth_str, iheight_str = images_ai_size_str.lower().split("x")
        images_ai_w = int(iwidth_str)
        images_ai_h = int(iheight_str)
    except:
        images_ai_w = 1792
        images_ai_h = 1024

    try:
        vwidth_str, vheight_str = video_size_str.lower().split("x")
        video_width = int(vwidth_str)
        video_height = int(vheight_str)
    except:
        video_width = 1920
        video_height = 1080

    try:
        fade_in_val = float(fade_in_str)
    except:
        fade_in_val = FADE_IN
    try:
        fade_out_val = float(fade_out_str)
    except:
        fade_out_val = FADE_OUT
    try:
        crossfade_val = float(crossfade_str)
    except:
        crossfade_val = CROSSFADE_DUR

    audio_basename = os.path.splitext(os.path.basename(file.filename))[0]
    short_uniq = str(uuid.uuid4())[:6]
    job_id = f"{audio_basename}-{short_uniq}"

    job_folder = os.path.join("app", "static", "projects", job_id)
    os.makedirs(job_folder, exist_ok=True)

    audio_path = os.path.join(job_folder, file.filename)
    file.save(audio_path)

    # Transcribe with Whisper (store segments in "whisper_data")
    try:
        # This returns a 'TranscriptionVerbose' with .text and .segments
        whisper_data = transcribe_audio(client, audio_path)
    except Exception as e:
        return jsonify({"error": f"Failed to transcribe audio: {str(e)}"}), 500

    full_text = whisper_data.text.strip()
    log(f"Full Text for {job_id}: {full_text}", "routes")

    # Store partial job data
    CURRENT_JOBS[job_id] = {
        "audio_path": audio_path,
        "whisper_data": whisper_data,
        "full_text": full_text,
        "words_per_scene": wps,
        "text_model": text_model,
        "images_ai_width": images_ai_w,
        "images_ai_height": images_ai_h,
        "images_ai_quality": images_ai_quality,
        "video_width": video_width,
        "video_height": video_height,
        "image_prompt_style": image_prompt_style,
        "characters_prompt_style": characters_prompt_style,
        "image_preprocessing_prompt": image_preprocessing_prompt,
        "fade_in": fade_in_val,
        "fade_out": fade_out_val,
        "crossfade_dur": crossfade_val,
        "title": None,
        "description": None,
        "story_ingredients": None,
        "chunks": None,
        "images": None,
        "prompts": None,
        "job_folder": job_folder,
        "reference_images": []
    }

    return jsonify({
        "job_id": job_id,
        "full_text": full_text
    })

@main_bp.route("/extract-details", methods=["POST"])
def extract_details():
    """
    1) Takes job_id, loads the stored whisper_data,
    2) Generates title, description, story ingredients,
    3) Chunks the transcript,
    4) Allocates images/prompts arrays,
    5) Returns them.
    """
    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        return jsonify({"error": "OPENAI_API_KEY not set"}), 500
    client = OpenAI(api_key=api_key)

    data = request.json
    job_id = data.get("job_id")
    job_data = CURRENT_JOBS.get(job_id)
    if not job_data:
        return jsonify({"error": "No such job"}), 400

    full_text = job_data.get("full_text", "")
    if not full_text:
        return jsonify({"error": "No transcription found"}), 400

    text_model = job_data["text_model"]
    characters_prompt_style = job_data["characters_prompt_style"]
    wps = job_data["words_per_scene"]

    # 1) Title & desc
    try:
        td = generate_title_and_description(client, full_text, text_model)
    except Exception as e:
        return jsonify({"error": f"Failed to get title/description: {str(e)}"}), 500

    # 2) story_ingredients
    try:
        si = preprocess_story_data(client, full_text, text_model, characters_prompt_style)
    except Exception as e:
        return jsonify({"error": f"Failed to get story ingredients: {str(e)}"}), 500

    # 3) chunk
    try:
        chunks = chunk_transcript(job_data["whisper_data"], wps)
    except Exception as e:
        return jsonify({"error": f"Failed to chunk transcript: {str(e)}"}), 500

    if not chunks:
        return jsonify({"error": "No chunks created."}), 500

    job_data["title"] = td["title"]
    job_data["description"] = td["description"]
    job_data["story_ingredients"] = si
    job_data["chunks"] = chunks
    job_data["images"] = [None]*len(chunks)
    job_data["prompts"] = [None]*len(chunks)

    return jsonify({
        "title": td["title"],
        "description": td["description"],
        "story_ingredients": si,
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
    new_story_ingredients = data.get("story_ingredients", None)

    job_data = CURRENT_JOBS.get(job_id)
    if not job_data:
        return jsonify({"error": "No such job"}), 400

    if new_story_ingredients is not None:
        job_data["story_ingredients"] = new_story_ingredients

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
    """
    This route can handle:
      - normal generation (no references),
      - generation with references,
      - editing a single existing scene image,
      all in one place.
    """
    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        return jsonify({"error": "OPENAI_API_KEY not set"}), 500

    client = OpenAI(api_key=api_key)
    data = request.json
    job_id = data.get("job_id")
    scene_index = data.get("scene_index")
    new_prompt = data.get("new_prompt", "")
    mode = data.get("mode", "normal")  # "normal", "edit_single"
    reference_list = data.get("references", [])  # array of reference filenames

    job_data = CURRENT_JOBS.get(job_id)
    if not job_data:
        return jsonify({"error": "No such job"}), 400

    images_folder = os.path.join(job_data["job_folder"], "images")
    os.makedirs(images_folder, exist_ok=True)

    # rename old scene image if it exists
    existing_image_path = os.path.join(images_folder, f"scene_{scene_index}.png")
    if os.path.isfile(existing_image_path):
        renamed_path = os.path.join(
            images_folder,
            f"scene_{scene_index}_unused-{uuid.uuid4().hex[:6]}.png"
        )
        os.rename(existing_image_path, renamed_path)

    # references logic
    # if mode=="edit_single", references = [the old scene image as single reference]
    #   but we already renamed the old scene, so we must read that path from the renamed?
    #   Actually we do that before rename, or do a separate var. We'll do a simpler approach:
    #   We'll do the rename AFTER we capture its path.
    references_paths = []
    if mode == "edit_single":
        # The "old" image was already renamed, so the old path is renamed_path
        references_paths = [renamed_path] if os.path.isfile(renamed_path) else []
    else:
        # normal: references come from job_data["reference_images"] or the list provided
        # The request sends an array of reference filenames. We'll open them from job_folder
        for ref_filename in reference_list:
            full_ref_path = os.path.join(job_data["job_folder"], ref_filename)
            if os.path.isfile(full_ref_path):
                references_paths.append(full_ref_path)

    # Now do the actual image generation/edit
    out_path = os.path.join(images_folder, f"scene_{scene_index}.png")

    new_image_path = generate_or_edit_image(
        client=client,
        final_prompt=new_prompt,
        reference_paths=references_paths,
        width=job_data["images_ai_width"],
        height=job_data["images_ai_height"],
        quality=job_data["images_ai_quality"],
        output_path=out_path
    )
    if not new_image_path:
        return jsonify({"error": "Failed to generate image"}), 500

    job_data["images"][scene_index] = new_image_path
    rel_path = new_image_path.split("app/static/")[-1]
    return jsonify({"image_url": f"/static/{rel_path}"})

@main_bp.route("/upload-local-image", methods=["POST"])
def upload_local_image():
    job_id = request.form.get("job_id")
    scene_index = request.form.get("scene_index")
    if not job_id or scene_index is None:
        return jsonify({"error": "Missing job_id or scene_index"}), 400

    job_data = CURRENT_JOBS.get(job_id)
    if not job_data:
        return jsonify({"error": "No such job"}), 400

    image_file = request.files.get("image_file")
    if not image_file:
        return jsonify({"error": "No image file provided"}), 400

    box_x_str = request.form.get("box_x", "0")
    box_y_str = request.form.get("box_y", "0")
    box_w_str = request.form.get("box_w", "0")
    box_h_str = request.form.get("box_h", "0")
    disp_w_str = request.form.get("displayed_w", "0")
    disp_h_str = request.form.get("displayed_h", "0")

    try:
        box_x = float(box_x_str)
        box_y = float(box_y_str)
        box_w = float(box_w_str)
        box_h = float(box_h_str)
        disp_w = float(disp_w_str)
        disp_h = float(disp_h_str)
    except:
        return jsonify({"error": "Invalid bounding box data"}), 400

    images_folder = os.path.join(job_data["job_folder"], "images")
    os.makedirs(images_folder, exist_ok=True)

    existing_path = os.path.join(images_folder, f"scene_{scene_index}.png")
    if os.path.isfile(existing_path):
        renamed_path = os.path.join(
            images_folder,
            f"scene_{scene_index}_unused-{uuid.uuid4().hex[:6]}.png"
        )
        os.rename(existing_path, renamed_path)

    output_path = os.path.join(images_folder, f"scene_{scene_index}.png")
    try:
        process_local_image(
            image_file.stream,
            output_path,
            job_data["video_width"],
            job_data["video_height"],
            crop_x=box_x,
            crop_y=box_y,
            crop_w=box_w,
            crop_h=box_h,
            displayed_w=disp_w,
            displayed_h=disp_h
        )
    except Exception as e:
        return jsonify({"error": f"Could not process/crop image: {str(e)}"}), 500

    job_data["images"][int(scene_index)] = output_path
    rel_path = output_path.split("app/static/")[-1]
    return jsonify({"image_url": f"/static/{rel_path}"})

@main_bp.route("/upload-reference-image", methods=["POST"])
def upload_reference_image():
    """
    Allows uploading reference images (files) for the job.
    We store them as reference-<uuid>.png, add to job_data["reference_images"].
    Returns the relative path.
    """
    job_id = request.form.get("job_id", "")
    if not job_id:
        return jsonify({"error": "No job_id provided"}), 400

    job_data = CURRENT_JOBS.get(job_id)
    if not job_data:
        return jsonify({"error": "No such job"}), 400

    ref_file = request.files.get("reference_file")
    if not ref_file:
        return jsonify({"error": "No reference file"}), 400

    short_uniq = str(uuid.uuid4())[:6]
    ref_filename = f"reference-{short_uniq}.png"
    job_folder = job_data["job_folder"]
    ref_path = os.path.join(job_folder, ref_filename)

    ref_file.save(ref_path)
    job_data["reference_images"].append(ref_filename)

    return jsonify({"reference_path": ref_filename})

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
            job_data["video_height"],
            fade_in=job_data["fade_in"],
            fade_out=job_data["fade_out"],
            crossfade_dur=job_data["crossfade_dur"]
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

@main_bp.route("/adjust-prompts", methods=["POST"])
def adjust_prompts():
    load_dotenv()
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        return jsonify({"error": "OPENAI_API_KEY not set"}), 500
    client = OpenAI(api_key=api_key)

    data = request.json
    job_id = data.get("job_id")
    job_data = CURRENT_JOBS.get(job_id)
    if not job_data:
        return jsonify({"error": "No such job"}), 400

    full_text = job_data["full_text"]
    story_ingredients = job_data["story_ingredients"]
    text_model = job_data["text_model"]
    scene_chunks = job_data["chunks"]
    existing_prompts = job_data["prompts"]

    try:
        result = image_prompts_adjustment(
            client=client,
            full_story=full_text,
            story_ingredients=story_ingredients,
            scene_chunks=scene_chunks,
            existing_prompts=existing_prompts,
            text_model=text_model
        )
        if not result or "adjusted_scene_prompts" not in result:
            # Just keep existing prompts
            adjusted_prompts = []
            for i, existing_prompt in enumerate(existing_prompts):
                adjusted_prompts.append({
                    "scene_index": i,
                    "prompt": existing_prompt
                })
            return jsonify({"adjusted_prompts": adjusted_prompts})

        adjusted_prompts = result["adjusted_scene_prompts"]
        if len(adjusted_prompts) != len(existing_prompts):
            # Mismatch => also just keep existing prompts
            adjusted_prompts = []
            for i, existing_prompt in enumerate(existing_prompts):
                adjusted_prompts.append({
                    "scene_index": i,
                    "prompt": existing_prompt
                })
            return jsonify({"adjusted_prompts": adjusted_prompts})

        # Otherwise, success. Overwrite the job_data prompts
        for item in adjusted_prompts:
            i = item["scene_index"]
            job_data["prompts"][i] = item["prompt"]

        return jsonify({"adjusted_prompts": adjusted_prompts})

    except Exception as e:
        log(f"Error adjusting prompts: {e}", "routes")
        # On any exception => keep existing prompts
        adjusted_prompts = []
        for i, existing_prompt in enumerate(existing_prompts):
            adjusted_prompts.append({
                "scene_index": i,
                "prompt": existing_prompt
            })
        return jsonify({"adjusted_prompts": adjusted_prompts})
