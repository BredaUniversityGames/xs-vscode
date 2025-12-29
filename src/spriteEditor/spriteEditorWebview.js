/**
 * Sprite Editor Webview
 * Runs in the browser context of the webview
 */

// Initialize VS Code API
const vscode = acquireVsCodeApi();

// State variables
let currentData;
let selectedSprite;
let spriteImage = null;
let canvasZoom = 1;
let previewZoom = 2;
let isDrawing = false;
let selectionStart = null;
let currentSelection = null;
let canvasInteractionSetup = false; // Track if canvas interaction is set up

// DOM elements - will be initialized when DOM is ready
let canvasZoomSelect = null;
let canvasViewElement = null;
let canvasZoomLevels = [0.25, 0.5, 1, 2, 4];

// Initialize function
function initialize(data, selectedSpr) {
    currentData = data;
    selectedSprite = selectedSpr;
    
    // Initialize DOM element references
    canvasZoomSelect = document.getElementById('canvas-zoom-select');
    canvasViewElement = document.getElementById('canvas-view');
    canvasZoomLevels = canvasZoomSelect ?
        Array.from(canvasZoomSelect.options).map(option => parseFloat(option.value)) :
        [0.25, 0.5, 1, 2, 4];
    
    setupEventListeners();
    updateRemoveButtonState();
    loadSpriteSheet();
    renderPreview();
}

// Event listeners setup
function setupEventListeners() {
    // Top bar event listeners
    const browseBtn = document.getElementById('browse-btn');
    if (browseBtn) {
        browseBtn.addEventListener('click', () => {
            vscode.postMessage({ type: 'browse' });
        });
    }

    const imagePathInput = document.getElementById('image-path');
    if (imagePathInput) {
        imagePathInput.addEventListener('input', (e) => {
            const target = e.target;
            let path = target.value;
            // Ensure path starts with [game]/
            if (path && !path.startsWith('[game]/')) {
                path = '[game]/' + path;
            }
            currentData.image = path;
            loadSpriteSheet();
            updateDocument();
        });
    }

    // Canvas zoom event listener
    if (canvasZoomSelect) {
        canvasZoomSelect.addEventListener('change', (e) => {
            const target = e.target;
            const value = parseFloat(target.value);
            if (!isNaN(value)) {
                setCanvasZoom(value);
            }
        });
    }

    if (canvasViewElement) {
        canvasViewElement.addEventListener('wheel', handleCanvasZoomWheel, { passive: false });
    }

    // Preview zoom event listener
    const previewZoomSelect = document.getElementById('preview-zoom-select');
    if (previewZoomSelect) {
        previewZoomSelect.addEventListener('change', (e) => {
            const target = e.target;
            previewZoom = parseInt(target.value) || 2;
            renderPreview();
        });
    }

    // Panel resize functionality
    setupPanelResize();

    // Sprite list event listeners
    const removeBtn = document.getElementById('remove-sprite-btn');
    if (removeBtn) {
        removeBtn.addEventListener('click', () => {
            if (!selectedSprite) {
                return;
            }
            vscode.postMessage({
                type: 'confirmDelete',
                name: selectedSprite
            });
        });
    }

    const autoFitBtn = document.getElementById('auto-fit-sprite-btn');
    if (autoFitBtn) {
        autoFitBtn.addEventListener('click', () => {
            if (!selectedSprite) {
                return;
            }
            autoFitSprite(selectedSprite);
        });
    }

    // Sprite item selection
    const spriteList = document.getElementById('sprite-list');
    if (spriteList) {
        spriteList.addEventListener('click', (e) => {
            const item = e.target.closest('.sprite-item');
            if (item) {
                document.querySelectorAll('.sprite-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
                selectedSprite = item.dataset.name || null;
                spriteList.focus();
                updateRemoveButtonState();
                renderPreview();
                redrawOverlay();
            }
        });

        // Sprite item rename (double-click)
        spriteList.addEventListener('dblclick', (e) => {
            const item = e.target.closest('.sprite-item');
            if (!item) return;

            const currentName = item.dataset.name;
            if (currentName) {
                vscode.postMessage({
                    type: 'promptRename',
                    currentName: currentName
                });
            }
        });
    }

    // Handle messages from extension
    window.addEventListener('message', handleExtensionMessage);
}

// Panel resize setup
function setupPanelResize() {
    const resizeHandle = document.getElementById('resize-handle');
    const bottomPanel = document.getElementById('bottom-panel');
    
    if (!resizeHandle || !bottomPanel) return;

    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startY = e.clientY;
        startHeight = bottomPanel.offsetHeight;
        document.body.style.cursor = 'ns-resize';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const delta = startY - e.clientY;
        const newHeight = startHeight + delta;

        // Respect min and max height
        if (newHeight >= 100 && newHeight <= 600) {
            bottomPanel.style.height = newHeight + 'px';
        }
    });

    document.addEventListener('mouseup', () => {
        if (isResizing) {
            isResizing = false;
            document.body.style.cursor = '';
        }
    });
}

