// image-handling.js
// Manages AI image generation/edit, local image cropping, and references logic

document.addEventListener('DOMContentLoaded', function() {
    // Single "Add reference images" button now:
    window.refFileInput = document.getElementById("reference-file-input");
    window.refOpenFileBtn = document.getElementById("reference-open-file-btn");

    if (cropConfirmBtn) {
        cropConfirmBtn.addEventListener('click', doCropConfirm);
    }

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

    if (window.refOpenFileBtn && window.refFileInput) {
        window.refOpenFileBtn.addEventListener("click", () => {
            window.refFileInput.click();
        });
    }
    if (window.refFileInput) {
        window.refFileInput.addEventListener("change", handleUploadReferenceFiles);
    }

    // Edit modal
    const editModalCancel = document.getElementById("edit-modal-cancel");
    if (editModalCancel) {
        editModalCancel.addEventListener("click", () => {
            closeEditModal();
        });
    }
    const editModalConfirm = document.getElementById("edit-modal-confirm");
    if (editModalConfirm) {
        editModalConfirm.addEventListener("click", async () => {
            closeEditModal();
            if (window.currentEditSceneIndex !== null) {
                // scene edit
                await doEditSceneImage(window.currentEditSceneIndex, 1);
            } else if (window.currentEditRefImageEl) {
                // reference edit
                await doEditReferenceImage(window.currentEditRefImageEl, 1);
            }
        });
    }

    const referenceDiscardBtn = document.getElementById("reference-discard-btn");
    if (referenceDiscardBtn) {
        referenceDiscardBtn.addEventListener("click", () => {
            hideReferenceImageModal();
        });
    }

    const referenceAddBtn = document.getElementById("reference-add-btn");
    if (referenceAddBtn) {
        referenceAddBtn.addEventListener("click", () => {
            const refImg = document.getElementById("reference-image-modal-img");
            if (refImg) {
                const fullsrc = refImg.getAttribute("data-fullsrc") || refImg.src;
                addReference(fullsrc);
            }
            hideReferenceImageModal();
        });
    }
});

/** Unified approach to open the "Edit Image" modal for a reference image */
window.handleEditReferenceImage = function(imgEl) {
    window.currentEditSceneIndex = null; // reset
    window.currentEditRefImageEl = imgEl;

    const editModal = document.getElementById("edit-image-modal");
    if (editModal) {
        const editTextarea = document.getElementById("edit-modal-textarea");
        if (editTextarea) {
            editTextarea.value = ""; // always blank for reference edits
        }
        editModal.style.display = "flex";
    }
};

/** Scenes: "Edit" button => open modal with blank text area */
window.handleEditSceneImage = function(sceneIndex) {
    window.currentEditSceneIndex = sceneIndex;
    window.currentEditRefImageEl = null; // reset

    const editModal = document.getElementById("edit-image-modal");
    if (editModal) {
        const editTextarea = document.getElementById("edit-modal-textarea");
        if (editTextarea) {
            editTextarea.value = ""; // always blank for scene edits
        }
        editModal.style.display = "flex";
    }
};

/** Closes the "Edit Image" modal */
function closeEditModal() {
    const editModal = document.getElementById("edit-image-modal");
    if (editModal) {
        editModal.style.display = "none";
    }
}

/** Actually call the edit API for a reference image */
async function doEditReferenceImage(imgEl, attempt = 1) {
    if (!window.currentJobId) return;
    if (window.isGeneratingImage && attempt === 1) return;

    window.isGeneratingImage = true;
    buttonsManager.handleAction('start_generation');

    const referenceCard = document.getElementById(`reference-generator-card`);
    const editBtn = referenceCard ? referenceCard.querySelector('.edit-btn') : null;
    if (editBtn) {
        editBtn.disabled = true;
        editBtn.textContent = `Editing... (# ${attempt})`;
    }

    const editTextarea = document.getElementById("edit-modal-textarea");
    let newEditPrompt = editTextarea ? editTextarea.value : "";
    if (!newEditPrompt.trim()) {
        newEditPrompt = "Refine this reference image";
    }

    const srcNoQ = imgEl.src.split("?")[0];
    const relativePath = srcNoQ.replace(/^.*\/static\//, "");
    const oldRefFilename = relativePath.split("/").pop();

    try {
        const resp = await fetch("/generate-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                job_id: window.currentJobId,
                scene_index: 0,
                new_prompt: newEditPrompt,
                mode: "edit_reference_card",
                references: [oldRefFilename]
            })
        });
        const dataImg = await resp.json();
        if (dataImg.error) {
            console.error("Error editing reference:", dataImg.error);
            if (attempt < 5) {
                await doEditReferenceImage(imgEl, attempt + 1);
            } else if (editBtn) {
                editBtn.textContent = "Edit";
                editBtn.disabled = false;
            }
            window.isGeneratingImage = false;
            buttonsManager.handleAction('finish_generation');
            return;
        }
        imgEl.src = dataImg.image_url + "?t=" + Date.now();

        // Show the "add to references" modal with the newly edited image
        showReferenceImageModal(dataImg.image_url);

        if (editBtn) {
            editBtn.textContent = "Edit";
            editBtn.disabled = false;
        }

    } catch (err) {
        console.error("Network error editing reference:", err);
        if (attempt < 5) {
            await doEditReferenceImage(imgEl, attempt + 1);
        } else if (editBtn) {
            editBtn.textContent = "Edit";
            editBtn.disabled = false;
        }
    } finally {
        window.isGeneratingImage = false;
        buttonsManager.handleAction('finish_generation');
        window.currentEditRefImageEl = null;
    }
}

