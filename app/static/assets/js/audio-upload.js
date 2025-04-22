// Focuses purely on uploading audio and setting up the initial job data
document.addEventListener('DOMContentLoaded', function() {
    // Upload button
    uploadBtn.addEventListener('click', handleAudioUpload);
    // Cancel button
    uploadCancelBtn.addEventListener('click', () => {
        userCanceledMidUpload = true;
        if (uploadAbortController) {
            uploadAbortController.abort();
        }
        resetUI();
    });
});

async function handleAudioUpload() {
    if (!audioFileInput.files.length) {
        alert("Please select an audio file first.");
        return;
    }
    const formData = new FormData();
    formData.append('audio', audioFileInput.files[0]);
    formData.append('words_per_scene', wordsPerSceneInput.value.trim());
    formData.append('text_model', textModelInput.value.trim());

    // Our two distinct sizes:
    formData.append('images_ai_requested_size', aiSizeSelect.value.trim());
    formData.append('video_size', videoSizeSelect.value.trim());

    formData.append('image_prompt_style', imagePromptStyleTextarea.value);
    formData.append('characters_prompt_style', charactersPromptStyleTextarea.value);
    formData.append('image_preprocessing_prompt', imagePreprocessingPromptTextarea.value);

    formData.append('fade_in', fadeInInput.value);
    formData.append('fade_out', fadeOutInput.value);
    formData.append('crossfade_dur', crossfadeInput.value);

    // Hide initial UI, show uploading
    initialUIContainer.style.display = 'none';
    uploadingSection.style.display = 'block';
    uploadingFeedback.textContent = "Uploading audio...";
    userCanceledMidUpload = false;
    uploadAbortController = new AbortController();
    let signal = uploadAbortController.signal;

    try {
        const resp = await fetch('/upload-audio', {
            method: 'POST',
            body: formData,
            signal: signal
        });
        if (userCanceledMidUpload) return;
        const data = await resp.json();
        if (data.error) {
            alert(data.error);
            resetUI();
            return;
        }
        uploadingSection.style.display = 'none';

        // Update header
        mainHeader.textContent = data.title;

        // Show the audio info
        audioProcessingSection.style.display = 'block';
        uploadedAudio.src = URL.createObjectURL(audioFileInput.files[0]);
        storyDescription.textContent = data.description;
        storyDescription.style.display = 'block';

        // Put story ingredients into a textarea (editable)
        storyIngredientsTextarea.value = data.story_ingredients;
        storyIngredientsContainer.style.display = 'block';

        chunksData = data.chunks;
        totalScenes = data.chunks.length;
        imagesGenerated = 0;
        sceneGenerated = new Array(totalScenes).fill(false);
        scenesContainer.innerHTML = '';

        // Create scene cards, but do NOT preprocess yet
        for (let i = 0; i < totalScenes; i++) {
            const { index } = data.chunks[i];
            const sceneCard = createSceneCard(index);
            scenesContainer.appendChild(sceneCard);
        }

        // Hide the "Generate Video" section until prompts are generated
        videoGenerationSection.style.display = 'none';

        currentJobId = data.job_id;

    } catch (err) {
        if (err.name === 'AbortError') {
            console.log("Fetch aborted by user.");
        } else {
            alert("Error uploading audio");
        }
        resetUI();
    }
}

