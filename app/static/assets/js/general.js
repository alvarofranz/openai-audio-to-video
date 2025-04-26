// general.js

// Expose all global variables on window, ensuring they exist before other scripts run
window.initialUIContainer = null;
window.audioFileInput = null;
window.uploadBtn = null;
window.uploadingSection = null;
window.uploadCancelBtn = null;
window.uploadingFeedback = null;
window.audioProcessingSection = null;
window.whisperLoading = null;
window.uploadedAudio = null;
window.storyTranscription = null;
window.storyDescription = null;
window.storyIngredientsContainer = null;
window.storyIngredientsTextarea = null;
window.generatePromptsBtn = null;
window.chunkProcessingStatus = null;
window.scenesContainer = null;
window.videoGenerationSection = null;
window.generateVideoBtn = null;
window.videoProgress = null;
window.finalVideoSection = null;
window.finalVideoSource = null;
window.finalVideo = null;
window.finalVideoPathEl = null;
window.mainHeader = null;
window.wordsPerSceneInput = null;
window.textModelInput = null;
window.aiSizeSelect = null;
window.videoSizeSelect = null;
window.imagePromptStyleTextarea = null;
window.charactersPromptStyleTextarea = null;
window.imagePreprocessingPromptTextarea = null;
window.fadeInInput = null;
window.fadeOutInput = null;
window.crossfadeInput = null;
window.localImageCropModal = null;
window.localImagePreview = null;
window.cropRect = null;
window.cropCancelBtn = null;
window.cropConfirmBtn = null;

// Global states
window.originalFile = null;
window.localImageSceneIndex = null;
window.displayedImgWidth = 0;
window.displayedImgHeight = 0;
window.rectX = 0;
window.rectY = 0;
window.rectW = 100;
window.rectH = 100;
window.dragging = false;
window.dragOffsetX = 0;
window.dragOffsetY = 0;

window.currentJobId = null;
window.totalScenes = 0;
window.imagesGenerated = 0;
window.userCanceledMidUpload = false;
window.sceneGenerated = [];
window.uploadAbortController = null;
window.chunksData = [];
window.isGeneratingImage = false;
window.aspectRatio = 1.0;
window.referenceImagesLocal = [];

// Utility: fadeOut
window.fadeOut = function(element, duration = 500) {
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
};

// Utility: fadeIn
window.fadeIn = function(element, duration = 500) {
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
};

// Utility: parseTime
window.parseTime = function(sec) {
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
};

// Utility: formatDuration
window.formatDuration = function(startSec, endSec) {
    const s = parseTime(startSec);
    const e = parseTime(endSec);
    return `from ${s} to ${e}`;
};

// Utility: resetUI
window.resetUI = function() {
    window.currentJobId = null;
    window.totalScenes = 0;
    window.imagesGenerated = 0;
    window.isGeneratingImage = false;
    window.userCanceledMidUpload = false;
    window.sceneGenerated = [];
    window.chunksData = [];

    if (initialUIContainer) initialUIContainer.style.display = 'block';
    if (uploadingSection) uploadingSection.style.display = 'none';
    if (audioProcessingSection) audioProcessingSection.style.display = 'none';
    if (storyTranscription) {
        storyTranscription.textContent = '';
        storyTranscription.style.display = 'none';
    }
    if (whisperLoading) whisperLoading.style.display = 'none';
    if (storyDescription) storyDescription.style.display = 'none';
    if (storyIngredientsContainer) storyIngredientsContainer.style.display = 'none';

    if (videoGenerationSection) videoGenerationSection.style.display = 'none';
    if (finalVideoSection) finalVideoSection.style.display = 'none';
    if (chunkProcessingStatus) {
        chunkProcessingStatus.style.display = 'none';
        chunkProcessingStatus.textContent = '';
    }

    if (scenesContainer) scenesContainer.innerHTML = '';
    if (uploadedAudio) uploadedAudio.src = '';
    if (generateVideoBtn) {
        generateVideoBtn.disabled = true;
        generateVideoBtn.style.display = 'inline-block';
    }
    if (videoProgress) {
        videoProgress.style.display = 'none';
        videoProgress.textContent = '';
    }
    if (finalVideoSource) finalVideoSource.src = '';
    if (finalVideo) finalVideo.load();
    if (finalVideoPathEl) finalVideoPathEl.textContent = '';

    if (mainHeader) mainHeader.textContent = "Make your story alive";
};

