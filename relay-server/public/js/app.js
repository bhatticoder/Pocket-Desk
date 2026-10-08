/**
 * Mobile-Laptop Bridge — Main Application
 * Orchestrates connection, display, input, and file transfer modules
 */

class App {
  constructor() {
    this.connection = null;
    this.display = null;
    this.input = null;
    this.fileManager = null;
    
    this.statsInterval = null;
    
    // UI elements
    this.connectionScreen = document.getElementById('connectionScreen');
    this.remoteScreen = document.getElementById('remoteScreen');
    this.connectBtn = document.getElementById('connectBtn');
    this.connectionError = document.getElementById('connectionError');
    this.disconnectedOverlay = document.getElementById('disconnectedOverlay');
    this.disconnectReason = document.getElementById('disconnectReason');
    
    this._init();
  }

  _init() {
    this._setupCodeInputs();
    this._setupConnectionButton();
    this._setupToolbar();
    this._setupPanels();
    this._setupSettings();
    this._setupFullscreen();
    this._setupDisconnect();
    this._checkUrlCode();
    
    // Initialize connection
    this.connection = new ConnectionManager();
    this.connection.init();
  }

  // ═══════════════════════════════════════════════════════════
  // CONNECTION SCREEN
  // ═══════════════════════════════════════════════════════════

  /**
   * Setup the 6-digit code input fields
   */
  _setupCodeInputs() {
    const inputs = document.querySelectorAll('.code-digit');
    
    inputs.forEach((input, index) => {
      // Handle input
      input.addEventListener('input', (e) => {
        const value = e.target.value.replace(/\D/g, '');
        e.target.value = value;
        
        if (value) {
          e.target.classList.add('filled');
          // Auto-advance to next input
          if (index < inputs.length - 1) {
            inputs[index + 1].focus();
          }
        } else {
          e.target.classList.remove('filled');
        }
        
        this._checkCodeComplete();
      });
      
      // Handle backspace
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !e.target.value && index > 0) {
          inputs[index - 1].focus();
          inputs[index - 1].value = '';
          inputs[index - 1].classList.remove('filled');
          this._checkCodeComplete();
        }
        
        if (e.key === 'Enter') {
          this._connect();
        }
      });
      
      // Handle paste
      input.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
        
