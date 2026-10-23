const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getToolVersions: () => ipcRenderer.invoke('get-tool-versions'),
  onToolsUpdated: (cb) => ipcRenderer.on('tools-updated', (event, data) => cb(data)),
  fetchInfo: (url) => ipcRenderer.invoke('fetch-info', url),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (partial) => ipcRenderer.invoke('save-settings', partial),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),

  startDownload: (payload) => ipcRenderer.invoke('start-download', payload),
  cancelDownload: () => ipcRenderer.invoke('cancel-download'),
  onDownloadProgress: (cb) => ipcRenderer.on('download-progress', (event, data) => cb(data)),
  onDownloadComplete: (cb) => ipcRenderer.on('download-complete', (event, data) => cb(data)),
  onDownloadError: (cb) => ipcRenderer.on('download-error', (event, data) => cb(data)),
  onDownloadCancelled: (cb) => ipcRenderer.on('download-cancelled', () => cb()),

  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  resizeToContent: (height) => ipcRenderer.send('resize-to-content', height),
});
