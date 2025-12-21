/**
 * Animation Editor Webview
 * Runs in the browser context of the webview
 */

// Initialize VS Code API
const vscode = acquireVsCodeApi();

// State variables
let currentData;
let selectedAnimation;
let selectedFrames = new Set(); // Currently selected frames in grid
let spriteImage = null; // Loaded sprite sheet image
let selectedTimelineIndex = -1; // Selected frame index in timeline
let isPlaying = false; // Preview playback state
let currentPreviewFrame = 0; // Current frame in preview
let loopEnabled = true; // Loop animation
let lastFrameTime = 0; // For FPS timing
let animationFrameId = null; // RequestAnimationFrame ID
let gridZoom = 1; // Grid view zoom level
let gridInteractionSetup = false; // Track if grid interaction is set up
let previewControlsSetup = false; // Track if preview controls are set up

// Initialize function
function initialize(data, selectedAnim) {
    currentData = data;
    selectedAnimation = selectedAnim;
    setupEventListeners();
    loadSpriteSheet();
    renderTimeline();
    renderPreview();
}

// Event listeners setup
function setupEventListeners() {
    // Top bar event listeners
    document.getElementById('browse-btn').addEventListener('click', () => {
    vscode.postMessage({ type: 'browse' });
});

document.getElementById('image-path').addEventListener('input', (e) => {
    currentData.image = e.target.value;
    loadSpriteSheet();
    updateDocument();
});

document.getElementById('columns').addEventListener('input', (e) => {
    currentData.columns = parseInt(e.target.value) || 1;
    if (spriteImage) {
        redrawOverlay();
        updateCellSizeDisplay();
    }
    updateDocument();
});

document.getElementById('rows').addEventListener('input', (e) => {
    currentData.rows = parseInt(e.target.value) || 1;
    if (spriteImage) {
        redrawOverlay();
        updateCellSizeDisplay();
    }
    updateDocument();
});

document.getElementById('fps').addEventListener('input', (e) => {
    currentData.fps = parseInt(e.target.value) || 1;
    updateDocument();
});

// Grid zoom event listener
document.getElementById('grid-zoom-select').addEventListener('change', (e) => {
    gridZoom = parseFloat(e.target.value) || 1;
    if (spriteImage && spriteImage.complete) {
        drawGridView();
    }
});

// Animation list event listeners
document.getElementById('add-animation-btn').addEventListener('click', () => {
    vscode.postMessage({ type: 'promptAnimationName' });
});

document.getElementById('remove-animation-btn').addEventListener('click', () => {
    if (!selectedAnimation) {
        return;
    }
    vscode.postMessage({
        type: 'confirmDelete',
        name: selectedAnimation
    });
});

// Animation item selection
const animationList = document.getElementById('animation-list');
animationList.addEventListener('click', (e) => {
    const item = e.target.closest('.animation-item');
    if (item && !e.target.matches('input')) {
        document.querySelectorAll('.animation-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        selectedAnimation = item.dataset.name;
        selectedTimelineIndex = -1; // Reset timeline selection
        currentPreviewFrame = 0; // Reset preview
        stopAnimation();
        animationList.focus();
        updateRemoveButtonState();
        updateAddFramesButtonState();
        renderTimeline();
        renderPreview();
    }
});

// Animation item rename (double-click)
document.getElementById('animation-list').addEventListener('dblclick', (e) => {
    const item = e.target.closest('.animation-item');
    if (!item) return;

    const currentName = item.dataset.name;
    vscode.postMessage({
        type: 'promptRename',
        currentName: currentName
    });
});

// Handle messages from extension
window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'imageSelected':
            document.getElementById('image-path').value = message.path;
            currentData.image = message.path;
            loadSpriteSheet();
            updateDocument();
            break;
        case 'animationNameEntered':
            currentData.animations[message.name] = [];
            selectedAnimation = message.name;
            selectedTimelineIndex = -1;
            currentPreviewFrame = 0;
            stopAnimation();
            rebuildAnimationList();
            renderTimeline();
            renderPreview();
            updateDocument();
            break;
        case 'deleteConfirmed':
            delete currentData.animations[message.name];
            selectedAnimation = null;
            selectedTimelineIndex = -1;
            currentPreviewFrame = 0;
            stopAnimation();
            rebuildAnimationList();
            renderTimeline();
            renderPreview();
            updateDocument();
            break;
        case 'renameConfirmed':
            currentData.animations[message.newName] = currentData.animations[message.oldName];
            delete currentData.animations[message.oldName];
            if (selectedAnimation === message.oldName) {
                selectedAnimation = message.newName;
            }
            rebuildAnimationList();
            renderTimeline();
            renderPreview();
            updateDocument();
            break;
        case 'imageUri':
            // Received webview URI for image, now load it
            const gridView = document.getElementById('grid-view');
            spriteImage = new Image();
            spriteImage.onload = () => {
                drawGridView();
                renderTimeline();
            };
            spriteImage.onerror = () => {
                gridView.innerHTML = '<div class="grid-placeholder">Failed to load image</div>';
                spriteImage = null;
            };
            spriteImage.src = message.uri;
            break;
    }
});

    // Grid/Timeline event listeners
    document.getElementById('add-frames-btn').addEventListener('click', () => {
        if (!selectedAnimation || selectedFrames.size === 0) {
            return;
        }

        // Add selected frames to current animation
        const framesToAdd = Array.from(selectedFrames).sort((a, b) => a - b);
        currentData.animations[selectedAnimation].push(...framesToAdd);

        // Clear selection
        selectedFrames.clear();
        redrawOverlay();
        renderTimeline();
        renderPreview();
        updateAddFramesButtonState();
        updateDocument();
    });

    document.getElementById('timeline').addEventListener('click', (e) => {
        const frameDiv = e.target.closest('.timeline-frame');
        if (frameDiv) {
            const timelineIndex = parseInt(frameDiv.dataset.timelineIndex);

            // Toggle selection
            if (selectedTimelineIndex === timelineIndex) {
                selectedTimelineIndex = -1;
            } else {
                selectedTimelineIndex = timelineIndex;
            }

            renderTimeline();
        }
    });

    document.getElementById('insert-before-btn').addEventListener('click', () => {
        if (selectedTimelineIndex < 0 || !selectedAnimation || selectedFrames.size === 0) {
            return;
        }

        const framesToInsert = Array.from(selectedFrames).sort((a, b) => a - b);
        currentData.animations[selectedAnimation].splice(selectedTimelineIndex, 0, ...framesToInsert);

        selectedFrames.clear();
        redrawOverlay();
        renderTimeline();
        renderPreview();
        updateAddFramesButtonState();
        updateDocument();
    });

    document.getElementById('insert-after-btn').addEventListener('click', () => {
        if (selectedTimelineIndex < 0 || !selectedAnimation || selectedFrames.size === 0) {
            return;
        }

        const framesToInsert = Array.from(selectedFrames).sort((a, b) => a - b);
        currentData.animations[selectedAnimation].splice(selectedTimelineIndex + 1, 0, ...framesToInsert);

        selectedFrames.clear();
        redrawOverlay();
        renderTimeline();
        renderPreview();
        updateAddFramesButtonState();
        updateDocument();
    });

    document.getElementById('remove-frame-btn').addEventListener('click', () => {
        if (selectedTimelineIndex < 0 || !selectedAnimation) {
            return;
        }

        currentData.animations[selectedAnimation].splice(selectedTimelineIndex, 1);
        selectedTimelineIndex = -1;

        // Clamp preview frame
        if (currentPreviewFrame >= currentData.animations[selectedAnimation].length) {
            currentPreviewFrame = Math.max(0, currentData.animations[selectedAnimation].length - 1);
        }

        renderTimeline();
        renderPreview();
        updateDocument();
    });
}

