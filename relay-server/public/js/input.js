/**
 * Input Manager
 * Handles touch → mouse mapping, gestures, and virtual keyboard
 * Supports two modes: Direct Touch (Touchscreen - Default) and Trackpad (Virtual Mouse)
 */

class InputManager {
  constructor(connection, display, canvas, container) {
    this.connection = connection;
    this.display = display;
    this.canvas = canvas;
    this.container = container || canvas.parentElement || canvas;
    
    // Default touch mode: 'direct' (AnyDesk-style touch screen)
    this.touchMode = 'direct';
    
    // One-tap action overrides
    this.forceDoubleClick = false;
    this.forceRightClick = false;
    this.isPanMode = false;
    
    // Trackpad state
    this.cursorX = 960;
    this.cursorY = 540;
    this.sensitivity = 1.6;
    
    // Touch tracking
    this.touches = new Map();
    this.lastTapTime = 0;
    this.lastTapPos = { x: 0, y: 0 };
    this.tapTimer = null;
    this.longPressTimer = null;
    this.isDragging = false;
    this.dragThreshold = 18; // pixels of movement to distinguish tap vs drag
    
    // Pinch / Zoom state
    this.initialPinchDistance = 0;
    this.initialZoom = 1;
    this.isPinching = false;
    
    // Scroll
    this.scrollAccumX = 0;
    this.scrollAccumY = 0;
    
    // Modifier keys state
    this.modifiers = {
      Control: false,
      Alt: false,
      Shift: false,
      Meta: false
    };
    
    // DOM Elements
    this.cursorOverlay = document.getElementById('cursorOverlay');
    this.touchFeedback = document.getElementById('touchFeedback');
    this.hiddenInput = document.getElementById('hiddenInput');
    
    this._bindEvents();
    this.setTouchMode('direct');
  }

  /**
   * Set touch mode: 'direct' or 'trackpad'
   */
  setTouchMode(mode) {
    this.touchMode = mode;
    if (mode === 'trackpad') {
      if (this.cursorOverlay) this.cursorOverlay.classList.add('visible');
      this._updateCursorOverlay();
    } else {
      if (this.cursorOverlay) this.cursorOverlay.classList.remove('visible');
    }
  }

  setPanMode(active) {
    this.isPanMode = active;
  }

  setForceDoubleClick(active) {
    this.forceDoubleClick = active;
  }

  setForceRightClick(active) {
    this.forceRightClick = active;
  }