// Handle messages from extension
function handleExtensionMessage(event) {
    const message = event.data;
    switch (message.type) {
        case 'imageSelected':
            let path = message.path;
            // Ensure path starts with [game]/
            if (path && !path.startsWith('[game]/')) {
                path = '[game]/' + path;
            }
            const imagePathInput = document.getElementById('image-path');
            if (imagePathInput) {
                imagePathInput.value = path;
            }
            currentData.image = path;
            loadSpriteSheet();
            updateDocument();
            break;
        case 'spriteNameEntered':
            if (currentSelection) {
                currentData.sprites[message.name] = { ...currentSelection };
                selectedSprite = message.name;
                currentSelection = null;
                rebuildSpriteList();
                renderPreview();
                redrawOverlay();
                updateDocument();
            }
            break;
        case 'deleteConfirmed':
            delete currentData.sprites[message.name];
            selectedSprite = null;
            rebuildSpriteList();
            renderPreview();
            redrawOverlay();
            updateDocument();
            break;
        case 'renameConfirmed':
            currentData.sprites[message.newName] = currentData.sprites[message.oldName];
            delete currentData.sprites[message.oldName];
            if (selectedSprite === message.oldName) {
                selectedSprite = message.newName;
            }
            rebuildSpriteList();
            renderPreview();
            updateDocument();
            break;
        case 'imageUri':
            // Received webview URI for image, now load it
            const canvasView = document.getElementById('canvas-view');
            if (!canvasView) return;
            
            spriteImage = new Image();
            spriteImage.onload = () => {
                drawCanvasView();
                renderPreview();
            };
            spriteImage.onerror = (err) => {
                console.error('Failed to load image:', message.uri, err);
                canvasView.innerHTML = '<div class="canvas-placeholder">Failed to load image: ' + currentData.image + '</div>';
                spriteImage = null;
            };
            spriteImage.src = message.uri;
            break;
        case 'dataUpdated':
            // External update to the document - update our data without resetting view state
            currentData = message.data;

            // Update image path input if changed
            const imagePathInputEl = document.getElementById('image-path');
            if (imagePathInputEl && imagePathInputEl.value !== currentData.image) {
                imagePathInputEl.value = currentData.image;
                loadSpriteSheet();
            }

            // Check if selected sprite still exists
            if (selectedSprite && !currentData.sprites[selectedSprite]) {
                selectedSprite = null;
            }

            // Rebuild UI elements but preserve zoom and other state
            rebuildSpriteList();
            renderPreview();
            if (spriteImage && spriteImage.complete) {
                redrawOverlay();
            }
            break;
    }
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
    const removeBtn = document.getElementById('remove-sprite-btn');
    const autoFitBtn = document.getElementById('auto-fit-sprite-btn');

    if (selectedSprite && currentData.sprites[selectedSprite]) {
        if (removeBtn) removeBtn.removeAttribute('disabled');
        if (autoFitBtn) autoFitBtn.removeAttribute('disabled');
    } else {
        if (removeBtn) removeBtn.setAttribute('disabled', 'true');
        if (autoFitBtn) autoFitBtn.setAttribute('disabled', 'true');
    }
}

