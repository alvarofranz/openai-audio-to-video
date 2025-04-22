import os
from PIL import Image

def process_local_image(input_file_stream, output_path, target_width, target_height,
                        crop_x, crop_y, crop_w, crop_h,
                        displayed_w, displayed_h):
    """
    1) Load the uploaded file as a Pillow image (RGBA).
    2) The bounding box is in 'displayed' coordinates:
       displayed_w x displayed_h is how big the image was shown in the browser,
       so we must scale it to the original (native) image resolution.
    3) Crop at that bounding box.
    4) Resize the result to (target_width, target_height).
    5) Save as PNG.
    """
    pil_img = Image.open(input_file_stream).convert("RGBA")
    orig_w, orig_h = pil_img.size

    if displayed_w <= 0 or displayed_h <= 0:
        # fallback: no bounding box => entire image
        box = (0, 0, orig_w, orig_h)
    else:
        scale_x = orig_w / displayed_w
        scale_y = orig_h / displayed_h

        left = int(crop_x * scale_x)
        top = int(crop_y * scale_y)
        right = int((crop_x + crop_w) * scale_x)
        bottom = int((crop_y + crop_h) * scale_y)

        # clamp
        if left < 0: left = 0
        if top < 0: top = 0
        if right > orig_w: right = orig_w
        if bottom > orig_h: bottom = orig_h

        box = (left, top, right, bottom)

    cropped = pil_img.crop(box)
    final_img = cropped.resize((target_width, target_height), Image.LANCZOS)
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    final_img.save(output_path, format="PNG")
