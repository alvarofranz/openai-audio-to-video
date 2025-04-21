import os
from moviepy import *
from .global_utils import log

def create_video_from_scenes(
    chunks,
    images_folder: str,
    audio_path: str,
    output_path: str,
    width: int,
    height: int,
    fade_in=2.0,
    fade_out=2.0,
    crossfade_dur=4.0
):
    """
    Builds the final MP4 video from chunk data and images.

    1) Removes any gap between consecutive chunks by stretching
       the previous chunk's end to the next chunk's start (so there is no silence/black screen).
    2) Clamps or extends the last chunk to the audio's total duration.
    3) Creates each ImageClip with .with_duration(...), .with_start(...), and .resized(...).
    4) Adds optional fade/crossfade transitions using fade_in, fade_out, crossfade_dur.
    5) Includes detailed logging for easy troubleshooting.
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

    # --- Remove gaps by stretching chunks ---
    for i in range(len(chunks) - 1):
        curr_end = float(chunks[i]["end"])
        next_start = float(chunks[i+1]["start"])
        if next_start > curr_end:
            log(
                f"Removing gap: expanding chunk #{i} end from {curr_end:.2f}s to {next_start:.2f}s",
                "video_utils"
            )
            chunks[i]["end"] = next_start

    # --- Clamp/extend the last chunk to match audio end ---
    if chunks:
        last_idx = len(chunks) - 1
        last_end = float(chunks[last_idx]["end"])
        if abs(last_end - total_duration) > 0.01:
            if last_end < total_duration:
                log(
                    f"Extending last chunk from {last_end:.2f}s to {total_duration:.2f}s",
                    "video_utils"
                )
                chunks[last_idx]["end"] = total_duration
            else:
                log(
                    f"Clamping last chunk from {last_end:.2f}s down to {total_duration:.2f}s",
                    "video_utils"
                )
                chunks[last_idx]["end"] = total_duration

    # --- Build scene clips with transitions ---
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

        base_duration = scene_end - scene_start
        if base_duration < 0.1:
            base_duration = 0.1

        # Add crossfade overlap if not the last chunk
        if i < len(chunks) - 1:
            final_duration = base_duration + crossfade_dur
        else:
            final_duration = base_duration

        log(f"Chunk #{i} final duration (with overlap if not last) = {final_duration:.2f}", "video_utils")

        # Collect effects the same way as in your working code snippet
        effects_list = []

        # 1) Resize
        effects_list.append(vfx.Resize((width, height)))

        # 2) Fade in on the first scene
        if i == 0 and fade_in > 0:
            log(f"Applying FadeIn({fade_in:.1f}) on scene #{i}", "video_utils")
            effects_list.append(vfx.FadeIn(fade_in))

        # 3) Cross-fade in if not the first scene
        if i > 0 and crossfade_dur > 0:
            log(f"Applying CrossFadeIn({crossfade_dur:.1f}) on scene #{i}", "video_utils")
            effects_list.append(vfx.CrossFadeIn(crossfade_dur))

        # 4) Cross-fade out if not the last scene
        if i < len(chunks) - 1 and crossfade_dur > 0:
            log(f"Applying CrossFadeOut({crossfade_dur:.1f}) on scene #{i}", "video_utils")
            effects_list.append(vfx.CrossFadeOut(crossfade_dur))

        # 5) Fade out on last scene
        if i == len(chunks) - 1 and fade_out > 0:
            log(f"Applying FadeOut({fade_out:.1f}) on last scene", "video_utils")
            effects_list.append(vfx.FadeOut(fade_out))

        # For debugging, list out which effects we added:
        log(f"Effects on clip #{i}: {[e.__class__.__name__ for e in effects_list]}", "video_utils")

        try:
            # Now build the clip with all effects in one go
            img_clip = (
                ImageClip(image_path)
                .with_duration(final_duration)
                .with_effects(effects_list)
                .with_start(scene_start)
            )

            scene_clips.append(img_clip)
            log(
                f"Clip #{i} built => base_duration={base_duration:.2f}, final_duration={final_duration:.2f}",
                "video_utils"
            )
        except Exception as e:
            log(f"Error creating image clip #{i}: {e}", "video_utils")
            raise

    if not scene_clips:
        log("No scene clips found. Cannot build video.", "video_utils")
        return

    # --- Composite & attach audio ---
    try:
        log(f"Building CompositeVideoClip at {width}x{height}.", "video_utils")
        final_clip = CompositeVideoClip(scene_clips, size=(width, height))
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
