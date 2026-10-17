/**
 * Display Manager
 * Handles rendering remote screen frames onto the canvas,
 * coordinate mapping, hardware-accelerated decoding,
 * and generic 360-degree zoom/pan controls
 */

class DisplayManager {
  constructor(canvas, container) {
    this.canvas = canvas;
    this.container = container;
    // Note: Do NOT use desynchronized: true here as it causes canvas repaint freezing on mobile GPU drivers
    this.ctx = canvas.getContext('2d', { alpha: false });
    
    // Remote screen dimensions - explicitly set canvas coordinate resolution
    this.screenWidth = 1920;
    this.screenHeight = 1080;
    this.canvas.width = 1920;
    this.canvas.height = 1080;
    
    // Viewport & Zoom state
    this.scale = 1;
    this.fitScale = 1;
    this.zoomLevel = 1;
    this.rotation = 0;
    this.isFitWidth = false;
    this.fitMode = 'fit'; // 'fit' (letterbox), 'fill' (stretch 100%), 'rotate' (90deg), 'width' (fit width)
    this.panX = 0;
    this.panY = 0;
    
    // Performance tracking
    this.frameCount = 0;
    this.fps = 0;
    this.lastFpsUpdate = Date.now();
    this.lastFrameTime = 0;
    this.latency = 0;
    
    // Callback when a frame has been rendered to screen
    this.onFrameRendered = null;
    
    // Image loading fallbacks
    this.currentImage = new Image();
    this.frameBuffer = new Image();
    this.useBuffer = false;
    this.isRendering = false;
    this.isDecoding = false;
    
    this.resizeObserver = null;
    this.animationFrame = null;
    
    this._setupResizeObserver();
  }

  /**
   * Set the remote screen dimensions
   */
  setScreenSize(width, height) {
    if (!width || !height) return;
    if (this.canvas.width === width && this.canvas.height === height && this.screenWidth === width && this.screenHeight === height) {
      return;
    }
    this.screenWidth = width;
    this.screenHeight = height;
    this.canvas.width = width;
    this.canvas.height = height;
    this._fitToContainer();
  }

  /**
   * Render a frame from the desktop with lowest possible latency (supports 60 FPS & 2K)
   */
  renderFrame(frameData) {
    if (!frameData || !frameData.image) return;

    // Zero-lag decode pipeline: if already decoding a frame on mobile GPU, drop stale frame
    if (this.isDecoding) {
      return;
    }

    const now = Date.now();
    
    // Calculate latency if timestamp provided
    if (frameData.timestamp) {
      this.latency = Math.max(1, now - frameData.timestamp);
    }
    
    // FPS tracking
    this.frameCount++;
    if (now - this.lastFpsUpdate >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsUpdate = now;
    }
    
    // Universal format normalization for frameData.image
    let blob = null;

    if (frameData.image instanceof Blob) {
      blob = frameData.image;
    } else if (frameData.image instanceof ArrayBuffer) {
      blob = new Blob([frameData.image], { type: 'image/jpeg' });
    } else if (frameData.image instanceof Uint8Array) {
      blob = new Blob([frameData.image], { type: 'image/jpeg' });
    } else if (frameData.image && frameData.image.buffer instanceof ArrayBuffer) {
      blob = new Blob([frameData.image.buffer], { type: 'image/jpeg' });
    } else if (frameData.image && Array.isArray(frameData.image.data)) {
      blob = new Blob([new Uint8Array(frameData.image.data)], { type: 'image/jpeg' });
    }

    if (blob) {
      if (typeof createImageBitmap === 'function') {
        this.isDecoding = true;
        createImageBitmap(blob)
          .then((bitmap) => {
            if (bitmap.width !== this.canvas.width || bitmap.height !== this.canvas.height) {
              this.setScreenSize(bitmap.width, bitmap.height);
            }
            this.ctx.drawImage(bitmap, 0, 0);
            bitmap.close();
            this.lastFrameTime = Date.now();
            this.isDecoding = false;
            
            if (this.onFrameRendered) {
              this.onFrameRendered();
            }
          })
          .catch((err) => {
            this.isDecoding = false;
            console.warn('[Display] createImageBitmap fallback:', err.message);
            this._renderViaBlobUrl(blob);
          });
        return;
      }
      
      this._renderViaBlobUrl(blob);
      return;
    }
    
    // Base64 string fallback
    if (typeof frameData.image === 'string') {
      const src = frameData.image.startsWith('data:') ? frameData.image : `data:image/jpeg;base64,${frameData.image}`;
      const img = this.useBuffer ? this.frameBuffer : this.currentImage;
      this.useBuffer = !this.useBuffer;
      
      img.onload = () => {
        if (img.naturalWidth !== this.canvas.width || img.naturalHeight !== this.canvas.height) {
          this.setScreenSize(img.naturalWidth, img.naturalHeight);
        }
        this.ctx.drawImage(img, 0, 0);
        this.lastFrameTime = Date.now();
        if (this.onFrameRendered) {
          this.onFrameRendered();
        }
      };
      
      img.src = src;
    }
  }

