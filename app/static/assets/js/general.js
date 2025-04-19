document.addEventListener('DOMContentLoaded', function() {

    const uploadSection = document.getElementById('upload-section');
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

    const settingsForm = document.getElementById('settings-form');
    const wordsPerSceneInput = document.getElementById('words-per-scene');
    const textModelInput = document.getElementById('text-model');
    const sizeSelect = document.getElementById('size-select');
    const imagePromptStyleTextarea = document.getElementById('image-prompt-style');
    const imagePreprocessingPromptTextarea = document.getElementById('image-preprocessing-prompt');

    let currentJobId = null;
    let totalScenes = 0;
    let imagesGenerated = 0;
    let isGeneratingImage = false;
    let userCanceledMidUpload = false;
    let sceneGenerated = [];
    let uploadAbortController = null;
    let chunksData = [];

    /*************** Fade utility ***************/
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
    /********************************************/

    // -------------- EVENT: "Use this audio" --------------
    uploadBtn.addEventListener('click', async () => {
        if (!audioFileInput.files.length) {
            alert("Please select an audio file first.");
            return;
        }
        const formData = new FormData();
        formData.append('audio', audioFileInput.files[0]);
        formData.append('words_per_scene', wordsPerSceneInput.value.trim());
        formData.append('text_model', textModelInput.value.trim());
        formData.append('size', sizeSelect.value);
        formData.append('image_prompt_style', imagePromptStyleTextarea.value);
        formData.append('image_preprocessing_prompt', imagePreprocessingPromptTextarea.value);

        settingsForm.style.display = 'none';
        uploadSection.style.display = 'none';
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
                const { index, raw_text } = data.chunks[i];
                const sceneCard = createSceneCard(index);
                scenesContainer.appendChild(sceneCard);
                chunkProcessingStatus.textContent = `Processing chunk ${i + 1} of ${totalScenes}...`;
                const finalPrompt = await preprocessChunk(data.job_id, index);
                if (!finalPrompt) {
                    resetUI();
                    return;
                }
                fillPromptTab(sceneCard, finalPrompt); // fill text area with prompt
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

    // -------------- CANCEL mid-upload --------------
    uploadCancelBtn.addEventListener('click', () => {
        userCanceledMidUpload = true;
        if (uploadAbortController) {
            uploadAbortController.abort();
        }
        resetUI();
    });

    // -------------- CREATE SCENE CARD --------------
    function createSceneCard(sceneIndex) {
        const sceneCard = document.createElement('div');
        sceneCard.className = 'scene-card';
        sceneCard.id = `scene-card-${sceneIndex}`;

        // TABS
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

        // TAB CONTENTS
        const tabPromptContent = document.createElement('div');
        tabPromptContent.className = 'tab-content tab-content-prompt active';
        const textArea = document.createElement('textarea');
        textArea.value = "Generating sequence prompt...";
        textArea.disabled = true;

        // Animate textarea height on focus/blur
        textArea.addEventListener('focus', adjustTextareaHeight);
        textArea.addEventListener('input', adjustTextareaHeight);
        textArea.addEventListener('blur', resetTextareaHeight);

        tabPromptContent.appendChild(textArea);

        const tabSceneTextContent = document.createElement('div');
        tabSceneTextContent.className = 'tab-content tab-content-text';
        const sceneTextBlock = document.createElement('div');
        sceneTextBlock.className = 'scene-text-block';
        tabSceneTextContent.appendChild(sceneTextBlock);

        // FIGURE (IMAGE + CAPTION)
        const figureEl = document.createElement('figure');
        const imgEl = document.createElement('img');
        imgEl.src = '/static/assets/img/placeholder.png';
        const figCaption = document.createElement('figcaption');
        const regenBtn = document.createElement('button');
        regenBtn.textContent = 'Generate';
        regenBtn.classList.add('regenerate-btn');
        regenBtn.disabled = true;
        regenBtn.addEventListener('click', () => handleGenerateImage(sceneIndex, textArea, imgEl, regenBtn));
        figCaption.appendChild(regenBtn);
        figureEl.appendChild(imgEl);
        figureEl.appendChild(figCaption);

        // CARD CONTENT WRAPPER
        const cardContent = document.createElement('div');
        cardContent.className = 'scene-card-content';
        const tabContentsContainer = document.createElement('div');
        tabContentsContainer.className = 'tab-contents-wrapper'; // custom for styling

        tabContentsContainer.appendChild(tabsContainer);
        tabContentsContainer.appendChild(tabPromptContent);
        tabContentsContainer.appendChild(tabSceneTextContent);

        cardContent.appendChild(tabContentsContainer);
        cardContent.appendChild(figureEl);
        sceneCard.appendChild(cardContent);

        // Switch tabs on click
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

        // Fill scene text
        fillSceneText(sceneIndex, sceneTextBlock);
        return sceneCard;
    }

    // -------------- ADJUST TEXTAREA ON FOCUS/INPUT --------------
    function adjustTextareaHeight(e) {
        const area = e.target;
        area.style.height = 'auto'; // reset first
        area.style.height = area.scrollHeight + 'px';
    }
    // -------------- RESET TEXTAREA ON BLUR --------------
    function resetTextareaHeight(e) {
        // revert to original 200px (or any default)
        e.target.style.height = '200px';
    }

    // -------------- FILL SCENE TEXT --------------
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

    // -------------- PREPROCESS CHUNK --------------
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

    // -------------- FILL PROMPT TAB ALWAYS --------------
    function fillPromptTab(sceneCard, finalPrompt) {
        // Always target the prompt tab content's textarea,
        // not only if it's active.
        const promptTab = sceneCard.querySelector('.tab-content-prompt textarea');
        if (promptTab) {
            promptTab.value = finalPrompt;
            promptTab.disabled = false;
        }
    }

    // -------------- ENABLE GENERATE BUTTONS --------------
    function enableGenerateButtons() {
        const allBtns = document.querySelectorAll('.regenerate-btn');
        allBtns.forEach(b => {
            b.disabled = false;
            b.textContent = 'Generate';
        });
    }

    // -------------- GENERATE IMAGE --------------
    async function handleGenerateImage(sceneIndex, textArea, img, regenBtn, attempt = 1) {
        if (isGeneratingImage && attempt === 1) return;
        isGeneratingImage = true;
        const allBtns = document.querySelectorAll('.regenerate-btn');
        allBtns.forEach(b => { b.disabled = true; });
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
                    return;
                }
            } else {
                // success
                img.src = dataImg.image_url + "?t=" + Date.now();
                if (!sceneGenerated[sceneIndex]) {
                    sceneGenerated[sceneIndex] = true;
                    imagesGenerated++;
                }
                // re-enable
                allBtns.forEach(btn => {
                    btn.disabled = false;
                    if (btn === regenBtn) {
                        btn.textContent = 'Regenerate';
                    } else {
                        if (!btn.textContent.includes('Regenerate')) {
                            btn.textContent = 'Generate';
                        }
                    }
                });
                isGeneratingImage = false;
                const nextIndex = sceneIndex + 1;
                if (nextIndex < totalScenes && !sceneGenerated[nextIndex]) {
                    const nextCard = document.getElementById(`scene-card-${nextIndex}`);
                    if (nextCard) {
                        const nextTextArea = nextCard.querySelector('.tab-content-prompt textarea');
                        const nextImg = nextCard.querySelector('img');
                        const nextBtn = nextCard.querySelector('.regenerate-btn');
                        await handleGenerateImage(nextIndex, nextTextArea, nextImg, nextBtn);
                    }
                }
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
                return;
            }
        }
    }

    // -------------- GENERATE VIDEO --------------
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

    // -------------- RESET UI --------------
    function resetUI() {
        currentJobId = null;
        totalScenes = 0;
        imagesGenerated = 0;
        isGeneratingImage = false;
        userCanceledMidUpload = false;
        sceneGenerated = [];
        chunksData = [];

        mainHeader.textContent = "Make your story alive";
        settingsForm.style.display = 'block';
        wordsPerSceneInput.value = '40';
        textModelInput.value = 'o4-mini';
        sizeSelect.value = '1792x1024';
        uploadSection.style.display = 'block';
        uploadingSection.style.display = 'none';
        audioProcessingSection.style.display = 'none';
        storyDescription.style.display = 'none';
        storyIngredientsParagraph.style.display = 'none';
        videoGenerationSection.style.display = 'none';
        finalVideoSection.style.display = 'none';
        chunkProcessingStatus.style.display = 'none';

        scenesContainer.innerHTML = '';
        audioFileInput.value = '';
        uploadedAudio.src = '';
        whisperLoading.style.display = 'none';
        generateVideoBtn.disabled = true;
        generateVideoBtn.style.display = 'inline-block';
        videoProgress.style.display = 'none';
        videoProgress.textContent = '';
        finalVideoSource.src = '';
        finalVideo.load();
        finalVideoPathEl.textContent = '';
    }
});
