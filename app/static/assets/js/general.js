document.addEventListener('DOMContentLoaded', function() {

    // DOM references
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

    // We'll replace the main header text with the story title once it’s known
    const mainHeader = document.querySelector('header h1');

    // State
    let currentJobId = null;
    let totalScenes = 0;
    let imagesGenerated = 0;
    let isGeneratingImage = false;
    let userCanceledMidUpload = false;  // for ignoring server responses if canceled
    let sceneGenerated = [];            // tracks which scenes are generated

    // We'll store an AbortController for the "upload-audio" fetch
    let uploadAbortController = null;

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
        // Hide the main upload section
        uploadSection.style.display = 'none';

        // Show the "uploading-section" with a Cancel button
        uploadingSection.style.display = 'block';
        uploadingFeedback.textContent = "Uploading audio...";
        userCanceledMidUpload = false;

        // Prepare an AbortController to truly cancel the fetch
        uploadAbortController = new AbortController();
        let signal = uploadAbortController.signal;

        try {
            const formData = new FormData();
            formData.append('audio', audioFileInput.files[0]);

            const resp = await fetch('/upload-audio', {
                method: 'POST',
                body: formData,
                signal: signal
            });
            if (userCanceledMidUpload) {
                return; // user canceled, ignore
            }

            const data = await resp.json();
            if (data.error) {
                alert(data.error);
                resetUI();
                return;
            }

            // All good => Update UI
            uploadingSection.style.display = 'none';
            // Put the story title in the main header
            mainHeader.textContent = data.title;

            // Show audio player & description
            audioProcessingSection.style.display = 'block';
            uploadedAudio.src = URL.createObjectURL(audioFileInput.files[0]);
            storyDescription.textContent = data.description;
            storyDescription.style.display = 'block';

            // NEW: Show story ingredients
            storyIngredientsParagraph.textContent = data.story_ingredients;
            storyIngredientsParagraph.style.display = 'block';

            // Scenes
            totalScenes = data.chunks.length;
            imagesGenerated = 0;
            scenesContainer.innerHTML = '';
            sceneGenerated = new Array(totalScenes).fill(false);

            // Show chunk status
            chunkProcessingStatus.style.display = 'block';
            chunkProcessingStatus.textContent = 'Processing chunks...';

            // Preprocess each chunk
            for (let i = 0; i < totalScenes; i++) {
                const { index, raw_text } = data.chunks[i];
                // placeholder card
                const sceneCard = createPlaceholderSceneCard(index);
                scenesContainer.appendChild(sceneCard);

                chunkProcessingStatus.textContent = `Processing chunk ${i + 1} of ${totalScenes}...`;

                // /preprocess-chunk
                const finalPrompt = await preprocessChunk(data.job_id, index);
                if (!finalPrompt) {
                    console.error("No prompt returned for chunk index " + index);
                    resetUI();
                    return;
                }
                fillSceneCard(sceneCard, finalPrompt);
            }
            chunkProcessingStatus.style.display = 'none';
            videoGenerationSection.style.display = 'block';
            currentJobId = data.job_id;

            enableGenerateButtons();
        } catch (err) {
            console.error("Error uploading audio:", err);
            if (err.name === 'AbortError') {
                // This means the request was truly canceled by the user
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
        // Actually abort the fetch
        if (uploadAbortController) {
            uploadAbortController.abort();
        }
        resetUI();
    });

    // -------------- Create placeholder scene card --------------
    function createPlaceholderSceneCard(sceneIndex) {
        const sceneCard = document.createElement('div');
        sceneCard.className = 'scene-card';
        sceneCard.id = `scene-card-${sceneIndex}`;

        // Textarea
        const textArea = document.createElement('textarea');
        textArea.value = "Generating sequence prompt...";
        textArea.disabled = true;

        // Figure
        const fig = document.createElement('figure');
        const img = document.createElement('img');
        img.src = '/static/assets/img/placeholder.png';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';

        const figCaption = document.createElement('figcaption');
        const regenBtn = document.createElement('button');
        regenBtn.textContent = 'Generate';
        regenBtn.classList.add('regenerate-btn');
        regenBtn.disabled = true; // not until chunk preprocessed
        regenBtn.addEventListener('click', () => handleGenerateImage(sceneIndex, textArea, img, regenBtn));

        figCaption.appendChild(regenBtn);
        fig.appendChild(img);
        fig.appendChild(figCaption);

        sceneCard.appendChild(textArea);
        sceneCard.appendChild(fig);
        return sceneCard;
    }

    // -------------- Fill final prompt --------------
    function fillSceneCard(sceneCard, finalPrompt) {
        const textArea = sceneCard.querySelector('textarea');
        textArea.value = finalPrompt;
        textArea.disabled = false;
    }

    // -------------- /preprocess-chunk --------------
    async function preprocessChunk(jobId, chunkIndex) {
        const resp = await fetch('/preprocess-chunk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_id: jobId, chunk_index: chunkIndex })
        });
        const data = await resp.json();
        if (data.error) {
            throw data.error;
        }
        return data.preprocessed_prompt;
    }

    // -------------- Enable "Generate" buttons --------------
    function enableGenerateButtons() {
        const allBtns = document.querySelectorAll('.regenerate-btn');
        allBtns.forEach(b => {
            b.disabled = false;
            b.textContent = 'Generate';
        });
    }

    // -------------- handleGenerateImage --------------
    async function handleGenerateImage(sceneIndex, textArea, img, regenBtn, attempt = 1) {
        // If we are already generating an image, don't start a new one
        if (isGeneratingImage && attempt === 1) return;
        isGeneratingImage = true;

        // On first attempt or any re-attempt, disable all buttons
        const allBtns = document.querySelectorAll('.regenerate-btn');
        allBtns.forEach(b => {
            b.disabled = true;
        });
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

            // If server returned an error
            if (dataImg.error) {
                console.error("Generate image error:", dataImg.error);
                if (attempt < 5) {
                    // Retry
                    await handleGenerateImage(sceneIndex, textArea, img, regenBtn, attempt + 1);
                    return;
                } else {
                    // 5 consecutive fails => stop automatic generation
                    console.log("Exceeded 5 consecutive failures for this scene. Stopping auto-generation.");
                    regenBtn.disabled = false;
                    regenBtn.textContent = 'Generate';
                    isGeneratingImage = false;
                    return;
                }
            } else {
                // success, bust cache
                img.src = dataImg.image_url + "?t=" + Date.now();

                // Mark this scene generated
                if (!sceneGenerated[sceneIndex]) {
                    sceneGenerated[sceneIndex] = true;
                    imagesGenerated++;
                }

                // Re-enable all => but keep them as 'Generate' if not generated
                // This button => "Regenerate"
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

                // Check if we should auto-generate the next scene
                isGeneratingImage = false;
                const nextIndex = sceneIndex + 1;
                if (nextIndex < totalScenes && !sceneGenerated[nextIndex]) {
                    const nextCard = document.getElementById(`scene-card-${nextIndex}`);
                    if (nextCard) {
                        const nextTextArea = nextCard.querySelector('textarea');
                        const nextImg = nextCard.querySelector('img');
                        const nextBtn = nextCard.querySelector('.regenerate-btn');
                        await handleGenerateImage(nextIndex, nextTextArea, nextImg, nextBtn);
                    }
                }
                // If user has generated all scenes
                if (imagesGenerated >= totalScenes) {
                    generateVideoBtn.disabled = false;
                }
            }
        } catch (err) {
            // Network/fetch error or exception
            console.error("Error generating image request:", err);
            if (attempt < 5) {
                // Retry
                await handleGenerateImage(sceneIndex, textArea, img, regenBtn, attempt + 1);
                return;
            } else {
                console.log("Exceeded 5 consecutive failures for this scene. Stopping auto-generation.");
                regenBtn.disabled = false;
                regenBtn.textContent = 'Generate';
                isGeneratingImage = false;
                return;
            }
        }
    }

    // -------------- Generate Video --------------
    generateVideoBtn.addEventListener('click', async () => {
        // Hide button
        generateVideoBtn.style.display = 'none';

        // Fade out scenes
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

                // show final video
                finalVideoSource.src = data.video_url;
                finalVideo.load();
                finalVideoSection.style.display = 'block';
                videoProgress.style.display = 'none';

            } catch (err) {
                console.error("Error creating video:", err);
                videoProgress.style.display = 'none';
                generateVideoBtn.style.display = 'inline-block';
            }
        }, delay + 300);
    });

    // -------------- Reset UI --------------
    function resetUI() {
        currentJobId = null;
        totalScenes = 0;
        imagesGenerated = 0;
        isGeneratingImage = false;
        userCanceledMidUpload = false;
        sceneGenerated = [];

        mainHeader.textContent = "Make your story alive";

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
    }

});
