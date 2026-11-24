const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('gameonixDesktop', {
  isDesktop: true,
  authSession: {
    get: () => ipcRenderer.invoke('auth-session:get'),
    set: (token) => ipcRenderer.invoke('auth-session:set', token),
    clear: () => ipcRenderer.invoke('auth-session:clear'),
    signInWithWebsite: () => ipcRenderer.invoke('auth-session:website-login'),
  },
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
    reload: () => ipcRenderer.invoke('window:reload'),
  },
  updates: {
    getState: () => ipcRenderer.invoke('updates:get-state'),
    check: () => ipcRenderer.invoke('updates:check'),
    defer: () => ipcRenderer.invoke('updates:defer'),
    restart: () => ipcRenderer.invoke('updates:restart'),
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
  notifications: {
    show: (notification) => ipcRenderer.invoke('notifications:show', notification),
    setUnreadCount: (count) => ipcRenderer.invoke('notifications:set-unread-count', count),
  },
  downloads: {
    list: () => ipcRenderer.invoke('downloads:list'),
    start: (game) => ipcRenderer.invoke('downloads:prepare', game),
    directList: () => ipcRenderer.invoke('downloads:direct-list'),
    directStart: (game) => ipcRenderer.invoke('downloads:direct-start', game),
    directCancel: (id) => ipcRenderer.invoke('downloads:direct-cancel', id),
    directPause: (id) => ipcRenderer.invoke('downloads:direct-pause', id),
    directResume: (id) => ipcRenderer.invoke('downloads:direct-resume', id),
    directRemove: (id, deleteFiles = false) => ipcRenderer.invoke('downloads:direct-remove', { id, deleteFiles }),
    directOpen: (id) => ipcRenderer.invoke('downloads:direct-open', id),
    directStartPage: (id) => ipcRenderer.invoke('downloads:direct-start-page', id),
    onDirectUpdate: (callback) => {
      const listener = (_event, downloads) => callback(downloads)
      ipcRenderer.on('downloads:direct-update', listener)
      return () => ipcRenderer.removeListener('downloads:direct-update', listener)
    },
    begin: (id, fileIndices) => ipcRenderer.invoke('downloads:begin', { id, fileIndices }),
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