// Rebuild sprite list UI
function rebuildSpriteList() {
    const listEl = document.getElementById('sprite-list');
    if (!listEl) return;

    const sprites = Object.entries(currentData.sprites);

    if (sprites.length === 0) {
        listEl.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--vscode-descriptionForeground); font-size: 12px;">No sprites</div>';
        selectedSprite = null;
    } else {
        listEl.innerHTML = sprites.map(([name, rect], index) => {
            const hue = (index * 360) / Math.max(sprites.length, 1);
            const color = `hsl(${hue}, 70%, 60%)`;
            const isSelected = name === selectedSprite;
            return `
                <div class="sprite-item ${isSelected ? 'selected' : ''}" data-name="${escapeHtml(name)}">
                    <div class="sprite-color-dot" style="background: ${color};"></div>
                    <div class="sprite-item-name">${escapeHtml(name)}</div>
                </div>
            `;
        }).join('');

        // If selected sprite was deleted, select first one
        if (selectedSprite && !currentData.sprites[selectedSprite]) {
            selectedSprite = sprites[0][0];
        }
    }

    updateRemoveButtonState();

    // Redraw canvas to update sprite rectangles
    if (spriteImage) {
        redrawOverlay();
    }
}

// Auto-fit sprite to connected pixels using flood fill
function autoFitSprite(spriteName) {
    if (!spriteImage || !spriteImage.complete) {
        return;
    }

    const sprite = currentData.sprites[spriteName];
    if (!sprite) {
        return;
    }

    // Create a temporary canvas to get pixel data
    const canvas = document.createElement('canvas');
    canvas.width = spriteImage.width;
    canvas.height = spriteImage.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(spriteImage, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Start from center of current sprite
    const centerX = Math.floor(sprite.x + sprite.width / 2);
    const centerY = Math.floor(sprite.y + sprite.height / 2);

    // Check if center pixel is transparent
    const centerIdx = (centerY * canvas.width + centerX) * 4;
    const centerAlpha = data[centerIdx + 3];
    
    if (centerAlpha === 0) {
        vscode.postMessage({
            type: 'showError',
            message: 'Center of sprite is transparent. Cannot auto-fit.'
        });
        return;
    }

    // Flood fill to find all connected non-transparent pixels
    const visited = new Set();
    const queue = [[centerX, centerY]];
    let minX = centerX, maxX = centerX;
    let minY = centerY, maxY = centerY;

    while (queue.length > 0) {
        const [x, y] = queue.shift();
        const key = `${x},${y}`;

        if (visited.has(key)) continue;
        if (x < 0 || x >= canvas.width || y < 0 || y >= canvas.height) continue;

        const idx = (y * canvas.width + x) * 4;
        const alpha = data[idx + 3];

        // Skip transparent pixels
        if (alpha === 0) continue;

        visited.add(key);

        // Update bounds
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);

        // Add neighbors
        queue.push([x + 1, y]);
        queue.push([x - 1, y]);
        queue.push([x, y + 1]);
        queue.push([x, y - 1]);
    }

    // Update sprite bounds (add 1 to max because it's exclusive)
    currentData.sprites[spriteName] = {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1
    };

    rebuildSpriteList();
    redrawOverlay();
    renderPreview();
    updateDocument();
}

// Canvas zoom functions
function setCanvasZoom(value) {
    canvasZoom = value;
    if (canvasZoomSelect) {
        canvasZoomSelect.value = value.toString();
    }
    if (spriteImage && spriteImage.complete) {
        drawCanvasView();
    }
}

function adjustCanvasZoom(step) {
    if (canvasZoomLevels.length === 0) {
        return;
    }
    let closestIndex = 0;
    let smallestDiff = Infinity;
    canvasZoomLevels.forEach((level, index) => {
        const diff = Math.abs(level - canvasZoom);
        if (diff < smallestDiff) {
            smallestDiff = diff;
            closestIndex = index;
        }
    });
    const nextIndex = Math.max(0, Math.min(canvasZoomLevels.length - 1, closestIndex + step));
    setCanvasZoom(canvasZoomLevels[nextIndex]);
}

function handleCanvasZoomWheel(event) {
    if (!event.ctrlKey && !event.metaKey) {
        return;
    }
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    adjustCanvasZoom(direction);
}

// Canvas View Functions
function loadSpriteSheet() {
    const canvasView = document.getElementById('canvas-view');
    if (!canvasView) return;

    if (!currentData.image) {
        canvasView.innerHTML = '<div class="canvas-placeholder">Select a sprite sheet to begin</div>';
        spriteImage = null;
        return;
    }

    canvasView.innerHTML = '<div class="canvas-placeholder">Loading image...</div>';

    // Request webview URI from extension
    vscode.postMessage({
        type: 'getImageUri',
        path: currentData.image
    });
}

