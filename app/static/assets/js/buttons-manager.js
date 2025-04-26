// File: /app/static/assets/js/buttons-manager.js
//
// Manages enabling and disabling scene-image-related buttons.
// You can call buttonsManager.disableAll(), buttonsManager.enableAll(), or
// buttonsManager.handleAction('start_generation'), etc.

document.addEventListener('DOMContentLoaded', function() {
    window.buttonsManager = {
        disableAll() {
            const allRegen = document.querySelectorAll('.regenerate-btn');
            const allSelect = document.querySelectorAll('.select-local-btn');
            const allEdits = document.querySelectorAll('.edit-btn');

            allRegen.forEach(btn => btn.disabled = true);
            allSelect.forEach(btn => btn.disabled = true);
            allEdits.forEach(btn => btn.disabled = true);
        },

        enableAll() {
            const allRegen = document.querySelectorAll('.regenerate-btn');
            const allSelect = document.querySelectorAll('.select-local-btn');
            const allEdits = document.querySelectorAll('.edit-btn');

            // Only enable if the button is currently visible in the DOM
            allRegen.forEach(btn => {
                if (btn.offsetParent !== null) {
                    btn.disabled = false;
                }
            });
            allSelect.forEach(btn => {
                if (btn.offsetParent !== null) {
                    btn.disabled = false;
                }
            });
            allEdits.forEach(btn => {
                // We check if it's not hidden via style.display or offsetParent
                if (btn.style.display !== 'none' && btn.offsetParent !== null) {
                    btn.disabled = false;
                }
            });
        },

        /**
         * handleAction: a flexible entry point for specific tasks.
         *   - actionType: "start_generation", "finish_generation", "prompt_available", "image_loaded"
         *   - targetCard: optional DOM element for the card in question
         */
        handleAction(actionType, targetCard) {
            switch (actionType) {
                case 'start_generation':
                    // disable all relevant buttons across entire UI
                    this.disableAll();
                    break;

                case 'finish_generation':
                    // re-enable after generation or editing finished
                    this.enableAll();
                    break;

                case 'prompt_available':
                    // means the user now has a prompt in the textarea => enable "Generate" for that card
                    if (targetCard) {
                        const regenBtn = targetCard.querySelector('.regenerate-btn');
                        if (regenBtn) {
                            regenBtn.disabled = false;
                        }
                    }
                    break;

                case 'image_loaded':
                    // means an image for a particular scene or reference is now present => enable "Edit" button
                    if (targetCard) {
                        const editBtn = targetCard.querySelector('.edit-btn');
                        if (editBtn) {
                            editBtn.style.display = 'inline-block';
                            editBtn.disabled = false;
                        }
                    }
                    break;

                default:
                    // no-op
                    break;
            }
        }
    };
});
