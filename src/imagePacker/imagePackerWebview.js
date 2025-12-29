// @ts-check

// Acquire VS Code API
const vscode = acquireVsCodeApi();

// State
let sources = []; // Array of SourceImage objects
let selectedIndex = -1;
let outputPath = 'atlas.png';
let padding = 2;
let canvasZoom = 1;
let packedAtlas = null; // { width, height, canvas }
let loadedImages = new Map(); // path -> HTMLImageElement

// Initialize with data from the .xsatlas file
function initialize() {
    // Read data from embedded JSON
    const dataElement = document.getElementById('atlas-data');
    if (dataElement) {
        try {
            const data = JSON.parse(dataElement.textContent);
            if (data) {
                outputPath = data.outputImage || 'atlas.png';
                padding = data.padding !== undefined ? data.padding : 2;
                sources = data.sources || [];

                // Set UI values
                document.getElementById('output-path').value = outputPath;
                document.getElementById('padding-input').value = padding;
            }
        } catch (e) {
            console.error('Failed to parse atlas data:', e);
        }
    }

    setupEventListeners();
    updateUI();
    loadAllImages();
}

function setupEventListeners() {
    // Top bar controls
    document.getElementById('output-path').addEventListener('input', (e) => {
        outputPath = e.target.value;
        saveDocument();
    });

    document.getElementById('browse-output-btn').addEventListener('click', () => {
        vscode.postMessage({ type: 'browseOutput' });
    });

    document.getElementById('padding-input').addEventListener('input', (e) => {
        padding = parseInt(e.target.value) || 0;
        saveDocument();
    });

    document.getElementById('pack-preview-btn').addEventListener('click', async () => {
        await packAndPreview();
    });

    // Left panel buttons
    document.getElementById('add-images-btn').addEventListener('click', () => {
        vscode.postMessage({ type: 'browseImages' });
    });

    document.getElementById('remove-image-btn').addEventListener('click', () => {
        if (selectedIndex >= 0 && selectedIndex < sources.length) {
            sources.splice(selectedIndex, 1);
            selectedIndex = -1;
            saveDocument();
            updateUI();
        }
    });

    // Bottom bar button
    document.getElementById('export-btn').addEventListener('click', () => {
        exportAtlas();
    });

    // Zoom control
    document.getElementById('zoom-select').addEventListener('change', (e) => {
        canvasZoom = parseFloat(e.target.value);
        if (packedAtlas) {
            renderPreview();
        }
    });

    // Handle messages from extension
    window.addEventListener('message', handleExtensionMessage);
}

function handleExtensionMessage(event) {
    const message = event.data;
    switch (message.type) {
        case 'imagesSelected':
            handleImagesSelected(message.paths);
            break;
        case 'outputPathSelected':
            outputPath = message.path;
            document.getElementById('output-path').value = outputPath;
            saveDocument();
            break;
        case 'imageUri':
            handleImageUri(message.path, message.uri);
            break;
        case 'dataUpdated':
            // External file change
            if (message.data) {
                outputPath = message.data.outputImage || 'atlas.png';
                padding = message.data.padding || 2;
                sources = message.data.sources || [];
                document.getElementById('output-path').value = outputPath;
                document.getElementById('padding-input').value = padding;
                updateUI();
                loadAllImages();
            }
            break;
        case 'exportError':
            console.error('Export error:', message.message);
            break;
    }
}

function handleImagesSelected(paths) {
    // Add new images to sources
    for (const imagePath of paths) {
        const name = imagePath.split(/[\\/]/).pop();
        sources.push({
            path: imagePath,
            name: name,
            trim: { top: 0, right: 0, bottom: 0, left: 0 }
        });
    }
    saveDocument();
    updateUI();
    loadAllImages();
}

function handleImageUri(path, uri) {
    const img = new Image();
    img.onload = () => {
        loadedImages.set(path, img);
        // Update dimensions in sources
        const source = sources.find(s => s.path === path);
        if (source) {
            source.width = img.width;
            source.height = img.height;
            updateTrimmedDimensions(source);
        }
        // Check if all images are loaded
        const allLoaded = sources.every(s => loadedImages.has(s.path));
        if (allLoaded) {
            updateUI();
        }
    };
    img.onerror = (err) => {
        console.error('Failed to load image:', path, err);
    };
    img.src = uri;
}

function loadAllImages() {
    for (const source of sources) {
        if (!loadedImages.has(source.path)) {
            vscode.postMessage({
                type: 'getImageUri',
                path: source.path
            });
        }
    }
}

