/**
 * File Transfer Manager
 * Handles file uploads (mobile → desktop) and downloads (desktop → mobile)
 */

class FileManager {
  constructor(connection) {
    this.connection = connection;
    this.transfers = [];
    this.downloadChunks = {};
    
    // UI elements
    this.fileList = document.getElementById('fileList');
    this.transferProgress = document.getElementById('transferProgress');
    this.transferFileName = document.getElementById('transferFileName');
    this.transferPercent = document.getElementById('transferPercent');
    this.progressFill = document.getElementById('progressFill');
    this.fileUploadInput = document.getElementById('fileUploadInput');
    
    this._bindEvents();
    this._setupConnectionHandlers();
  }

  _bindEvents() {
    // Upload button
    if (this.fileUploadInput) {
      this.fileUploadInput.addEventListener('change', (e) => {
        this._handleFileUpload(e.target.files);
        e.target.value = ''; // Reset
      });
    }

    // Download button
    const downloadBtn = document.getElementById('btnDownloadFile');
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        this.connection.requestFileList('~');
      });
    }
  }

  _setupConnectionHandlers() {
    // File list from desktop
    this.connection.onFileList = (data) => {
      this._renderFileList(data.files || []);
    };

    // File download chunks
    this.connection.onFileChunk = (data) => {
      if (!this.downloadChunks[data.fileId]) {
        this.downloadChunks[data.fileId] = {
          name: data.fileName,
          chunks: [],
          totalChunks: data.totalChunks,
          size: data.totalSize,
          mimeType: data.mimeType || 'application/octet-stream'
        };
      }
      
      this.downloadChunks[data.fileId].chunks.push(data.chunk);
      
      // Update progress
      const progress = (this.downloadChunks[data.fileId].chunks.length / data.totalChunks) * 100;
      this._updateProgress(data.fileName, progress);
    };

    // File download complete
    this.connection.onFileComplete = (data) => {
      const fileData = this.downloadChunks[data.fileId];
      if (!fileData) return;
      
      // Combine chunks and trigger download
      const combined = this._combineChunks(fileData.chunks);
      const blob = new Blob([combined], { type: fileData.mimeType });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = fileData.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      // Add to transfer list
      this._addTransferRecord(fileData.name, fileData.size, 'download', 'complete');
      
      // Clean up
      delete this.downloadChunks[data.fileId];
      this._hideProgress();
    };

    // File upload complete acknowledgment
    this.connection.onFileUploadComplete = (data) => {
      this._addTransferRecord(data.fileName, data.size, 'upload', 'complete');
      this._hideProgress();
    };
  }

  /**
   * Handle file upload from mobile
   */
  async _handleFileUpload(files) {
    for (const file of files) {
      const CHUNK_SIZE = 512 * 1024; // 512KB chunks
      const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
      const fileId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      
      this._addTransferRecord(file.name, file.size, 'upload', 'in-progress');
      
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        const buffer = await chunk.arrayBuffer();
        
        this.connection.sendFileUpload({
          fileId,
          fileName: file.name,
          chunk: buffer,
          chunkIndex: i,
          totalChunks,
          totalSize: file.size,
          mimeType: file.type
        });
        
        const progress = ((i + 1) / totalChunks) * 100;
        this._updateProgress(file.name, progress);
      }
    }
  }

  /**
   * Render file list from desktop
   */
  _renderFileList(files) {
    if (!this.fileList) return;
    
    if (files.length === 0) {
      this.fileList.innerHTML = `
        <div class="file-list-empty">
          <p>No files found</p>
        </div>
      `;
      return;
    }

    this.fileList.innerHTML = files.map(file => `
      <div class="file-item" data-path="${this._escapeHtml(file.path)}">
        <div class="file-item-icon">${file.isDir ? '📁' : this._getFileIcon(file.name)}</div>
        <div class="file-item-info">
          <div class="file-item-name">${this._escapeHtml(file.name)}</div>
          <div class="file-item-size">${file.isDir ? 'Folder' : this._formatSize(file.size)}</div>
        </div>
        ${file.isDir 
          ? `<button class="file-item-action" onclick="app.fileManager._browseFolder('${this._escapeHtml(file.path)}')">→</button>`
          : `<button class="file-item-action" onclick="app.fileManager._downloadFile('${this._escapeHtml(file.path)}')">↓</button>`
        }
      </div>
    `).join('');
  }

  _browseFolder(path) {
    this.connection.requestFileList(path);
  }

  _downloadFile(path) {
    this.connection.requestFileDownload(path);
  }

  _addTransferRecord(name, size, type, status) {
    const record = { name, size, type, status, time: Date.now() };
    this.transfers.unshift(record);
    
    // Update UI with the last few transfers
    if (this.fileList) {
      const existingRecords = this.fileList.querySelectorAll('.transfer-record');
      
      const recordHtml = `
        <div class="file-item transfer-record">
          <div class="file-item-icon">${type === 'upload' ? '⬆️' : '⬇️'}</div>
          <div class="file-item-info">
            <div class="file-item-name">${this._escapeHtml(name)}</div>
            <div class="file-item-size">${this._formatSize(size)} • ${status}</div>
          </div>
        </div>
      `;
      
      if (existingRecords.length === 0 && this.fileList.querySelector('.file-list-empty')) {
        this.fileList.innerHTML = recordHtml;
      } else {
        this.fileList.insertAdjacentHTML('afterbegin', recordHtml);
      }
    }
  }

  _updateProgress(fileName, percent) {
    if (this.transferProgress) {
      this.transferProgress.style.display = 'block';
      this.transferFileName.textContent = fileName;
      this.transferPercent.textContent = `${Math.round(percent)}%`;
      this.progressFill.style.width = `${percent}%`;
    }
  }

  _hideProgress() {
    setTimeout(() => {
      if (this.transferProgress) {
        this.transferProgress.style.display = 'none';
        this.progressFill.style.width = '0%';
      }
    }, 1500);
  }

  _combineChunks(chunks) {
    // Handle both ArrayBuffer and base64 chunks
    if (typeof chunks[0] === 'string') {
      // Base64 encoded
      const binaryString = chunks.map(c => atob(c)).join('');
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      return bytes.buffer;
    }
    
    // ArrayBuffer chunks
    const totalLength = chunks.reduce((sum, c) => sum + c.byteLength, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }
    return combined.buffer;
  }

  _getFileIcon(name) {
    const ext = name.split('.').pop().toLowerCase();
    const iconMap = {
      pdf: '📄', doc: '📝', docx: '📝', txt: '📝',
      jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️', svg: '🖼️',
      mp4: '🎬', avi: '🎬', mkv: '🎬', mov: '🎬',
      mp3: '🎵', wav: '🎵', flac: '🎵',
      zip: '📦', rar: '📦', '7z': '📦',
      js: '💻', py: '💻', html: '💻', css: '💻',
      exe: '⚙️', msi: '⚙️',
      xls: '📊', xlsx: '📊', csv: '📊',
      ppt: '📊', pptx: '📊'
    };
    return iconMap[ext] || '📄';
  }

  _formatSize(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) {
      size /= 1024;
      i++;
    }
    return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
  }

  _escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

window.FileManager = FileManager;
