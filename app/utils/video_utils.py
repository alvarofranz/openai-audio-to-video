import os
from moviepy import *
from .global_utils import log

def create_video_from_scenes(chunks, images_folder: str, audio_path: str, output_path: str, width: int, height: int):
    """
    Builds the final MP4 video from chunk data and images.

    1) Removes any gap between consecutive chunks by stretching
       the previous chunk's end to the next chunk's start (so there is no silence/black screen).
    2) Clamps or extends the last chunk to the audio's total duration.
    3) Creates each ImageClip with .with_duration(...), .with_start(...), and .resized(...).
    4) Includes detailed logging for easy troubleshooting.
    """

    # --- Load the audio ---
    log(f"Loading audio for final video... (audio_path={audio_path})", "video_utils")
    try:
        audio_clip = AudioFileClip(audio_path)
    except Exception as e:
        log(f"Error creating AudioFileClip: {e}", "video_utils")
        raise

    try:
        total_duration = audio_clip.duration
        log(f"Audio total duration: {total_duration:.2f}s", "video_utils")
    except Exception as e:
        log(f"Error retrieving audio duration: {e}", "video_utils")
        raise

    # --- Remove gaps between chunks by stretching the previous chunk ---
    for i in range(len(chunks) - 1):
        curr_end = float(chunks[i]["end"])
        next_start = float(chunks[i+1]["start"])
        if next_start > curr_end:
            log(
                f"Removing gap: expanding chunk #{i} end from {curr_end:.2f}s to {next_start:.2f}s",
                "video_utils"
            )
            # Stretch chunk[i] so it ends exactly where chunk[i+1] starts
            chunks[i]["end"] = next_start

    # --- Clamp/extend the last chunk to match audio end ---
    if chunks:
        last_idx = len(chunks) - 1
        last_end = float(chunks[last_idx]["end"])
        if abs(last_end - total_duration) > 0.01:  # if there's a noticeable mismatch
            if last_end < total_duration:
                # Extend the last chunk
                log(
                    f"Extending last chunk from {last_end:.2f}s to {total_duration:.2f}s "
                    f"so it ends exactly with audio",
                    "video_utils"
                )
                chunks[last_idx]["end"] = total_duration
            else:
                # Clamp the last chunk
                log(
                    f"Clamping last chunk from {last_end:.2f}s down to {total_duration:.2f}s "
                    f"to match audio",
                    "video_utils"
                )
                chunks[last_idx]["end"] = total_duration

    # --- Build the final scene clips ---
    scene_clips = []
    for i, chunk in enumerate(chunks):
        scene_start = float(chunk["start"])
        scene_end = float(chunk["end"])

        log(f"Chunk #{i}: start={scene_start:.2f}, end={scene_end:.2f}", "video_utils")

        if scene_end <= scene_start:
            log(f"Skipping invalid chunk #{i} (start >= end).", "video_utils")
            continue

        image_path = os.path.join(images_folder, f"scene_{i}.png")
        if not os.path.isfile(image_path):
            log(f"Warning: Missing image for chunk #{i} => {image_path}", "video_utils")
            continue

        duration = scene_end - scene_start
        if duration < 0.1:
            duration = 0.1
        log(f"Chunk #{i} final duration={duration:.2f}", "video_utils")

        try:
            img_clip = (
                ImageClip(image_path)
                .with_duration(duration)
                .with_start(scene_start)
                .resized((width, height))
            )
            log(
                f"Clip #{i} built => start={scene_start:.2f}s, duration={duration:.2f}s",
                "video_utils"
            )
            scene_clips.append(img_clip)
        except Exception as e:
            log(f"Error creating image clip #{i}: {e}", "video_utils")
            raise

    if not scene_clips:
        log("No scene clips found. Cannot build video.", "video_utils")
        return

    # --- Build CompositeVideoClip & attach audio ---
    try:
        log(f"Building CompositeVideoClip timeline at {width}x{height}.", "video_utils")
        final_clip = CompositeVideoClip(scene_clips, size=(width, height))
        # By default, CompositeVideoClip will end at the max end time of all clips,
        # but let's also clamp it to total_duration if needed
        final_clip = final_clip.with_duration(total_duration).with_audio(audio_clip)

        log(f"Writing final video to: {output_path}", "video_utils")
        final_clip.write_videofile(
            filename=output_path,
            fps=24,
            codec="libx264",
            audio_codec="aac",
            threads=4
        )
    except Exception as e:
        log(f"Error during final video composition/writing: {e}", "video_utils")
        raise
