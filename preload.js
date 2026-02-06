const { contextBridge, ipcRenderer } = require('electron');

// Expõe API segura para o frontend
contextBridge.exposeInMainWorld('electronAPI', {
  loadData: () => ipcRenderer.invoke('load-data'),
  saveData: (data) => ipcRenderer.invoke('save-data', data),
  listSaves: () => ipcRenderer.invoke('list-saves'),
  switchSave: (fileName) => ipcRenderer.invoke('switch-save', fileName),
  restoreBackup: (fileName) => ipcRenderer.invoke('restore-backup', fileName),
  createBackup: (fileName, data) => ipcRenderer.invoke('create-backup', fileName, data),
  createSave: (fileName) => ipcRenderer.invoke('create-save', fileName),
  restoreFocus: () => ipcRenderer.invoke('restore-focus'),
  openSavesFolder: () => ipcRenderer.invoke('open-saves-folder'),
  resetMachineGUID: () => ipcRenderer.invoke('reset-machine-guid'),
  getMachineGUID: () => ipcRenderer.invoke('get-machine-guid'),
  clearWarThunderCache: () => ipcRenderer.invoke('clear-warthunder-cache'),
  clearMiHoYoCache: () => ipcRenderer.invoke('clear-mihoyo-cache'),
  clearEndfieldCache: () => ipcRenderer.invoke('clear-endfield-cache'),
  
  // APIs de checagem de cache
  checkWarThunderCache: () => ipcRenderer.invoke('check-warthunder-cache'),
  checkMiHoYoCache: () => ipcRenderer.invoke('check-mihoyo-cache'),
  checkEndfieldCache: () => ipcRenderer.invoke('check-endfield-cache'),
  
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),
  resetMacAddress: (adapterName) => ipcRenderer.invoke('reset-mac-address', adapterName),
  listNetworkAdapters: () => ipcRenderer.invoke('list-network-adapters'),
  resetSecondaryIds: () => ipcRenderer.invoke('reset-secondary-ids'),
  clearKameleoCache: () => ipcRenderer.invoke('clear-kameleo-cache'),
  
  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  quitAndInstall: () => ipcRenderer.invoke('quit-and-install'),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (_, info) => callback(info)),
  onUpdateDownloadProgress: (callback) => ipcRenderer.on('update-download-progress', (_, progress) => callback(progress)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (_, info) => callback(info))
});