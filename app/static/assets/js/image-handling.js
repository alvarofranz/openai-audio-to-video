// Handles everything about images (AI generation, local selection, cropping).

document.addEventListener('DOMContentLoaded', function() {
    // Overwrite the default cropConfirmBtn click
    window.cropConfirmBtn.addEventListener('click', doCropConfirm);

    // localImagePreview onload => compute bounding box
    if (window.localImagePreview) {
        window.localImagePreview.onload = () => {
            console.log("[DEBUG] localImagePreview onload fired for AI/local image.");
            console.log("[DEBUG] clientWidth=", window.localImagePreview.clientWidth,
                "clientHeight=", window.localImagePreview.clientHeight,
                "naturalWidth=", window.localImagePreview.naturalWidth,
                "naturalHeight=", window.localImagePreview.naturalHeight,
                "aspectRatio=", window.aspectRatio);

            let w = window.localImagePreview.clientWidth;
            let h = window.localImagePreview.clientHeight;

            // If displayed width/height are 0 or too small, fallback
            if (w < 2 || h < 2) {
                console.log("[DEBUG] clientWidth/Height too small, using natural dims");
                w = window.localImagePreview.naturalWidth;
                h = window.localImagePreview.naturalHeight;
            }

            window.displayedImgWidth = w;
            window.displayedImgHeight = h;

            // Fill as much as possible while preserving final aspectRatio
            const targetRatio = window.aspectRatio;
            const displayedRatio = w / h;
            let desiredW, desiredH;

            if (targetRatio > displayedRatio) {
                // Fill entire width
                desiredW = w;
                desiredH = Math.floor(desiredW / targetRatio);
                if (desiredH > h) {
                    desiredH = h;
                    desiredW = Math.floor(desiredH * targetRatio);
                }
            } else {
                // Fill entire height
                desiredH = h;
                desiredW = Math.floor(desiredH * targetRatio);
                if (desiredW > w) {
                    desiredW = w;
                    desiredH = Math.floor(desiredW / targetRatio);
                }
            }

            window.rectW = desiredW;
            window.rectH = desiredH;

            // center it
            window.rectX = Math.floor((w - desiredW) / 2);
            window.rectY = Math.floor((h - desiredH) / 2);

            console.log("[DEBUG] computed displayedRatio=", displayedRatio,
                "=> desiredW=", desiredW, "desiredH=", desiredH,
                "rectX=", window.rectX, "rectY=", window.rectY);

            updateCropRect();
            console.log("[DEBUG] Final rect => W=", window.rectW,
                "H=", window.rectH, "X=", window.rectX, "Y=", window.rectY);
        };
    }
});

// AI generate
async function handleGenerateImage(sceneIndex, textArea, imgEl, regenBtn, attempt = 1) {
    if (attempt > 1) {
        regenBtn.textContent = `Generating... (attempt ${attempt})`;
    } else {
        regenBtn.textContent = "Generating...";
    }

    if (window.isGeneratingImage && attempt === 1) return;
    window.isGeneratingImage = true;
    disableAllImageButtons();

    console.log(`[DEBUG] handleGenerateImage => sceneIndex=${sceneIndex}, attempt=${attempt}`);

    // IMPORTANT: Also set the final aspect ratio for AI images,
    // just like we do for local images:
    const [twStr, thStr] = window.videoSizeSelect.value.split('x');
    const tw = parseInt(twStr, 10) || 1920;
    const th = parseInt(thStr, 10) || 1080;
    window.aspectRatio = tw / th;
    console.log(`[DEBUG] finalVideoSize => ${tw} x ${th}, so aspectRatio=${window.aspectRatio}`);

    try {
        const resp = await fetch('/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                job_id: window.currentJobId,
                scene_index: sceneIndex,
                new_prompt: textArea.value
            })
        });
        const dataImg = await resp.json();
        if (dataImg.error) {
            console.error("[DEBUG] generate-image error:", dataImg.error);
            if (attempt < 5) {
                await handleGenerateImage(sceneIndex, textArea, imgEl, regenBtn, attempt + 1);
                return;
            } else {
                regenBtn.disabled = false;
                regenBtn.textContent = 'Generate';
                window.isGeneratingImage = false;
                enableAllImageButtons();
                return;
            }
        } else {
            console.log("[DEBUG] AI image generated =>", dataImg.image_url);
            imgEl.src = dataImg.image_url + "?t=" + Date.now();

            if (!window.sceneGenerated[sceneIndex]) {
                window.sceneGenerated[sceneIndex] = true;
                window.imagesGenerated++;
            }
            regenBtn.textContent = 'Regenerate';

            // Immediately open cropping modal for new AI image
            await openCropModalFromURL(dataImg.image_url, sceneIndex);

            if (window.imagesGenerated >= window.totalScenes) {
                window.generateVideoBtn.disabled = false;
            }
        }
    } catch (err) {
        console.error("[DEBUG] fetch error in handleGenerateImage:", err);
        if (attempt < 5) {
            await handleGenerateImage(sceneIndex, textArea, imgEl, regenBtn, attempt + 1);
            return;
        } else {
            regenBtn.disabled = false;
            regenBtn.textContent = 'Generate';
            window.isGeneratingImage = false;
            enableAllImageButtons();
            return;
        }
    }
}