  /**
   * Bind all input events for touch, mouse, and pointer
   */
  _bindEvents() {
    // ── Touch Events on Container (covers whole phone viewport) ──
    const touchTarget = this.container || this.canvas;
    touchTarget.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    touchTarget.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
    touchTarget.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: false });
    touchTarget.addEventListener('touchcancel', (e) => this._onTouchEnd(e), { passive: false });
    
    // ── Mouse / Pointer Events on Canvas (for desktop browser testing & stylus) ──
    touchTarget.addEventListener('mousedown', (e) => this._onMouseDown(e));
    touchTarget.addEventListener('mousemove', (e) => this._onMouseMove(e));
    touchTarget.addEventListener('mouseup', (e) => this._onMouseUp(e));
    touchTarget.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    touchTarget.addEventListener('contextmenu', (e) => e.preventDefault());
    
    // ── Virtual Keyboard Input ──
    if (this.hiddenInput) {
      this.hiddenInput.addEventListener('input', (e) => this._onTextInput(e));
      this.hiddenInput.addEventListener('keydown', (e) => this._onKeyDown(e));
    }
    
    // ── Special Keys (Touch & Click) ──
    document.querySelectorAll('.special-key').forEach((btn) => {
      const handleSpecial = (e) => {
        e.preventDefault();
        this._onSpecialKey(btn);
      };
      btn.addEventListener('click', handleSpecial);
      btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        this._onSpecialKey(btn);
      });
    });
  }

  // ═══════════════════════════════════════════════════════════
  // TOUCH HANDLING (Mobile AnyDesk-style)
  // ═══════════════════════════════════════════════════════════

  _onTouchStart(e) {
    e.preventDefault();
    
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      this.touches.set(touch.identifier, {
        startX: touch.clientX,
        startY: touch.clientY,
        lastX: touch.clientX,
        lastY: touch.clientY,
        startTime: Date.now(),
        moved: false,
        dragStarted: false
      });
    }
    
    const touchCount = e.touches.length;
    
    if (touchCount === 1) {
      const touch = e.touches[0];
      this._showTouchFeedback(touch.clientX, touch.clientY);
      
      // Start long-press timer for Right Click (500ms)
      clearTimeout(this.longPressTimer);
      this.longPressTimer = setTimeout(() => {
        const tracked = this.touches.get(touch.identifier);
        if (tracked && !tracked.moved && !this.isDragging) {
          // Long press = Right Click
          this._executeClick(tracked.startX, tracked.startY, 'right');
          if (navigator.vibrate) navigator.vibrate([40, 20, 40]);
          tracked.moved = true; // prevent tap on release
        }
      }, 500);
      
    } else if (touchCount === 2) {
      // Two finger gestures: Scroll or Pinch to Zoom
      clearTimeout(this.longPressTimer);
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      this.initialPinchDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      this.initialZoom = this.display.zoomLevel || 1;
      this.isPinching = false;
      this.scrollAccumX = 0;
      this.scrollAccumY = 0;
    }
  }

  _onTouchMove(e) {
    e.preventDefault();
    const touchCount = e.touches.length;
    
    if (touchCount === 1) {
      const touch = e.touches[0];
      const tracked = this.touches.get(touch.identifier);
      if (!tracked) return;
      
      const dx = touch.clientX - tracked.lastX;
      const dy = touch.clientY - tracked.lastY;
      
      // If Pan Mode is enabled, 1 finger moves pan the screen freely
      if (this.isPanMode) {
        this.display.pan(dx, dy);
        tracked.lastX = touch.clientX;
        tracked.lastY = touch.clientY;
        tracked.moved = true;
        clearTimeout(this.longPressTimer);
        return;
      }
      
      const totalDist = Math.hypot(touch.clientX - tracked.startX, touch.clientY - tracked.startY);
      
      if (totalDist > this.dragThreshold) {
        tracked.moved = true;
        clearTimeout(this.longPressTimer);
      }
      
      if (this.touchMode === 'direct') {
        // Direct Touch: If moved beyond threshold, user is dragging!
        if (tracked.moved) {
          const coords = this.display.canvasToScreen(touch.clientX, touch.clientY);
          
          if (!this.isDragging) {
            this.isDragging = true;
            tracked.dragStarted = true;
            // Press mouse button down at drag start position
            const startCoords = this.display.canvasToScreen(tracked.startX, tracked.startY);
            this.connection.sendMouseDown(startCoords.x, startCoords.y, 'left', {
              xRatio: startCoords.xRatio,
              yRatio: startCoords.yRatio
            });
          }
          
          // Move mouse
          this.connection.sendMouseMove(coords.x, coords.y, {
            xRatio: coords.xRatio,
            yRatio: coords.yRatio
          });
        }
      } else {
        // Trackpad Mode: relative movement
        const dx = touch.clientX - tracked.lastX;
        const dy = touch.clientY - tracked.lastY;
        
        this.cursorX = Math.max(0, Math.min(this.display.screenWidth, this.cursorX + dx * this.sensitivity));
        this.cursorY = Math.max(0, Math.min(this.display.screenHeight, this.cursorY + dy * this.sensitivity));
        
        const xRatio = this.cursorX / this.display.screenWidth;
        const yRatio = this.cursorY / this.display.screenHeight;
        
        this.connection.sendMouseMove(Math.round(this.cursorX), Math.round(this.cursorY), {
          xRatio,
          yRatio
        });
        
        this._updateCursorOverlay();
      }
      
      tracked.lastX = touch.clientX;
      tracked.lastY = touch.clientY;
      
    } else if (touchCount === 2) {
      // Two fingers: Pinch-to-zoom or Pan or Two-finger scroll
      clearTimeout(this.longPressTimer);
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
      const distChange = Math.abs(currentDist - this.initialPinchDistance);
      
      const tracked1 = this.touches.get(t1.identifier);
      const tracked2 = this.touches.get(t2.identifier);
      
      if (distChange > 24) {
        // Pinching to zoom: compute focal center
        this.isPinching = true;
        const focalX = (t1.clientX + t2.clientX) / 2;
        const focalY = (t1.clientY + t2.clientY) / 2;
        const newZoom = this.initialZoom * (currentDist / this.initialPinchDistance);
        this.display.setZoom(newZoom, focalX, focalY);
      } else if (tracked1 && tracked2) {
        const dx1 = t1.clientX - tracked1.lastX;
        const dy1 = t1.clientY - tracked1.lastY;
        const dx2 = t2.clientX - tracked2.lastX;
        const dy2 = t2.clientY - tracked2.lastY;
        
        const avgDx = (dx1 + dx2) / 2;
        const avgDy = (dy1 + dy2) / 2;
        
        if (this.display.zoomLevel > 1.05) {
          // When zoomed in: 2 fingers freely PAN the entire desktop in ANY direction!
          this.display.pan(avgDx, avgDy);
        } else {
          // Normal mode: 2 fingers scroll
          this.scrollAccumY += avgDy;
          if (Math.abs(this.scrollAccumY) > 5) {
            const coords = this.display.canvasToScreen(t1.clientX, t1.clientY);
            this.connection.sendScroll(
              coords.x,
              coords.y,
              0,
              Math.round(-this.scrollAccumY * 3),
              { xRatio: coords.xRatio, yRatio: coords.yRatio }
            );
            this.scrollAccumY = 0;
          }
        }
        
        tracked1.lastX = t1.clientX;
        tracked1.lastY = t1.clientY;
        tracked2.lastX = t2.clientX;
        tracked2.lastY = t2.clientY;
      }
    }
  }

  _onTouchEnd(e) {
    e.preventDefault();
    clearTimeout(this.longPressTimer);
    
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      const tracked = this.touches.get(touch.identifier);
      if (!tracked) continue;
      
      const elapsed = Date.now() - tracked.startTime;
      const totalDist = Math.hypot(touch.clientX - tracked.startX, touch.clientY - tracked.startY);
      
      // If user was dragging, release mouse button
      if (this.isDragging && tracked.dragStarted) {
        const coords = this.display.canvasToScreen(touch.clientX, touch.clientY);
        this.connection.sendMouseUp(coords.x, coords.y, 'left', {
          xRatio: coords.xRatio,
          yRatio: coords.yRatio
        });
        this.isDragging = false;
        this.touches.delete(touch.identifier);
        continue;
      }
      
      // If in Pan Mode, do not execute click
      if (this.isPanMode) {
        this.touches.delete(touch.identifier);
        continue;
      }
      
      // Check if this was a TAP (not moved far and not dragged)
      if (!tracked.moved && totalDist < this.dragThreshold && elapsed < 500) {
        this._handleTap(touch.clientX, touch.clientY);
      }
      
      this.touches.delete(touch.identifier);
    }
  }

  /**
   * Handle Single Tap and Double Tap
   */
  _handleTap(clientX, clientY) {
    // Dismiss any open overlay panels when tapping canvas
    const openPanels = document.querySelectorAll('.panel.open');
    if (openPanels.length > 0) {
      openPanels.forEach(p => p.classList.remove('open'));
    }

    const now = Date.now();
    const timeSinceLastTap = now - this.lastTapTime;
    const distFromLastTap = Math.hypot(clientX - this.lastTapPos.x, clientY - this.lastTapPos.y);
    
    // Check if user has toggled Force Double Click or Force Right Click
    if (this.forceRightClick) {
      this._executeClick(clientX, clientY, 'right');
      this.setForceRightClick(false);
      this._dispatchModeChangeEvent();
      return;
    }
    
    if (this.forceDoubleClick) {
      this._executeDoubleClick(clientX, clientY);
      this.setForceDoubleClick(false);
      this._dispatchModeChangeEvent();
      return;
    }
    
    // Detect Double Tap (two taps within 350ms and within 35px)
    if (timeSinceLastTap < 350 && distFromLastTap < 35) {
      // Cancel pending single tap
      clearTimeout(this.tapTimer);
      this.tapTimer = null;
      this.lastTapTime = 0;
      
      // Execute DOUBLE CLICK (Opens Windows apps, shortcuts, folders)
      this._executeDoubleClick(clientX, clientY);
      return;
    }
    
    // Record for double tap detection
    this.lastTapTime = now;
    this.lastTapPos = { x: clientX, y: clientY };
    
    // Wait slightly to distinguish single tap from double tap
    clearTimeout(this.tapTimer);
    this.tapTimer = setTimeout(() => {
      this._executeClick(clientX, clientY, 'left');
      this.tapTimer = null;
    }, 200);
  }

  /**
   * Execute Left or Right Click at coordinates
   */
  _executeClick(clientX, clientY, button = 'left') {
    let coords;
    if (this.touchMode === 'direct') {
      coords = this.display.canvasToScreen(clientX, clientY);
    } else {
      coords = {
        x: Math.round(this.cursorX),
        y: Math.round(this.cursorY),
        xRatio: this.cursorX / this.display.screenWidth,
        yRatio: this.cursorY / this.display.screenHeight
      };
    }
    
    this._showTouchFeedback(clientX, clientY, button === 'right' ? 'right' : 'left');
    this.connection.sendMouseClick(coords.x, coords.y, button, {
      xRatio: coords.xRatio,
      yRatio: coords.yRatio
    });
    
    if (navigator.vibrate) navigator.vibrate(25);
  }

  /**
   * Execute OS Double Click at coordinates (Opens Windows apps / files)
   */
  _executeDoubleClick(clientX, clientY) {
    let coords;
    if (this.touchMode === 'direct') {
      coords = this.display.canvasToScreen(clientX, clientY);
    } else {
      coords = {
        x: Math.round(this.cursorX),
        y: Math.round(this.cursorY),
        xRatio: this.cursorX / this.display.screenWidth,
        yRatio: this.cursorY / this.display.screenHeight
      };
    }
    
    this._showTouchFeedback(clientX, clientY, 'double');
    this.connection.sendMouseDoubleClick(coords.x, coords.y, 'left', {
      xRatio: coords.xRatio,
      yRatio: coords.yRatio
    });
    
    if (navigator.vibrate) navigator.vibrate([30, 30, 30]);
  }

  // ═══════════════════════════════════════════════════════════
  // MOUSE / DESKTOP TESTING SUPPORT
  // ═══════════════════════════════════════════════════════════

  _onMouseDown(e) {
    const coords = this.display.canvasToScreen(e.clientX, e.clientY);
    const button = e.button === 2 ? 'right' : (e.button === 1 ? 'middle' : 'left');
    this.connection.sendMouseDown(coords.x, coords.y, button, {
      xRatio: coords.xRatio,
      yRatio: coords.yRatio
    });
  }

  _onMouseMove(e) {
    if (e.buttons > 0) {
      const coords = this.display.canvasToScreen(e.clientX, e.clientY);
      this.connection.sendMouseMove(coords.x, coords.y, {
        xRatio: coords.xRatio,
        yRatio: coords.yRatio
      });
    }
  }

  _onMouseUp(e) {
    const coords = this.display.canvasToScreen(e.clientX, e.clientY);
    const button = e.button === 2 ? 'right' : (e.button === 1 ? 'middle' : 'left');
    this.connection.sendMouseUp(coords.x, coords.y, button, {
      xRatio: coords.xRatio,
      yRatio: coords.yRatio
    });
  }

  _onWheel(e) {
    e.preventDefault();
    const coords = this.display.canvasToScreen(e.clientX, e.clientY);
    this.connection.sendScroll(
      coords.x,
      coords.y,
      Math.round(e.deltaX),
      Math.round(e.deltaY),
      { xRatio: coords.xRatio, yRatio: coords.yRatio }
    );
  }

  // ═══════════════════════════════════════════════════════════
  // VISUAL FEEDBACK & OVERLAYS
  // ═══════════════════════════════════════════════════════════

  _updateCursorOverlay() {
    if (this.touchMode !== 'trackpad' || !this.cursorOverlay) return;
    const canvasPos = this.display.screenToCanvas(this.cursorX, this.cursorY);
    this.cursorOverlay.style.left = `${canvasPos.x}px`;
    this.cursorOverlay.style.top = `${canvasPos.y}px`;
    this.cursorOverlay.classList.add('visible');
  }

  _showTouchFeedback(x, y, type = 'left') {
    if (!this.touchFeedback) return;
    const ripple = document.createElement('div');
    ripple.className = `touch-ripple ${type}`;
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    this.touchFeedback.appendChild(ripple);
    setTimeout(() => ripple.remove(), 400);
  }

  _dispatchModeChangeEvent() {
    const event = new CustomEvent('inputModeChange', {
      detail: {
        forceDoubleClick: this.forceDoubleClick,
        forceRightClick: this.forceRightClick
      }
    });
    window.dispatchEvent(event);
  }

  // ═══════════════════════════════════════════════════════════
  // KEYBOARD & QUICK SHORTCUTS
  // ═══════════════════════════════════════════════════════════

  toggleKeyboard() {
    if (this.hiddenInput) {
      this.hiddenInput.focus();
    }
  }

  sendDirectText(text) {
    if (!text) return;
    this.connection.sendText(text);
  }

  sendSingleKey(key) {
    this.connection.sendKeyPress(key);
  }

  sendStartMenu() {
    this.connection.sendKeyPress('Meta');
  }

  _onTextInput(e) {
    const data = e.data;
    if (!data) return;
    
    for (const char of data) {
      const activeModifiers = Object.entries(this.modifiers)
        .filter(([_, active]) => active)
        .map(([key]) => key);
      
      if (activeModifiers.length > 0) {
        this.connection.sendKeyCombo([...activeModifiers, char]);
        this._resetModifiers();
      } else {
        this.connection.sendKeyPress(char);
      }
    }
    
    if (this.hiddenInput) {
      this.hiddenInput.value = '';
    }
  }

  _onKeyDown(e) {
    const key = e.key;
    if (['Backspace', 'Enter', 'Tab', 'Escape', 'Delete',
         'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
         'Home', 'End', 'PageUp', 'PageDown'].includes(key)) {
      e.preventDefault();
      
      const activeModifiers = Object.entries(this.modifiers)
        .filter(([_, active]) => active)
        .map(([k]) => k);
      
      if (activeModifiers.length > 0) {
        this.connection.sendKeyCombo([...activeModifiers, key]);
        this._resetModifiers();
      } else {
        this.connection.sendKeyPress(key);
      }
    }
  }

  _onSpecialKey(btn) {
    const key = btn.dataset.key;
    const isModifier = btn.dataset.modifier === 'true';
    const combo = btn.dataset.combo;
    
    if (combo) {
      const keys = combo.split('+');
      this.connection.sendKeyCombo(keys);
      if (navigator.vibrate) navigator.vibrate(30);
      return;
    }
    
    if (isModifier) {
      this.modifiers[key] = !this.modifiers[key];
      btn.classList.toggle('active', this.modifiers[key]);
      if (navigator.vibrate) navigator.vibrate(20);
      return;
    }
    
    const activeModifiers = Object.entries(this.modifiers)
      .filter(([_, active]) => active)
      .map(([k]) => k);
    
    if (activeModifiers.length > 0) {
      this.connection.sendKeyCombo([...activeModifiers, key]);
      this._resetModifiers();
    } else {
      this.connection.sendKeyPress(key);
    }
    
    if (navigator.vibrate) navigator.vibrate(20);
  }

  _resetModifiers() {
    Object.keys(this.modifiers).forEach(key => {
      this.modifiers[key] = false;
    });
    document.querySelectorAll('.special-key.modifier').forEach(btn => {
      btn.classList.remove('active');
    });
  }

  destroy() {
    this.canvas.removeEventListener('touchstart', this._onTouchStart);
    this.canvas.removeEventListener('touchmove', this._onTouchMove);
    this.canvas.removeEventListener('touchend', this._onTouchEnd);
  }
}

window.InputManager = InputManager;
