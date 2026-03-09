/**
 * Tiles Editor Webview
 * Runs in the browser context of the webview
 */

// Initialize VS Code API
const vscode = acquireVsCodeApi();

// State variables
let currentData;
let tilesetImage = null; // Loaded tileset image
let gridZoom = 1; // Grid view zoom level
let gridInteractionSetup = false; // Track if grid interaction is set up

// Initialize function
function initialize(data) {
    currentData = data;
    setupEventListeners();
    loadTilesetImage();
}

// Event listeners setup
function setupEventListeners() {
    // Top bar event listeners
    document.getElementById('browse-btn').addEventListener('click', () => {
        vscode.postMessage({ type: 'browse' });
    });

    document.getElementById('image-path').addEventListener('input', (e) => {
        let path = e.target.value;
        // Ensure path starts with [game]/
        if (path && !path.startsWith('[game]/')) {
            path = '[game]/' + path;
        }
        currentData.image = path;
        loadTilesetImage();
        updateDocument();
    });

    document.getElementById('columns').addEventListener('input', (e) => {
        currentData.columns = parseInt(e.target.value) || 1;
        if (tilesetImage) {
            redrawOverlay();
            updateCellSizeDisplay();
        }
        updateDocument();
    });

    document.getElementById('rows').addEventListener('input', (e) => {
        currentData.rows = parseInt(e.target.value) || 1;
        if (tilesetImage) {
            redrawOverlay();
            updateCellSizeDisplay();
        }
        updateDocument();
    });

    document.getElementById('image-padding').addEventListener('input', (e) => {
        currentData.imagePadding = parseInt(e.target.value) || 0;
        if (tilesetImage) {
            redrawOverlay();
            updateCellSizeDisplay();
        }
        updateDocument();
    });

    document.getElementById('padding').addEventListener('input', (e) => {
        currentData.padding = parseInt(e.target.value) || 0;
        if (tilesetImage) {
            redrawOverlay();
            updateCellSizeDisplay();
        }
        updateDocument();
    });

    // Grid zoom event listener
    document.getElementById('grid-zoom-select').addEventListener('change', (e) => {
        gridZoom = parseFloat(e.target.value) || 1;
        if (tilesetImage && tilesetImage.complete) {
            drawGridView();
        }
    });

    // Handle messages from extension
    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'dataChanged':
                // External change to the document (e.g., undo/redo, manual edit)
                currentData = message.data;
                document.getElementById('image-path').value = currentData.image || '';
                document.getElementById('columns').value = currentData.columns;
                document.getElementById('rows').value = currentData.rows;
                document.getElementById('image-padding').value = currentData.imagePadding || 0;
                document.getElementById('padding').value = currentData.padding || 0;
                loadTilesetImage();
                break;
            case 'imageSelected':
                let path = message.path;
                // Ensure path starts with [game]/
                if (path && !path.startsWith('[game]/')) {
                    path = '[game]/' + path;
                }
                document.getElementById('image-path').value = path;
                currentData.image = path;
                loadTilesetImage();
                updateDocument();
                break;
            case 'imageUri':
                // Received webview URI for image, now load it
                const gridView = document.getElementById('grid-view');
                tilesetImage = new Image();
                tilesetImage.onload = () => {
                    drawGridView();
                };
                tilesetImage.onerror = () => {
                    gridView.innerHTML = '<div class="grid-placeholder">Failed to load image</div>';
                    tilesetImage = null;
                };
                tilesetImage.src = message.uri;
                break;
        }
    });
}

// Load tileset image
function loadTilesetImage() {
    if (!currentData.image || currentData.image.trim() === '') {
        const gridView = document.getElementById('grid-view');
        gridView.innerHTML = '<div class="grid-placeholder">No image selected</div>';
        tilesetImage = null;
        updateCellSizeDisplay();
        return;
    }

    // Request the webview URI from extension
    vscode.postMessage({
        type: 'getImageUri',
        path: currentData.image
    });
}

