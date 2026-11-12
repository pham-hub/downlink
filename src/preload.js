const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getToolVersions: () => ipcRenderer.invoke('get-tool-versions'),
  onToolsUpdated: (cb) => ipcRenderer.on('tools-updated', (event, data) => cb(data)),
  fetchInfo: (url, opts) => ipcRenderer.invoke('fetch-info', url, opts),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (partial) => ipcRenderer.invoke('save-settings', partial),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),

  startDownload: (payload) => ipcRenderer.invoke('start-download', payload),
  cancelDownload: () => ipcRenderer.invoke('cancel-download'),
  submitPassword: (payload) => ipcRenderer.invoke('submit-password', payload),
  discardJob: (id) => ipcRenderer.invoke('discard-job', id),
  onJobUpdate: (cb) => ipcRenderer.on('job-update', (event, snapshot) => cb(snapshot)),
  getPresets: () => ipcRenderer.invoke('get-presets'),
  history: {
    list: (query) => ipcRenderer.invoke('history-list', query),
    thumb: (id) => ipcRenderer.invoke('history-thumb', id),
    get: (id) => ipcRenderer.invoke('history-get', id),
    remove: (id) => ipcRenderer.invoke('history-remove', id),
    show: (id) => ipcRenderer.invoke('history-show', id),
    open: (id) => ipcRenderer.invoke('history-open', id),
    copyLink: (id) => ipcRenderer.invoke('history-copy-link', id),
    clear: () => ipcRenderer.invoke('history-clear'),
  },
  onClipboardOffer: (cb) => ipcRenderer.on('clipboard-offer', (event, data) => cb(data)),
  openFolder: () => ipcRenderer.invoke('open-folder'),

  showInFolder: (filePath) => ipcRenderer.invoke('show-in-folder', filePath),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  resizeToContent: (height) => ipcRenderer.send('resize-to-content', height),
});
