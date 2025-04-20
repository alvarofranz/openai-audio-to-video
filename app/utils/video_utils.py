import os
from moviepy import *
from .global_utils import log

def create_video_from_scenes(chunks, images_folder: str, audio_path: str, output_path: str, width: int, height: int):
    log("Loading audio for final video...", "video_utils")
    audio_clip = AudioFileClip(audio_path)
    total_duration = audio_clip.duration

    scene_clips = []

    for i, chunk in enumerate(chunks):
        scene_start = float(chunk["start"])
        scene_end = float(chunk["end"])
        if scene_end <= scene_start:
            continue

        image_path = os.path.join(images_folder, f"scene_{i}.png")
        if not os.path.isfile(image_path):
            log(f"Missing image for scene #{i}, skipping.", "video_utils")
            continue

        duration = scene_end - scene_start
        if duration < 0.1:
            duration = 0.1

        img_clip = (
            ImageClip(image_path)
            .set_duration(duration)
            .set_start(scene_start)
            .resize((width, height))
        )
        scene_clips.append(img_clip)

    if not scene_clips:
        log("No scene clips found. Cannot build video.", "video_utils")
        return

    # Clamp the last clip to end exactly when the audio ends,
    # or extend it if the chunks finish earlier.
    last_clip = scene_clips[-1]
    last_clip_start = last_clip.start
    last_clip_duration = last_clip.duration
    last_clip_end = last_clip_start + last_clip_duration

    if last_clip_end != total_duration:
        # Adjust the last clip duration so it ends exactly at total_duration
        new_duration = total_duration - last_clip_start
        if new_duration < 0.1:
            # If for some reason it becomes negative or extremely short, clamp it.
            new_duration = 0.1

        scene_clips[-1] = last_clip.set_duration(new_duration)

    log(f"Building CompositeVideoClip at {width}x{height}.", "video_utils")
    final_clip = CompositeVideoClip(scene_clips, size=(width, height)).set_duration(total_duration)
    final_clip = final_clip.set_audio(audio_clip)

    log(f"Writing final video: {output_path}", "video_utils")
    final_clip.write_videofile(
        filename=output_path,
        fps=24,
        codec="libx264",
        audio_codec="aac",
        threads=4
    )