// Helper Functions

// Load sprite sheet
function loadSpriteSheet() {
    const gridView = document.getElementById('grid-view');

    if (!currentData.image) {
        gridView.innerHTML = '<div class="grid-placeholder">Select a sprite sheet to begin</div>';
        spriteImage = null;
        return;
    }

    // Request webview URI from extension
    vscode.postMessage({
        type: 'getImageUri',
        path: currentData.image
    });
}

// Update document
function updateDocument() {
    vscode.postMessage({
        type: 'update',
        data: currentData
    });
}

// Update remove button state
function updateRemoveButtonState() {
    const removeBtn = document.getElementById('remove-animation-btn');
    if (selectedAnimation && currentData.animations[selectedAnimation]) {
        removeBtn.removeAttribute('disabled');
    } else {
        removeBtn.setAttribute('disabled', 'true');
    }
}

// Rebuild animation list UI
function rebuildAnimationList() {
    const listEl = document.getElementById('animation-list');
    const animations = Object.entries(currentData.animations);

    if (animations.length === 0) {
        listEl.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 12px;">No animations</div>';
        selectedAnimation = null;
    } else {
        listEl.innerHTML = animations.map(([name, frames], index) => {
            const hue = (index * 360) / Math.max(animations.length, 1);
            const color = `hsl(${hue}, 70%, 60%)`;
            const isSelected = name === selectedAnimation;
            return `
                <div class="animation-item ${isSelected ? 'selected' : ''}" data-name="${escapeHtml(name)}">
                    <div class="animation-color-dot" style="background: ${color};"></div>
                    <div class="animation-item-name">${escapeHtml(name)}</div>
                </div>
            `;
        }).join('');

        // If selected animation was deleted, select first one
        if (selectedAnimation && !currentData.animations[selectedAnimation]) {
            selectedAnimation = animations[0][0];
        }
    }

    updateRemoveButtonState();
    updateAddFramesButtonState();

    // Redraw grid to update animation dots
    if (spriteImage) {
        redrawOverlay();
    }
}

