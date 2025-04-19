import os
from moviepy import *
from .global_utils import log

def create_video_from_scenes(chunks, images_folder: str, audio_path: str, output_path: str, width: int, height: int):
    log("Loading audio for final video...", "video_utils")
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
            log(f"Missing image for scene #{i}, skipping.", "video_utils")
            continue
        duration = scene_end - scene_start
        if duration < 0.1:
            duration = 0.1
        img_clip = (
            ImageClip(image_path)
            .with_duration(duration)
            .with_start(scene_start)
            .resized((width, height))
        )
        scene_clips.append(img_clip)
    if not scene_clips:
        log("No scene clips found. Cannot build video.", "video_utils")
        return
    log(f"Building CompositeVideoClip at {width}x{height}.", "video_utils")
    final_clip = CompositeVideoClip(scene_clips, size=(width, height)).with_duration(total_duration)
    final_clip = final_clip.with_audio(audio_clip)
    log(f"Writing final video: {output_path}", "video_utils")
    final_clip.write_videofile(
        filename=output_path,
        fps=24,
        codec="libx264",
        audio_codec="aac",
        threads=4
    )