function drawCanvasView() {
    const canvasView = document.getElementById('canvas-view');
    if (!canvasView) return;

    if (!spriteImage || !spriteImage.complete) {
        return;
    }

    const imgWidth = spriteImage.width;
    const imgHeight = spriteImage.height;

    // Apply zoom to dimensions
    const zoomedWidth = Math.floor(imgWidth * canvasZoom);
    const zoomedHeight = Math.floor(imgHeight * canvasZoom);

    // Create container
    canvasView.innerHTML = '';
    canvasInteractionSetup = false; // Reset since we're creating new canvases
    const container = document.createElement('div');
    container.className = 'canvas-container';
    container.style.width = zoomedWidth + 'px';
    container.style.height = zoomedHeight + 'px';

    const baseCanvas = document.createElement('canvas');
    baseCanvas.id = 'canvas-base';
    baseCanvas.width = zoomedWidth;
    baseCanvas.height = zoomedHeight;

    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.id = 'canvas-overlay';
    overlayCanvas.width = zoomedWidth;
    overlayCanvas.height = zoomedHeight;

    container.appendChild(baseCanvas);
    container.appendChild(overlayCanvas);
    canvasView.appendChild(container);

    // Draw checkerboard background on base canvas
    const baseCtx = baseCanvas.getContext('2d');
    if (!baseCtx) return;

    // Checkerboard pattern
    const checkSize = 16;
    const color1 = '#cccccc';
    const color2 = '#999999';

    for (let y = 0; y < zoomedHeight; y += checkSize) {
        for (let x = 0; x < zoomedWidth; x += checkSize) {
            const isEven = (Math.floor(x / checkSize) + Math.floor(y / checkSize)) % 2 === 0;
            baseCtx.fillStyle = isEven ? color1 : color2;
            baseCtx.fillRect(x, y, checkSize, checkSize);
        }
    }

    // Draw sprite sheet on top with pixel-perfect rendering
    baseCtx.imageSmoothingEnabled = false;
    baseCtx.drawImage(spriteImage, 0, 0, zoomedWidth, zoomedHeight);

    // Draw sprite rectangles on overlay
    redrawOverlay();

    // Setup interaction only once
    if (!canvasInteractionSetup) {
        setupCanvasInteraction(overlayCanvas);
        canvasInteractionSetup = true;
    }
}

function redrawOverlay() {
    const overlayCanvas = document.getElementById('canvas-overlay');
    if (!overlayCanvas) {
        return;
    }

    const ctx = overlayCanvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    // Draw existing sprite rectangles
    const sprites = Object.entries(currentData.sprites);
    sprites.forEach(([name, rect], index) => {
        const hue = (index * 360) / Math.max(sprites.length, 1);
        const color = `hsl(${hue}, 70%, 60%)`;

        // Scale rect to zoom
        const x = rect.x * canvasZoom;
        const y = rect.y * canvasZoom;
        const width = rect.width * canvasZoom;
        const height = rect.height * canvasZoom;

        // Draw semi-transparent fill
        ctx.fillStyle = name === selectedSprite ? 'rgba(100, 150, 255, 0.15)' : 'rgba(0, 0, 0, 0.1)';
        ctx.fillRect(x, y, width, height);

        // Draw rectangle outline
        ctx.strokeStyle = color;
        ctx.lineWidth = name === selectedSprite ? 3 : 2;
        ctx.strokeRect(x, y, width, height);

        // Draw label
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(x, y - 16, ctx.measureText(name).width + 8, 16);
        ctx.fillStyle = color;
        ctx.font = '12px var(--vscode-font-family)';
        ctx.fillText(name, x + 4, y - 4);

        // Draw handles for selected sprite
        if (name === selectedSprite) {
            const handleSize = 6;
            ctx.fillStyle = color;
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1;

            // Corner handles
            const corners = [
                { cx: x, cy: y },                           // top-left
                { cx: x + width, cy: y },                   // top-right
                { cx: x + width, cy: y + height },          // bottom-right
                { cx: x, cy: y + height }                   // bottom-left
            ];

            // Edge handles
            const edges = [
                { cx: x + width / 2, cy: y },               // top
                { cx: x + width, cy: y + height / 2 },      // right
                { cx: x + width / 2, cy: y + height },      // bottom
                { cx: x, cy: y + height / 2 }               // left
            ];

            [...corners, ...edges].forEach(handle => {
                ctx.fillRect(handle.cx - handleSize / 2, handle.cy - handleSize / 2, handleSize, handleSize);
                ctx.strokeRect(handle.cx - handleSize / 2, handle.cy - handleSize / 2, handleSize, handleSize);
            });
        }

        // Draw reticle at center of sprite
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const reticleSize = 8;

        ctx.strokeStyle = color;
        ctx.lineWidth = 1;

        // Horizontal line
        ctx.beginPath();
        ctx.moveTo(centerX - reticleSize, centerY);
        ctx.lineTo(centerX + reticleSize, centerY);
        ctx.stroke();

        // Vertical line
        ctx.beginPath();
        ctx.moveTo(centerX, centerY - reticleSize);
        ctx.lineTo(centerX, centerY + reticleSize);
        ctx.stroke();

        // Center dot
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(centerX, centerY, 2, 0, Math.PI * 2);
        ctx.fill();
    });

    // Draw current selection
    if (currentSelection) {
        const x = currentSelection.x * canvasZoom;
        const y = currentSelection.y * canvasZoom;
        const width = currentSelection.width * canvasZoom;
        const height = currentSelection.height * canvasZoom;

        ctx.strokeStyle = 'rgba(100, 150, 255, 0.8)';
        ctx.lineWidth = 2;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(x, y, width, height);
        ctx.setLineDash([]);

        ctx.fillStyle = 'rgba(100, 150, 255, 0.2)';
        ctx.fillRect(x, y, width, height);
    }
}

