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
    crossfade_dur=4.0,
    transition_displacement=0.0
):
    """
    Builds the final MP4 video from chunk data and images.

    1) Removes any gap between consecutive chunks by stretching
       the previous chunk's end to the next chunk's start (so there is no silence/black screen).
    2) Clamps or extends the last chunk to the audio's total duration.
    3) Builds an array of boundaries (start/end times for each chunk).
       The first boundary is 0, the last boundary is audio total_duration.
    4) Shifts every INTERNAL boundary by 'transition_displacement'.
    5) Creates each ImageClip with .with_duration(...), .with_start(...), .resized(...).
    6) Adds optional fade/crossfade transitions using fade_in, fade_out, crossfade_dur.
    7) Composites all clips to match the final audio duration.
    """

    # --- Log the transition displacement explicitly ---
    log(f"transition_displacement param: {transition_displacement:.2f}", "video_utils")

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

    # --- 1) Remove gaps by stretching chunks ---
    for i in range(len(chunks) - 1):
        curr_end = float(chunks[i]["end"])
        next_start = float(chunks[i+1]["start"])
        if next_start > curr_end:
            log(
                f"Removing gap: expanding chunk #{i} end from {curr_end:.2f}s to {next_start:.2f}s",
                "video_utils"
            )
            chunks[i]["end"] = next_start

    # --- 2) Clamp or extend the last chunk to match audio end ---
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

    if not chunks:
        log("No chunks to process. Exiting.", "video_utils")
        return

    # --- 3) Build boundaries array ---
    # boundaries[i] => start time of chunk i; boundaries[i+1] => end time of chunk i.
    # Force boundaries[0] = 0.0
    n = len(chunks)
    boundaries = [0.0] * (n + 1)

    boundaries[0] = 0.0
    for i in range(n):
        boundaries[i+1] = float(chunks[i]["end"])

    # Enforce boundaries[n] <= total_duration
    boundaries[n] = min(boundaries[n], total_duration)
    # Ensure ascending
    for i in range(1, n+1):
        if boundaries[i] < boundaries[i-1]:
            boundaries[i] = boundaries[i-1]

    # --- 4) Shift each INTERNAL boundary [1..n-1] by transition_displacement ---
    for i in range(1, n):
        old_b = boundaries[i]
        new_b = old_b + transition_displacement
        # clamp to [boundaries[i-1], boundaries[i+1]]
        # except for i==n which is forced to total_duration
        left_limit = boundaries[i-1]
        right_limit = boundaries[i+1]
        if new_b < left_limit:
            new_b = left_limit
        if new_b > right_limit:
            new_b = right_limit

        boundaries[i] = new_b
        log(f"Boundary {i} from {old_b:.2f} => {boundaries[i]:.2f} (shift={transition_displacement:.2f})",
            "video_utils")

    # final re-clamp ascending
    for i in range(1, n+1):
        if boundaries[i] < boundaries[i-1]:
            boundaries[i] = boundaries[i-1]

    # --- 5) Build scene clips using these boundaries ---
    scene_clips = []
    for i in range(n):
        start_t = boundaries[i]
        end_t = boundaries[i+1]
        base_duration = end_t - start_t
        if base_duration < 0.01:
            log(f"Skipping chunk #{i}, no valid duration after shift/clamp.", "video_utils")
            continue

        # If NOT the last chunk, add crossfade
        if i < (n - 1):
            final_duration = base_duration + crossfade_dur
        else:
            final_duration = base_duration

        # Path to scene image
        image_path = os.path.join(images_folder, f"scene_{i}.png")
        if not os.path.isfile(image_path):
            log(f"Warning: Missing image for chunk #{i} => {image_path}", "video_utils")
            continue

        orig_start = float(chunks[i]["start"])
        orig_end   = float(chunks[i]["end"])
        log(
            f"Chunk #{i}: original=({orig_start:.2f},{orig_end:.2f}), "
            f"boundaries=({start_t:.2f},{end_t:.2f}), base_dur={base_duration:.2f}, "
            f"final_dur={final_duration:.2f}",
            "video_utils"
        )

        effects_list = []
        # Resize
        effects_list.append(vfx.Resize((width, height)))
        # Fade in on first scene
        if i == 0 and fade_in > 0:
            effects_list.append(vfx.FadeIn(fade_in))
            log(f"Applying FadeIn({fade_in:.1f}) on scene #{i}", "video_utils")
        # CrossFadeIn if not first scene
        if i > 0 and crossfade_dur > 0:
            effects_list.append(vfx.CrossFadeIn(crossfade_dur))
            log(f"Applying CrossFadeIn({crossfade_dur:.1f}) on scene #{i}", "video_utils")
        # CrossFadeOut if not last scene
        if i < (n - 1) and crossfade_dur > 0:
            effects_list.append(vfx.CrossFadeOut(crossfade_dur))
            log(f"Applying CrossFadeOut({crossfade_dur:.1f}) on scene #{i}", "video_utils")
        # Fade out on last scene
        if i == (n - 1) and fade_out > 0:
            effects_list.append(vfx.FadeOut(fade_out))
            log(f"Applying FadeOut({fade_out:.1f}) on last scene", "video_utils")

        log(f"Effects on clip #{i}: {[e.__class__.__name__ for e in effects_list]}", "video_utils")

        try:
            clip = (
                ImageClip(image_path)
                .with_duration(final_duration)
                .with_effects(effects_list)
                .with_start(start_t)
            )
            scene_clips.append(clip)
        except Exception as e:
            log(f"Error creating image clip #{i}: {e}", "video_utils")
            raise

    if not scene_clips:
        log("No valid scene clips to build. Exiting.", "video_utils")
        return

    # --- 6) Composite & attach audio, final output ---
    try:
        log(f"Building CompositeVideoClip at {width}x{height}", "video_utils")
        final_clip = CompositeVideoClip(scene_clips, size=(width, height))
        # Force entire track to match total audio length
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