        if (pasted.length >= 6) {
          for (let i = 0; i < 6; i++) {
            inputs[i].value = pasted[i];
            inputs[i].classList.add('filled');
          }
          inputs[5].focus();
          this._checkCodeComplete();
        }
      });

      // Select on focus
      input.addEventListener('focus', () => {
        input.select();
      });
    });
  }

  _checkCodeComplete() {
    const code = this._getCode();
    this.connectBtn.disabled = code.length !== 6;
  }

  _getCode() {
    const inputs = document.querySelectorAll('.code-digit');
    return Array.from(inputs).map(i => i.value).join('');
  }

  _setupConnectionButton() {
    this.connectBtn.addEventListener('click', () => this._connect());
  }

  /**
   * Check if connection code is in URL
   */
  _checkUrlCode() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    
    if (code && code.length === 6 && /^\d{6}$/.test(code)) {
      const inputs = document.querySelectorAll('.code-digit');
      for (let i = 0; i < 6; i++) {
        inputs[i].value = code[i];
        inputs[i].classList.add('filled');
      }
      this._checkCodeComplete();
      
      // Auto-connect after a short delay
      setTimeout(() => this._connect(), 500);
    }
  }

  /**
   * Attempt to connect to the desktop
   */
  async _connect() {
    const code = this._getCode();
    if (code.length !== 6) return;
    
    this.connectBtn.classList.add('loading');
    this.connectBtn.disabled = true;
    this.connectionError.textContent = '';
    
    try {
      await this.connection.connectToDesktop(code);
      this._showRemoteScreen();
    } catch (error) {
      this.connectionError.textContent = error.message;
      this.connectBtn.classList.remove('loading');
      this.connectBtn.disabled = false;
      
      // Shake animation on error
      this.connectionError.style.animation = 'none';
      this.connectionError.offsetHeight; // Trigger reflow
      this.connectionError.style.animation = '';
    }
  }

  // ═══════════════════════════════════════════════════════════
  // REMOTE DESKTOP SCREEN
  // ═══════════════════════════════════════════════════════════

  _showRemoteScreen() {
    // Switch screens
    this.connectionScreen.classList.remove('active');
    this.remoteScreen.classList.add('active');
    
    // Initialize display
    const canvas = document.getElementById('remoteCanvas');
    const container = document.getElementById('canvasContainer');
    this.display = new DisplayManager(canvas, container);
    
    // Set initial screen size from desktop info
    if (this.connection.desktopInfo) {
      const { screenWidth, screenHeight } = this.connection.desktopInfo;
      if (screenWidth && screenHeight) {
        this.display.setScreenSize(screenWidth, screenHeight);
      }
    }
    
    // Initialize input
    this.input = new InputManager(this.connection, this.display, canvas, container);
    
    // Initialize file manager
    this.fileManager = new FileManager(this.connection);
    
    // Wire up frame rendering & low-latency flow control ACK
    this.display.onFrameRendered = () => {
      this.connection.sendFrameAck();
    };

    this.connection.onFrame = (data) => {
      this.display.renderFrame(data);
    };
    
    this.connection.onScreenInfo = (info) => {
      this.display.setScreenSize(info.width, info.height);
    };

    // Screen Lock / Sleep state banner & Wake button
    const banner = document.getElementById('screenLockedBanner');
    const btnWake = document.getElementById('btnWakeScreen');
    if (btnWake) {
      btnWake.addEventListener('click', () => {
        if (this.connection) this.connection.wakeScreen();
      });
      btnWake.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (this.connection) this.connection.wakeScreen();
      });
    }

    this.connection.onScreenState = (data) => {
      if (banner) {
        banner.style.display = data.isLocked ? 'flex' : 'none';
      }
    };
    
    // Handle disconnection & seamless auto-reconnection
    const statusText = document.getElementById('statusText');
    const statusDot = document.querySelector('.status-dot');
    let disconnectTimeout = null;

    this.connection.onReconnecting = (reason) => {
      console.log('[App] Network blip, attempting to reconnect:', reason);
      if (statusText) statusText.textContent = 'Reconnecting...';
      if (statusDot) statusDot.style.background = '#eab308';
      if (!disconnectTimeout) {
        disconnectTimeout = setTimeout(() => {
          this._showDisconnected(reason);
        }, 15000);
      }
    };

    this.connection.onReconnected = () => {
      console.log('[App] Reconnected successfully!');
      if (disconnectTimeout) {
        clearTimeout(disconnectTimeout);
        disconnectTimeout = null;
      }
      if (statusText) statusText.textContent = 'Connected';
      if (statusDot) statusDot.style.background = '#10b981';
      this.disconnectedOverlay.style.display = 'none';
    };

    this.connection.onDisconnected = (reason) => {
      if (disconnectTimeout) clearTimeout(disconnectTimeout);
      this._showDisconnected(reason);
    };
    
    // Close all panels initially so remote screen is completely visible
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('open'));

    // Tapping canvas closes any open overlay panels
    container.addEventListener('click', (e) => {
      if (!e.target.closest('.floating-kb-btn')) {
        document.querySelectorAll('.panel.open').forEach(p => p.classList.remove('open'));
      }
    });

    // Start stats updates
    this._startStatsUpdate();
    this._setupQuickBar();
    this._setupInteractiveKeyboard();
    this._setupQuickTypingBar();
    this._setupScreenFitMode();
    this._updateModeUI('direct');
    
    // Request fullscreen orientation lock if possible
    try {
      screen.orientation.lock('landscape').catch(() => {});
    } catch (e) {}
  }

  /**
   * Update FPS and latency display
   */
  _startStatsUpdate() {
    this.statsInterval = setInterval(() => {
      if (!this.display) return;
      
      const fpsEl = document.getElementById('fpsCounter');
      const latencyEl = document.getElementById('latencyDisplay');
      
      if (fpsEl) fpsEl.textContent = `${this.display.getFps()} FPS`;
      if (latencyEl) {
        const lat = this.display.getLatency();
        latencyEl.textContent = lat > 0 ? `${lat} ms` : '-- ms';
      }
    }, 1000);
  }

  // ═══════════════════════════════════════════════════════════
  // QUICK BAR & REMOTE CONTROLS
  // ═══════════════════════════════════════════════════════════

  _setupQuickBar() {
    const btnStart = document.getElementById('btnStartMenu');
    if (btnStart) {
      btnStart.addEventListener('click', () => {
        if (this.input) this.input.sendStartMenu();
      });
    }

    const btnDouble = document.getElementById('btnDoubleTapToggle');
    if (btnDouble) {
      btnDouble.addEventListener('click', () => {
        if (this.input) {
          const next = !this.input.forceDoubleClick;
          this.input.setForceDoubleClick(next);
          btnDouble.classList.toggle('active', next);
          if (next && this.input.forceRightClick) {
            this.input.setForceRightClick(false);
            const btnRight = document.getElementById('btnRightClickToggle');
            if (btnRight) btnRight.classList.remove('active');
          }
        }
      });
    }

    const btnRight = document.getElementById('btnRightClickToggle');
    if (btnRight) {
      btnRight.addEventListener('click', () => {
        if (this.input) {
          const next = !this.input.forceRightClick;
          this.input.setForceRightClick(next);
          btnRight.classList.toggle('active', next);
          if (next && this.input.forceDoubleClick) {
            this.input.setForceDoubleClick(false);
            const btnD = document.getElementById('btnDoubleTapToggle');
            if (btnD) btnD.classList.remove('active');
          }
        }
      });
    }

    const btnPanMode = document.getElementById('btnPanModeToggle');
    if (btnPanMode) {
      btnPanMode.addEventListener('click', () => {
        if (this.input) {
          const active = !this.input.isPanMode;
          this.input.setPanMode(active);
          btnPanMode.classList.toggle('active', active);
        }
      });
    }

    const zoomDisplay = document.getElementById('zoomLevelDisplay');
    const updateZoomDisplay = (z) => {
      if (zoomDisplay) zoomDisplay.textContent = `${z.toFixed(1)}x`;
    };

    const btnRotateView = document.getElementById('btnRotateView');
    if (btnRotateView) {
      btnRotateView.addEventListener('click', () => {
        if (this.display) {
          const r = this.display.toggleRotate();
          btnRotateView.classList.toggle('active', r === 90);
          updateZoomDisplay(this.display.zoomLevel);
        }
      });
    }

    const btnFitWidth = document.getElementById('btnFitWidth');
    if (btnFitWidth) {
      btnFitWidth.addEventListener('click', () => {
        if (this.display) {
          const isFw = this.display.toggleFitWidth();
          btnFitWidth.classList.toggle('active', isFw);
          updateZoomDisplay(this.display.zoomLevel);
        }
      });
    }

    const btnZoomOut = document.getElementById('btnZoomOut');
    if (btnZoomOut) {
      btnZoomOut.addEventListener('click', () => {
        if (this.display) {
          const z = this.display.zoomOut();
          if (btnFitWidth) btnFitWidth.classList.remove('active');
          updateZoomDisplay(z);
        }
      });
    }

    const btnZoomReset = document.getElementById('btnZoomReset');
    if (btnZoomReset) {
      btnZoomReset.addEventListener('click', () => {
        if (this.display) {
          const z = this.display.resetZoom();
          if (btnFitWidth) btnFitWidth.classList.remove('active');
          updateZoomDisplay(z);
        }
      });
    }

    const btnZoomIn = document.getElementById('btnZoomIn');
    if (btnZoomIn) {
      btnZoomIn.addEventListener('click', () => {
        if (this.display) {
          const z = this.display.zoomIn();
          updateZoomDisplay(z);
        }
      });
    }

    const btnShowDesktop = document.getElementById('btnShowDesktop');
    if (btnShowDesktop) {
      btnShowDesktop.addEventListener('click', () => {
        if (this.connection) this.connection.sendKeyCombo(['Meta', 'd']);
      });
    }

    const qb = document.getElementById('quickBar');
    const scrollLeftBtn = document.getElementById('btnQuickScrollLeft');
    const scrollRightBtn = document.getElementById('btnQuickScrollRight');

    if (qb) {
      // Touch gesture drag scrolling for mobile phones
      let isTouchDown = false;
      let startX = 0;
      let scrollStart = 0;

      qb.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
          isTouchDown = true;
          startX = e.touches[0].pageX;
          scrollStart = qb.scrollLeft;
        }
      }, { passive: true });

      qb.addEventListener('touchmove', (e) => {
        if (!isTouchDown || e.touches.length !== 1) return;
        const currentX = e.touches[0].pageX;
        const diff = currentX - startX;
        qb.scrollLeft = scrollStart - diff;
      }, { passive: true });

      const endTouch = () => {
        isTouchDown = false;
      };
      qb.addEventListener('touchend', endTouch, { passive: true });
      qb.addEventListener('touchcancel', endTouch, { passive: true });

      // Mouse drag scrolling for desktop preview
      let isMouseDown = false;
      let mouseStartX = 0;
      let mouseScrollStart = 0;

      qb.addEventListener('mousedown', (e) => {
        isMouseDown = true;
        mouseStartX = e.pageX;
        mouseScrollStart = qb.scrollLeft;
      });

      window.addEventListener('mousemove', (e) => {
        if (!isMouseDown) return;
        const diff = e.pageX - mouseStartX;
        qb.scrollLeft = mouseScrollStart - diff;
      });

      window.addEventListener('mouseup', () => {
        isMouseDown = false;
      });
    }

    if (scrollLeftBtn && qb) {
      const doScrollLeft = (e) => {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        qb.scrollBy({ left: -160, behavior: 'smooth' });
      };
      scrollLeftBtn.addEventListener('click', doScrollLeft);
      scrollLeftBtn.addEventListener('touchend', doScrollLeft);
    }
    if (scrollRightBtn && qb) {
      const doScrollRight = (e) => {
        if (e.cancelable) e.preventDefault();
        e.stopPropagation();
        qb.scrollBy({ left: 160, behavior: 'smooth' });
      };
      scrollRightBtn.addEventListener('click', doScrollRight);
      scrollRightBtn.addEventListener('touchend', doScrollRight);
    }

    const modeBadge = document.getElementById('modeBadge');
    if (modeBadge) {
      modeBadge.addEventListener('click', () => {
        if (this.input) {
          const newMode = this.input.touchMode === 'trackpad' ? 'direct' : 'trackpad';
          this.input.setTouchMode(newMode);
          this._updateModeUI(newMode);
        }
      });
    }

    window.addEventListener('inputModeChange', (e) => {
      if (btnDouble) btnDouble.classList.toggle('active', !!e.detail.forceDoubleClick);
      if (btnRight) btnRight.classList.toggle('active', !!e.detail.forceRightClick);
    });
  }

  _setupInteractiveKeyboard() {
    const keyboardDirectInput = document.getElementById('keyboardDirectInput');
    const btnSendDirectText = document.getElementById('btnSendDirectText');
    const btnClearDirectText = document.getElementById('btnClearDirectText');
    const btnTriggerNativeKb = document.getElementById('btnTriggerNativeKb');
    
    // Synchronously summon native mobile keyboard
    if (btnTriggerNativeKb && keyboardDirectInput) {
      btnTriggerNativeKb.addEventListener('click', () => {
        keyboardDirectInput.focus();
      });
    }

    // Live typing: As characters or words are typed, send immediately to laptop
    let lastLength = 0;
    if (keyboardDirectInput) {
      keyboardDirectInput.addEventListener('input', (e) => {
        const val = keyboardDirectInput.value;
        if (!this.input) return;

        if (e.inputType === 'deleteContentBackward') {
          this.input.sendSingleKey('Backspace');
        } else if (val.length > lastLength) {
          const added = val.slice(lastLength);
          this.input.sendDirectText(added);
        } else if (val.length < lastLength) {
          const diff = lastLength - val.length;
          for (let i = 0; i < diff; i++) {
            this.input.sendSingleKey('Backspace');
          }
        }
        lastLength = val.length;
      });

      keyboardDirectInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          if (this.input) this.input.sendSingleKey('Enter');
          keyboardDirectInput.value = '';
          lastLength = 0;
        }
      });
    }

    if (btnClearDirectText && keyboardDirectInput) {
      btnClearDirectText.addEventListener('click', () => {
        keyboardDirectInput.value = '';
        lastLength = 0;
      });
    }

    if (btnSendDirectText && keyboardDirectInput) {
      btnSendDirectText.addEventListener('click', () => {
        const text = keyboardDirectInput.value;
        if (text && this.input) {
          this.input.sendDirectText(text);
          keyboardDirectInput.value = '';
          lastLength = 0;
        }
      });
    }

    // Quick Keys
    document.querySelectorAll('.quick-key-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        if (this.input && key) {
          this.input.sendSingleKey(key);
        }
      });
    });

    // On-Screen Keyboard Keys
    document.querySelectorAll('.osk-key').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const key = btn.dataset.key;
        const combo = btn.dataset.combo;
        if (combo && this.connection) {
          this.connection.sendKeyCombo(combo.split('+'));
        } else if (key && this.input) {
          this.input.sendSingleKey(key);
        }
      });
    });
  }

  _setupQuickTypingBar() {
    const bar = document.getElementById('quickTypingBar');
    const input = document.getElementById('quickTypingInput');
    const btnSend = document.getElementById('btnQuickTypeSend');
    const btnEnter = document.getElementById('btnQuickTypeEnter');
    const btnBack = document.getElementById('btnQuickTypeBack');
    const btnClose = document.getElementById('btnQuickTypeClose');
    const btnTopKb = document.getElementById('btnTopKeyboard');
    const btnQuickKb = document.getElementById('btnQuickKeyboard');
    const btnFloatKb = document.getElementById('btnFloatingKeyboard');

    if (!bar || !input) return;

    const openBar = () => {
      bar.style.display = 'flex';
      btnTopKb?.classList.add('active');
      btnQuickKb?.classList.add('active');
      if (btnFloatKb) btnFloatKb.style.display = 'none';
      setTimeout(() => {
        input.focus();
      }, 60);
    };

    const closeBar = () => {
      bar.style.display = 'none';
      btnTopKb?.classList.remove('active');
      btnQuickKb?.classList.remove('active');
      if (btnFloatKb) btnFloatKb.style.display = 'flex';
      input.blur();
    };

    this._toggleQuickTypingBar = () => {
      if (bar.style.display === 'none' || !bar.style.display) {
        openBar();
      } else {
        closeBar();
      }
    };

    [btnTopKb, btnQuickKb, btnFloatKb].forEach(btn => {
      if (!btn) return;
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        this._toggleQuickTypingBar();
      });
      btn.addEventListener('touchend', (e) => {
        e.preventDefault();
        this._toggleQuickTypingBar();
      });
    });

    if (btnClose) {
      btnClose.addEventListener('click', (e) => {
        e.preventDefault();
        closeBar();
      });
    }

    // Live typing: As characters are typed on the mobile keyboard, send immediately to laptop
    let lastVal = '';
    input.addEventListener('input', (e) => {
      const val = input.value;
      if (!this.connection) return;

      if (e.inputType === 'deleteContentBackward') {
        this.connection.sendKeyPress('Backspace');
      } else if (val.length > lastVal.length) {
        const added = val.slice(lastVal.length);
        this.connection.sendText(added);
      } else if (val.length < lastVal.length) {
        const diff = lastVal.length - val.length;
        for (let i = 0; i < diff; i++) {
          this.connection.sendKeyPress('Backspace');
        }
      }
      lastVal = val;
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (this.connection) {
          this.connection.sendKeyPress('Enter');
        }
        input.value = '';
        lastVal = '';
      } else if (e.key === 'Escape') {
        if (this.connection) this.connection.sendKeyPress('Escape');
        closeBar();
      }
    });

    if (btnSend) {
      btnSend.addEventListener('click', () => {
        if (input.value && this.connection) {
          this.connection.sendText(input.value);
          input.value = '';
          lastVal = '';
        }
      });
    }

    if (btnEnter) {
      btnEnter.addEventListener('click', () => {
        if (this.connection) this.connection.sendKeyPress('Enter');
      });
    }

    if (btnBack) {
      btnBack.addEventListener('click', () => {
        if (this.connection) this.connection.sendKeyPress('Backspace');
        if (input.value.length > 0) {
          input.value = input.value.slice(0, -1);
          lastVal = input.value;
        }
      });
    }
  }

  _setupScreenFitMode() {
    const btn = document.getElementById('btnScreenFitMode');
    const badge = document.getElementById('screenFitBadge');
    const label = document.getElementById('screenFitLabel');
    if (!btn) return;

    const updateFitUI = (mode) => {
      const modeNames = {
        'fit': { badge: 'Fit', label: 'Fit Screen' },
        'fill': { badge: 'Fill', label: 'Stretch Full' },
        'rotate': { badge: '90°', label: 'Rotate 90°' },
        'width': { badge: 'Width', label: 'Fit Width' }
      };
      const info = modeNames[mode] || modeNames['fit'];
      if (badge) badge.textContent = info.badge;
      if (label) label.textContent = info.label;
      btn.classList.toggle('highlight', mode !== 'fit');
    };

    btn.addEventListener('click', () => {
      if (this.display) {
        const nextMode = this.display.cycleFitMode();
        updateFitUI(nextMode);
      }
    });

    if (this.display) {
      updateFitUI(this.display.fitMode || 'fit');
    }
  }

  _updateModeUI(mode) {
    const btnMouse = document.getElementById('btnMouse');
    const modeBadge = document.getElementById('modeBadge');
    
    if (mode === 'direct') {
      if (btnMouse) {
        btnMouse.classList.add('active');
        const span = btnMouse.querySelector('span');
        if (span) span.textContent = 'Touch Mode';
      }
      if (modeBadge) {
        modeBadge.textContent = '👆 Direct Touch';
      }
    } else {
      if (btnMouse) {
        btnMouse.classList.remove('active');
        const span = btnMouse.querySelector('span');
        if (span) span.textContent = 'Trackpad';
      }
      if (modeBadge) {
        modeBadge.textContent = '🖱️ Trackpad';
      }
    }
  }

  // ═══════════════════════════════════════════════════════════
  // TOOLBAR & PANELS
  // ═══════════════════════════════════════════════════════════

  _setupToolbar() {
    const btnKeyboard = document.getElementById('btnKeyboard');
    const btnMouse = document.getElementById('btnMouse');
    const btnFiles = document.getElementById('btnFiles');
    const btnSettings = document.getElementById('btnSettings');
    const btnSpecialKeys = document.getElementById('btnSpecialKeys');
    
    btnKeyboard.addEventListener('click', () => {
      if (this._toggleQuickTypingBar) {
        this._toggleQuickTypingBar();
      } else {
        this._togglePanel('keyboardPanel');
      }
    });
    
    btnMouse.addEventListener('click', () => {
      if (this.input) {
        const newMode = this.input.touchMode === 'trackpad' ? 'direct' : 'trackpad';
        this.input.setTouchMode(newMode);
        this._updateModeUI(newMode);
      }
    });
    
    btnFiles.addEventListener('click', () => {
      this._togglePanel('filePanel');
    });
    
    btnSettings.addEventListener('click', () => {
      this._togglePanel('settingsPanel');
    });
    
    btnSpecialKeys.addEventListener('click', () => {
      this._togglePanel('specialKeysPanel');
    });
  }

  _setupPanels() {
    // Close buttons
    document.querySelectorAll('.panel-close').forEach(btn => {
      btn.addEventListener('click', () => {
        const panelId = btn.dataset.panel;
        this._closePanel(panelId);
      });
    });
  }

  _togglePanel(panelId) {
    const panel = document.getElementById(panelId);
    const isOpen = panel.classList.contains('open');
    
    // Close all panels first
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('open'));
    
    // Toggle the target panel
    if (!isOpen) {
      panel.classList.add('open');
    }
  }

  _closePanel(panelId) {
    const panel = document.getElementById(panelId);
    panel.classList.remove('open');
  }

  // ═══════════════════════════════════════════════════════════
  // SETTINGS
  // ═══════════════════════════════════════════════════════════

  _setupSettings() {
    // Quality settings
    document.querySelectorAll('[data-quality]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-quality]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const quality = btn.dataset.quality;
        const qualityMap = { low: 30, medium: 50, high: 80 };
        
        if (this.connection) {
          this.connection.sendQualitySettings({
            quality: qualityMap[quality],
            type: quality
          });
        }
      });
    });
    
    // FPS slider
    const fpsSlider = document.getElementById('fpsSlider');
    const fpsValue = document.getElementById('fpsValue');
    
    if (fpsSlider) {
      fpsSlider.addEventListener('input', () => {
        fpsValue.textContent = `${fpsSlider.value} FPS`;
      });
      
      fpsSlider.addEventListener('change', () => {
        if (this.connection) {
          this.connection.sendQualitySettings({
            fps: parseInt(fpsSlider.value)
          });
        }
      });
    }
    
    // Touch mode
    document.querySelectorAll('[data-touchmode]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('[data-touchmode]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        if (this.input) {
          this.input.setTouchMode(btn.dataset.touchmode);
        }
      });
    });
    
    // Toolbar toggle
    const toggleToolbar = document.getElementById('toggleToolbar');
    if (toggleToolbar) {
      toggleToolbar.addEventListener('change', () => {
        const toolbar = document.querySelector('.toolbar');
        const statusBar = document.querySelector('.status-bar');
        
        if (toggleToolbar.checked) {
          toolbar.classList.remove('hidden');
          statusBar.classList.remove('hidden');
        } else {
          toolbar.classList.add('hidden');
          statusBar.classList.add('hidden');
        }
      });
    }
  }

  // ═══════════════════════════════════════════════════════════
  // FULLSCREEN & DISCONNECT
  // ═══════════════════════════════════════════════════════════

  _setupFullscreen() {
    const fullscreenBtn = document.getElementById('fullscreenBtn');
    if (fullscreenBtn) {
      fullscreenBtn.addEventListener('click', () => {
        if (document.fullscreenElement) {
          document.exitFullscreen();
        } else {
          document.documentElement.requestFullscreen().catch(() => {});
        }
      });
    }
  }

  _setupDisconnect() {
    const disconnectBtn = document.getElementById('disconnectBtn');
    if (disconnectBtn) {
      disconnectBtn.addEventListener('click', () => {
        if (confirm('Disconnect from remote desktop?')) {
          this.connection.disconnect();
          this._showDisconnected('You disconnected');
        }
      });
    }
  }

  _showDisconnected(reason) {
    if (this.statsInterval) clearInterval(this.statsInterval);
    
    this.disconnectedOverlay.style.display = 'flex';
    this.disconnectReason.textContent = reason || 'Connection lost';
    
    // Clean up
    if (this.display) this.display.destroy();
    if (this.input) this.input.destroy();
  }
}

// ═══════════════════════════════════════════════════════════
// INITIALIZE APP
// ═══════════════════════════════════════════════════════════

let app;
document.addEventListener('DOMContentLoaded', () => {
  app = new App();
  
  // Expose globally for file manager callbacks
  window.app = app;
});

// Prevent pull-to-refresh and bounce scrolling
document.addEventListener('touchmove', (e) => {
  if (document.getElementById('remoteScreen').classList.contains('active')) {
    if (e.target.closest('.panel')) return; // Allow scrolling in panels
    e.preventDefault();
  }
}, { passive: false });

// Handle visibility change (pause/resume)
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    console.log('[App] App went to background');
  } else {
    console.log('[App] App returned to foreground');
  }
});