/** Actually call the edit API for a scene image */
async function doEditSceneImage(sceneIndex, attempt) {
    if (!window.currentJobId) return;
    if (window.isGeneratingImage && attempt === 1) return;

    window.isGeneratingImage = true;
    buttonsManager.handleAction('start_generation');

    const sceneCard = document.getElementById(`scene-card-${sceneIndex}`);
    const editBtn = sceneCard ? sceneCard.querySelector('.edit-btn') : null;
    if (editBtn) {
        editBtn.disabled = true;
        editBtn.textContent = `Editing... (# ${attempt})`;
    }

    const editTextarea = document.getElementById("edit-modal-textarea");
    let newEditPrompt = editTextarea ? editTextarea.value : "";
    if (!newEditPrompt.trim()) {
        newEditPrompt = "Fix this image";
    }

    let refs = [`scene_${sceneIndex}.png`];

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
                new_prompt: newEditPrompt,
                mode: "edit_single",
                references: refs
            })
        });
        const dataImg = await resp.json();
        if (dataImg.error) {
            console.error("[DEBUG] edit-image error:", dataImg.error);
            if (attempt < 5) {
                await doEditSceneImage(sceneIndex, attempt + 1);
            } else if (editBtn) {
                editBtn.textContent = "Edit";
                editBtn.disabled = false;
            }
            window.isGeneratingImage = false;
            buttonsManager.handleAction('finish_generation');
            return;
        }
        // updated scene image
        if (sceneCard) {
            const imgEl = sceneCard.querySelector('figure img');
            if (imgEl) {
                imgEl.src = dataImg.image_url + "?t=" + Date.now();
            }
        }

        // Automatically add the old replaced image to references if it exists
        if (dataImg.unused_old_image) {
            await addReference(dataImg.unused_old_image);
        }

        // Open the cropping modal so user can recrop the newly edited scene
        await openCropModalFromURL(dataImg.image_url, sceneIndex);

        if (editBtn) {
            editBtn.textContent = "Edit";
            editBtn.disabled = false;
        }
    } catch (err) {
        console.error("[DEBUG] confirmEditScene error:", err);
        if (attempt < 5) {
            await doEditSceneImage(sceneIndex, attempt + 1);
        } else {
            alert("Error editing scene image");
        }
    }

    window.currentEditSceneIndex = null;
    window.isGeneratingImage = false;
    buttonsManager.handleAction('finish_generation');
}

/**
 * Adds a reference path to job data and local referenceImagesLocal[].
 */
async function addReference(refPath) {
    if (!window.currentJobId) return;
    const body = { job_id: window.currentJobId, ref_path: refPath };
    try {
        await fetch("/add-reference", {
            method: "POST",
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        const isDefault = refPath.startsWith("/static/default-reference-images/");
        if (isDefault) {
            let alreadyIn = referenceImagesLocal.find(r => r.filename === refPath);
            if (!alreadyIn) {
                referenceImagesLocal.push({
                    filename: refPath,
                    url: refPath,
                    selected: true
                });
            }
        } else {
            const bname = refPath.split("/").pop();
            let alreadyIn = referenceImagesLocal.find(r => r.filename === bname);
            if (!alreadyIn) {
                let finalURL = refPath;
                if (!finalURL.startsWith("/static/")) {
                    finalURL = "/static/" + window.currentJobId + "/images/" + bname;
                }
                referenceImagesLocal.push({
                    filename: bname,
                    url: finalURL,
                    selected: true
                });
            }
        }
        updateReferenceFilesList();
    } catch (err) {
        console.warn("Could not add reference to job data:", err);
    }
}

/**
 * Upload new reference images to the job.
 */
async function handleUploadReferenceFiles() {
    if (!window.refFileInput.files.length) return;
    if (!window.currentJobId) {
        alert("No active job. Please upload audio first.");
        window.refFileInput.value = "";
        return;
    }
    buttonsManager.handleAction('start_generation');
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
            const finalURL = `/static/projects/${window.currentJobId}/images/${data.reference_path}`;
            referenceImagesLocal.push({
                filename: data.reference_path,
                url: finalURL,
                selected: true
            });
            updateReferenceFilesList();
        } catch (err) {
            console.error("Error uploading reference file:", err);
        }
    }
    window.refFileInput.value = "";
    window.isGeneratingImage = false;
    buttonsManager.handleAction('finish_generation');
}

