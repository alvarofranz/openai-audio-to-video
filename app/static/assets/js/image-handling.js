// Manages AI image generation/edit, local image cropping, and references logic

// Make sure we initialize this array so it won't be undefined
window.referenceImagesLocal = [];  // { filename, url, selected: bool }

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

    // reference image modal (discard / add)
    const discardBtn = document.getElementById("reference-discard-btn");
    const addBtn = document.getElementById("reference-add-btn");
    if (discardBtn) {
        discardBtn.addEventListener("click", () => {
            document.getElementById("reference-image-modal").style.display = "none";
            enableAllImageButtons();
        });
    }
    if (addBtn) {
        addBtn.addEventListener("click", async () => {
            const modalImg = document.getElementById("reference-image-modal-img");
            const finalSrc = modalImg.getAttribute("data-fullsrc");
            // call /add-reference
            await addReference(finalSrc);
            document.getElementById("reference-image-modal").style.display = "none";
            enableAllImageButtons();
        });
    }
});

async function addReference(refPath) {
    if (!window.currentJobId) return;
    const body = { job_id: window.currentJobId, ref_path: refPath };
    try {
        await fetch("/add-reference", {
            method: "POST",
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        // Also add to local array if not present
        const isDefault = refPath.startsWith("/static/default-reference-images/");
        if (isDefault) {
            // push as { filename: refPath, url: refPath, selected:true }
            let alreadyIn = referenceImagesLocal.find(r => r.filename === refPath);
            if (!alreadyIn) {
                referenceImagesLocal.push({
                    filename: refPath,
                    url: refPath,
                    selected: true
                });
            }
        } else {
            // It's a job folder file
            const bname = refPath.split("/").pop();
            let alreadyIn = referenceImagesLocal.find(r => r.filename === bname);
            if (!alreadyIn) {
                const finalURL = refPath.startsWith("/static/")
                    ? refPath
                    : "/static/" + window.currentJobId + "/" + bname;
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
            const objURL = URL.createObjectURL(f);
            referenceImagesLocal.push({
                filename: data.reference_path,
                url: objURL,
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
    referenceImagesLocal.forEach((ref, index) => {
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

// Show the full-screen overlay in center
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
            enableAllImageButtons();
            return;
        }
        imgEl.src = dataImg.image_url + "?t=" + Date.now();

        if (!sceneGenerated[sceneIndex]) {
            sceneGenerated[sceneIndex] = true;
            imagesGenerated++;
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
    enableAllImageButtons();
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
    // We'll set currentEditSceneIndex = null after we finish attempts
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
            } else {
                if (editBtn) {
                    editBtn.textContent = "Edit";
                    editBtn.disabled = false;
                }
            }
            window.isGeneratingImage = false;
            enableAllImageButtons();
            return;
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
        if (attempt < 5) {
            await doEditSceneImage(sceneIndex, attempt + 1);
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
        if (!sceneGenerated[sceneIndex]) {
            sceneGenerated[sceneIndex] = true;
            imagesGenerated++;
        }
        if (imagesGenerated >= totalScenes) {
            generateVideoBtn.disabled = false;
        }
    } catch (err) {
        console.error("[DEBUG] error uploading local image crop:", err);
        alert("Error uploading/cropping image");
    }

    window.isGeneratingImage = false;
    enableAllImageButtons();
    localImageCropModal.style.display = 'none';
}

// Reference Generator logic
async function handleGenerateReferenceCardImage(textArea, imgEl, button, editBtn, attempt = 1) {
    if (attempt === 1) {
        if (window.isGeneratingImage) return;
        window.isGeneratingImage = true;
    }

    button.textContent = `Generating... (# ${attempt})`;
    disableAllImageButtons();

    let refs = referenceImagesLocal
        .filter(r => r.selected)
        .map(r => r.filename);

    try {
        const resp = await fetch("/generate-image", {
            method: "POST",
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                job_id: window.currentJobId,
                scene_index: 0, // dummy
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
            enableAllImageButtons();
            return;
        }
        imgEl.src = dataImg.image_url + "?t=" + Date.now();

        // Show modal => discard/add
        showReferenceImageModal(dataImg.image_url);

        // Show edit button
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
    enableAllImageButtons();
}

function showReferenceImageModal(imageUrl) {
    const mod = document.getElementById("reference-image-modal");
    const img = document.getElementById("reference-image-modal-img");
    if (!mod || !img) return;

    img.src = imageUrl;
    img.setAttribute("data-fullsrc", imageUrl.replace(/\?t=\d+$/, "")); // store raw
    mod.style.display = "flex";
}

function handleSelectLocalReferenceImage(imgEl, editRefBtn) {
    if (window.isGeneratingImage) return;
    disableAllImageButtons();
    window.isGeneratingImage = true;

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'image/*';

    fileInput.onchange = async () => {
        if (!fileInput.files || !fileInput.files.length) {
            window.isGeneratingImage = false;
            enableAllImageButtons();
            return;
        }
        const localFile = fileInput.files[0];
        if (!localFile) {
            window.isGeneratingImage = false;
            enableAllImageButtons();
            return;
        }

        const formData = new FormData();
        formData.append('job_id', window.currentJobId);
        formData.append('scene_index', '0'); // dummy
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
                enableAllImageButtons();
                return;
            }
            imgEl.src = data.image_url + "?t=" + Date.now();
            showReferenceImageModal(data.image_url);

            // Enable "Edit" after user selects local
            editRefBtn.style.display = 'inline-block';
            editRefBtn.disabled = false;
        } catch (err) {
            console.error("Error uploading local reference image:", err);
        }

        window.isGeneratingImage = false;
        enableAllImageButtons();
    };
    fileInput.click();
}

// Edit existing reference image in place
async function handleEditReferenceImage(imgEl, textArea, editRefBtn, attempt = 1) {
    if (attempt === 1) {
        if (window.isGeneratingImage) return;
        window.isGeneratingImage = true;
    }
    disableAllImageButtons();
    editRefBtn.textContent = `Editing... (# ${attempt})`;

    const newPrompt = textArea.value || "Refine this reference image";

    try {
        // We'll do a new /generate-image call with mode=edit_single
        // BUT we skip cropping. This is a reference card, so no crop modal.
        const resp = await fetch("/generate-image", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                job_id: window.currentJobId,
                scene_index: 0,
                new_prompt: newPrompt,
                mode: "edit_single",
                references: []
            })
        });
        const dataImg = await resp.json();
        if (dataImg.error) {
            console.error("[DEBUG] edit-reference_image error:", dataImg.error);
            if (attempt < 5) {
                await handleEditReferenceImage(imgEl, textArea, editRefBtn, attempt + 1);
            } else {
                editRefBtn.textContent = "Edit";
            }
            window.isGeneratingImage = false;
            enableAllImageButtons();
            return;
        }
        // got new image
        imgEl.src = dataImg.image_url + "?t=" + Date.now();
        showReferenceImageModal(dataImg.image_url);

        editRefBtn.textContent = "Edit";
    } catch (err) {
        console.error("[DEBUG] handleEditReferenceImage error:", err);
        if (attempt < 5) {
            await handleEditReferenceImage(imgEl, textArea, editRefBtn, attempt + 1);
        } else {
            alert("Error editing reference image");
            editRefBtn.textContent = "Edit";
        }
    }

    window.isGeneratingImage = false;
    enableAllImageButtons();
}

/* Utility to disable all image-related buttons across all cards */
function disableAllImageButtons() {
    const allRegen = document.querySelectorAll('.regenerate-btn');
    const allSelect = document.querySelectorAll('.select-local-btn');
    const allEdits = document.querySelectorAll('.edit-btn');
    allRegen.forEach(btn => btn.disabled = true);
    allSelect.forEach(btn => btn.disabled = true);
    allEdits.forEach(btn => btn.disabled = true);
}

/* Utility to enable all image-related buttons across all cards that
   are logically available (i.e. hidden ones remain hidden). */
function enableAllImageButtons() {
    // We'll re-enable if the element is visible
    const allRegen = document.querySelectorAll('.regenerate-btn');
    const allSelect = document.querySelectorAll('.select-local-btn');
    const allEdits = document.querySelectorAll('.edit-btn');

    allRegen.forEach(btn => {
        if (btn.offsetParent !== null) btn.disabled = false;
    });
    allSelect.forEach(btn => {
        if (btn.offsetParent !== null) btn.disabled = false;
    });
    allEdits.forEach(btn => {
        // Only enable if displayed
        if (btn.style.display !== 'none' && btn.offsetParent !== null) {
            btn.disabled = false;
        }
    });
}

function updateCropRect() {
    if (!cropRect) return;
    cropRect.style.left = window.rectX + 'px';
    cropRect.style.top = window.rectY + 'px';
    cropRect.style.width = window.rectW + 'px';
    cropRect.style.height = window.rectH + 'px';
}
