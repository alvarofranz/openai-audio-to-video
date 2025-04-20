import requests
from openai import OpenAI
from moviepy import *
from .global_utils import log, pretty_print_api_response

def generate_title_and_description(client: OpenAI, full_text: str, text_model: str) -> dict:
    """
    Moved from routes.py:
    Generates a short title & description in the same language as the provided story text.
    """
    prompt_text = (
        "You are a helpful assistant. The user has provided the following story text, in an unknown language. "
        "We need you to generate a short 'title' and a short 'description' for this story, both in the same language as the provided story text. Importantly, the "
        "title and description must be in the SAME language as the original text. The output must clearly be "
        "in the format:\n\n"
        "title: <related-emoji> <captivating amazing creative title of around 10 words, no new lines> <another-related-emoji>\n"
        "description: <some description of around 100 words, no new lines>\n\n"
        f"Story text:\n{full_text}\n\n"
        "Now output only the two items with no newlines or extra commentary for each item, because it will be processed programmatically and needs to be just two lines, one for title:, and one for description:."
    )
    try:
        response = client.chat.completions.create(
            model=text_model,
            messages=[{"role": "user", "content": prompt_text}],
        )
        raw_output = response.choices[0].message.content.strip()
        title = ""
        description = ""
        for line in raw_output.split("\n"):
            line = line.strip()
            if line.lower().startswith("title:"):
                title = line.split(":", 1)[1].strip()
            elif line.lower().startswith("description:"):
                description = line.split(":", 1)[1].strip()
        return {"title": title, "description": description}
    except Exception:
        return {"title": "Untitled", "description": "No description available."}

def shorten_prompt_if_needed(prompt: str, max_bytes: int = 4000, encoding: str = "utf-8"):
    data = prompt.encode(encoding)
    if len(data) <= max_bytes:
        return prompt
    cut = data[: max_bytes - 10]
    # ensure we don't cut in the middle of a multi-byte char
    while cut and (cut[-1] & 0b11000000) == 0b10000000:
        cut = cut[:-1]
    shortened = cut.decode(encoding, errors="ignore").rstrip()
    return f"{shortened}..."

def preprocess_story_data(
    client: OpenAI,
    full_story: str,
    text_model: str,
    characters_prompt_style: str
) -> str:
    """
    Incorporates the characters_prompt_style as the 'character base descriptions' to ensure
    it's merged into the final story ingredients.
    """
    try:
        completion = client.chat.completions.create(
            model=text_model,
            messages=[
                {
                    "role": "developer",
                    "content": (
                        "You are a very visual story processor. You extract relevant visual details from a story and convert "
                        'them into a list of "ingredients" for a story: [Characters], [Scenarios], [Items] (translate each label to the target output language), '
                        "so they are well visually described in a consistent way, with no room for confusion or ambiguity at all if someone else had to paint them with your given details. If an item or scenario is not "
                        "described in detail, but they are relevant to the story, make the visual details up based "
                        "on the story context, leave no room for ambiguous choices by the final painter. When choosing between male and female, you must also make clear choices based on the context. The output must be clearly defined. Each item can only be defined once. You also need to blend the provided character base descriptions into the characters result. Detect the type of character from the provided list and blend the descriptions into the final list that you extract from the story. Note that the character base descriptions provided are more important than what you may interpret from the story, you cannot omit anything. Even if two characters belong to the same type, you need to repeat the base descriptions for each character. This is crucial, extremely important. The provided character base descriptions are:\n"
                        f"{characters_prompt_style}\n"
                        "The expected output should contain the final list of main scenarios, characters and items that are "
                        "most relevant to the story. Do not repeat items, if they appear more than once in the story, sum their information into one single instance. Example output:\n\n"
                        "[Characters]\n"
                        "-Peter: <all base descriptions provided for this detected character type without omitting anything like human, big heads, fancy clothes> <all story specific additional details that do not contradict any base description like male blue eyes, brown hair, middle age, wears a brown hat>\n"
                        "-Elvy: <all base descriptions provided for this detected character type without omitting anything like living porcelain elve, pointy ears, peach-beige porcelain skin> <all story specific additional details that do not contradict any base description like green eyes, blonde hair, young, wears a red dress>\n"
                        "[Scenarios]\n"
                        "-Forest: dark, dense, full of trees with autumn colors\n"
                        "-Lake: clear water, big, surrounded by trees\n"
                        "[Items]\n"
                        "-Sword: sharp, made of steel, engraved with shiny runes\n\n"
                        "Here is the story that you need to extract information from, in the same language as the provided story. Detect the language and return the response in the same language:\n\n"
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
    image_preprocessing_prompt: str,
    characters_prompt_style: str
) -> str:
    """
    Incorporates characters_prompt_style as [character_types].
    Does not alter any existing prompt wording, just adds new context.
    """
    try:
        completion = client.chat.completions.create(
            model=text_model,
            messages=[
                {
                    "role": "developer",
                    "content": (
                        image_preprocessing_prompt
                        + "\n"
                        f"[image_style] (important details):\n{style_prefix}\n\n"
                        f"[character_types] (important details, nothing can be omitted or reworded in the prompt under any circumstance for any character):\n{characters_prompt_style}\n\n"
                        f"[story] (just for context):\n{full_story}\n\n"
                        f"[story_items_style] (important details context):\n{story_ingredients}\n\n"
                        f"[current_sequence] (main focus for the final image, final prompt should be unique for current scene):\n{scene_text}"
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
    height: int,
    characters_prompt_style: str
):
    final_prompt = preprocess_image_prompt(
        client=client,
        full_story=story_text,
        story_ingredients=story_ingredients,
        style_prefix=image_prompt_style,
        scene_text=scene_text,
        text_model=text_model,
        image_preprocessing_prompt=image_preprocessing_prompt,
        characters_prompt_style=characters_prompt_style
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