/**
 * Refresh the reference thumbnails list
 */
function updateReferenceFilesList() {
    const listEl = document.getElementById("reference-files-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    referenceImagesLocal.forEach(ref => {
        const img = document.createElement("img");
        img.src = ref.url;
        img.className = "ref-thumb";

        if (ref.selected) {
            img.classList.add("selected");
        } else {
            img.classList.remove("selected");
            img.classList.add("unselected");
        }

        // Toggle selection
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

        let hoverTimer = null;
        img.addEventListener("mouseenter", () => {
            hoverTimer = setTimeout(() => {
                showReferencePreview(ref.url);
            }, 300);
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

function showReferencePreview(imageUrl) {
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

/**
 * Scene logic: pick local image => crop => place in scene
 */
window.handleSelectLocalImage = function(sceneIndex) {
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
};

/**
 * Generate a new AI image for the scene
 */
window.handleGenerateImage = async function(sceneIndex, textArea, imgEl, regenBtn, attempt = 1) {
    if (attempt === 1) {
        if (window.isGeneratingImage) return;
        window.isGeneratingImage = true;
    }

    regenBtn.textContent = `Generating... (# ${attempt})`;
    buttonsManager.handleAction('start_generation');

    let refs = referenceImagesLocal
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
            } else {
                regenBtn.disabled = false;
                regenBtn.textContent = 'Generate';
            }
            window.isGeneratingImage = false;
            buttonsManager.handleAction('finish_generation');
            return;
        }
        imgEl.src = dataImg.image_url + "?t=" + Date.now();

        if (!sceneGenerated[sceneIndex]) {
            sceneGenerated[sceneIndex] = true;
            imagesGenerated++;
        }
        regenBtn.textContent = 'Regenerate';

        // Once the image is loaded for this scene, enable the "Edit" button for the card
        const sceneCard = document.getElementById(`scene-card-${sceneIndex}`);
        if (sceneCard) {
            buttonsManager.handleAction('image_loaded', sceneCard);
        }

        // Let user immediately crop
        await openCropModalFromURL(dataImg.image_url, sceneIndex);

        if (imagesGenerated >= totalScenes) {
            generateVideoBtn.disabled = false;
        }
    } catch (err) {
        console.error("[DEBUG] fetch error in handleGenerateImage:", err);
        if (attempt < 5) {
            await handleGenerateImage(sceneIndex, textArea, imgEl, regenBtn, attempt + 1);
        } else {
            regenBtn.disabled = false;
            regenBtn.textContent = 'Generate';
        }
    }

    window.isGeneratingImage = false;
    buttonsManager.handleAction('finish_generation');
};

/**
 * Loads an AI-generated image => open crop UI
 */
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
        buttonsManager.handleAction('finish_generation');
    }
}

/**
 * Crop confirm => /upload-local-image => update scene
 * If "crop-add-ref" is checked, add either old replaced or new final to references.
 */
async function doCropConfirm() {
    if (!window.originalFile) {
        localImageCropModal.style.display = 'none';
        window.isGeneratingImage = false;
        buttonsManager.handleAction('finish_generation');
        return;
    }

    const sceneIndex = window.localImageSceneIndex;
    const formData = new FormData();
    formData.append('job_id', window.currentJobId);
    formData.append('mode', 'scene');

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
            buttonsManager.handleAction('finish_generation');
            localImageCropModal.style.display = 'none';
            return;
        }
        const sceneCard = document.getElementById(`scene-card-${sceneIndex}`);
        if (sceneCard) {
            const figureEl = sceneCard.querySelector('figure img');
            figureEl.src = data.image_url + '?t=' + Date.now();
        }
        if (!sceneGenerated[sceneIndex]) {
            sceneGenerated[sceneIndex] = true;
            imagesGenerated++;
        }
        if (imagesGenerated >= totalScenes) {
            generateVideoBtn.disabled = false;
        }

        const addRefCheckbox = document.getElementById('crop-add-ref');
        if (addRefCheckbox && addRefCheckbox.checked) {
            // If we replaced an existing scene, data.unused_old_image might exist,
            // but with mode=scene_local, that rename logic is skipped,
            // so it should be null. We add the new final image to references.
            if (data.unused_old_image) {
                await addReference(data.unused_old_image);
            } else {
                await addReference(data.image_url);
            }
        }
    } catch (err) {
        console.error("[DEBUG] error uploading local image crop:", err);
        alert("Error uploading/cropping image");
    }

    window.isGeneratingImage = false;
    buttonsManager.handleAction('finish_generation');
    localImageCropModal.style.display = 'none';
}