// Create a scene card for a chunk
function createSceneCard(sceneIndex) {
    const sceneCard = document.createElement('div');
    sceneCard.className = 'scene-card';
    sceneCard.id = `scene-card-${sceneIndex}`;

    // Tabs
    const tabsContainer = document.createElement('div');
    tabsContainer.className = 'tabs-container';

    const tabBtnPrompt = document.createElement('div');
    tabBtnPrompt.className = 'tab-button active';
    tabBtnPrompt.textContent = 'Image Prompt';

    const tabBtnText = document.createElement('div');
    tabBtnText.className = 'tab-button';
    tabBtnText.textContent = 'Scene Text';

    tabsContainer.appendChild(tabBtnPrompt);
    tabsContainer.appendChild(tabBtnText);

    // Tab contents
    const tabPromptContent = document.createElement('div');
    tabPromptContent.className = 'tab-content tab-content-prompt active';
    const textArea = document.createElement('textarea');
    textArea.value = "No prompt yet.";
    textArea.disabled = true;

    textArea.addEventListener('focus', adjustTextareaHeight);
    textArea.addEventListener('input', adjustTextareaHeight);
    textArea.addEventListener('blur', resetTextareaHeight);
    tabPromptContent.appendChild(textArea);

    const tabSceneTextContent = document.createElement('div');
    tabSceneTextContent.className = 'tab-content tab-content-text';
    const sceneTextBlock = document.createElement('div');
    sceneTextBlock.className = 'scene-text-block';
    tabSceneTextContent.appendChild(sceneTextBlock);

    // Figure
    const figureEl = document.createElement('figure');
    const imgEl = document.createElement('img');
    imgEl.src = '/static/assets/img/placeholder.png';

    const figCaption = document.createElement('figcaption');

    const regenBtn = document.createElement('button');
    regenBtn.textContent = 'Generate';
    regenBtn.classList.add('regenerate-btn');
    regenBtn.disabled = true;  // Will enable after prompts are generated
    regenBtn.addEventListener('click', () =>
        handleGenerateImage(sceneIndex, textArea, imgEl, regenBtn)
    );

    const selectLocalBtn = document.createElement('button');
    selectLocalBtn.textContent = 'Select Image';
    selectLocalBtn.disabled = true; // Will enable after prompts are generated
    selectLocalBtn.addEventListener('click', () =>
        handleSelectLocalImage(sceneIndex)
    );

    figCaption.appendChild(regenBtn);
    figCaption.appendChild(selectLocalBtn);

    figureEl.appendChild(imgEl);
    figureEl.appendChild(figCaption);

    // Container
    const cardContent = document.createElement('div');
    cardContent.className = 'scene-card-content';
    const tabContentsContainer = document.createElement('div');
    tabContentsContainer.className = 'tab-contents-wrapper';

    tabContentsContainer.appendChild(tabsContainer);
    tabContentsContainer.appendChild(tabPromptContent);
    tabContentsContainer.appendChild(tabSceneTextContent);

    cardContent.appendChild(tabContentsContainer);
    cardContent.appendChild(figureEl);
    sceneCard.appendChild(cardContent);

    // Tab switching
    tabBtnPrompt.addEventListener('click', () => {
        tabBtnPrompt.classList.add('active');
        tabBtnText.classList.remove('active');
        tabPromptContent.classList.add('active');
        tabSceneTextContent.classList.remove('active');
    });
    tabBtnText.addEventListener('click', () => {
        tabBtnPrompt.classList.remove('active');
        tabBtnText.classList.add('active');
        tabPromptContent.classList.remove('active');
        tabSceneTextContent.classList.add('active');
    });

    // Fill the scene text
    fillSceneText(sceneIndex, sceneTextBlock);
    return sceneCard;
}

function fillSceneText(sceneIndex, sceneTextBlock) {
    const chunk = chunksData.find(c => c.index === sceneIndex);
    if (!chunk) return;
    const displayText = chunk.raw_text;
    const startSeconds = chunk.start;
    const endSeconds = chunk.end;
    const rangeStr = formatDuration(startSeconds, endSeconds);
    sceneTextBlock.textContent = `"${displayText}"\nDuration: ${rangeStr}`;
}

// Textarea auto-height
function adjustTextareaHeight(e) {
    const area = e.target;
    area.style.height = 'auto';
    area.style.height = area.scrollHeight + 'px';
}
function resetTextareaHeight(e) {
    e.target.style.height = '200px';
}
