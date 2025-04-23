import requests
from openai import OpenAI
from moviepy import *
from .global_utils import log, pretty_print_api_response
import json

def generate_title_and_description(client: OpenAI, full_text: str, text_model: str) -> dict:
    """
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
    Extract story ingredients from the text + incorporate characters_prompt_style.
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
                        "-Peter: <...>\n"
                        "[Scenarios]\n"
                        "-Forest: ...\n"
                        "[Items]\n"
                        "-Sword: ...\n\n"
                        "Here is the story that you need to extract information from, in the same language as the provided story. Return the response in that same language:\n\n"
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
                        f"[character_types] (important details, must not omit anything about them):\n{characters_prompt_style}\n\n"
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
    """
    Creates a final prompt for the scene, then calls DALL-E.
    """
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

def image_prompts_adjustment(
    client: OpenAI,
    full_story: str,
    story_ingredients: str,
    scene_chunks: list,
    existing_prompts: list,
    text_model: str
):
    """
    Unify prompts across scenes to ensure no contradictions, consistent characters, etc.
    Return JSON with "adjusted_scene_prompts".
    """
    from .global_utils import pretty_print_api_response, log

    scene_info = []
    for i, prompt in enumerate(existing_prompts):
        chunk_text = scene_chunks[i]["text"]
        scene_info.append(
            f"Scene {i}:\n- scene_words: {chunk_text}\n- old_prompt: {prompt}"
        )
    combined_scene_info = "\n\n".join(scene_info)

    system_message = (
        """You are an AI assistant whose only job is to harmonize a list of image-generation prompts so they form a clear, consistent visual story.
         INPUT
         [scenes]: an ordered array; each element has:
         – scene_words: a short text describing to what part in the original full story this current scene belongs to (the matching words in full story that correspond to the current scene)
         – old_prompt: the existing image prompt to be refined
         [story_ingredients]: the canonical reference for every character, location, prop, and style rule. Treat every detail in story_ingredients as fixed, untouchable and as must be included in each scene, as each prompt will generate an independent image and needs to contain all the details.
         TASK
         For every scene, rewrite old_prompt so it:
         - Depicts the current scene as vividly and specifically as possible.
         - Does not include anything in the prompt that may lead to dialogues or text generation, the final prompt must be visual.
         - Preserves every character, prop, and stylistic detail defined in story_ingredients without change.
         - Uses the same language the story is written in.
         - Advances the timeline, so that no two refined prompts may show the exact same instant.
         Is self-contained (no references to other scenes or to these instructions)."""
        "JSON OUTPUT\n\n"
        "{\n"
        '  "adjusted_scene_prompts": [\n'
        '    {"scene_index": 0, "prompt": "final refined prompt for this specific scene 0 - between 1800 and 2200 chars"},\n'
        '    {"scene_index": 1, "prompt": "final refined prompt for this specific scene 1 - between 1800 and 2200 chars"},\n'
        "    ...\n"
        "  ]\n"
        "}\n\n"
        "No extra text, just that JSON, properly escaping values so they don't break the JSON format."
    )

    user_message = (
        f"Full story, just for context, so you can make better decisions on how to refine each scene for the best visual representation, linking each scene to the current time in the story via the scene_words: {full_story}\n\n"
        f"[story_ingredients], the details provided here, especially for characters, needs to be respected 100%, this has already been processed and it must be respected, no room for creativity here: {story_ingredients}\n\n"
        "Here are the scenes that need to be visually refined for consistency and great representation for each current scene - [scenes]\n"
        f"{combined_scene_info}\n\n"
        "Now please unify them. Return only valid properly escaped JSON."
    )

    try:
        response = client.chat.completions.create(
            model=text_model,
            messages=[
                {"role": "system", "content": system_message},
                {"role": "user", "content": user_message},
            ],
        )
        raw_output = response.choices[0].message.content.strip()
        pretty_print_api_response(response)

        # Attempt to parse JSON
        try:
            return json.loads(raw_output)
        except json.JSONDecodeError as je:
            log(f"JSON parse error: {je}", "prompt_utils")
            return None
    except Exception as e:
        log(f"Error in image_prompts_adjustment: {e}", "prompt_utils")
        return None