/**
 * Show the reference image in a modal => user can discard or add
 */
function showReferenceImageModal(imageUrl) {
    const mod = document.getElementById("reference-image-modal");
    const img = document.getElementById("reference-image-modal-img");
    if (!mod || !img) return;

    img.src = imageUrl;
    // remove ?t=... so we have a stable path
    img.setAttribute("data-fullsrc", imageUrl.replace(/\?t=\d+$/, ""));
    mod.style.display = "flex";
}

/**
 * Hide the reference image modal
 */
function hideReferenceImageModal() {
    const mod = document.getElementById("reference-image-modal");
    if (mod) mod.style.display = "none";
}

/**
 * "Generate Reference" => produce a new reference card image
 */
window.handleGenerateReferenceCardImage = async function(textArea, imgEl, button, editBtn, attempt = 1) {
    if (attempt === 1) {
        if (window.isGeneratingImage) return;
        window.isGeneratingImage = true;
    }

    button.textContent = `Generating... (# ${attempt})`;
    buttonsManager.handleAction('start_generation');

    let refs = referenceImagesLocal
        .filter(r => r.selected)
        .map(r => r.filename);

    try {
        const resp = await fetch("/generate-image", {
            method: "POST",
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                job_id: window.currentJobId,
                scene_index: 0,
                new_prompt: textArea.value,
                mode: "reference_card",
                references: refs
            })
        });
        const dataImg = await resp.json();
        if (dataImg.error) {
            console.error("[DEBUG] reference_card generate error:", dataImg.error);
            if (attempt < 5) {
                await handleGenerateReferenceCardImage(textArea, imgEl, button, editBtn, attempt + 1);
            } else {
                button.disabled = false;
                button.textContent = 'Generate';
            }
            window.isGeneratingImage = false;
            buttonsManager.handleAction('finish_generation');
            return;
        }
        imgEl.src = dataImg.image_url + "?t=" + Date.now();

        // Show the reference image modal => user can discard or add
        showReferenceImageModal(dataImg.image_url);

        editBtn.style.display = 'inline-block';
        editBtn.disabled = false;

        button.textContent = 'Generate';
    } catch (err) {
        console.error("[DEBUG] error in handleGenerateReferenceCardImage:", err);
        if (attempt < 5) {
            await handleGenerateReferenceCardImage(textArea, imgEl, button, editBtn, attempt + 1);
        } else {
            button.disabled = false;
            button.textContent = 'Generate';
        }
    }

    window.isGeneratingImage = false;
    buttonsManager.handleAction('finish_generation');
};

/**
 * "Select local file" to replace a reference card
 */
window.handleSelectLocalReferenceImage = function(imgEl, editRefBtn) {
    if (window.isGeneratingImage) return;
    buttonsManager.handleAction('start_generation');
    window.isGeneratingImage = true;

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';

    fileInput.onchange = async () => {
        if (!fileInput.files || !fileInput.files.length) {
            window.isGeneratingImage = false;
            buttonsManager.handleAction('finish_generation');
            return;
        }
        const localFile = fileInput.files[0];
        if (!localFile) {
            window.isGeneratingImage = false;
            buttonsManager.handleAction('finish_generation');
            return;
        }

        // We'll re-use upload-local-image with mode=reference_card to store it
        const formData = new FormData();
        formData.append('job_id', window.currentJobId);
        formData.append('scene_index', '0');
        formData.append('mode', 'reference_card');
        formData.append('image_file', localFile);

        try {
            const resp = await fetch('/upload-local-image', {
                method: 'POST',
                body: formData
            });
            const data = await resp.json();
            if (data.error) {
                alert(data.error);
                window.isGeneratingImage = false;
                buttonsManager.handleAction('finish_generation');
                return;
            }
            imgEl.src = data.image_url + "?t=" + Date.now();
            showReferenceImageModal(data.image_url);

            editRefBtn.style.display = 'inline-block';
            editRefBtn.disabled = false;
        } catch (err) {
            console.error("Error uploading local reference image:", err);
        }

        window.isGeneratingImage = false;
        buttonsManager.handleAction('finish_generation');
    };
    fileInput.click();
};

function updateCropRect() {
    if (!cropRect) return;
    cropRect.style.left = window.rectX + 'px';
    cropRect.style.top = window.rectY + 'px';
    cropRect.style.width = window.rectW + 'px';
    cropRect.style.height = window.rectH + 'px';
}
