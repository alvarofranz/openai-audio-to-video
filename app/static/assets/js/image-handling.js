// Manages AI image generation/edit, local image cropping, and references logic

document.addEventListener('DOMContentLoaded', function() {
    // We only have a single "Add reference images" button now:
    window.refFileInput = document.getElementById("reference-file-input");
    window.refOpenFileBtn = document.getElementById("reference-open-file-btn");

    // Overwrite the default cropConfirmBtn
    if (cropConfirmBtn) {
        cropConfirmBtn.addEventListener('click', doCropConfirm);
    }

    // localImagePreview onload => compute bounding box
    if (window.localImagePreview) {
        window.localImagePreview.onload = () => {
            let w = window.localImagePreview.clientWidth;
            let h = window.localImagePreview.clientHeight;

            if (w < 2 || h < 2) {
                w = window.localImagePreview.naturalWidth;
                h = window.localImagePreview.naturalHeight;
            }

            window.displayedImgWidth = w;
            window.displayedImgHeight = h;

            // try to keep the cropping rectangle at the same aspect ratio
            const targetRatio = window.aspectRatio;
            const displayedRatio = w / h;
            let desiredW, desiredH;

            if (targetRatio > displayedRatio) {
                desiredW = w;
                desiredH = Math.floor(desiredW / targetRatio);
                if (desiredH > h) {
                    desiredH = h;
                    desiredW = Math.floor(desiredH * targetRatio);
                }
            } else {
                desiredH = h;
                desiredW = Math.floor(desiredH * targetRatio);
                if (desiredW > w) {
                    desiredW = w;
                    desiredH = Math.floor(desiredW / targetRatio);
                }
            }

            window.rectW = desiredW;
            window.rectH = desiredH;
            window.rectX = Math.floor((w - desiredW) / 2);
            window.rectY = Math.floor((h - desiredH) / 2);

            updateCropRect();
        };
    }

    // [ADDED] Trigger file input on button click
    if (window.refOpenFileBtn && window.refFileInput) {
        window.refOpenFileBtn.addEventListener("click", () => {
            window.refFileInput.click();
        });
    }

    // [ADDED] Whenever the hidden input changes, upload references
    if (window.refFileInput) {
        window.refFileInput.addEventListener("change", handleUploadReferenceFiles);
    }

    // edit modal
    const editModalCancel = document.getElementById("edit-modal-cancel");
    if (editModalCancel) {
        editModalCancel.addEventListener("click", () => {
            closeEditModal();
        });
    }
    const editModalConfirm = document.getElementById("edit-modal-confirm");
    if (editModalConfirm) {
        editModalConfirm.addEventListener("click", async () => {
            // Close modal immediately
            closeEditModal();

            // Attempt edit in up to 5 tries
            if (window.currentEditSceneIndex !== null) {
                await doEditSceneImage(window.currentEditSceneIndex, 1);
            }
        });
    }
});

// Reference images local array
window.referenceImagesLocal = [];  // { filename, url, selected: bool }

async function handleUploadReferenceFiles() {
    // If no files, do nothing
    if (!window.refFileInput.files.length) return;
    if (!window.currentJobId) {
        alert("No active job. Please upload audio first.");
        // Clear the file input to avoid re-triggering
        window.refFileInput.value = "";
        return;
    }
    disableAllImageButtons();
    window.isGeneratingImage = true;

    const fileList = Array.from(window.refFileInput.files);
    for (let f of fileList) {
        const formData = new FormData();
        formData.append("job_id", window.currentJobId);
        formData.append("reference_file", f);
        try {
            const resp = await fetch("/upload-reference-image", {
                method: "POST",
                body: formData
            });
            const data = await resp.json();
            if (data.error) {
                console.error("Error uploading reference:", data.error);
                continue;
            }
            // store 'selected: true' by default
            window.referenceImagesLocal.push({
                filename: data.reference_path,
                url: URL.createObjectURL(f),
                selected: true
            });
            updateReferenceFilesList();
        } catch (err) {
            console.error("Error uploading reference file:", err);
        }
    }
    // Clear file input
    window.refFileInput.value = "";
    window.isGeneratingImage = false;
    enableAllImageButtons();
}

function updateReferenceFilesList() {
    const listEl = document.getElementById("reference-files-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    window.referenceImagesLocal.forEach((ref, index) => {
        const img = document.createElement("img");
        img.src = ref.url;
        img.className = "ref-thumb";

        if (ref.selected) {
            img.classList.add("selected");
        } else {
            img.classList.add("unselected");
        }

        // Toggle selection on click
        img.addEventListener("click", () => {
            ref.selected = !ref.selected;
            if (ref.selected) {
                img.classList.remove("unselected");
                img.classList.add("selected");
            } else {
                img.classList.remove("selected");
                img.classList.add("unselected");
            }
        });

        // [CHANGED] Add delayed preview (300ms)
        let hoverTimer = null;
        img.addEventListener("mouseenter", () => {
            hoverTimer = setTimeout(() => {
                showReferencePreview(ref.url);
            }, 300); // CHANGED from 500 to 300
        });
        img.addEventListener("mouseleave", () => {
            if (hoverTimer) {
                clearTimeout(hoverTimer);
                hoverTimer = null;
            }
            hideReferencePreview();
        });

        listEl.appendChild(img);
    });
}