// Update the document in VS Code
function updateDocument() {
    vscode.postMessage({
        type: 'update',
        data: currentData
    });
}

// Draw the grid view
function drawGridView() {
    const gridView = document.getElementById('grid-view');

    if (!tilesetImage || !tilesetImage.complete) {
        return;
    }

    const cols = currentData.columns;
    const rows = currentData.rows;
    const imgWidth = tilesetImage.width;
    const imgHeight = tilesetImage.height;

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

    // Checkerboard pattern (scaled)
    const checkSize = 16 * gridZoom;
    const color1 = '#666666';
    const color2 = '#4d4d4d';

    for (let y = 0; y < zoomedHeight; y += checkSize) {
        for (let x = 0; x < zoomedWidth; x += checkSize) {
            const isEven = (Math.floor(x / checkSize) + Math.floor(y / checkSize)) % 2 === 0;
            baseCtx.fillStyle = isEven ? color1 : color2;
            baseCtx.fillRect(x, y, checkSize, checkSize);
        }
    }

    // Draw tileset image on top (scaled)
    baseCtx.imageSmoothingEnabled = false; // Keep pixels crisp
    baseCtx.drawImage(tilesetImage, 0, 0, zoomedWidth, zoomedHeight);

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

// Update the cell size display
function updateCellSizeDisplay() {
    const display = document.getElementById('cell-size-display');
    if (!tilesetImage || !tilesetImage.complete) {
        display.textContent = 'Tile: -';
        return;
    }

    const imagePadding = currentData.imagePadding || 0;
    const effectiveImageWidth = tilesetImage.width - 2 * imagePadding;
    const effectiveImageHeight = tilesetImage.height - 2 * imagePadding;
    const cellWidth = Math.floor(effectiveImageWidth / currentData.columns);
    const cellHeight = Math.floor(effectiveImageHeight / currentData.rows);
    const padding = currentData.padding || 0;
    const effectiveWidth = Math.max(0, cellWidth - 2 * padding);
    const effectiveHeight = Math.max(0, cellHeight - 2 * padding);
    display.textContent = `Tile: ${effectiveWidth}×${effectiveHeight}px`;
}

// Redraw the overlay (grid lines and padding visualization)
function redrawOverlay() {
    const overlayCanvas = document.getElementById('grid-overlay-canvas');
    if (!overlayCanvas) {
        return;
    }

    const ctx = overlayCanvas.getContext('2d');
    const cols = currentData.columns;
    const rows = currentData.rows;
    const imagePadding = currentData.imagePadding || 0;
    const imagePaddingScaled = imagePadding * gridZoom;
    const effectiveWidth = overlayCanvas.width - 2 * imagePaddingScaled;
    const effectiveHeight = overlayCanvas.height - 2 * imagePaddingScaled;
    const cellWidth = effectiveWidth / cols;
    const cellHeight = effectiveHeight / rows;
    const padding = currentData.padding || 0;
    const paddingScaled = padding * gridZoom;

    ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    // Draw image padding area (edges of entire tileset)
    if (imagePadding > 0) {
        ctx.fillStyle = 'rgba(255, 0, 0, 0.2)';
        // Top edge
        ctx.fillRect(0, 0, overlayCanvas.width, imagePaddingScaled);
        // Bottom edge
        ctx.fillRect(0, overlayCanvas.height - imagePaddingScaled, overlayCanvas.width, imagePaddingScaled);
        // Left edge
        ctx.fillRect(0, 0, imagePaddingScaled, overlayCanvas.height);
        // Right edge
        ctx.fillRect(overlayCanvas.width - imagePaddingScaled, 0, imagePaddingScaled, overlayCanvas.height);
    }

    // Draw padding areas (dimmed regions per tile)
    if (padding > 0) {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const x = imagePaddingScaled + col * cellWidth;
                const y = imagePaddingScaled + row * cellHeight;

                // Top padding
                ctx.fillRect(x, y, cellWidth, paddingScaled);
                // Bottom padding
                ctx.fillRect(x, y + cellHeight - paddingScaled, cellWidth, paddingScaled);
                // Left padding
                ctx.fillRect(x, y, paddingScaled, cellHeight);
                // Right padding
                ctx.fillRect(x + cellWidth - paddingScaled, y, paddingScaled, cellHeight);
            }
        }

        // Draw inner rectangles showing effective tile area
        ctx.strokeStyle = 'rgba(100, 200, 255, 0.6)';
        ctx.lineWidth = 1;
        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const x = imagePaddingScaled + col * cellWidth + paddingScaled;
                const y = imagePaddingScaled + row * cellHeight + paddingScaled;
                const w = cellWidth - 2 * paddingScaled;
                const h = cellHeight - 2 * paddingScaled;
                ctx.strokeRect(x, y, w, h);
            }
        }
    }

    // Draw simple grid lines
    ctx.strokeStyle = '#80ff8091';
    ctx.lineWidth = 1;

    // Draw all vertical lines
    for (let x = 0; x <= cols; x++) {
        const xPos = Math.floor(imagePaddingScaled + x * cellWidth) + 0.5;
        ctx.beginPath();
        ctx.moveTo(xPos, imagePaddingScaled);
        ctx.lineTo(xPos, imagePaddingScaled + effectiveHeight);
        ctx.stroke();
    }

    // Draw all horizontal lines
    for (let y = 0; y <= rows; y++) {
        const yPos = Math.floor(imagePaddingScaled + y * cellHeight) + 0.5;
        ctx.beginPath();
        ctx.moveTo(imagePaddingScaled, yPos);
        ctx.lineTo(imagePaddingScaled + effectiveWidth, yPos);
        ctx.stroke();
    }

    // Draw tile indices
    ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
    ctx.lineWidth = 3;
    ctx.font = `bold ${Math.max(10, Math.min(cellWidth, cellHeight) * 0.2)}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const index = row * cols + col;
            const x = imagePaddingScaled + col * cellWidth + cellWidth / 2;
            const y = imagePaddingScaled + row * cellHeight + cellHeight / 2;
            const text = String(index);
            
            // Draw text with outline for better visibility
            ctx.strokeText(text, x, y);
            ctx.fillText(text, x, y);
        }
    }
}

// Setup grid interaction for tooltips
function setupGridInteraction(canvas) {
    const tooltip = document.getElementById('tile-tooltip');
    const cols = currentData.columns;

    canvas.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const imagePadding = currentData.imagePadding || 0;
        const imagePaddingScaled = imagePadding * gridZoom;
        const effectiveWidth = canvas.width - 2 * imagePaddingScaled;
        const effectiveHeight = canvas.height - 2 * imagePaddingScaled;
        const cellWidth = effectiveWidth / cols;
        const cellHeight = effectiveHeight / currentData.rows;

        // Check if mouse is within the effective grid area
        if (x >= imagePaddingScaled && x <= imagePaddingScaled + effectiveWidth &&
            y >= imagePaddingScaled && y <= imagePaddingScaled + effectiveHeight) {
            
            const col = Math.floor((x - imagePaddingScaled) / cellWidth);
            const row = Math.floor((y - imagePaddingScaled) / cellHeight);
            const tileIndex = row * cols + col;

            // Show tooltip
            tooltip.textContent = `Tile #${tileIndex} (row ${row}, col ${col})`;
            tooltip.style.display = 'block';
            tooltip.style.left = (e.clientX + 15) + 'px';
            tooltip.style.top = (e.clientY + 15) + 'px';
        } else {
            // Hide tooltip when outside grid
            tooltip.style.display = 'none';
        }
    });

    canvas.addEventListener('mouseleave', () => {
        tooltip.style.display = 'none';
    });
}

// Initialize on page load
initialize(initialData);
