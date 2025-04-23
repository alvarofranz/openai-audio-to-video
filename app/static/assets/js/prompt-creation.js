// Manages generating scene prompts & final consistency adjustments

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

        // Now do a final "adjust-prompts" pass
        chunkProcessingStatus.textContent = "Finalizing prompts consistency...";
        await adjustAllPrompts();

        chunkProcessingStatus.style.display = 'none';

        // Enable "Generate" & "Select" for images
        videoGenerationSection.style.display = 'block';
        enableAllImageButtons();
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
}

// Once we have all initial prompts, unify them across scenes
async function adjustAllPrompts() {
    try {
        const resp = await fetch('/adjust-prompts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_id: window.currentJobId })
        });
        const data = await resp.json();
        if (data.error) {
            console.warn("Prompt adjustment error:", data.error);
            return; // fallback: keep old prompts
        }
        if (!data.adjusted_prompts) {
            console.warn("No adjusted_prompts in response");
            return; // fallback
        }

        // Replace the textareas
        data.adjusted_prompts.forEach(item => {
            const sceneIndex = item.scene_index;
            const newPrompt = item.prompt;
            const sceneCard = document.getElementById(`scene-card-${sceneIndex}`);
            if (sceneCard) {
                const promptTab = sceneCard.querySelector('.tab-content-prompt textarea');
                if (promptTab) {
                    promptTab.value = newPrompt;
                }
            }
        });
    } catch (err) {
        console.error("Error adjusting all prompts:", err);
    }
}