// We no longer define disableAllImageButtons/enableAllImageButtons here.
// The new central manager is in buttons-manager.js

document.addEventListener('DOMContentLoaded', function() {
    window.initialUIContainer = document.getElementById('initial-ui-container');
    window.audioFileInput      = document.getElementById('audio-file-input');
    window.uploadBtn           = document.getElementById('upload-btn');
    window.uploadingSection    = document.getElementById('uploading-section');
    window.uploadCancelBtn     = document.getElementById('upload-cancel-btn');
    window.uploadingFeedback   = document.getElementById('uploading-feedback');

    window.audioProcessingSection  = document.getElementById('audio-processing-section');
    window.whisperLoading          = document.getElementById('whisper-loading');
    window.uploadedAudio           = document.getElementById('uploaded-audio');
    window.storyTranscription      = document.getElementById('story-transcription');
    window.storyDescription        = document.getElementById('story-description');
    window.storyIngredientsContainer = document.getElementById('story-ingredients-container');
    window.storyIngredientsTextarea  = document.getElementById('story-ingredients-textarea');
    window.generatePromptsBtn        = document.getElementById('generate-prompts-btn');

    window.chunkProcessingStatus  = document.getElementById('chunk-processing-status');
    window.scenesContainer        = document.getElementById('scenes-container');

    window.videoGenerationSection = document.getElementById('video-generation-section');
    window.generateVideoBtn       = document.getElementById('generate-video-btn');
    window.videoProgress          = document.getElementById('video-progress');

    window.finalVideoSection      = document.getElementById('final-video-section');
    window.finalVideoSource       = document.getElementById('final-video-source');
    window.finalVideo             = document.getElementById('final-video');
    window.finalVideoPathEl       = document.getElementById('final-video-path');

    window.mainHeader             = document.querySelector('header h1');

    window.wordsPerSceneInput     = document.getElementById('words-per-scene');
    window.textModelInput         = document.getElementById('text-model');
    window.aiSizeSelect           = document.getElementById('ai-size-select');
    window.videoSizeSelect        = document.getElementById('video-size');
    window.imagePromptStyleTextarea      = document.getElementById('image-prompt-style');
    window.charactersPromptStyleTextarea = document.getElementById('characters-prompt-style');
    window.imagePreprocessingPromptTextarea = document.getElementById('image-preprocessing-prompt');
    window.fadeInInput            = document.getElementById('fade-in');
    window.fadeOutInput           = document.getElementById('fade-out');
    window.crossfadeInput         = document.getElementById('crossfade-dur');

    window.localImageCropModal    = document.getElementById('local-image-crop-modal');
    window.localImagePreview      = document.getElementById('local-image-preview');
    window.cropRect               = document.getElementById('crop-rect');
    window.cropCancelBtn          = document.getElementById('crop-cancel');
    window.cropConfirmBtn         = document.getElementById('crop-confirm');

    // Basic dragging for the cropRect
    if (cropRect) {
        cropRect.addEventListener('mousedown', (e) => {
            window.dragging = true;
            window.dragOffsetX = e.offsetX;
            window.dragOffsetY = e.offsetY;
        });
    }
    document.addEventListener('mouseup', () => {
        window.dragging = false;
    });
    document.addEventListener('mousemove', (e) => {
        if (!window.dragging) return;
        e.preventDefault();

        const previewRect = window.localImagePreview.getBoundingClientRect();
        let newLeft = e.clientX - previewRect.left - window.dragOffsetX;
        let newTop = e.clientY - previewRect.top - window.dragOffsetY;

        // clamp
        if (newLeft < 0) newLeft = 0;
        if (newTop < 0) newTop = 0;
        if (newLeft + window.rectW > window.displayedImgWidth) {
            newLeft = window.displayedImgWidth - window.rectW;
        }
        if (newTop + window.rectH > window.displayedImgHeight) {
            newTop = window.displayedImgHeight - window.rectH;
        }

        window.rectX = newLeft;
        window.rectY = newTop;
        window.updateCropRect();
    });

    if (cropCancelBtn) {
        cropCancelBtn.addEventListener('click', () => {
            window.localImageCropModal.style.display = 'none';
            window.isGeneratingImage = false;
            buttonsManager.enableAll();
        });
    }
});