// Escape HTML helper
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function drawGridView() {
    const gridView = document.getElementById('grid-view');

    if (!spriteImage || !spriteImage.complete) {
        return;
    }

    const cols = currentData.columns;
    const rows = currentData.rows;
    const imgWidth = spriteImage.width;
    const imgHeight = spriteImage.height;

    // Apply zoom to dimensions
    const zoomedWidth = Math.floor(imgWidth * gridZoom);
    const zoomedHeight = Math.floor(imgHeight * gridZoom);

    // Create container
    gridView.innerHTML = '';
    gridInteractionSetup = false; // Reset since we're creating new canvases
    const container = document.createElement('div');
    container.className = 'grid-canvas-container';
    container.style.width = zoomedWidth + 'px';
    container.style.height = zoomedHeight + 'px';

    const baseCanvas = document.createElement('canvas');
    baseCanvas.id = 'grid-base-canvas';
    baseCanvas.width = zoomedWidth;
    baseCanvas.height = zoomedHeight;

    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'grid-overlay-canvas';
    overlayCanvas.className = 'overlay-canvas';
    overlayCanvas.width = zoomedWidth;
    overlayCanvas.height = zoomedHeight;

    container.appendChild(baseCanvas);
    container.appendChild(overlayCanvas);
    gridView.appendChild(container);

    // Draw checkerboard background on base canvas
    const baseCtx = baseCanvas.getContext('2d');

    // Checkerboard pattern
    const checkSize = 16;
    const color1 = '#cccccc';
    const color2 = '#999999';

    for (let y = 0; y < imgHeight; y += checkSize) {
        for (let x = 0; x < imgWidth; x += checkSize) {
            const isEven = (Math.floor(x / checkSize) + Math.floor(y / checkSize)) % 2 === 0;
            baseCtx.fillStyle = isEven ? color1 : color2;
            baseCtx.fillRect(x, y, checkSize, checkSize);
        }
    }

    // Draw sprite sheet on top
    baseCtx.drawImage(spriteImage, 0, 0);

    // Draw grid and decorations on overlay
    redrawOverlay();

    // Setup interaction only once
    if (!gridInteractionSetup) {
        setupGridInteraction(overlayCanvas);
        gridInteractionSetup = true;
    }

    // Update cell size display
    updateCellSizeDisplay();
}