// Local image selection
function handleSelectLocalImage(sceneIndex) {
    if (window.isGeneratingImage) return;
    window.localImageSceneIndex = sceneIndex;

    const [twStr, thStr] = window.videoSizeSelect.value.split('x');
    const tw = parseInt(twStr, 10) || 1920;
    const th = parseInt(thStr, 10) || 1080;
    window.aspectRatio = tw / th;

    console.log("[DEBUG] handleSelectLocalImage => sceneIndex=", sceneIndex,
        "videoSize=", tw, "x", th, "=> aspectRatio=", window.aspectRatio);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';

    fileInput.onchange = () => {
        if (!fileInput.files || !fileInput.files.length) return;
        window.originalFile = fileInput.files[0];
        if (!window.originalFile) return;

        window.localImageCropModal.style.display = 'flex';
        window.rectX = 0;
        window.rectY = 0;
        window.rectW = 100;
        window.rectH = 100;
        window.dragging = false;
        window.dragOffsetX = 0;
        window.dragOffsetY = 0;

        console.log("[DEBUG] local image selected:", window.originalFile.name);

        const reader = new FileReader();
        reader.onload = (ev) => {
            if (window.localImagePreview) {
                window.localImagePreview.src = ev.target.result;
            }
        };
        reader.readAsDataURL(window.originalFile);
    };
    fileInput.click();
}

// For AI images, treat them as local file for cropping
async function openCropModalFromURL(imageUrl, sceneIndex) {
    console.log("[DEBUG] openCropModalFromURL => sceneIndex=", sceneIndex,
        "imageUrl=", imageUrl);

    try {
        const blob = await fetch(imageUrl).then(r => r.blob());
        const file = new File([blob], `scene_${sceneIndex}_ai.png`, { type: blob.type });

        window.localImageSceneIndex = sceneIndex;
        window.originalFile = file;

        window.localImageCropModal.style.display = 'flex';
        window.rectX = 0;
        window.rectY = 0;
        window.rectW = 100;
        window.rectH = 100;
        window.dragging = false;
        window.dragOffsetX = 0;
        window.dragOffsetY = 0;

        console.log("[DEBUG] AI image loaded => name=", file.name);

        const reader = new FileReader();
        reader.onload = (ev) => {
            if (window.localImagePreview) {
                window.localImagePreview.src = ev.target.result;
            }
        };
        reader.readAsDataURL(file);
    } catch (err) {
        console.error("[DEBUG] error in openCropModalFromURL:", err);
        window.isGeneratingImage = false;
        enableAllImageButtons();
    }
}

// Called when user confirms the crop
async function doCropConfirm() {
    console.log("[DEBUG] doCropConfirm fired.");
    if (!window.originalFile) {
        console.log("[DEBUG] No originalFile => closing modal.");
        window.localImageCropModal.style.display = 'none';
        window.isGeneratingImage = false;
        enableAllImageButtons();
        return;
    }

    window.isGeneratingImage = true;
    disableAllImageButtons();

    console.log("[DEBUG] Uploading crop => rectX=", window.rectX,
        "rectY=", window.rectY, "rectW=", window.rectW, "rectH=", window.rectH,
        "dispW=", window.displayedImgWidth, "dispH=", window.displayedImgHeight);

    const formData = new FormData();
    formData.append('job_id', window.currentJobId);
    formData.append('scene_index', window.localImageSceneIndex);
    formData.append('image_file', window.originalFile);

    formData.append('box_x', window.rectX);
    formData.append('box_y', window.rectY);
    formData.append('box_w', window.rectW);
    formData.append('box_h', window.rectH);
    formData.append('displayed_w', window.displayedImgWidth);
    formData.append('displayed_h', window.displayedImgHeight);

    try {
        const resp = await fetch('/upload-local-image', {
            method: 'POST',
            body: formData
        });
        const data = await resp.json();
        if (data.error) {
            console.error("[DEBUG] Crop upload error:", data.error);
            alert(data.error);
            window.isGeneratingImage = false;
            enableAllImageButtons();
            window.localImageCropModal.style.display = 'none';
            return;
        }
        console.log("[DEBUG] Crop upload success => new image url=", data.image_url);

        const sceneCard = document.getElementById(`scene-card-${window.localImageSceneIndex}`);
        if (sceneCard) {
            const figureEl = sceneCard.querySelector('figure img');
            figureEl.src = data.image_url + '?t=' + Date.now();
        }
        if (!window.sceneGenerated[window.localImageSceneIndex]) {
            window.sceneGenerated[window.localImageSceneIndex] = true;
            window.imagesGenerated++;
        }
        if (window.imagesGenerated >= window.totalScenes) {
            window.generateVideoBtn.disabled = false;
        }
    } catch (err) {
        console.error("[DEBUG] Error uploading local/AI cropped image:", err);
        alert("Error uploading/cropping image");
    }

    window.isGeneratingImage = false;
    enableAllImageButtons();
    window.localImageCropModal.style.display = 'none';
}