// Check if a point is inside a sprite rectangle
function findSpriteAtPoint(x, y) {
    const sprites = Object.entries(currentData.sprites);
    for (let i = sprites.length - 1; i >= 0; i--) {
        const [name, rect] = sprites[i];
        if (x >= rect.x && x < rect.x + rect.width &&
            y >= rect.y && y < rect.y + rect.height) {
            return name;
        }
    }
    return null;
}

// Find which handle (if any) is at the given point
function findHandleAtPoint(x, y, sprite) {
    if (!sprite) return null;

    const handleSize = 6 / canvasZoom; // Account for zoom
    const tolerance = handleSize;

    const rect = currentData.sprites[sprite];
    if (!rect) return null;

    // Check corners first (higher priority)
    const corners = [
        { name: 'nw', px: rect.x, py: rect.y },
        { name: 'ne', px: rect.x + rect.width, py: rect.y },
        { name: 'se', px: rect.x + rect.width, py: rect.y + rect.height },
        { name: 'sw', px: rect.x, py: rect.y + rect.height }
    ];

    for (const corner of corners) {
        if (Math.abs(x - corner.px) <= tolerance && Math.abs(y - corner.py) <= tolerance) {
            return corner.name;
        }
    }

    // Check edges
    const edges = [
        { name: 'n', condition: Math.abs(y - rect.y) <= tolerance && x >= rect.x && x <= rect.x + rect.width },
        { name: 'e', condition: Math.abs(x - (rect.x + rect.width)) <= tolerance && y >= rect.y && y <= rect.y + rect.height },
        { name: 's', condition: Math.abs(y - (rect.y + rect.height)) <= tolerance && x >= rect.x && x <= rect.x + rect.width },
        { name: 'w', condition: Math.abs(x - rect.x) <= tolerance && y >= rect.y && y <= rect.y + rect.height }
    ];

    for (const edge of edges) {
        if (edge.condition) {
            return edge.name;
        }
    }

    return null;
}

// Update cursor based on handle type
function getCursorForHandle(handle) {
    const cursors = {
        'nw': 'nw-resize',
        'ne': 'ne-resize',
        'se': 'se-resize',
        'sw': 'sw-resize',
        'n': 'n-resize',
        'e': 'e-resize',
        's': 's-resize',
        'w': 'w-resize',
        'move': 'move'
    };
    return cursors[handle] || 'crosshair';
}

