// prompt-creation.js
// Manages generating scene prompts.

document.addEventListener('DOMContentLoaded', function() {
    generatePromptsBtn.addEventListener('click', async () => {
        if (!window.currentJobId) {
            alert("No job to process. Please upload audio first.");
            return;
        }

        // Disable the textarea and hide the button
        storyIngredientsTextarea.disabled = true;
        generatePromptsBtn.style.display = 'none';

        chunkProcessingStatus.style.display = 'block';
        chunkProcessingStatus.textContent = 'Generating image prompts...';

        const updatedIngredients = storyIngredientsTextarea.value || "";

        // For each scene
        for (let i = 0; i < window.totalScenes; i++) {
            const finalPrompt = await preprocessChunk(window.currentJobId, i, updatedIngredients);
            const sceneCard = document.getElementById(`scene-card-${i}`);
            if (sceneCard) {
                fillPromptTab(sceneCard, finalPrompt);
            }
            chunkProcessingStatus.textContent = `Generated prompt for scene ${i + 1} of ${window.totalScenes}`;
        }

        // Done with prompt generation
        chunkProcessingStatus.style.display = 'none';

        // Enable "Generate Video" button area
        videoGenerationSection.style.display = 'block';

        // Re-enable buttons for each scene as needed
        buttonsManager.enableAll();
    });
});

async function preprocessChunk(jobId, chunkIndex, storyIngr) {
    const resp = await fetch('/preprocess-chunk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            job_id: jobId,
            chunk_index: chunkIndex,
            story_ingredients: storyIngr
        })
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

    // Now that we have a prompt, enable the "Generate" button for this scene
    buttonsManager.handleAction('prompt_available', sceneCard);
}