function updateCellSizeDisplay() {
    const display = document.getElementById('cell-size-display');
    if (!spriteImage || !spriteImage.complete) {
        display.textContent = 'Cell: -';
        return;
    }

    const cellWidth = Math.floor(spriteImage.width / currentData.columns);
    const cellHeight = Math.floor(spriteImage.height / currentData.rows);
    display.textContent = `Cell: ${cellWidth}×${cellHeight}px`;
}

function redrawOverlay() {
    const overlayCanvas = document.getElementById('grid-overlay-canvas');
    if (!overlayCanvas) {
        return;
    }

    const ctx = overlayCanvas.getContext('2d');
    const cols = currentData.columns;
    const rows = currentData.rows;
    const cellWidth = overlayCanvas.width / cols;
    const cellHeight = overlayCanvas.height / rows;

    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    // Draw simple grid lines
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 1;

    // Draw all vertical lines
    for (let x = 0; x <= cols; x++) {
        const xPos = Math.floor(x * cellWidth) + 0.5;
        ctx.beginPath();
        ctx.moveTo(xPos, 0);
        ctx.lineTo(xPos, overlayCanvas.height);
        ctx.stroke();
    }

    // Draw all horizontal lines
    for (let y = 0; y <= rows; y++) {
        const yPos = Math.floor(y * cellHeight) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, yPos);
        ctx.lineTo(overlayCanvas.width, yPos);
        ctx.stroke();
    }

    // Draw animation dots on frames
    const animations = Object.entries(currentData.animations);
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const frameIndex = row * cols + col;
            const x = col * cellWidth;
            const y = row * cellHeight;

            // Find which animations contain this frame
            const animsWithFrame = [];
            animations.forEach(([name, frames], index) => {
                if (frames.includes(frameIndex)) {
                    const hue = (index * 360) / Math.max(animations.length, 1);
                    animsWithFrame.push({ name, color: `hsl(${hue}, 70%, 60%)` });
                }
            });

            // Draw dots for each animation
            animsWithFrame.forEach((anim, dotIndex) => {
                ctx.fillStyle = anim.color;
                ctx.beginPath();
                const dotX = x + 6;
                const dotY = y + 6 + (dotIndex * 6);
                ctx.arc(dotX, dotY, 3, 0, Math.PI * 2);
                ctx.fill();
            });

            // Highlight selected frames
            if (selectedFrames.has(frameIndex)) {
                ctx.fillStyle = 'rgba(100, 150, 255, 0.3)';
                ctx.fillRect(x, y, cellWidth, cellHeight);
                ctx.strokeStyle = 'rgba(100, 150, 255, 0.8)';
                ctx.lineWidth = 2;
                ctx.strokeRect(x + 1, y + 1, cellWidth - 2, cellHeight - 2);
            }
        }
    }
}

function getFrameAtPosition(canvas, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const cols = currentData.columns;
    const rows = currentData.rows;
    const cellWidth = canvas.width / cols;
    const cellHeight = canvas.height / rows;

    const col = Math.floor(x / cellWidth);
    const row = Math.floor(y / cellHeight);

    if (col >= 0 && col < cols && row >= 0 && row < rows) {
        return row * cols + col;
    }
    return -1;
}