function setupCanvasInteraction(canvas) {
    let dragMode = null;
    let dragHandle = null;
    let editingSprite = null;
    let dragStart = null;
    let originalRect = null;

    canvas.addEventListener('mousemove', (e) => {
        if (isDrawing) {
            // Currently dragging
            const rect = canvas.getBoundingClientRect();
            const x = Math.floor((e.clientX - rect.left) / canvasZoom);
            const y = Math.floor((e.clientY - rect.top) / canvasZoom);

            if (dragMode === 'create' && dragStart) {
                // Creating new sprite
                currentSelection = {
                    x: Math.min(dragStart.x, x),
                    y: Math.min(dragStart.y, y),
                    width: Math.abs(x - dragStart.x),
                    height: Math.abs(y - dragStart.y)
                };
            } else if (dragMode === 'handle' && originalRect && dragStart && dragHandle) {
                // Dragging a handle
                const dx = x - dragStart.x;
                const dy = y - dragStart.y;
                const newRect = { ...originalRect };

                // Apply delta based on handle type
                if (dragHandle.includes('n')) {
                    newRect.y = originalRect.y + dy;
                    newRect.height = originalRect.height - dy;
                }
                if (dragHandle.includes('s')) {
                    newRect.height = originalRect.height + dy;
                }
                if (dragHandle.includes('w')) {
                    newRect.x = originalRect.x + dx;
                    newRect.width = originalRect.width - dx;
                }
                if (dragHandle.includes('e')) {
                    newRect.width = originalRect.width + dx;
                }

                // Ensure minimum size
                if (newRect.width < 1) {
                    newRect.x = originalRect.x + originalRect.width - 1;
                    newRect.width = 1;
                }
                if (newRect.height < 1) {
                    newRect.y = originalRect.y + originalRect.height - 1;
                    newRect.height = 1;
                }

                currentSelection = newRect;
            } else if (dragMode === 'move' && originalRect && dragStart) {
                // Moving sprite
                const dx = x - dragStart.x;
                const dy = y - dragStart.y;
                currentSelection = {
                    x: originalRect.x + dx,
                    y: originalRect.y + dy,
                    width: originalRect.width,
                    height: originalRect.height
                };
            }

            redrawOverlay();
        } else {
            // Update cursor based on what's under the mouse
            const rect = canvas.getBoundingClientRect();
            const x = Math.floor((e.clientX - rect.left) / canvasZoom);
            const y = Math.floor((e.clientY - rect.top) / canvasZoom);

            if (selectedSprite) {
                const handle = findHandleAtPoint(x, y, selectedSprite);
                if (handle) {
                    canvas.style.cursor = getCursorForHandle(handle);
                    return;
                }

                const sprite = findSpriteAtPoint(x, y);
                if (sprite === selectedSprite) {
                    canvas.style.cursor = 'move';
                    return;
                }
            }

            canvas.style.cursor = 'crosshair';
        }
    });

    canvas.addEventListener('mousedown', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left) / canvasZoom);
        const y = Math.floor((e.clientY - rect.top) / canvasZoom);

        dragStart = { x, y };

        // Check if clicking on a handle of the selected sprite
        if (selectedSprite) {
            const handle = findHandleAtPoint(x, y, selectedSprite);
            if (handle) {
                // Start dragging handle
                dragMode = 'handle';
                dragHandle = handle;
                editingSprite = selectedSprite;
                originalRect = { ...currentData.sprites[selectedSprite] };
                currentSelection = { ...originalRect };
                isDrawing = true;
                return;
            }

            // Check if clicking inside selected sprite (move mode)
            const clickedSprite = findSpriteAtPoint(x, y);
            if (clickedSprite === selectedSprite) {
                dragMode = 'move';
                editingSprite = selectedSprite;
                originalRect = { ...currentData.sprites[selectedSprite] };
                currentSelection = { ...originalRect };
                isDrawing = true;
                return;
            }
        }

        // Check if clicking on another sprite (select it)
        const clickedSprite = findSpriteAtPoint(x, y);
        if (clickedSprite) {
            selectedSprite = clickedSprite;
            rebuildSpriteList();
            renderPreview();
            redrawOverlay();
            return;
        }

        // Otherwise, start creating new sprite
        dragMode = 'create';
        editingSprite = null;
        isDrawing = true;
        currentSelection = { x, y, width: 0, height: 0 };
        redrawOverlay();
    });

    canvas.addEventListener('mouseup', (e) => {
        if (!isDrawing) return;
        isDrawing = false;

        if (currentSelection && currentSelection.width > 0 && currentSelection.height > 0) {
            if ((dragMode === 'handle' || dragMode === 'move') && editingSprite) {
                // Update existing sprite
                currentData.sprites[editingSprite] = { ...currentSelection };
                currentSelection = null;
                redrawOverlay();
                renderPreview();
                updateDocument();
            } else if (dragMode === 'create') {
                // Prompt for new sprite name
                vscode.postMessage({ type: 'promptSpriteName' });
            }
        } else {
            currentSelection = null;
            redrawOverlay();
        }

        dragMode = null;
        dragHandle = null;
        editingSprite = null;
        originalRect = null;
        dragStart = null;
    });

    canvas.addEventListener('mouseleave', () => {
        if (isDrawing) {
            isDrawing = false;
            currentSelection = null;
            dragMode = null;
            dragHandle = null;
            editingSprite = null;
            originalRect = null;
            dragStart = null;
            redrawOverlay();
        }
        canvas.style.cursor = 'crosshair';
    });
}

