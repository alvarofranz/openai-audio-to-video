// Manages AI image generation/edit, local image cropping, and references logic

document.addEventListener('DOMContentLoaded', function() {
    // Single "Add reference images" button now:
    window.refFileInput = document.getElementById("reference-file-input");
    window.refOpenFileBtn = document.getElementById("reference-open-file-btn");
    window.opacitySlider = document.getElementById("overlay-opacity-slider");
    window.opacityValue = document.getElementById("overlay-opacity-value");

    // Setup overlay opacity controls
    if (window.opacitySlider) {
        window.opacitySlider.addEventListener("input", function() {
            if (window.opacityValue) {
                window.opacityValue.textContent = opacitySlider.value + "%";
            }
            window.overlayOpacity = parseInt(opacitySlider.value, 10);
        });
    }

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

/** Scenes: "Overlay" button => crop, then merges with existing scene */
window.overlayInProgress = false;
window.overlayOpacity = 85;

window.handleOverlayImage = function(sceneIndex) {
    if (window.isGeneratingImage) return;
    const sceneCard = document.getElementById(`scene-card-${sceneIndex}`);
    const imgEl = sceneCard ? sceneCard.querySelector('figure img') : null;
    if (!imgEl || !imgEl.src || imgEl.src.endsWith("placeholder.png")) {
        return;
    }
    window.overlayInProgress = true;
    window.localImageSceneIndex = sceneIndex;

    // Hide the "Add original to references" label
    const addRefLabel = document.getElementById('crop-add-ref-label');
    if (addRefLabel) {
        addRefLabel.style.display = 'none';
    }

    // Show the opacity controls for overlay mode
    const opacityControls = document.getElementById("overlay-opacity-controls");
    if (opacityControls) {
        opacityControls.style.display = "flex";
    }

    if (window.opacitySlider) {
        window.opacitySlider.value = window.overlayOpacity;
    }
    if (window.opacityValue) {
        window.opacityValue.textContent = window.overlayOpacity + "%";
    }

    const [twStr, thStr] = window.videoSizeSelect.value.split('x');
    const tw = parseInt(twStr, 10) || 1920;
    const th = parseInt(thStr, 10) || 1080;
    window.aspectRatio = tw / th;

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';
    fileInput.onchange = () => {
        if (!fileInput.files || !fileInput.files.length) {
            window.overlayInProgress = false;
            return;
        }
        window.originalFile = fileInput.files[0];
        if (!window.originalFile) {
            window.overlayInProgress = false;
            return;
        }

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

function closeEditModal() {
    const editModal = document.getElementById("edit-image-modal");
    if (editModal) {
        editModal.style.display = "none";
    }
}

async function processImageResponse(response, sceneCard, editBtn) {
    const data = await response.json();
    if (data.error) {
        console.error("Error processing image:", data.error);
        return { success: false, data };
    }

    if (sceneCard) {
        const imgEl = sceneCard.querySelector('figure img');
        if (imgEl) {
            imgEl.src = data.image_url + "?t=" + Date.now();
        }
    }

    if (editBtn) {
        editBtn.textContent = "Edit";
        editBtn.disabled = false;
    }

    return { success: true, data };
}

/** Reference editing */
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

        const result = await processImageResponse(resp, null, editBtn);
        if (!result.success) {
            if (attempt < 5) {
                await doEditReferenceImage(imgEl, attempt + 1);
            }
            window.isGeneratingImage = false;
            buttonsManager.handleAction('finish_generation');
            return;
        }

        imgEl.src = result.data.image_url + "?t=" + Date.now();
        showReferenceImageModal(result.data.image_url);

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

window.handleEditReferenceImage = function(imgEl) {
    window.currentEditSceneIndex = null;
    window.currentEditRefImageEl = imgEl;

    const editModal = document.getElementById("edit-image-modal");
    if (editModal) {
        const editTextarea = document.getElementById("edit-modal-textarea");
        if (editTextarea) {
            editTextarea.value = "";
        }
        editModal.style.display = "flex";
    }
};

/** Scenes: "Edit" button => open modal */
window.handleEditSceneImage = function(sceneIndex) {
    window.currentEditSceneIndex = sceneIndex;
    window.currentEditRefImageEl = null;

    const editModal = document.getElementById("edit-image-modal");
    if (editModal) {
        const editTextarea = document.getElementById("edit-modal-textarea");
        if (editTextarea) {
            editTextarea.value = "";
        }
        editModal.style.display = "flex";
    }
};

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

        const result = await processImageResponse(resp, sceneCard, editBtn);
        if (!result.success) {
            if (attempt < 5) {
                await doEditSceneImage(sceneIndex, attempt + 1);
            }
            window.isGeneratingImage = false;
            buttonsManager.handleAction('finish_generation');
            return;
        }

        // If the old scene was replaced, add it to references
        if (result.data.unused_old_image) {
            await addReference(result.data.unused_old_image);
        }

        await openCropModalFromURL(result.data.image_url, sceneIndex);

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

/** Add path to references & local list */
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
                    // Build the local path to the job's images
                    finalURL = "/static/projects/" + window.currentJobId + "/images/" + bname;
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

/** Upload new reference images to job */
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

/** Update reference thumbnails list */
function updateReferenceFilesList() {
    const listEl = document.getElementById("reference-files-list");
    if (!listEl) return;
    listEl.innerHTML = "";

    referenceImagesLocal.forEach((ref, idx) => {
        const wrapper = document.createElement("div");
        wrapper.className = "ref-item-wrapper";

        const removeBtn = document.createElement("div");
        removeBtn.className = "ref-remove-btn";
        removeBtn.textContent = "X";
        removeBtn.addEventListener("click", () => {
            referenceImagesLocal.splice(idx, 1);
            updateReferenceFilesList();
        });
        wrapper.appendChild(removeBtn);

        const img = document.createElement("img");
        img.src = ref.url;
        img.className = "ref-thumb";

        if (ref.selected) {
            img.classList.remove("unselected");
            img.classList.add("selected");
        } else {
            img.classList.remove("selected");
            img.classList.add("unselected");
        }

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

        wrapper.appendChild(img);
        listEl.appendChild(wrapper);
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

/** Normal scene image selection => crop => etc */
window.handleSelectLocalImage = function(sceneIndex) {
    if (window.isGeneratingImage) return;
    window.localImageSceneIndex = sceneIndex;
    window.overlayInProgress = false;

    // Show the "Add original to references" label
    const addRefLabel = document.getElementById('crop-add-ref-label');
    if (addRefLabel) {
        addRefLabel.style.display = 'inline-block';
    }

    // Hide the overlay opacity controls
    const opacityControls = document.getElementById("overlay-opacity-controls");
    if (opacityControls) {
        opacityControls.style.display = "none";
    }

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

        const result = await processImageResponse(resp,
            document.getElementById(`scene-card-${sceneIndex}`),
            regenBtn
        );
        if (!result.success) {
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

        imgEl.src = result.data.image_url + "?t=" + Date.now();

        if (!sceneGenerated[sceneIndex]) {
            sceneGenerated[sceneIndex] = true;
            imagesGenerated++;
        }
        regenBtn.textContent = 'Regenerate';

        const sceneCard = document.getElementById(`scene-card-${sceneIndex}`);
        if (sceneCard) {
            buttonsManager.handleAction('image_loaded', sceneCard);
            const overlayBtn = sceneCard.querySelector('.overlay-btn');
            if (overlayBtn) {
                overlayBtn.disabled = false;
                overlayBtn.style.display = 'inline-block';
            }
        }

        await openCropModalFromURL(result.data.image_url, sceneIndex);

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

async function openCropModalFromURL(imageUrl, sceneIndex) {
    try {
        const blob = await fetch(imageUrl).then(r => r.blob());
        const file = new File([blob], `scene_${sceneIndex}_ai.png`, { type: blob.type });

        window.localImageSceneIndex = sceneIndex;
        window.originalFile = file;
        window.overlayInProgress = false;

        // Show "Add original to references"
        const addRefLabel = document.getElementById('crop-add-ref-label');
        if (addRefLabel) {
            addRefLabel.style.display = 'inline-block';
        }

        const opacityControls = document.getElementById("overlay-opacity-controls");
        if (opacityControls) {
            opacityControls.style.display = "none";
        }

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

async function doCropConfirm() {
    if (!window.originalFile) {
        localImageCropModal.style.display = 'none';
        window.isGeneratingImage = false;
        buttonsManager.handleAction('finish_generation');
        window.overlayInProgress = false;
        return;
    }

    const sceneIndex = window.localImageSceneIndex;
    const formData = new FormData();
    formData.append('job_id', window.currentJobId);
    formData.append('scene_index', sceneIndex);

    let routeMode = "scene";
    if (window.overlayInProgress) {
        routeMode = "scene_overlay";
    }
    formData.append('mode', routeMode);
    formData.append('image_file', window.originalFile);

    formData.append('box_x', window.rectX);
    formData.append('box_y', window.rectY);
    formData.append('box_w', window.rectW);
    formData.append('box_h', window.rectH);
    formData.append('displayed_w', window.displayedImgWidth);
    formData.append('displayed_h', window.displayedImgHeight);

    if (window.overlayInProgress) {
        formData.append('crop_add_ref', 'false');
    } else {
        const addRefCheckbox = document.getElementById('crop-add-ref');
        if (addRefCheckbox && addRefCheckbox.checked) {
            formData.append('crop_add_ref', 'true');
        } else {
            formData.append('crop_add_ref', 'false');
        }
    }

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
            window.overlayInProgress = false;
            return;
        }
        if (!window.overlayInProgress) {
            const sceneCard = document.getElementById(`scene-card-${sceneIndex}`);
            if (sceneCard) {
                const figureEl = sceneCard.querySelector('figure img');
                figureEl.src = data.image_url + '?t=' + Date.now();

                const overlayBtn = sceneCard.querySelector('.overlay-btn');
                if (overlayBtn) {
                    overlayBtn.disabled = false;
                    overlayBtn.style.display = 'inline-block';
                }
            }
            if (!sceneGenerated[sceneIndex]) {
                sceneGenerated[sceneIndex] = true;
                imagesGenerated++;
            }
            if (imagesGenerated >= totalScenes) {
                generateVideoBtn.disabled = false;
            }

            // If the server says we added to references, add it to front-end list
            if (data.added_ref_filename) {
                const newRefPath = "/static/projects/" + window.currentJobId + "/images/" + data.added_ref_filename;
                await addReference(newRefPath);
            }
        } else {
            const overlayFilename = data.overlay_filename;
            await applyOverlayToScene(sceneIndex, overlayFilename, window.overlayOpacity);
        }
    } catch (err) {
        console.error("[DEBUG] error uploading local image crop:", err);
        alert("Error uploading/cropping image");
    }

    localImageCropModal.style.display = 'none';
    window.isGeneratingImage = false;
    buttonsManager.handleAction('finish_generation');
    window.overlayInProgress = false;
}

async function applyOverlayToScene(sceneIndex, overlayFilename, opacityVal) {
    const body = {
        job_id: window.currentJobId,
        scene_index: sceneIndex,
        overlay_filename: overlayFilename,
        opacity: opacityVal
    };
    buttonsManager.handleAction('start_generation');
    window.isGeneratingImage = true;

    try {
        const resp = await fetch('/overlay-scene-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await resp.json();
        if (data.error) {
            alert(data.error);
        } else {
            const sceneCard = document.getElementById(`scene-card-${sceneIndex}`);
            if (sceneCard) {
                const figureEl = sceneCard.querySelector('figure img');
                figureEl.src = data.image_url + '?t=' + Date.now();
            }
        }
    } catch (err) {
        console.error("Overlay error:", err);
        alert("Failed to overlay images");
    }
    window.isGeneratingImage = false;
    buttonsManager.handleAction('finish_generation');
}

function updateCropRect() {
    if (!cropRect) return;
    cropRect.style.left = window.rectX + 'px';
    cropRect.style.top = window.rectY + 'px';
    cropRect.style.width = window.rectW + 'px';
    cropRect.style.height = window.rectH + 'px';
}

function showReferenceImageModal(imageUrl) {
    const mod = document.getElementById("reference-image-modal");
    const img = document.getElementById("reference-image-modal-img");
    if (!mod || !img) return;

    img.src = imageUrl;
    img.setAttribute("data-fullsrc", imageUrl.replace(/\?t=\d+$/, ""));
    mod.style.display = "flex";
}

function hideReferenceImageModal() {
    const mod = document.getElementById("reference-image-modal");
    if (mod) mod.style.display = "none";
}

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
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                job_id: window.currentJobId,
                scene_index: 0,
                new_prompt: textArea.value,
                mode: "reference_card",
                references: refs
            })
        });

        const result = await processImageResponse(resp, null, button);
        if (!result.success) {
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

        imgEl.src = result.data.image_url + "?t=" + Date.now();
        showReferenceImageModal(result.data.image_url);

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