function setupGridInteraction(canvas) {
    let isDragging = false;
    let dragStartFrame = -1;

    canvas.addEventListener('mousedown', (e) => {
        const frame = getFrameAtPosition(canvas, e.clientX, e.clientY);
        if (frame !== -1) {
            isDragging = true;
            dragStartFrame = frame;

            // Toggle selection on click
            if (selectedFrames.has(frame)) {
                selectedFrames.delete(frame);
            } else {
                selectedFrames.add(frame);
            }
            redrawOverlay();
            updateAddFramesButtonState();
        }
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        const currentFrame = getFrameAtPosition(canvas, e.clientX, e.clientY);
        if (currentFrame !== -1) {
            // Select all frames in rectangle from dragStartFrame to currentFrame
            const cols = currentData.columns;
            const startRow = Math.floor(dragStartFrame / cols);
            const startCol = dragStartFrame % cols;
            const endRow = Math.floor(currentFrame / cols);
            const endCol = currentFrame % cols;

            const minRow = Math.min(startRow, endRow);
            const maxRow = Math.max(startRow, endRow);
            const minCol = Math.min(startCol, endCol);
            const maxCol = Math.max(startCol, endCol);

            selectedFrames.clear();
            for (let r = minRow; r <= maxRow; r++) {
                for (let c = minCol; c <= maxCol; c++) {
                    selectedFrames.add(r * cols + c);
                }
            }
            redrawOverlay();
            updateAddFramesButtonState();
        }
    });

    canvas.addEventListener('mouseup', () => {
        isDragging = false;
    });

    canvas.addEventListener('mouseleave', () => {
        isDragging = false;
    });
}

// Update add frames button state
function updateAddFramesButtonState() {
    const addBtn = document.getElementById('add-frames-btn');
    if (selectedAnimation && selectedFrames.size > 0) {
        addBtn.removeAttribute('disabled');
    } else {
        addBtn.setAttribute('disabled', 'true');
    }
}

// Timeline Functions
function renderTimeline() {
    const timelineEl = document.getElementById('timeline');

    if (!selectedAnimation || !currentData.animations[selectedAnimation]) {
        timelineEl.innerHTML = '<div class="timeline-placeholder">No animation selected</div>';
        selectedTimelineIndex = -1;
        updateTimelineButtonState();
        return;
    }

    const frames = currentData.animations[selectedAnimation];

    if (frames.length === 0) {
        timelineEl.innerHTML = '<div class="timeline-placeholder">No frames in animation</div>';
        selectedTimelineIndex = -1;
        updateTimelineButtonState();
        return;
    }

    if (!spriteImage || !spriteImage.complete) {
        timelineEl.innerHTML = '<div class="timeline-placeholder">Loading...</div>';
        return;
    }

    // Render frame thumbnails
    timelineEl.innerHTML = '';

    const cols = currentData.columns;
    const rows = currentData.rows;
    const cellWidth = spriteImage.width / cols;
    const cellHeight = spriteImage.height / rows;
    const thumbHeight = 80; // Max thumbnail height
    const scale = Math.min(1, thumbHeight / cellHeight);
    const thumbWidth = cellWidth * scale;
    const scaledThumbHeight = cellHeight * scale;

    frames.forEach((frameIndex, timelineIndex) => {
        const frameDiv = document.createElement('div');
        frameDiv.className = 'timeline-frame';
        if (timelineIndex === selectedTimelineIndex) {
            frameDiv.classList.add('selected');
        }
        frameDiv.dataset.timelineIndex = timelineIndex;

        // Create canvas for thumbnail
        const canvas = document.createElement('canvas');
        canvas.width = thumbWidth;
        canvas.height = scaledThumbHeight;

        const ctx = canvas.getContext('2d');

        // Draw checkerboard background
        const checkSize = 8;
        const color1 = '#cccccc';
        const color2 = '#999999';
        for (let y = 0; y < scaledThumbHeight; y += checkSize) {
            for (let x = 0; x < thumbWidth; x += checkSize) {
                const isEven = (Math.floor(x / checkSize) + Math.floor(y / checkSize)) % 2 === 0;
                ctx.fillStyle = isEven ? color1 : color2;
                ctx.fillRect(x, y, checkSize, checkSize);
            }
        }

        // Calculate source position
        const row = Math.floor(frameIndex / cols);
        const col = frameIndex % cols;
        const sx = col * cellWidth;
        const sy = row * cellHeight;

        // Draw frame
        ctx.drawImage(
            spriteImage,
            sx, sy, cellWidth, cellHeight,
            0, 0, thumbWidth, scaledThumbHeight
        );

        // Add frame index label
        const label = document.createElement('div');
        label.className = 'timeline-frame-index';
        label.textContent = frameIndex;

        frameDiv.appendChild(canvas);
        frameDiv.appendChild(label);
        timelineEl.appendChild(frameDiv);
    });

    updateTimelineButtonState();
}

