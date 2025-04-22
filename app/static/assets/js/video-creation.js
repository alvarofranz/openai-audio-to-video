// Manages the final video assembly.

document.addEventListener('DOMContentLoaded', function() {
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
});