// Show the full-screen overlay in center
function showReferencePreview(imageUrl) {
    console.log('triggered');
    const previewEl = document.getElementById("reference-hover-preview");
    const previewImg = document.getElementById("reference-hover-preview-img");
    if (!previewEl || !previewImg) return;

    previewImg.src = imageUrl;
    previewEl.style.display = "flex";
}

function hideReferencePreview() {
    const previewEl = document.getElementById("reference-hover-preview");
    if (!previewEl) return;
    previewEl.style.display = "none";
}

function handleSelectLocalImage(sceneIndex) {
    if (window.isGeneratingImage) return;
    window.localImageSceneIndex = sceneIndex;

    const [twStr, thStr] = window.videoSizeSelect.value.split('x');
    const tw = parseInt(twStr, 10) || 1920;
    const th = parseInt(thStr, 10) || 1080;
    window.aspectRatio = tw / th;

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';

    fileInput.onchange = () => {
        if (!fileInput.files || !fileInput.files.length) return;
        window.originalFile = fileInput.files[0];
        if (!window.originalFile) return;

        localImageCropModal.style.display = 'flex';

        window.rectX = 0;
        window.rectY = 0;
        window.rectW = 100;
        window.rectH = 100;
        window.dragging = false;
        window.dragOffsetX = 0;
        window.dragOffsetY = 0;

        const reader = new FileReader();
        reader.onload = ev => {
            if (localImagePreview) {
                localImagePreview.src = ev.target.result;
            }
        };
        reader.readAsDataURL(window.originalFile);
    };
    fileInput.click();
}

async function handleGenerateImage(sceneIndex, textArea, imgEl, regenBtn, attempt = 1) {
    if (attempt === 1) {
        if (window.isGeneratingImage) return;
        window.isGeneratingImage = true;
    }

    regenBtn.textContent = `Generating... (# ${attempt})`;
    disableAllImageButtons();

    // Only include selected references
    let refs = window.referenceImagesLocal
        .filter(r => r.selected)
        .map(r => r.filename);

    const [twStr, thStr] = window.videoSizeSelect.value.split('x');
    const tw = parseInt(twStr, 10) || 1920;
    const th = parseInt(thStr, 10) || 1080;
    window.aspectRatio = tw / th;

    try {
        const resp = await fetch('/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                job_id: window.currentJobId,
                scene_index: sceneIndex,
                new_prompt: textArea.value,
                mode: "normal",
                references: refs
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
        }
        imgEl.src = dataImg.image_url + "?t=" + Date.now();

        if (!window.sceneGenerated[sceneIndex]) {
            window.sceneGenerated[sceneIndex] = true;
            window.imagesGenerated++;
        }
        regenBtn.textContent = 'Regenerate';

        // show Edit button
        const sceneCard = document.getElementById(`scene-card-${sceneIndex}`);
        if (sceneCard) {
            const editBtn = sceneCard.querySelector('.edit-btn');
            if (editBtn) {
                editBtn.disabled = false;
                editBtn.style.display = 'inline-block';
            }
        }

        // Crop
        await openCropModalFromURL(dataImg.image_url, sceneIndex);

        if (window.imagesGenerated >= window.totalScenes) {
            window.generateVideoBtn.disabled = false;
        }
    } catch (err) {
        console.error("[DEBUG] fetch error in handleGenerateImage:", err);
        if (attempt < 5) {
            await handleGenerateImage(sceneIndex, textArea, imgEl, regenBtn, attempt + 1);
        } else {
            regenBtn.disabled = false;
            regenBtn.textContent = 'Generate';
            window.isGeneratingImage = false;
            enableAllImageButtons();
        }
    }
}

function handleEditSceneImage(sceneIndex) {
    // Open the edit modal
    window.currentEditSceneIndex = sceneIndex;
    const editModal = document.getElementById("edit-image-modal");
    if (editModal) {
        editModal.style.display = "flex";
    }
    const editTextarea = document.getElementById("edit-modal-textarea");
    if (editTextarea) {
        // fill with the existing prompt for convenience
        const sceneCard = document.getElementById(`scene-card-${sceneIndex}`);
        if (sceneCard) {
            const promptArea = sceneCard.querySelector('.tab-content-prompt textarea');
            if (promptArea) {
                editTextarea.value = promptArea.value;
            }
        }
    }
}