function updateTrimmedDimensions(source) {
    if (source.width !== undefined && source.height !== undefined) {
        source.trimmedWidth = Math.max(0, source.width - source.trim.left - source.trim.right);
        source.trimmedHeight = Math.max(0, source.height - source.trim.top - source.trim.bottom);
    }
}

function saveDocument() {
    // Send update to extension to save the file
    vscode.postMessage({
        type: 'update',
        data: {
            outputImage: outputPath,
            padding: padding,
            sources: sources.map(s => ({
                path: s.path,
                name: s.name,
                trim: s.trim
            }))
        }
    });
}

function updateUI() {
    updateImagesList();
    updateRemoveButton();
    updateExportButton();
    updateImagesCount();
}

function updateImagesCount() {
    document.getElementById('images-count').textContent = `Images (${sources.length})`;
}

function updateImagesList() {
    const listEl = document.getElementById('images-list');

    if (sources.length === 0) {
        listEl.innerHTML = '<div class="empty-state">Click "+ Add Images" to begin</div>';
        return;
    }

    listEl.innerHTML = sources.map((source, index) => {
        const isSelected = index === selectedIndex;
        const dimensions = source.width !== undefined
            ? `${source.width}×${source.height}px`
            : 'Loading...';
        const trimmedDim = source.trimmedWidth !== undefined
            ? `→ ${source.trimmedWidth}×${source.trimmedHeight}px`
            : '';

        return `
            <div class="image-item ${isSelected ? 'selected' : ''}" data-index="${index}">
                <div class="image-item-header">
                    <input type="checkbox" ${isSelected ? 'checked' : ''} data-index="${index}">
                    <span class="image-name">${escapeHtml(source.name)}</span>
                </div>
                <div class="image-dimensions">${dimensions} ${trimmedDim}</div>
                <div class="trim-inputs">
                    <div class="trim-row trim-all-row">
                        <label>Trim:</label>
                        <input type="number" class="trim-all-input" data-index="${index}"
                               value="0" min="0" max="999" placeholder="All sides">
                    </div>
                    <div class="trim-row">
                        <label>T:</label>
                        <input type="number" class="trim-input" data-index="${index}" data-side="top"
                               value="${source.trim.top}" min="0" max="999">
                        <label>R:</label>
                        <input type="number" class="trim-input" data-index="${index}" data-side="right"
                               value="${source.trim.right}" min="0" max="999">
                    </div>
                    <div class="trim-row">
                        <label>B:</label>
                        <input type="number" class="trim-input" data-index="${index}" data-side="bottom"
                               value="${source.trim.bottom}" min="0" max="999">
                        <label>L:</label>
                        <input type="number" class="trim-input" data-index="${index}" data-side="left"
                               value="${source.trim.left}" min="0" max="999">
                    </div>
                </div>
            </div>
        `;
    }).join('');

    // Add event listeners to checkboxes
    listEl.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (e) => {
            const index = parseInt(e.target.dataset.index);
            selectedIndex = e.target.checked ? index : -1;
            updateUI();
        });
    });

    // Add event listeners to trim-all inputs
    listEl.querySelectorAll('.trim-all-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const index = parseInt(e.target.dataset.index);
            const value = parseInt(e.target.value) || 0;

            // Set all four sides to the same value
            sources[index].trim.top = value;
            sources[index].trim.right = value;
            sources[index].trim.bottom = value;
            sources[index].trim.left = value;

            updateTrimmedDimensions(sources[index]);
            saveDocument();
            updateUI();
        });
    });

    // Add event listeners to individual trim inputs
    listEl.querySelectorAll('.trim-input').forEach(input => {
        input.addEventListener('input', (e) => {
            const index = parseInt(e.target.dataset.index);
            const side = e.target.dataset.side;
            const value = parseInt(e.target.value) || 0;
            sources[index].trim[side] = value;
            updateTrimmedDimensions(sources[index]);
            saveDocument();
            updateUI();
        });
    });
}

function updateRemoveButton() {
    const removeBtn = document.getElementById('remove-image-btn');
    if (selectedIndex >= 0) {
        removeBtn.removeAttribute('disabled');
    } else {
        removeBtn.setAttribute('disabled', 'true');
    }
}

function updateExportButton() {
    const exportBtn = document.getElementById('export-btn');
    if (packedAtlas && outputPath) {
        exportBtn.removeAttribute('disabled');
    } else {
        exportBtn.setAttribute('disabled', 'true');
    }
}

