// preload.js — Mere Code — Context Bridge
const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

contextBridge.exposeInMainWorld('merecode', {
  // ─── File System ───
  fs: {
    readdir:      (p)          => ipcRenderer.invoke('fs:readdir', p),
    readFile:     (p)          => ipcRenderer.invoke('fs:readfile', p),
    writeFile:    (p, c)       => ipcRenderer.invoke('fs:writefile', p, c),
    mkdir:        (p)          => ipcRenderer.invoke('fs:mkdir', p),
    delete:       (p)          => ipcRenderer.invoke('fs:delete', p),
    rename:       (o, n)       => ipcRenderer.invoke('fs:rename', o, n),
    stat:         (p)          => ipcRenderer.invoke('fs:stat', p),
    exists:       (p)          => ipcRenderer.invoke('fs:exists', p),
    realpath:     (p)          => ipcRenderer.invoke('fs:realpath', p),
    search:       (root, q, o) => ipcRenderer.invoke('fs:search', root, q, o),
    replaceInFile:(fp, s, r, o)=> ipcRenderer.invoke('fs:replaceInFile', fp, s, r, o),
    listAllFiles: (root, max)   => ipcRenderer.invoke('fs:listAllFiles', root, max),
    readFileBase64:(p)          => ipcRenderer.invoke('fs:readFileBase64', p),
    watchDir:     (p)          => ipcRenderer.invoke('fs:watchDir', p),
    unwatchDir:   ()           => ipcRenderer.invoke('fs:unwatchDir'),
    onFileChanged: (cb) => {
      const handler = (_, data) => cb(data);
      ipcRenderer.on('fs:fileChanged', handler);
      return () => ipcRenderer.removeListener('fs:fileChanged', handler);
    },
  },

  // ─── Terminal ───
  terminal: {
    create:  (opts)         => ipcRenderer.invoke('terminal:create', opts),
    write:   (id, data)     => ipcRenderer.send('terminal:write', id, data),
    resize:  (id, cols, rows) => ipcRenderer.send('terminal:resize', id, cols, rows),
    destroy: (id)           => ipcRenderer.send('terminal:destroy', id),
    onData: (cb) => {
      const handler = (_, id, data) => cb(id, data);
      ipcRenderer.on('terminal:data', handler);
      return () => ipcRenderer.removeListener('terminal:data', handler);
    },
    onExit: (cb) => {
      const handler = (_, id, code) => cb(id, code);
      ipcRenderer.on('terminal:exit', handler);
      return () => ipcRenderer.removeListener('terminal:exit', handler);
    },
  },

  // ─── Dialogs ───
  dialog: {
    openFolder: ()  => ipcRenderer.invoke('dialog:openFolder'),
    openFile:   ()  => ipcRenderer.invoke('dialog:openFile'),
    saveFile:   (p) => ipcRenderer.invoke('dialog:saveFile', p),
  },

  // ─── Git ───
  git: {
    status:          (rp)           => ipcRenderer.invoke('git:status', rp),
    log:             (rp)           => ipcRenderer.invoke('git:log', rp),
    diff:            (rp, fp)       => ipcRenderer.invoke('git:diff', rp, fp),
    diffStaged:      (rp, fp)       => ipcRenderer.invoke('git:diffStaged', rp, fp),
    add:             (rp, files)    => ipcRenderer.invoke('git:add', rp, files),
    unstage:         (rp, files)    => ipcRenderer.invoke('git:unstage', rp, files),
    commit:          (rp, msg)      => ipcRenderer.invoke('git:commit', rp, msg),
    push:            (rp, r, b)     => ipcRenderer.invoke('git:push', rp, r, b),
    pull:            (rp, r, b)     => ipcRenderer.invoke('git:pull', rp, r, b),
    fetch:           (rp)           => ipcRenderer.invoke('git:fetch', rp),
    branches:        (rp)           => ipcRenderer.invoke('git:branches', rp),
    checkout:        (rp, branch)   => ipcRenderer.invoke('git:checkout', rp, branch),
    createBranch:    (rp, name)     => ipcRenderer.invoke('git:createBranch', rp, name),
    stash:           (rp)           => ipcRenderer.invoke('git:stash', rp),
    stashPop:        (rp)           => ipcRenderer.invoke('git:stashPop', rp),
    discardFile:     (rp, fp)       => ipcRenderer.invoke('git:discardFile', rp, fp),
    blame:           (rp, fp)       => ipcRenderer.invoke('git:blame', rp, fp),
    graph:           (rp)           => ipcRenderer.invoke('git:graph', rp),
    fileLog:         (rp, fp)       => ipcRenderer.invoke('git:fileLog', rp, fp),
    getConflicts:    (rp)           => ipcRenderer.invoke('git:getConflicts', rp),
    resolveConflict: (rp, fp, c)    => ipcRenderer.invoke('git:resolveConflict', rp, fp, c),
    stageHunk:       (rp, patch)     => ipcRenderer.invoke('git:stageHunk', rp, patch),
    blameLines:      (rp, fp)        => ipcRenderer.invoke('git:blameLines', rp, fp),
  },

  // ─── Task Runner ───
  task: {
    list: (rootPath)               => ipcRenderer.invoke('task:list', rootPath),
    run:  (rootPath, name, cmd)    => ipcRenderer.invoke('task:run', rootPath, name, cmd),
    kill: (id)                     => ipcRenderer.send('task:kill', id),
    onOutput: (cb) => {
      const handler = (_, id, data) => cb(id, data);
      ipcRenderer.on('task:output', handler);
      return () => ipcRenderer.removeListener('task:output', handler);
    },
    onDone: (cb) => {
      const handler = (_, id, code) => cb(id, code);
      ipcRenderer.on('task:done', handler);
      return () => ipcRenderer.removeListener('task:done', handler);
    },
  },

  // ─── Workspace Settings ───
  workspace: {
    load: (rootPath)              => ipcRenderer.invoke('workspace:loadSettings', rootPath),
    save: (rootPath, settings)    => ipcRenderer.invoke('workspace:saveSettings', rootPath, settings),
  },

  // ─── Window Controls ───
  window: {
    minimize:    () => ipcRenderer.send('window:minimize'),
    maximize:    () => ipcRenderer.send('window:maximize'),
    close:       () => ipcRenderer.send('window:close'),
    forceClose:  () => ipcRenderer.send('window:forceClose'),
    isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    onStateChange: (cb) => {
      const handler = (_, maximized) => cb(maximized);
      ipcRenderer.on('window:state', handler);
      return () => ipcRenderer.removeListener('window:state', handler);
    },
    onBeforeClose: (cb) => {
      const handler = () => cb();
      ipcRenderer.on('window:beforeClose', handler);
      return () => ipcRenderer.removeListener('window:beforeClose', handler);
    },
  },

  // ─── Path Utilities ───
  path: {
    join:       (...args) => path.join(...args),
    dirname:    (p)       => path.dirname(p),
    basename:   (p, ext)  => path.basename(p, ext),
    extname:    (p)       => path.extname(p),
    sep:        path.sep,
    isAbsolute: (p)       => path.isAbsolute(p),
    resolve:    (...args) => path.resolve(...args),
    normalize:  (p)       => path.normalize(p),
  },

  // ─── App ───
  app: {
    getVersion:   () => ipcRenderer.invoke('app:getVersion'),
    getAppPath:   () => ipcRenderer.invoke('app:getAppPath'),
    getPlatform:  () => ipcRenderer.invoke('app:getPlatform'),
    openExternal: (u) => ipcRenderer.send('app:openExternal', u),
    getCrashLog:  () => ipcRenderer.invoke('app:getCrashLog'),
    platform:     process.platform,
  },

  // ─── Secure Storage (safeStorage) ───
  secure: {
    encrypt:     (plaintext) => ipcRenderer.invoke('secure:encrypt', plaintext),
    decrypt:     (base64)    => ipcRenderer.invoke('secure:decrypt', base64),
    isAvailable: ()          => ipcRenderer.invoke('secure:isAvailable'),
  },

  // ─── API Proxy (main process handles fetch to avoid CORS) ───
  api: {
    chatStream: (opts) => ipcRenderer.invoke('api:chatStream', opts),
    chat:       (opts) => ipcRenderer.invoke('api:chat', opts),
    onChatChunk: (handler) => {
      const fn = (_event, data) => handler(data);
      ipcRenderer.on('api:chatChunk', fn);
      return () => ipcRenderer.removeListener('api:chatChunk', fn);
    },
  },

  // ─── Auto-Updater ───
  updater: {
    check:    () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.send('updater:download'),
    install:  () => ipcRenderer.send('updater:install'),
    onAvailable: (cb) => {
      const handler = (_, info) => cb(info);
      ipcRenderer.on('updater:available', handler);
      return () => ipcRenderer.removeListener('updater:available', handler);
    },
    onDownloaded: (cb) => {
      const handler = (_, info) => cb(info);
      ipcRenderer.on('updater:downloaded', handler);
      return () => ipcRenderer.removeListener('updater:downloaded', handler);
    },
  },
});
