WORDS_PER_SCENE = 75
TEXT_MODEL       = "o4-mini"
IMAGES_AI_REQUESTED_SIZE = "1536x1024"
VIDEO_SIZE       = "1920x1080"
CROSSFADE_DUR    = 4.0
FADE_IN          = 1.5
FADE_OUT         = 2.0
IMAGES_AI_QUALITY = "high"

IMAGE_PROMPT_STYLE = (
"""A cinematic illustration with full bleed that fills the entire 16:9 frame rendered in vivid beautiful scene, where the aesthetic is whimsical and magical, evoking a deep connection with nature and the overall tone is dreamlike and nostalgic, blending serene beauty with a touch of lighthearted magic. The style emphasizes detailed environments and elements, and an atmosphere filled with quiet wonder and subtle enchantment."""
)

CHARACTERS_PROMPT_STYLE = (
"""Hay dos tipos principales de personajes en las historias y debes identificarlos correctamente según el contexto.
Pueden ser "humanos" o pueden ser "magikitos: duende de porcelana viviente, con orejas puntiagudas élficas y piel de porcelana de color melocotón claro, orejas puntiagudas, diseño encantador" que visten ropas imperfectas hechas con retazos de tela vieja. Para este tipo de personajes, es muy importante que incluyas esas palabras clave: "duende de porcelana viviente, con orejas puntiagudas élficas y piel de porcelana de color melocotón claro, orejas puntiagudas, diseño encantador" sin omitir nada ni simplificar el lenguaje. Extremadamente importante incluirlo todo para este tipo de personaje "duende de porcelana viviente, con orejas puntiagudas élficas y piel de porcelana de color melocotón claro, orejas puntiagudas, diseño encantador". Cuando sea un humano, debes dejar claro que es un humano, simple. Los dos tipos de personajes son claramente diferenciables.
Cualquier otra criatura que no sea un humano o "duende de porcelana viviente, con orejas puntiagudas élficas y piel de porcelana de color melocotón claro, orejas puntiagudas, diseño encantador" se diferenciará claramente; pueden ser aves, ranas, insectos... para estos utiliza la descripción que prefieras, siempre presentando criaturas mágicas agradables, amables y acogedoras."""
)

IMAGE_PREPROCESSING_PROMPT = (
"""You are a prompt preprocessor specialized in generating prompts for images that will be part of a sequence in a larger story. I will provide you with the style and the entire story for context, as well as the details for this specific image and its elements.

Please produce a single final prompt for the current image, capturing the style and element descriptions provided perfectly, but focusing with great detail on the [current_sequence], not mixing the whole story up in one prompt.

You will receive separate instructions for each [current_sequence], and you need to focus on one final prompt for that specific [current_sequence], making sure you do not talk about the whole story in one image. The story is just provided for context.

It is also very important to include all the provided general [image_style] details and specific [story_items_style] details blended into the prompt effectively, giving a clear detailed final prompt where you describe the background, the foreground, the perspective, just like an artist would create a very meaningful scene (but making sure you do not mix the whole story in one image).

Avoid using character personal names at all costs, since it is completely forbidden to use character personal names for the images prompt, focus EXCLUSIVELY on the VISUAL DESCRIPTIONS provided in [story_items_style].

Do not mention anything in the prompt that may lead to text generation on the image, even if the sequence seems like it should, find a visual way to describe the scene. So never use dialogues or dialogue inciting words. Focus on visual aspects to make the scene captures the currently relevant key details in a cinematic approach.

For characters, scenarios and items you MUST use THE FULL descriptions provided in [story_items_style] width all the visual details provided (especially for characters, it is crucial that you use the exact same words, without changing them or simplifying them or rewording them, to avoid confusion with the image generation), and of course only describe the items that are relevant to this current sequence, completely ignoring characters, items or scenarios that are not present in the [current_sequence].

The most important thing is to not mix up everything in one image, give a static result with all the relevant details for the [current_sequence], so it represents the [current_sequence] perfectly repeating the provided descriptions for elements, scenarios and very importantly, characters.

You must also detect and use the same language as the provided for [story] and [current_sequence], that will be your output language. Min length: 1200 characters. Max length: 1700 characters."""
)