async function packAndPreview() {
    if (sources.length === 0) {
        showPreviewMessage('No images to pack');
        return;
    }

    // Ensure all images are loaded
    const allLoaded = sources.every(s => loadedImages.has(s.path));
    if (!allLoaded) {
        showPreviewMessage('Loading images...');
        return;
    }

    // Update trimmed dimensions
    sources.forEach(updateTrimmedDimensions);

    // Pack using shelf-packing algorithm
    packedAtlas = packImages(sources, padding);

    // Render preview
    renderPreview();

    // Update UI
    updateExportButton();
}

function packImages(sources, padding) {
    // Sort by trimmed height (tallest first)
    const sortedSources = [...sources].sort((a, b) =>
        (b.trimmedHeight || 0) - (a.trimmedHeight || 0)
    );

    let currentX = padding;
    let currentY = padding;
    let currentShelfHeight = 0;
    let maxX = 0;
    let maxY = 0;

    for (const source of sortedSources) {
        const w = source.trimmedWidth || 0;
        const h = source.trimmedHeight || 0;

        // Try to fit on current shelf
        if (currentX + w + padding > maxX && currentX > padding) {
            // Move to next shelf
            currentY += currentShelfHeight + padding;
            currentX = padding;
            currentShelfHeight = 0;
        }

        // Place image
        source.x = currentX;
        source.y = currentY;

        // Update shelf and bounds
        currentX += w + padding;
        currentShelfHeight = Math.max(currentShelfHeight, h);
        maxX = Math.max(maxX, currentX);
        maxY = Math.max(maxY, currentY + h + padding);
    }

    const atlasWidth = maxX;
    const atlasHeight = maxY;

    // Create canvas and render
    const canvas = document.createElement('canvas');
    canvas.width = atlasWidth;
    canvas.height = atlasHeight;

    const ctx = canvas.getContext('2d');

    // Draw checkerboard background
    drawCheckerboard(ctx, atlasWidth, atlasHeight, 16);

    // Draw each image
    for (const source of sources) {
        if (source.x === undefined || source.y === undefined) continue;
        const img = loadedImages.get(source.path);
        if (!img) continue;

        const srcX = source.trim.left;
        const srcY = source.trim.top;
        const srcW = source.trimmedWidth || 0;
        const srcH = source.trimmedHeight || 0;
        const dstX = source.x;
        const dstY = source.y;

        ctx.drawImage(img, srcX, srcY, srcW, srcH, dstX, dstY, srcW, srcH);
    }

    return { width: atlasWidth, height: atlasHeight, canvas };
}

function renderPreview() {
    if (!packedAtlas) {
        showPreviewMessage('Click "Pack & Preview" to see the atlas');
        return;
    }

    const container = document.getElementById('preview-container');
    const info = document.getElementById('preview-info');

    // Create zoom canvas
    const displayCanvas = document.createElement('canvas');
    displayCanvas.id = 'preview-canvas';
    displayCanvas.width = packedAtlas.width * canvasZoom;
    displayCanvas.height = packedAtlas.height * canvasZoom;

    const ctx = displayCanvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(packedAtlas.canvas, 0, 0, displayCanvas.width, displayCanvas.height);

    // Draw sprite boundaries
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.7)';
    ctx.lineWidth = 2;
    for (const source of sources) {
        if (source.x !== undefined && source.y !== undefined) {
            ctx.strokeRect(
                source.x * canvasZoom,
                source.y * canvasZoom,
                (source.trimmedWidth || 0) * canvasZoom,
                (source.trimmedHeight || 0) * canvasZoom
            );
        }
    }

    container.innerHTML = '';
    container.appendChild(displayCanvas);

    // Update info
    info.textContent = `Atlas: ${packedAtlas.width}×${packedAtlas.height}px`;
}

function showPreviewMessage(message) {
    const container = document.getElementById('preview-container');
    container.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
    document.getElementById('preview-info').textContent = '';
}

function exportAtlas() {
    if (!packedAtlas || !outputPath) {
        return;
    }

    // Convert canvas to data URL
    const dataUrl = packedAtlas.canvas.toDataURL('image/png');

    // Send to extension
    vscode.postMessage({
        type: 'exportPng',
        data: dataUrl,
        outputPath: outputPath
    });
}

function drawCheckerboard(ctx, width, height, checkSize) {
    const color1 = '#cccccc';
    const color2 = '#999999';

    for (let y = 0; y < height; y += checkSize) {
        for (let x = 0; x < width; x += checkSize) {
            const isEven = (Math.floor(x / checkSize) + Math.floor(y / checkSize)) % 2 === 0;
            ctx.fillStyle = isEven ? color1 : color2;
            ctx.fillRect(x, y, checkSize, checkSize);
        }
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Start the application when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}
