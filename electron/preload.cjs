const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('gameonixDesktop', {
  isDesktop: true,
  windowControls: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    toggleMaximize: () => ipcRenderer.invoke('window:toggle-maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onStateChange: (callback) => {
      const listener = (_event, maximized) => callback(maximized)
      ipcRenderer.on('window:state', listener)
      return () => ipcRenderer.removeListener('window:state', listener)
    },
    back: () => ipcRenderer.invoke('window:back'),
    forward: () => ipcRenderer.invoke('window:forward'),
  },
  updates: {
    getState: () => ipcRenderer.invoke('updates:get-state'),
    check: () => ipcRenderer.invoke('updates:check'),
    onStateChange: (callback) => {
      const listener = (_event, state) => callback(state)
      ipcRenderer.on('updates:state', listener)
      return () => ipcRenderer.removeListener('updates:state', listener)
    },
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    update: (patch) => ipcRenderer.invoke('settings:update', patch),
  },
  downloads: {
    list: () => ipcRenderer.invoke('downloads:list'),
    start: (game) => ipcRenderer.invoke('downloads:start', game),
    pause: (id) => ipcRenderer.invoke('downloads:pause', id),
    resume: (id) => ipcRenderer.invoke('downloads:resume', id),
    remove: (id, deleteFiles = false) => ipcRenderer.invoke('downloads:remove', { id, deleteFiles }),
    openFolder: (id) => ipcRenderer.invoke('downloads:open-folder', id),
    getDirectory: () => ipcRenderer.invoke('downloads:get-directory'),
    chooseDirectory: () => ipcRenderer.invoke('downloads:choose-directory'),
    onUpdate: (callback) => {
      const listener = (_event, downloads) => callback(downloads)
      ipcRenderer.on('downloads:update', listener)
      return () => ipcRenderer.removeListener('downloads:update', listener)
    },
  },
})
