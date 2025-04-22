document.addEventListener('DOMContentLoaded', function() {

    // ====== DOM references ======
    const initialUIContainer = document.getElementById('initial-ui-container');
    const audioFileInput = document.getElementById('audio-file-input');
    const uploadBtn = document.getElementById('upload-btn');

    const uploadingSection = document.getElementById('uploading-section');
    const uploadCancelBtn = document.getElementById('upload-cancel-btn');
    const uploadingFeedback = document.getElementById('uploading-feedback');

    const audioProcessingSection = document.getElementById('audio-processing-section');
    const whisperLoading = document.getElementById('whisper-loading');
    const uploadedAudio = document.getElementById('uploaded-audio');
    const storyDescription = document.getElementById('story-description');
    const storyIngredientsParagraph = document.getElementById('story-ingredients');

    const chunkProcessingStatus = document.getElementById('chunk-processing-status');
    const scenesContainer = document.getElementById('scenes-container');

    const videoGenerationSection = document.getElementById('video-generation-section');
    const generateVideoBtn = document.getElementById('generate-video-btn');
    const videoProgress = document.getElementById('video-progress');

    const finalVideoSection = document.getElementById('final-video-section');
    const finalVideoSource = document.getElementById('final-video-source');
    const finalVideo = document.getElementById('final-video');
    const finalVideoPathEl = document.getElementById('final-video-path');

    const mainHeader = document.querySelector('header h1');

    // Form fields
    const wordsPerSceneInput = document.getElementById('words-per-scene');
    const textModelInput = document.getElementById('text-model');
    const sizeSelect = document.getElementById('size-select');
    const imagePromptStyleTextarea = document.getElementById('image-prompt-style');
    const charactersPromptStyleTextarea = document.getElementById('characters-prompt-style');
    const imagePreprocessingPromptTextarea = document.getElementById('image-preprocessing-prompt');

    // Crop overlay references
    const localImageCropModal = document.getElementById('local-image-crop-modal');
    const localImagePreview = document.getElementById('local-image-preview');
    const cropRect = document.getElementById('crop-rect');
    const cropCancelBtn = document.getElementById('crop-cancel');
    const cropConfirmBtn = document.getElementById('crop-confirm');

    // State for local image cropping
    let originalFile = null;    // The raw File object user selected
    let localImageSceneIndex = null;
    let displayedImgWidth = 0;   // actual rendered width in px
    let displayedImgHeight = 0;  // actual rendered height in px

    // The crop rectangle position & size (in displayed-image coords)
    let rectX = 0;
    let rectY = 0;
    let rectW = 100;
    let rectH = 100;

    let dragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    // ====== Other global states ======
    let currentJobId = null;
    let totalScenes = 0;
    let imagesGenerated = 0;
    let isGeneratingImage = false;
    let userCanceledMidUpload = false;
    let sceneGenerated = [];
    let uploadAbortController = null;
    let chunksData = [];

    // ====== Fade utilities ======
    function fadeOut(element, duration = 500) {
        let start = null;
        function animate(timestamp) {
            if (!start) start = timestamp;
            const progress = timestamp - start;
            let opacity = 1 - Math.min(progress / duration, 1);
            element.style.opacity = opacity;
            if (progress >= duration) {
                element.style.display = 'none';
            } else {
                requestAnimationFrame(animate);
            }
        }
        requestAnimationFrame(animate);
    }
    function fadeIn(element, duration = 500) {
        element.style.opacity = 0;
        element.style.display = 'block';
        let start = null;
        function animate(timestamp) {
            if (!start) start = timestamp;
            const progress = timestamp - start;
            let opacity = Math.min(progress / duration, 1);
            element.style.opacity = opacity;
            if (progress < duration) {
                requestAnimationFrame(animate);
            }
        }
        requestAnimationFrame(animate);
    }

    // ====== Audio upload flow ======
    uploadBtn.addEventListener('click', async () => {
        if (!audioFileInput.files.length) {
            alert("Please select an audio file first.");
            return;
        }
        const formData = new FormData();
        formData.append('audio', audioFileInput.files[0]);
        formData.append('words_per_scene', wordsPerSceneInput.value.trim());
        formData.append('text_model', textModelInput.value.trim());
        formData.append('size', sizeSelect.value.trim());
        formData.append('image_prompt_style', imagePromptStyleTextarea.value);
        formData.append('characters_prompt_style', charactersPromptStyleTextarea.value);
        formData.append('image_preprocessing_prompt', imagePreprocessingPromptTextarea.value);
        formData.append('fade_in', document.getElementById('fade-in').value);
        formData.append('fade_out', document.getElementById('fade-out').value);
        formData.append('crossfade_dur', document.getElementById('crossfade-dur').value);

        // Hide the entire initial UI
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
            // After successful upload
            uploadingSection.style.display = 'none';
            mainHeader.textContent = data.title;
            audioProcessingSection.style.display = 'block';
            uploadedAudio.src = URL.createObjectURL(audioFileInput.files[0]);
            storyDescription.textContent = data.description;
            storyDescription.style.display = 'block';
            storyIngredientsParagraph.textContent = data.story_ingredients;
            storyIngredientsParagraph.style.display = 'block';

            chunksData = data.chunks;
            totalScenes = data.chunks.length;
            imagesGenerated = 0;
            scenesContainer.innerHTML = '';
            sceneGenerated = new Array(totalScenes).fill(false);

            chunkProcessingStatus.style.display = 'block';
            chunkProcessingStatus.textContent = 'Processing chunks...';

            for (let i = 0; i < totalScenes; i++) {
                const { index } = data.chunks[i];
                const sceneCard = createSceneCard(index);
                scenesContainer.appendChild(sceneCard);
                chunkProcessingStatus.textContent = `Processing chunk ${i + 1} of ${totalScenes}...`;
                const finalPrompt = await preprocessChunk(data.job_id, index);
                if (!finalPrompt) {
                    resetUI();
                    return;
                }
                fillPromptTab(sceneCard, finalPrompt);
            }
            chunkProcessingStatus.style.display = 'none';
            videoGenerationSection.style.display = 'block';
            currentJobId = data.job_id;
            enableGenerateButtons();
        } catch (err) {
            if (err.name === 'AbortError') {
                console.log("Fetch aborted by user.");
            } else {
                alert("Error uploading audio");
            }
            resetUI();
        }
    });

    uploadCancelBtn.addEventListener('click', () => {
        userCanceledMidUpload = true;
        if (uploadAbortController) {
            uploadAbortController.abort();
        }
        resetUI();
    });

    // ====== Scenes & prompts ======
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
        textArea.value = "Generating sequence prompt...";
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
        regenBtn.disabled = true;
        regenBtn.addEventListener('click', () =>
            handleGenerateImage(sceneIndex, textArea, imgEl, regenBtn)
        );

        const selectLocalBtn = document.createElement('button');
        selectLocalBtn.textContent = 'Select Image';
        selectLocalBtn.disabled = true;
        selectLocalBtn.addEventListener('click', () =>
            handleSelectLocalImage(sceneIndex, imgEl, regenBtn, selectLocalBtn)
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

    function formatDuration(startSec, endSec) {
        const s = parseTime(startSec);
        const e = parseTime(endSec);
        return `from ${s} to ${e}`;
    }
    function parseTime(sec) {
        sec = Math.floor(sec);
        const h = Math.floor(sec / 3600);
        const m = Math.floor((sec % 3600) / 60);
        const s = sec % 60;
        let parts = [];
        if (h > 0) parts.push(`${h}h`);
        if (m > 0) parts.push(`${m}m`);
        if (s > 0) parts.push(`${s}s`);
        if (!parts.length) parts.push("0s");
        return parts.join(" ");
    }

    // ====== Textarea auto-height ======
    function adjustTextareaHeight(e) {
        const area = e.target;
        area.style.height = 'auto';
        area.style.height = area.scrollHeight + 'px';
    }
    function resetTextareaHeight(e) {
        e.target.style.height = '200px';
    }

    // ====== Preprocess chunk ======
    async function preprocessChunk(jobId, chunkIndex) {
        const resp = await fetch('/preprocess-chunk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_id: jobId, chunk_index: chunkIndex })
        });
        const data = await resp.json();
        if (data.error) throw data.error;
        return data.preprocessed_prompt;
    }
    function fillPromptTab(sceneCard, finalPrompt) {
        const promptTab = sceneCard.querySelector('.tab-content-prompt textarea');
        if (promptTab) {
            promptTab.value = finalPrompt;
            promptTab.disabled = false;
        }
    }

    // ====== Enable scene card buttons ======
    function enableGenerateButtons() {
        const allCards = document.querySelectorAll('.scene-card');
        allCards.forEach(card => {
            const regenBtn = card.querySelector('.regenerate-btn');
            const selectLocalBtn = card.querySelector('button:nth-of-type(2)');
            if (regenBtn) regenBtn.disabled = false;
            if (selectLocalBtn) selectLocalBtn.disabled = false;
        });
    }

    // ====== AI Generate Image ======
    async function handleGenerateImage(sceneIndex, textArea, img, regenBtn, attempt = 1) {
        if (isGeneratingImage && attempt === 1) return;
        isGeneratingImage = true;
        disableAllImageButtons();
        regenBtn.textContent = `Generating... (attempt ${attempt})`;

        try {
            const resp = await fetch('/generate-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    job_id: currentJobId,
                    scene_index: sceneIndex,
                    new_prompt: textArea.value
                })
            });
            const dataImg = await resp.json();
            if (dataImg.error) {
                console.error("Image generation error:", dataImg.error);
                if (attempt < 5) {
                    await handleGenerateImage(sceneIndex, textArea, img, regenBtn, attempt + 1);
                    return;
                } else {
                    regenBtn.disabled = false;
                    regenBtn.textContent = 'Generate';
                    isGeneratingImage = false;
                    enableAllImageButtons();
                    return;
                }
            } else {
                // success
                img.src = dataImg.image_url + "?t=" + Date.now();
                if (!sceneGenerated[sceneIndex]) {
                    sceneGenerated[sceneIndex] = true;
                    imagesGenerated++;
                }
                regenBtn.textContent = 'Regenerate';
                isGeneratingImage = false;
                enableAllImageButtons();
                if (imagesGenerated >= totalScenes) {
                    generateVideoBtn.disabled = false;
                }
            }
        } catch (err) {
            console.error("Image generation fetch error:", err);
            if (attempt < 5) {
                await handleGenerateImage(sceneIndex, textArea, img, regenBtn, attempt + 1);
                return;
            } else {
                regenBtn.disabled = false;
                regenBtn.textContent = 'Generate';
                isGeneratingImage = false;
                enableAllImageButtons();
                return;
            }
        }
    }

    // ====== Local Image + custom bounding-box approach with fixed aspect ratio ======
    let aspectRatio = 1.0; // final video size ratio = (width / height)

    function handleSelectLocalImage(sceneIndex, imgEl, regenBtn, selectLocalBtn) {
        if (isGeneratingImage) return;
        localImageSceneIndex = sceneIndex;

        // parse ratio from sizeSelect => e.g. "1792x1024"
        const [twStr, thStr] = sizeSelect.value.split('x');
        const tw = parseInt(twStr, 10) || 1792;
        const th = parseInt(thStr, 10) || 1024;
        aspectRatio = tw / th;

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';

        fileInput.onchange = () => {
            if (!fileInput.files || !fileInput.files.length) return;
            originalFile = fileInput.files[0];
            if (!originalFile) return;

            localImageCropModal.style.display = 'flex';
            // Initially zero out bounding box
            rectX = 0; rectY = 0;
            rectW = 100; rectH = 100;
            dragging = false;
            dragOffsetX = 0; dragOffsetY = 0;

            const reader = new FileReader();
            reader.onload = (ev) => {
                localImagePreview.src = ev.target.result;
            };
            reader.readAsDataURL(originalFile);
        };
        fileInput.click();
    }

    localImagePreview.onload = () => {
        displayedImgWidth = localImagePreview.clientWidth;
        displayedImgHeight = localImagePreview.clientHeight;

        // Decide bounding box so it matches aspectRatio = rectW / rectH
        // and fits fully in displayedImgWidth x displayedImgHeight,
        // filling either entire width or entire height.
        const displayedRatio = displayedImgWidth / displayedImgHeight;
        if (displayedRatio > aspectRatio) {
            // fill entire height
            rectH = displayedImgHeight;
            rectW = Math.floor(rectH * aspectRatio);
        } else {
            // fill entire width
            rectW = displayedImgWidth;
            rectH = Math.floor(rectW / aspectRatio);
        }

        // Center the rectangle
        rectX = Math.floor((displayedImgWidth - rectW) / 2);
        rectY = Math.floor((displayedImgHeight - rectH) / 2);

        updateCropRect();
    };

    // Drag
    cropRect.addEventListener('mousedown', (e) => {
        dragging = true;
        dragOffsetX = e.offsetX;
        dragOffsetY = e.offsetY;
    });
    document.addEventListener('mouseup', () => {
        dragging = false;
    });
    document.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        e.preventDefault();

        const previewRect = localImagePreview.getBoundingClientRect();
        let newLeft = e.clientX - previewRect.left - dragOffsetX;
        let newTop = e.clientY - previewRect.top - dragOffsetY;

        // clamp
        if (newLeft < 0) newLeft = 0;
        if (newTop < 0) newTop = 0;
        if (newLeft + rectW > displayedImgWidth) {
            newLeft = displayedImgWidth - rectW;
        }
        if (newTop + rectH > displayedImgHeight) {
            newTop = displayedImgHeight - rectH;
        }

        rectX = newLeft;
        rectY = newTop;
        updateCropRect();
    });

    function updateCropRect() {
        cropRect.style.left = rectX + 'px';
        cropRect.style.top = rectY + 'px';
        cropRect.style.width = rectW + 'px';
        cropRect.style.height = rectH + 'px';
    }

    cropCancelBtn.addEventListener('click', () => {
        localImageCropModal.style.display = 'none';
    });

    cropConfirmBtn.addEventListener('click', async () => {
        if (!originalFile) {
            localImageCropModal.style.display = 'none';
            return;
        }

        isGeneratingImage = true;
        disableAllImageButtons();

        const formData = new FormData();
        formData.append('job_id', currentJobId);
        formData.append('scene_index', localImageSceneIndex);
        formData.append('image_file', originalFile);

        // bounding box in displayed coords
        formData.append('box_x', rectX);
        formData.append('box_y', rectY);
        formData.append('box_w', rectW);
        formData.append('box_h', rectH);
        formData.append('displayed_w', displayedImgWidth);
        formData.append('displayed_h', displayedImgHeight);

        try {
            const resp = await fetch('/upload-local-image', {
                method: 'POST',
                body: formData
            });
            const data = await resp.json();
            if (data.error) {
                console.error("Local image upload error:", data.error);
                alert(data.error);
                isGeneratingImage = false;
                enableAllImageButtons();
                localImageCropModal.style.display = 'none';
                return;
            }

            // success
            const sceneCard = document.getElementById(`scene-card-${localImageSceneIndex}`);
            if (sceneCard) {
                const figureEl = sceneCard.querySelector('figure img');
                figureEl.src = data.image_url + '?t=' + Date.now();
            }
            if (!sceneGenerated[localImageSceneIndex]) {
                sceneGenerated[localImageSceneIndex] = true;
                imagesGenerated++;
            }
            if (imagesGenerated >= totalScenes) {
                generateVideoBtn.disabled = false;
            }
        } catch (err) {
            console.error("Error uploading local image:", err);
            alert("Error uploading/cropping image");
        }

        isGeneratingImage = false;
        enableAllImageButtons();
        localImageCropModal.style.display = 'none';
    });

    function disableAllImageButtons() {
        const allRegen = document.querySelectorAll('.regenerate-btn');
        const allSelect = document.querySelectorAll('.scene-card figcaption button:nth-of-type(2)');
        allRegen.forEach(btn => { btn.disabled = true; });
        allSelect.forEach(btn => { btn.disabled = true; });
    }
    function enableAllImageButtons() {
        const allRegen = document.querySelectorAll('.regenerate-btn');
        const allSelect = document.querySelectorAll('.scene-card figcaption button:nth-of-type(2)');
        allRegen.forEach(btn => { btn.disabled = false; });
        allSelect.forEach(btn => { btn.disabled = false; });
    }

    // ====== Generate Video ======
    generateVideoBtn.addEventListener('click', async () => {
        generateVideoBtn.style.display = 'none';
        const sceneCards = Array.from(document.querySelectorAll('.scene-card'));
        let delay = 0;
        sceneCards.reverse().forEach(card => {
            setTimeout(() => fadeOut(card, 300), delay);
            delay += 300;
        });
        setTimeout(async () => {
            scenesContainer.innerHTML = '';
            videoProgress.style.display = 'inline-block';
            videoProgress.textContent = 'Generating video...';
            try {
                const resp = await fetch('/create-video', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ job_id: currentJobId })
                });
                const data = await resp.json();
                if (data.error) {
                    console.error("Error creating video:", data.error);
                    videoProgress.style.display = 'none';
                    generateVideoBtn.style.display = 'inline-block';
                    return;
                }
                finalVideoSource.src = data.video_url;
                finalVideo.load();
                finalVideoSection.style.display = 'block';
                videoProgress.style.display = 'none';
                finalVideoPathEl.textContent = "Saved at: " + data.video_url;
            } catch (err) {
                console.error("Error creating video:", err);
                videoProgress.style.display = 'none';
                generateVideoBtn.style.display = 'inline-block';
            }
        }, delay + 300);
    });

    // ====== Reset UI ======
    function resetUI() {
        currentJobId = null;
        totalScenes = 0;
        imagesGenerated = 0;
        isGeneratingImage = false;
        userCanceledMidUpload = false;
        sceneGenerated = [];
        chunksData = [];

        // Show initial UI again
        initialUIContainer.style.display = 'block';

        // Reset form to the default or blank
        wordsPerSceneInput.value = '{{ default_words_per_scene }}';
        textModelInput.value = '{{ default_text_model }}';
        sizeSelect.value = '{{ default_video_size }}';
        imagePromptStyleTextarea.value = `{{ default_image_prompt_style|replace("\n", "\\n") }}`;
        charactersPromptStyleTextarea.value = `{{ default_characters_prompt_style|replace("\n", "\\n") }}`;
        imagePreprocessingPromptTextarea.value = `{{ default_image_preprocessing_prompt|replace("\n", "\\n") }}`;
        audioFileInput.value = '';

        uploadingSection.style.display = 'none';
        audioProcessingSection.style.display = 'none';
        storyDescription.style.display = 'none';
        storyIngredientsParagraph.style.display = 'none';
        videoGenerationSection.style.display = 'none';
        finalVideoSection.style.display = 'none';
        chunkProcessingStatus.style.display = 'none';

        scenesContainer.innerHTML = '';
        uploadedAudio.src = '';
        whisperLoading.style.display = 'none';
        generateVideoBtn.disabled = true;
        generateVideoBtn.style.display = 'inline-block';
        videoProgress.style.display = 'none';
        videoProgress.textContent = '';
        finalVideoSource.src = '';
        finalVideo.load();
        finalVideoPathEl.textContent = '';

        mainHeader.textContent = "Make your story alive";
    }
});