function updateTimelineButtonState() {
    const insertBeforeBtn = document.getElementById('insert-before-btn');
    const insertAfterBtn = document.getElementById('insert-after-btn');
    const removeFrameBtn = document.getElementById('remove-frame-btn');

    const hasSelection = selectedTimelineIndex >= 0 &&
                        selectedAnimation &&
                        currentData.animations[selectedAnimation] &&
                        selectedTimelineIndex < currentData.animations[selectedAnimation].length;

    const hasFramesSelected = selectedFrames.size > 0 && selectedAnimation;

    if (hasSelection && hasFramesSelected) {
        insertBeforeBtn.removeAttribute('disabled');
        insertAfterBtn.removeAttribute('disabled');
    } else {
        insertBeforeBtn.setAttribute('disabled', 'true');
        insertAfterBtn.setAttribute('disabled', 'true');
    }

    if (hasSelection) {
        removeFrameBtn.removeAttribute('disabled');
    } else {
        removeFrameBtn.setAttribute('disabled', 'true');
    }
}

// Preview Functions
function renderPreview() {
    const previewEl = document.getElementById('preview');

    if (!selectedAnimation || !currentData.animations[selectedAnimation]) {
        previewEl.innerHTML = '<div class="preview-placeholder">No animation selected</div>';
        stopAnimation();
        return;
    }

    const frames = currentData.animations[selectedAnimation];

    if (frames.length === 0) {
        previewEl.innerHTML = '<div class="preview-placeholder">No frames in animation</div>';
        stopAnimation();
        return;
    }

    if (!spriteImage || !spriteImage.complete) {
        previewEl.innerHTML = '<div class="preview-placeholder">Loading...</div>';
        return;
    }

    // Calculate frame dimensions
    const cols = currentData.columns;
    const rows = currentData.rows;
    const cellWidth = spriteImage.width / cols;
    const cellHeight = spriteImage.height / rows;

    // Integer scaling for crisp pixels
    const maxPreviewSize = 200;
    const scale = Math.max(1, Math.floor(maxPreviewSize / Math.max(cellWidth, cellHeight)));
    const previewWidth = cellWidth * scale;
    const previewHeight = cellHeight * scale;

    // Build preview HTML
    previewControlsSetup = false; // Reset since we're rebuilding the preview
    previewEl.innerHTML = `
        <div class="preview-canvas-container">
            <canvas id="preview-canvas"></canvas>
        </div>
        <div class="preview-controls">
            <vscode-button appearance="icon" id="preview-step-back" aria-label="Step Back">
                <span class="codicon codicon-debug-step-back"></span>
            </vscode-button>
            <vscode-button appearance="icon" id="preview-play-pause" aria-label="Play/Pause">
                <span class="codicon codicon-${isPlaying ? 'debug-pause' : 'play'}"></span>
            </vscode-button>
            <vscode-button appearance="icon" id="preview-step-forward" aria-label="Step Forward">
                <span class="codicon codicon-debug-step-over"></span>
            </vscode-button>
            <vscode-button appearance="icon" id="preview-loop" aria-label="Toggle Loop" ${loopEnabled ? '' : 'appearance="secondary"'}>
                <span class="codicon codicon-sync"></span>
            </vscode-button>
        </div>
        <div class="preview-frame-info">
            Frame: <span id="preview-frame-number">${currentPreviewFrame + 1}</span> / ${frames.length}
        </div>
    `;

    const canvas = document.getElementById('preview-canvas');
    canvas.width = previewWidth;
    canvas.height = previewHeight;

    // Setup control event listeners only once
    if (!previewControlsSetup) {
        setupPreviewControls();
        previewControlsSetup = true;
    }

    // Draw current frame
    drawPreviewFrame();
}