  _renderViaBlobUrl(blob) {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.naturalWidth !== this.canvas.width || img.naturalHeight !== this.canvas.height) {
        this.setScreenSize(img.naturalWidth, img.naturalHeight);
      }
      this.ctx.drawImage(img, 0, 0);
      this.lastFrameTime = Date.now();
      if (this.onFrameRendered) {
        this.onFrameRendered();
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      if (this.onFrameRendered) {
        this.onFrameRendered();
      }
    };
    img.src = url;
  }

  /**
   * Convert touch/pointer coordinates to remote screen coordinates
   * Supports normal, zoomed, panned, and rotated viewports accurately
   */
  canvasToScreen(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    if (this.rotation === 90) {
      // Un-rotate touch around visual center (-90 deg rotation)
      const dx = clientX - cx;
      const dy = clientY - cy;
      const unrotX = dy;
      const unrotY = -dx;

      const baseW = (parseFloat(this.canvas.style.width) || this.screenWidth) * (this.zoomLevel || 1);
      const baseH = (parseFloat(this.canvas.style.height) || this.screenHeight) * (this.zoomLevel || 1);

      const localX = unrotX + baseW / 2;
      const localY = unrotY + baseH / 2;

      const xRatio = Math.max(0, Math.min(1, baseW > 0 ? localX / baseW : 0));
      const yRatio = Math.max(0, Math.min(1, baseH > 0 ? localY / baseH : 0));

      return {
        x: Math.round(xRatio * this.screenWidth),
        y: Math.round(yRatio * this.screenHeight),
        xRatio: xRatio,
        yRatio: yRatio,
        screenWidth: this.screenWidth,
        screenHeight: this.screenHeight,
        insideCanvas: localX >= 0 && localX <= baseW && localY >= 0 && localY <= baseH
      };
    } else {
      // Normal 0 deg orientation
      const relX = clientX - rect.left;
      const relY = clientY - rect.top;

      const xRatio = Math.max(0, Math.min(1, rect.width > 0 ? relX / rect.width : 0));
      const yRatio = Math.max(0, Math.min(1, rect.height > 0 ? relY / rect.height : 0));

      return {
        x: Math.round(xRatio * this.screenWidth),
        y: Math.round(yRatio * this.screenHeight),
        xRatio: xRatio,
        yRatio: yRatio,
        screenWidth: this.screenWidth,
        screenHeight: this.screenHeight,
        insideCanvas: clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
      };
    }
  }

  /**
   * Convert remote screen coordinates to canvas element position
   */
  screenToCanvas(screenX, screenY) {
    const rect = this.canvas.getBoundingClientRect();
    const canvasX = (screenX / this.screenWidth) * rect.width + rect.left;
    const canvasY = (screenY / this.screenHeight) * rect.height + rect.top;
    return { x: canvasX, y: canvasY };
  }

  /**
   * Fit canvas to its container
   */
  _fitToContainer() {
    const containerRect = this.container.getBoundingClientRect();
    const containerWidth = containerRect.width;
    const containerHeight = containerRect.height;
    
    if (containerWidth === 0 || containerHeight === 0) return;
    
    if (this.fitMode === 'fill' && this.rotation === 0) {
      // FILL SCREEN: stretches to fill 100% of container with ZERO black bars
      this.canvas.style.objectFit = 'fill';
      this.fitScale = containerWidth / this.screenWidth;
      this.canvas.style.width = `${containerWidth}px`;
      this.canvas.style.height = `${containerHeight}px`;
      this._applyTransform();
      return;
    }

    this.canvas.style.objectFit = 'contain';

    if (this.rotation === 90) {
      // Rotated 90 deg: width fits container height, height fits container width
      this.canvas.style.maxWidth = 'none';
      this.canvas.style.maxHeight = 'none';
      const scaleX = containerHeight / this.screenWidth;
      const scaleY = containerWidth / this.screenHeight;
      this.fitScale = Math.min(scaleX, scaleY);
    } else {
      this.canvas.style.maxWidth = '100%';
      this.canvas.style.maxHeight = '100%';
      const scaleX = containerWidth / this.screenWidth;
      const scaleY = containerHeight / this.screenHeight;
      this.fitScale = Math.min(scaleX, scaleY);
    }
    
    const displayWidth = Math.round(this.screenWidth * this.fitScale);
    const displayHeight = Math.round(this.screenHeight * this.fitScale);
    
    this.canvas.style.width = `${displayWidth}px`;
    this.canvas.style.height = `${displayHeight}px`;
    this._applyTransform();
  }

  // ═══════════════════════════════════════════════════════════
  // GENERIC ZOOM & PAN & ROTATION (360° Free Movement)
  // ═══════════════════════════════════════════════════════════

  setFitMode(mode) {
    this.fitMode = mode;
    if (mode === 'rotate') {
      this.rotation = 90;
      this.isFitWidth = false;
    } else if (mode === 'fill') {
      this.rotation = 0;
      this.isFitWidth = false;
    } else {
      this.fitMode = 'fit';
      this.rotation = 0;
      this.isFitWidth = false;
    }
    this.resetZoom();
    this._fitToContainer();
    return this.fitMode;
  }

  cycleFitMode() {
    if (this.fitMode === 'fit') {
      return this.setFitMode('rotate');
    } else if (this.fitMode === 'rotate') {
      return this.setFitMode('fill');
    } else {
      return this.setFitMode('fit');
    }
  }

  toggleRotate() {
    return this.setFitMode(this.rotation === 90 ? 'fit' : 'rotate');
  }

  toggleFitWidth() {
    return this.setFitMode(this.rotation === 90 ? 'fit' : 'rotate');
  }

  /**
   * Set Zoom Level with optional focal point (360° Free Panning)
   */
  setZoom(zoom, focalX = null, focalY = null) {
    const oldZoom = this.zoomLevel;
    const clampedZoom = Math.max(1, Math.min(4.0, zoom));
    
    if (focalX !== null && focalY !== null && oldZoom > 0) {
      const containerRect = this.container.getBoundingClientRect();
      const centerX = containerRect.left + containerRect.width / 2;
      const centerY = containerRect.top + containerRect.height / 2;
      
      const dx = focalX - centerX - this.panX;
      const dy = focalY - centerY - this.panY;
      const zoomRatio = clampedZoom / oldZoom;
      
      this.panX -= dx * (zoomRatio - 1);
      this.panY -= dy * (zoomRatio - 1);
    }
    
    this.zoomLevel = clampedZoom;
    this._applyTransform();
    return this.zoomLevel;
  }

  zoomIn() {
    return this.setZoom(this.zoomLevel + 0.5);
  }

  zoomOut() {
    return this.setZoom(this.zoomLevel - 0.5);
  }

  toggleZoom(focalX = null, focalY = null) {
    if (this.zoomLevel > 1.25) {
      this.resetZoom();
    } else {
      this.setZoom(2.0, focalX, focalY);
    }
    return this.zoomLevel;
  }

  resetZoom() {
    this.zoomLevel = 1;
    this.panX = 0;
    this.panY = 0;
    this.isFitWidth = false;
    this._applyTransform();
    return this.zoomLevel;
  }

  /**
   * Pan the view freely in any direction (360° unrestricted)
   */
  pan(deltaX, deltaY) {
    if (this.zoomLevel <= 1.02) return;
    this.panX += deltaX;
    this.panY += deltaY;
    this._applyTransform();
  }

  _applyTransform() {
    let transformStr = '';
    if (this.rotation === 90) {
      transformStr += 'rotate(90deg) ';
    }

    if (this.zoomLevel > 1.02) {
      const effZoom = this.zoomLevel;
      const containerRect = this.container.getBoundingClientRect();
      const baseW = parseFloat(this.canvas.style.width) || this.screenWidth;
      const baseH = parseFloat(this.canvas.style.height) || this.screenHeight;
      const visualW = baseW * effZoom;
      const visualH = baseH * effZoom;

      const maxPanX = Math.max(120, (visualW - containerRect.width) / 2 + 150);
      const maxPanY = Math.max(120, (visualH - containerRect.height) / 2 + 150);

      this.panX = Math.max(-maxPanX, Math.min(maxPanX, this.panX));
      this.panY = Math.max(-maxPanY, Math.min(maxPanY, this.panY));

      transformStr += `translate(${this.panX}px, ${this.panY}px) scale(${effZoom})`;
    } else {
      this.panX = 0;
      this.panY = 0;
      this.zoomLevel = 1;
    }

    this.canvas.style.transformOrigin = 'center center';
    this.canvas.style.transform = transformStr.trim();
  }

  /**
   * Watch for container size changes
   */
  _setupResizeObserver() {
    this.resizeObserver = new ResizeObserver(() => {
      this._fitToContainer();
    });
    this.resizeObserver.observe(this.container);
  }

  getFps() {
    return this.fps;
  }

  getLatency() {
    return this.latency;
  }

  destroy() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
    if (this.animationFrame) {
      cancelAnimationFrame(this.animationFrame);
    }
  }
}

window.DisplayManager = DisplayManager;