// Preview Functions
function renderPreview() {
    const previewEl = document.getElementById('preview');
    if (!previewEl) return;

    if (!selectedSprite || !currentData.sprites[selectedSprite]) {
        previewEl.innerHTML = '<div class="preview-placeholder">No sprite selected</div>';
        return;
    }

    if (!spriteImage || !spriteImage.complete) {
        previewEl.innerHTML = '<div class="preview-placeholder">Loading...</div>';
        return;
    }

    const sprite = currentData.sprites[selectedSprite];

    // Use preview zoom for scaling
    const previewWidth = sprite.width * previewZoom;
    const previewHeight = sprite.height * previewZoom;

    // Build preview HTML
    previewEl.innerHTML = `
        <div class="preview-canvas-container">
            <canvas id="preview-canvas"></canvas>
        </div>
        <div class="preview-info">
            <div class="preview-info-row">
                <span class="preview-info-label">Name:</span>
                <span>${escapeHtml(selectedSprite)}</span>
            </div>
            <div class="preview-info-row">
                <span class="preview-info-label">Position:</span>
                <span>x: ${sprite.x}, y: ${sprite.y}</span>
            </div>
            <div class="preview-info-row">
                <span class="preview-info-label">Size:</span>
                <span>${sprite.width} × ${sprite.height}px</span>
            </div>
            <div class="preview-info-row">
                <span class="preview-info-label">Zoom:</span>
                <span>${previewZoom}x</span>
            </div>
        </div>
    `;

    const canvas = document.getElementById('preview-canvas');
    if (!canvas) return;
    
    canvas.width = previewWidth;
    canvas.height = previewHeight;

    // Draw sprite
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Draw checkerboard
    const checkSize = 8;
    const color1 = '#cccccc';
    const color2 = '#999999';
    for (let y = 0; y < previewHeight; y += checkSize) {
        for (let x = 0; x < previewWidth; x += checkSize) {
            const isEven = (Math.floor(x / checkSize) + Math.floor(y / checkSize)) % 2 === 0;
            ctx.fillStyle = isEven ? color1 : color2;
            ctx.fillRect(x, y, checkSize, checkSize);
        }
    }

    // Draw sprite
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
        spriteImage,
        sprite.x, sprite.y, sprite.width, sprite.height,
        0, 0, previewWidth, previewHeight
    );

    // Draw center reticle
    const centerX = previewWidth / 2;
    const centerY = previewHeight / 2;
    const reticleSize = 10;

    ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
    ctx.lineWidth = 1;

    // Horizontal line
    ctx.beginPath();
    ctx.moveTo(centerX - reticleSize, centerY);
    ctx.lineTo(centerX + reticleSize, centerY);
    ctx.stroke();

    // Vertical line
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - reticleSize);
    ctx.lineTo(centerX, centerY + reticleSize);
    ctx.stroke();

    // Center dot
    ctx.fillStyle = 'rgba(255, 0, 0, 0.8)';
    ctx.fillRect(centerX - 1, centerY - 1, 2, 2);
}

// Utility function
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Export initialize function to be called from HTML
window.initializeSpriteEditor = initialize;
