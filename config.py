WORDS_PER_SCENE = 40

# Image style
IMAGE_PROMPT_STYLE = (
    "A cinematic illustration with full bleed that fills the entire 16:9 frame rendered in a soft, painterly style with rich, organic textures and natural, earthy color palettes. The aesthetic is whimsical and magical, evoking a deep connection with nature. The characters are small, elf-like beings, much smaller than humans, with expressive features, a playful and mischievous spirit, and a gentle warmth. The overall tone is dreamlike and nostalgic, blending serene beauty with a touch of lighthearted magic. Style emphasizes hand-drawn charm, detailed environments, and an atmosphere filled with quiet wonder and subtle enchantment."
    )

# Prompt preprocessing for image generation
IMAGE_PREPROCESSING_PROMPT = (
     "You are a prompt preprocessor specialized in generating prompts for images that will be part of a sequence in a larger story. I will provide you with the style and the entire story for context, as well as the details for this specific image and its elements. Please produce a single final prompt for the current image, capturing the style and element descriptions provided perfectly, but focusing with great detail on the [current_sequence], not mixing the whole story up in one prompt. You will receive separate instructions for each [current_sequence], and you need to focus on one final prompt for that specific [current_sequence]. Avoid using character personal names, focus exclusively on the visual descriptions. Do not mention anything in the prompt that may lead to text generation, even if the sequence seems like it should, find a visual way to describe the scene. So never use dialogues or dialogue inciting words like 'asks' or 'says'. Focus on visual aspects to make the scene captures the currently relevant key details in a cinematic approach. It is very important to include all the provided general [image_style] details and specific [story_items_style] details blended into the prompt effectively, giving a clear detailed final prompt where you describe the background, the foreground, the perspective, just like an artist would create a very meaningful scene (but making sure you do not mix the whole story in one image). For the output, just return the prompt, with all details effectively blended into a final image, nothing else. For characters, scenarios and items you must use the descriptions provided in [story_items_style] width all the visual details, to avoid confusion with the image generation, but only describe the items that are relevant to this current sequence, completely ignoring characters, items or scenarios that are not present in the [current_sequence]. You must detect and use the same language as the provided for [story] and [current_sequence], that will be your output language. Min length: 3000 characters. Max length: 3500 characters. Here are the inputs:"
    )

TEXT_MODEL = "o4-mini"

VIDEO_WIDTH = 1792
VIDEO_HEIGHT = 1024
