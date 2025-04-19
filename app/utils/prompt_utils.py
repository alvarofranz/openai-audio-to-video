import requests
from moviepy import *
from openai import OpenAI
from .global_utils import log, pretty_print_api_response

def shorten_prompt_if_needed(prompt: str, max_bytes: int = 4000, encoding: str = "utf-8"):
    data = prompt.encode(encoding)
    if len(data) <= max_bytes:
        return prompt
    cut = data[: max_bytes - 10]
    while cut and (cut[-1] & 0b11000000) == 0b10000000:
        cut = cut[:-1]
    shortened = cut.decode(encoding, errors="ignore").rstrip()
    return f"{shortened}..."

def preprocess_story_data(client: OpenAI, full_story: str, text_model: str) -> str:
    try:
        completion = client.chat.completions.create(
            model=text_model,
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
                {"role": "user", "content": "Generate the story context now."},
            ],
            reasoning_effort="high",
        )
        pretty_print_api_response(completion.choices[0])
        return completion.choices[0].message.content.strip()
    except Exception as e:
        log(f"Error calling story data preprocessor: {e}", "prompt_utils")
        return ""

def preprocess_image_prompt(
    client: OpenAI,
    full_story: str,
    story_ingredients: str,
    style_prefix: str,
    scene_text: str,
    text_model: str,
    image_preprocessing_prompt: str
) -> str:
    try:
        completion = client.chat.completions.create(
            model=text_model,
            messages=[
                {
                    "role": "developer",
                    "content": (
                        image_preprocessing_prompt
                        + "\n"
                        f"image_style (important details):\n{style_prefix}\n\n"
                        f"story (context):\n{full_story}\n\n"
                        f"story_items_style (important details context):\n{story_ingredients}\n\n"
                        f"current_sequence (main focus for the final image, should be unique for current scene):\n{scene_text}"
                    ),
                },
                {"role": "user", "content": "Generate the final image prompt now."},
            ],
            reasoning_effort="high",
        )
        pretty_print_api_response(completion.choices[0])
        refined_prompt = completion.choices[0].message.content.strip()
        refined_prompt = shorten_prompt_if_needed(refined_prompt)
        return refined_prompt
    except Exception as e:
        log(f"Error calling GPT for prompt preprocessing: {e}", "prompt_utils")
        fallback = f"{style_prefix} {scene_text}"
        return shorten_prompt_if_needed(fallback)

def generate_image_for_scene(
    client: OpenAI,
    story_text: str,
    scene_text: str,
    index: int,
    output_folder: str,
    story_ingredients: str,
    image_prompt_style: str,
    image_preprocessing_prompt: str,
    text_model: str,
    width: int,
    height: int
):
    final_prompt = preprocess_image_prompt(
        client=client,
        full_story=story_text,
        story_ingredients=story_ingredients,
        style_prefix=image_prompt_style,
        scene_text=scene_text,
        text_model=text_model,
        image_preprocessing_prompt=image_preprocessing_prompt
    )
    log(f"Generating image for scene #{index}:\n---\n{final_prompt}\n---", "prompt_utils")
    try:
        response = client.images.generate(
            model="dall-e-3",
            prompt=shorten_prompt_if_needed(final_prompt, 4000),
            n=1,
            quality="hd",
            size=f"{width}x{height}"
        )
        pretty_print_api_response(response)
        image_url = response.data[0].url
        img_data = requests.get(image_url).content
        image_path = f"{output_folder}/scene_{index}.png"
        with open(image_path, "wb") as file:
            file.write(img_data)
        return image_path
    except Exception as e:
        log(f"Error generating image for scene #{index}: {e}", "prompt_utils")
        return None