function closeEditModal() {
    const editModal = document.getElementById("edit-image-modal");
    if (editModal) {
        editModal.style.display = "none";
    }
    // We'll set currentEditSceneIndex = null only after we finish attempts
}

async function doEditSceneImage(sceneIndex, attempt) {
    if (!window.currentJobId) return;
    if (window.isGeneratingImage && attempt === 1) return;

    window.isGeneratingImage = true;
    disableAllImageButtons();

    const sceneCard = document.getElementById(`scene-card-${sceneIndex}`);
    const editBtn = sceneCard ? sceneCard.querySelector('.edit-btn') : null;
    if (editBtn) {
        editBtn.disabled = true;
        editBtn.textContent = `Editing... (# ${attempt})`;
    }

    const editTextarea = document.getElementById("edit-modal-textarea");
    const newEditPrompt = editTextarea ? editTextarea.value : "Fix this image";

    const [twStr, thStr] = window.videoSizeSelect.value.split('x');
    const tw = parseInt(twStr, 10) || 1920;
    const th = parseInt(thStr, 10) || 1080;
    window.aspectRatio = tw / th;

    try {
        // We'll call the same /generate-image route with mode="edit_single"
        const resp = await fetch('/generate-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                job_id: window.currentJobId,
                scene_index: sceneIndex,
                new_prompt: newEditPrompt,
                mode: "edit_single",
                references: []
            })
        });
        const dataImg = await resp.json();
        if (dataImg.error) {
            console.error("[DEBUG] edit-image error:", dataImg.error);
            if (attempt < 5) {
                await doEditSceneImage(sceneIndex, attempt + 1);
                return;
            } else {
                if (editBtn) {
                    editBtn.textContent = "Edit";
                    editBtn.disabled = false;
                }
                window.isGeneratingImage = false;
                enableAllImageButtons();
                return;
            }
        }
        // Successfully got an image
        if (sceneCard) {
            const imgEl = sceneCard.querySelector('figure img');
            if (imgEl) {
                imgEl.src = dataImg.image_url + "?t=" + Date.now();
            }
        }

        // now open crop
        await openCropModalFromURL(dataImg.image_url, sceneIndex);

        // We can revert the button text to "Edit"
        if (editBtn) {
            editBtn.textContent = "Edit";
            editBtn.disabled = false;
        }
    } catch (err) {
        console.error("[DEBUG] confirmEditScene error:", err);
        // If it fails, we can attempt again
        if (attempt < 5) {
            await doEditSceneImage(sceneIndex, attempt + 1);
            return;
        } else {
            alert("Error editing scene image");
        }
    }

    window.currentEditSceneIndex = null;
    window.isGeneratingImage = false;
    enableAllImageButtons();
}

async function openCropModalFromURL(imageUrl, sceneIndex) {
    try {
        const blob = await fetch(imageUrl).then(r => r.blob());
        const file = new File([blob], `scene_${sceneIndex}_ai.png`, { type: blob.type });

        window.localImageSceneIndex = sceneIndex;
        window.originalFile = file;

        localImageCropModal.style.display = 'flex';
        window.rectX = 0;
        window.rectY = 0;
        window.rectW = 100;
        window.rectH = 100;
        window.dragging = false;
        window.dragOffsetX = 0;
        window.dragOffsetY = 0;

        const reader = new FileReader();
        reader.onload = ev => {
            if (localImagePreview) {
                localImagePreview.src = ev.target.result;
            }
        };
        reader.readAsDataURL(file);
    } catch (err) {
        console.error("[DEBUG] error openCropModalFromURL:", err);
        window.isGeneratingImage = false;
        enableAllImageButtons();
    }
}

async function doCropConfirm() {
    if (!window.originalFile) {
        localImageCropModal.style.display = 'none';
        window.isGeneratingImage = false;
        enableAllImageButtons();
        return;
    }

    const sceneIndex = window.localImageSceneIndex;
    const formData = new FormData();
    formData.append('job_id', window.currentJobId);
    formData.append('scene_index', sceneIndex);
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
            alert(data.error);
            window.isGeneratingImage = false;
            enableAllImageButtons();
            localImageCropModal.style.display = 'none';
            return;
        }
        const sceneCard = document.getElementById(`scene-card-${sceneIndex}`);
        if (sceneCard) {
            const figureEl = sceneCard.querySelector('figure img');
            figureEl.src = data.image_url + '?t=' + Date.now();
        }
        if (!window.sceneGenerated[sceneIndex]) {
            window.sceneGenerated[sceneIndex] = true;
            window.imagesGenerated++;
        }
        if (window.imagesGenerated >= window.totalScenes) {
            window.generateVideoBtn.disabled = false;
        }
    } catch (err) {
        console.error("[DEBUG] error uploading local image crop:", err);
        alert("Error uploading/cropping image");
    }

    window.isGeneratingImage = false;
    enableAllImageButtons();
    localImageCropModal.style.display = 'none';
}