function drawPreviewFrame() {
    const canvas = document.getElementById('preview-canvas');
    if (!canvas || !selectedAnimation) return;

    const frames = currentData.animations[selectedAnimation];
    if (frames.length === 0) return;

    // Clamp current frame
    currentPreviewFrame = Math.max(0, Math.min(currentPreviewFrame, frames.length - 1));

    const ctx = canvas.getContext('2d');
    const cols = currentData.columns;
    const rows = currentData.rows;
    const cellWidth = spriteImage.width / cols;
    const cellHeight = spriteImage.height / rows;

    // Draw checkerboard
    const checkSize = 16;
    const color1 = '#cccccc';
    const color2 = '#999999';
    for (let y = 0; y < canvas.height; y += checkSize) {
        for (let x = 0; x < canvas.width; x += checkSize) {
            const isEven = (Math.floor(x / checkSize) + Math.floor(y / checkSize)) % 2 === 0;
            ctx.fillStyle = isEven ? color1 : color2;
            ctx.fillRect(x, y, checkSize, checkSize);
        }
    }

    // Get current frame from animation
    const frameIndex = frames[currentPreviewFrame];
    const row = Math.floor(frameIndex / cols);
    const col = frameIndex % cols;
    const sx = col * cellWidth;
    const sy = row * cellHeight;

    // Draw frame scaled to canvas size (integer scaling for crisp pixels)
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
        spriteImage,
        sx, sy, cellWidth, cellHeight,
        0, 0, canvas.width, canvas.height
    );

    // Update frame counter
    const frameInfo = document.getElementById('preview-frame-number');
    if (frameInfo) {
        frameInfo.textContent = currentPreviewFrame + 1;
    }
}

function setupPreviewControls() {
    document.getElementById('preview-play-pause')?.addEventListener('click', () => {
        if (isPlaying) {
            stopAnimation();
        } else {
            startAnimation();
        }
    });

    document.getElementById('preview-step-back')?.addEventListener('click', () => {
        stopAnimation();
        stepFrame(-1);
    });

    document.getElementById('preview-step-forward')?.addEventListener('click', () => {
        stopAnimation();
        stepFrame(1);
    });

    document.getElementById('preview-loop')?.addEventListener('click', () => {
        loopEnabled = !loopEnabled;
        renderPreview();
    });
}

function startAnimation() {
    if (!selectedAnimation || !currentData.animations[selectedAnimation]) return;

    const frames = currentData.animations[selectedAnimation];
    if (frames.length === 0) return;

    isPlaying = true;
    lastFrameTime = performance.now();
    renderPreview();
    animationLoop();
}

function stopAnimation() {
    isPlaying = false;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    renderPreview();
}

function stepFrame(direction) {
    if (!selectedAnimation) return;

    const frames = currentData.animations[selectedAnimation];
    if (frames.length === 0) return;

    currentPreviewFrame += direction;

    if (currentPreviewFrame < 0) {
        currentPreviewFrame = loopEnabled ? frames.length - 1 : 0;
    } else if (currentPreviewFrame >= frames.length) {
        currentPreviewFrame = loopEnabled ? 0 : frames.length - 1;
    }

    drawPreviewFrame();
}

function animationLoop() {
    if (!isPlaying) return;

    const now = performance.now();
    const frameDuration = 1000 / currentData.fps;

    if (now - lastFrameTime >= frameDuration) {
        lastFrameTime = now;

        const frames = currentData.animations[selectedAnimation];
        currentPreviewFrame++;

        if (currentPreviewFrame >= frames.length) {
            if (loopEnabled) {
                currentPreviewFrame = 0;
            } else {
                currentPreviewFrame = frames.length - 1;
                stopAnimation();
                return;
            }
        }

        drawPreviewFrame();
    }

    animationFrameId = requestAnimationFrame(animationLoop);
}
