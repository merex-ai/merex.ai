// main.js — Mere Code — Electron Main Process
const { app, BrowserWindow, ipcMain, dialog, shell, Menu, net } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const url = require('url');

let mainWindow = null;
let serverPort = 0;
let currentRootPath = null;

// Path validation: ensure file operations stay within workspace
const ALLOWED_API_HOSTS = ['merex.ai', 'www.merex.ai', 'localhost'];
function isPathSafe(targetPath) {
  if (!currentRootPath) return true; // No workspace open — allow all
  const resolved = path.resolve(targetPath);
  const root = path.resolve(currentRootPath);
  return resolved.startsWith(root + path.sep) || resolved === root;
}
function validateEndpointUrl(endpoint) {
  try {
    const parsed = new URL(endpoint);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    const host = parsed.hostname.toLowerCase();
    return ALLOWED_API_HOSTS.some(h => host === h || host.endsWith('.' + h));
  } catch { return false; }
}
const ALLOWED_SHELLS_WIN = ['cmd.exe', 'powershell.exe', 'pwsh.exe', 'bash.exe', 'wsl.exe', 'git-bash.exe'];
const ALLOWED_SHELLS_UNIX = ['/bin/bash', '/bin/sh', '/bin/zsh', '/usr/bin/fish', '/usr/local/bin/fish', '/usr/bin/bash', '/usr/bin/zsh'];

// ═══════════════════════════════════════════════════
//  MIME Types
// ═════���══════════════════��══════════════════════════
const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json', '.map': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
  '.wasm': 'application/wasm', '.ts': 'text/javascript',
};

// ════════════════════���══════════════════════════════
//  Static File Server (serves renderer + node_modules)
//  Port auto-assigned (0 = OS picks a free port)
// ══════════════���════════════════════════════════════
function createServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url);
      let pathname = decodeURIComponent(parsedUrl.pathname);

      let filePath;
      if (pathname.startsWith('/node_modules/')) {
        filePath = path.join(__dirname, pathname);
      } else if (pathname.startsWith('/vendor/')) {
        filePath = path.join(__dirname, 'renderer', pathname);
      } else {
        filePath = path.join(__dirname, 'renderer', pathname === '/' ? 'index.html' : pathname);
      }

      // Prevent path traversal — normalize before checking
      const resolvedPath = path.resolve(filePath);
      const allowedRoots = [
        path.resolve(__dirname, 'renderer'),
        path.resolve(__dirname, 'node_modules'),
      ];
      if (!allowedRoots.some(root => resolvedPath.startsWith(root + path.sep) || resolvedPath === root)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME[ext] || 'application/octet-stream';

      fs.readFile(filePath, (err, content) => {
        if (err) {
          res.writeHead(err.code === 'ENOENT' ? 404 : 500);
          res.end(err.code === 'ENOENT' ? 'Not Found' : 'Error');
          return;
        }
        res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache' });
        res.end(content);
      });
    });

    // Auto-assign port (port 0 = OS picks a free port)
    server.listen(0, '127.0.0.1', () => {
      serverPort = server.address().port;
      console.log(`[Mere Code] Server listening on port ${serverPort}`);
      resolve(serverPort);
    });

    server.on('error', (err) => {
      console.error('[Mere Code] Server error:', err.message);
      reject(err);
    });
  });
}

// ═══════════════════════════════════════════════════
//  Window Creation
// ═════���═════════════════════════════════════════════
function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: '#191918',
    title: 'Mere Code',
    icon: path.join(__dirname, 'renderer', 'assets', 'logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      sandbox: false,
    },
  });

  Menu.setApplicationMenu(null);
  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  // Set Content Security Policy
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [`default-src 'self' http://127.0.0.1:${port}; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://127.0.0.1:${port}; style-src 'self' 'unsafe-inline' http://127.0.0.1:${port}; connect-src 'self' http://127.0.0.1:${port} https://merex.ai https://*.merex.ai; img-src 'self' data: blob: http://127.0.0.1:${port}; font-src 'self' data: http://127.0.0.1:${port}; worker-src 'self' blob:;`]
      }
    });
  });

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:state', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:state', false));
  mainWindow.on('closed', () => {
    // Cleanup all resources
    if (fileWatcher) { fileWatcher.close(); fileWatcher = null; }
    for (const [langId, proc] of lspProcesses) {
      try { proc.kill(); } catch {}
    }
    lspProcesses.clear();
    for (const [id, proc] of terminals) {
      try { proc.kill(); } catch {}
    }
    terminals.clear();
    mainWindow = null;
  });
}

// ═══��════════════════════��══════════════════════════
//  IPC: Window Controls
// ═══════���═══════════════════════════════════════════
ipcMain.on('window:minimize', () => mainWindow?.minimize());
ipcMain.on('window:maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.on('window:close', () => {
  // Send beforeClose to renderer to check for unsaved changes
  mainWindow?.webContents.send('window:beforeClose');
});
ipcMain.on('window:forceClose', () => {
  if (mainWindow) {
    mainWindow.destroy();
  }
});
ipcMain.handle('window:isMaximized', () => mainWindow?.isMaximized() || false);

// ═══════════════════════════════��═══════════════════
//  IPC: File System
// ════════════════════════���══════════════════════════
ipcMain.handle('fs:readdir', async (_, dirPath) => {
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    const hidden = new Set(['.git', 'node_modules', '__pycache__', '.next', '.DS_Store', 'Thumbs.db', '.cache', '.turbo']);
    return entries
      .filter(e => !hidden.has(e.name))
      .map(e => ({
        name: e.name,
        path: path.join(dirPath, e.name),
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
      }))
      .sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:readfile', async (_, filePath) => {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return { content };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:writefile', async (_, filePath, content) => {
  try {
    if (!isPathSafe(filePath)) return { error: 'Path outside workspace' };
    await fs.promises.writeFile(filePath, content, 'utf-8');
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:mkdir', async (_, dirPath) => {
  try {
    if (!isPathSafe(dirPath)) return { error: 'Path outside workspace' };
    await fs.promises.mkdir(dirPath, { recursive: true });
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:delete', async (_, itemPath) => {
  try {
    if (!isPathSafe(itemPath)) return { error: 'Path outside workspace' };
    await fs.promises.rm(itemPath, { recursive: true, force: true });
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:rename', async (_, oldPath, newPath) => {
  try {
    if (!isPathSafe(oldPath) || !isPathSafe(newPath)) return { error: 'Path outside workspace' };
    await fs.promises.rename(oldPath, newPath);
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:stat', async (_, itemPath) => {
  try {
    const stat = await fs.promises.stat(itemPath);
    return { size: stat.size, isFile: stat.isFile(), isDirectory: stat.isDirectory(), modified: stat.mtime.toISOString() };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle('fs:exists', async (_, itemPath) => {
  try { await fs.promises.access(itemPath); return true; } catch { return false; }
});

ipcMain.handle('fs:realpath', async (_, itemPath) => {
  try { return { path: await fs.promises.realpath(itemPath) }; } catch (err) { return { error: err.message }; }
});

// ═══════════════════════════════════════════════════
//  File Search (grep-like) with performance limits
// ═══════════════════════���═══════════════════════════
ipcMain.handle('fs:search', async (_, rootPath, query, options = {}) => {
  const results = [];
  const isRegex = options.regex || false;
  const caseSensitive = options.caseSensitive || false;
  const maxResults = Math.min(options.maxResults || 500, 2000);
  const skip = new Set(['.git', 'node_modules', '__pycache__', '.next', '.cache', 'dist', 'build', '.DS_Store', '.env']);
  const binaryExts = new Set(['.png','.jpg','.jpeg','.gif','.ico','.svg','.woff','.woff2','.ttf','.eot','.mp3','.mp4','.zip','.gz','.tar','.exe','.dll','.so','.wasm','.pdf']);

  let pattern;
  try {
    const flags = caseSensitive ? 'g' : 'gi';
    pattern = isRegex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
  } catch { return { error: 'Invalid regex pattern' }; }

  async function walk(dir, depth) {
    if (results.length >= maxResults || depth > 20) return;
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (results.length >= maxResults) return;
        if (skip.has(entry.name) || entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath, depth + 1);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (binaryExts.has(ext)) continue;
          try {
            const stat = await fs.promises.stat(fullPath);
            if (stat.size > 1024 * 512) continue;
            const content = await fs.promises.readFile(fullPath, 'utf-8');
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (results.length >= maxResults) return;
              pattern.lastIndex = 0;
              if (pattern.test(lines[i])) {
                results.push({
                  file: fullPath,
                  relativePath: path.relative(rootPath, fullPath),
                  line: i + 1,
                  column: lines[i].search(new RegExp(pattern.source, pattern.flags.replace('g', ''))) + 1,
                  text: lines[i].trim().substring(0, 200),
                });
              }
            }
          } catch { /* skip unreadable files */ }
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  await walk(rootPath, 0);
  return results;
});

// Replace in file
ipcMain.handle('fs:replaceInFile', async (_, filePath, searchText, replaceText, options = {}) => {
  try {
    if (!isPathSafe(filePath)) return { error: 'Path outside workspace' };
    const content = await fs.promises.readFile(filePath, 'utf-8');
    const flags = (options.caseSensitive ? '' : 'i') + 'g';
    const pattern = options.regex ? new RegExp(searchText, flags) : new RegExp(searchText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
    const count = (content.match(pattern) || []).length;
    const newContent = content.replace(pattern, replaceText);
    if (content === newContent) return { replaced: 0 };
    await fs.promises.writeFile(filePath, newContent, 'utf-8');
    return { replaced: count };
  } catch (err) { return { error: err.message }; }
});

// List all files recursively (for Quick Open)
ipcMain.handle('fs:listAllFiles', async (_, rootPath, maxFiles = 2000) => {
  const files = [];
  const skip = new Set(['.git', 'node_modules', '__pycache__', '.next', '.cache', 'dist', 'build', '.DS_Store', '.env', 'Thumbs.db', '.turbo']);
  async function walk(dir, depth) {
    if (files.length >= maxFiles || depth > 20) return;
    try {
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (files.length >= maxFiles) return;
        if (skip.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) await walk(fullPath, depth + 1);
        else files.push({ path: fullPath, relativePath: path.relative(rootPath, fullPath), name: entry.name });
      }
    } catch { /* skip unreadable dirs */ }
  }
  await walk(rootPath, 0);
  return files;
});

// Read file as base64 (for image preview)
ipcMain.handle('fs:readFileBase64', async (_, filePath) => {
  try {
    const data = await fs.promises.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml','.webp':'image/webp','.ico':'image/x-icon','.bmp':'image/bmp'};
    return { data: data.toString('base64'), mime: mimeMap[ext] || 'application/octet-stream' };
  } catch (err) { return { error: err.message }; }
});

// ═══════════════════════════════════════════════════
//  IPC: File Watcher
// ════════════════��══════════════════════════════════
let fileWatcher = null;
ipcMain.handle('fs:watchDir', async (_, dirPath) => {
  try {
    if (fileWatcher) { fileWatcher.close(); fileWatcher = null; }
    fileWatcher = fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      // Skip common noise
      const skip = ['.git', 'node_modules', '.cache', '.turbo'];
      if (skip.some(s => filename.startsWith(s + path.sep) || filename === s)) return;
      mainWindow?.webContents.send('fs:fileChanged', { eventType, filename, fullPath: path.join(dirPath, filename) });
    });
    fileWatcher.on('error', () => { fileWatcher = null; });
    return { success: true };
  } catch (err) { fileWatcher = null; return { error: err.message }; }
});

ipcMain.handle('fs:unwatchDir', async () => {
  if (fileWatcher) { fileWatcher.close(); fileWatcher = null; }
  return { success: true };
});

// ═════════���═════════════════════════════════════════
//  IPC: Dialogs
// ══════════════════��════════════════════════════════
ipcMain.handle('dialog:openFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  if (!result.canceled && result.filePaths[0]) {
    currentRootPath = result.filePaths[0];
  }
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('dialog:saveFile', async (_, defaultPath) => {
  const result = await dialog.showSaveDialog(mainWindow, { defaultPath });
  return result.canceled ? null : result.filePath;
});

// ═════════════════════════════���═════════════════════
//  IPC: Terminal (node-pty)
// ═══════════��═══════════════════════════════════════
let pty;
try { pty = require('node-pty'); } catch { pty = null; }
const terminals = new Map();
let terminalIdCounter = 0;

ipcMain.handle('terminal:create', (_, options = {}) => {
  if (!pty) return { error: 'Terminal not available — node-pty not found' };
  const id = ++terminalIdCounter;

  // Detect default shell properly with whitelist validation
  let shellBin;
  if (process.platform === 'win32') {
    shellBin = options.shell || process.env.COMSPEC || 'powershell.exe';
    const shellName = path.basename(shellBin).toLowerCase();
    if (!ALLOWED_SHELLS_WIN.includes(shellName)) shellBin = 'powershell.exe';
  } else {
    shellBin = options.shell || process.env.SHELL || '/bin/bash';
    if (!ALLOWED_SHELLS_UNIX.includes(shellBin)) shellBin = '/bin/bash';
  }

  const cwd = options.cwd || process.env.HOME || process.env.USERPROFILE || '/';

  const proc = pty.spawn(shellBin, [], {
    name: 'xterm-256color',
    cols: options.cols || 80,
    rows: options.rows || 24,
    cwd,
    env: { ...process.env, TERM: 'xterm-256color' },
  });

  proc.onData((data) => { mainWindow?.webContents.send('terminal:data', id, data); });
  proc.onExit(({ exitCode }) => { mainWindow?.webContents.send('terminal:exit', id, exitCode); terminals.delete(id); });
  terminals.set(id, proc);
  return { id, shell: shellBin };
});

ipcMain.on('terminal:write', (_, id, data) => { terminals.get(id)?.write(data); });
ipcMain.on('terminal:resize', (_, id, cols, rows) => { try { terminals.get(id)?.resize(cols, rows); } catch { /* ignore resize errors */ } });
ipcMain.on('terminal:destroy', (_, id) => { terminals.get(id)?.kill(); terminals.delete(id); });

// ══════════════════════════���════════════════════════
//  IPC: Git
// ═══════════════════════════════════════════════════
let simpleGit;
try { simpleGit = require('simple-git'); } catch { simpleGit = null; }
const GIT_TIMEOUT = { timeout: { block: 30000 } }; // 30s timeout for all git operations
function git(rootPath) { return simpleGit(rootPath, GIT_TIMEOUT); }

ipcMain.handle('git:status', async (_, rootPath) => {
  if (!simpleGit) return { error: 'Git integration not available' };
  try {
    const g = git(rootPath);
    const s = await g.status();
    return { branch: s.current, files: s.files.map(f => ({ path: f.path, status: f.working_dir + f.index, index: f.index, working_dir: f.working_dir })), ahead: s.ahead, behind: s.behind, isClean: s.isClean(), tracking: s.tracking };
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('git:log', async (_, rootPath) => {
  if (!simpleGit) return { error: 'Git not available' };
  try {
    const g = git(rootPath);
    const log = await g.log({ maxCount: 50 });
    return log.all.map(c => ({ hash: c.hash.slice(0, 7), fullHash: c.hash, message: c.message, author: c.author_name, date: c.date }));
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('git:diff', async (_, rootPath, filePath) => {
  if (!simpleGit) return { error: 'Git not available' };
  try { return { diff: await git(rootPath).diff([filePath]) }; } catch (err) { return { error: err.message }; }
});

ipcMain.handle('git:diffStaged', async (_, rootPath, filePath) => {
  if (!simpleGit) return { error: 'Git not available' };
  try { return { diff: await git(rootPath).diff(['--cached', filePath]) }; } catch (err) { return { error: err.message }; }
});

ipcMain.handle('git:add', async (_, rootPath, files) => {
  if (!simpleGit) return { error: 'Git not available' };
  try { await git(rootPath).add(files); return { success: true }; } catch (err) { return { error: err.message }; }
});

ipcMain.handle('git:unstage', async (_, rootPath, files) => {
  if (!simpleGit) return { error: 'Git not available' };
  try { await git(rootPath).reset(['HEAD', '--', ...files]); return { success: true }; } catch (err) { return { error: err.message }; }
});

ipcMain.handle('git:commit', async (_, rootPath, message) => {
  if (!simpleGit) return { error: 'Git not available' };
  try {
    const result = await git(rootPath).commit(message);
    return { success: true, hash: result.commit, summary: result.summary };
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('git:push', async (_, rootPath, remote, branch) => {
  if (!simpleGit) return { error: 'Git not available' };
  try {
    await git(rootPath).push(remote || 'origin', branch || undefined);
    return { success: true };
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('git:pull', async (_, rootPath, remote, branch) => {
  if (!simpleGit) return { error: 'Git not available' };
  try {
    const result = await git(rootPath).pull(remote || 'origin', branch || undefined);
    return { success: true, summary: result.summary };
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('git:fetch', async (_, rootPath) => {
  if (!simpleGit) return { error: 'Git not available' };
  try { await git(rootPath).fetch(); return { success: true }; } catch (err) { return { error: err.message }; }
});

ipcMain.handle('git:branches', async (_, rootPath) => {
  if (!simpleGit) return { error: 'Git not available' };
  try {
    const b = await git(rootPath).branch();
    return { current: b.current, all: b.all, branches: b.branches };
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('git:checkout', async (_, rootPath, branch) => {
  if (!simpleGit) return { error: 'Git not available' };
  try { await git(rootPath).checkout(branch); return { success: true }; } catch (err) { return { error: err.message }; }
});

ipcMain.handle('git:createBranch', async (_, rootPath, branchName) => {
  if (!simpleGit) return { error: 'Git not available' };
  try { await git(rootPath).checkoutLocalBranch(branchName); return { success: true }; } catch (err) { return { error: err.message }; }
});

ipcMain.handle('git:stash', async (_, rootPath) => {
  if (!simpleGit) return { error: 'Git not available' };
  try { await git(rootPath).stash(); return { success: true }; } catch (err) { return { error: err.message }; }
});

ipcMain.handle('git:stashPop', async (_, rootPath) => {
  if (!simpleGit) return { error: 'Git not available' };
  try { await git(rootPath).stash(['pop']); return { success: true }; } catch (err) { return { error: err.message }; }
});

ipcMain.handle('git:discardFile', async (_, rootPath, filePath) => {
  if (!simpleGit) return { error: 'Git not available' };
  try { await git(rootPath).checkout(['--', filePath]); return { success: true }; } catch (err) { return { error: err.message }; }
});

ipcMain.handle('git:blame', async (_, rootPath, filePath) => {
  if (!simpleGit) return { error: 'Git not available' };
  try {
    const g = git(rootPath);
    const result = await g.raw(['blame', '--porcelain', filePath]);
    return { blame: result };
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('git:graph', async (_, rootPath) => {
  if (!simpleGit) return { error: 'Git not available' };
  try {
    const g = git(rootPath);
    const result = await g.raw(['log', '--graph', '--oneline', '--all', '--decorate', '--color=never', '-60']);
    return { graph: result };
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('git:fileLog', async (_, rootPath, filePath) => {
  if (!simpleGit) return { error: 'Git not available' };
  try {
    const g = git(rootPath);
    const log = await g.log(['--follow', '--max-count=40', '--', filePath]);
    return log.all.map(c => ({ hash: c.hash.slice(0, 7), fullHash: c.hash, message: c.message, author: c.author_name, date: c.date }));
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('git:getConflicts', async (_, rootPath) => {
  if (!simpleGit) return { error: 'Git not available' };
  try {
    const g = git(rootPath);
    const s = await g.status();
    const conflicted = s.files.filter(f => f.index === 'U' || f.working_dir === 'U' ||
      (f.index === 'A' && f.working_dir === 'A') ||
      (f.index === 'D' && f.working_dir === 'D'));
    return { files: conflicted.map(f => f.path) };
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('git:resolveConflict', async (_, rootPath, filePath, content) => {
  if (!simpleGit) return { error: 'Git not available' };
  try {
    const fullPath = path.join(rootPath, filePath);
    const resolved = path.resolve(fullPath);
    if (!resolved.startsWith(path.resolve(rootPath) + path.sep)) {
      return { error: 'Path traversal blocked' };
    }
    await fs.promises.writeFile(fullPath, content, 'utf-8');
    await git(rootPath).add([filePath]);
    return { success: true };
  } catch (err) { return { error: err.message }; }
});

// Hunk-level staging: apply a patch to the index
ipcMain.handle('git:stageHunk', async (_, rootPath, patchText) => {
  if (!simpleGit) return { error: 'Git not available' };
  try {
    const g = git(rootPath);
    // Write patch to temp file and apply --cached
    const tmpFile = path.join(rootPath, '.git', 'tmp-hunk-patch.diff');
    await fs.promises.writeFile(tmpFile, patchText, 'utf-8');
    await g.raw(['apply', '--cached', tmpFile]);
    await fs.promises.unlink(tmpFile).catch(() => {});
    return { success: true };
  } catch (err) { return { error: err.message }; }
});

// Parsed blame lines for inline blame
ipcMain.handle('git:blameLines', async (_, rootPath, filePath) => {
  if (!simpleGit) return { error: 'Git not available' };
  try {
    const g = git(rootPath);
    const raw = await g.raw(['blame', '--porcelain', filePath]);
    const lines = [];
    let current = {};
    for (const line of raw.split('\n')) {
      if (/^[0-9a-f]{40}\s/.test(line)) {
        if (current.hash) lines.push({ ...current });
        const parts = line.split(' ');
        current = { hash: parts[0].slice(0, 7), origLine: parseInt(parts[1]), finalLine: parseInt(parts[2]) };
      } else if (line.startsWith('author ')) {
        current.author = line.slice(7);
      } else if (line.startsWith('author-time ')) {
        current.date = new Date(parseInt(line.slice(12)) * 1000).toISOString();
      } else if (line.startsWith('summary ')) {
        current.summary = line.slice(8);
      }
    }
    if (current.hash) lines.push({ ...current });
    return { lines };
  } catch (err) { return { error: err.message }; }
});

// ═══════════════════════════════════════════════════
//  IPC: Task Runner (npm/yarn/pnpm scripts)
// ═══════════════════════════════════════════════════
const { spawn } = require('child_process');
const taskProcesses = new Map();
let taskIdCounter = 0;

ipcMain.handle('task:list', async (_, rootPath) => {
  try {
    const pkgPath = path.join(rootPath, 'package.json');
    const content = await fs.promises.readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(content);
    return { scripts: pkg.scripts || {}, name: pkg.name || '', version: pkg.version || '' };
  } catch (err) { return { scripts: {}, error: err.message }; }
});

ipcMain.handle('task:run', async (_, rootPath, scriptName, customCmd) => {
  const id = ++taskIdCounter;

  // Security: Only allow known npm scripts or sanitized commands
  let cmd;
  if (!customCmd) {
    // Running a named script from package.json — safe to use npm run
    const safeName = scriptName.replace(/[^a-zA-Z0-9_:.-]/g, '');
    cmd = `npm run ${safeName}`;
  } else {
    // Custom command — validate it doesn't contain shell injection characters
    const dangerous = /[;&|`$(){}\[\]<>!\\]|\|\||&&/;
    if (dangerous.test(customCmd)) {
      mainWindow?.webContents.send('task:output', id, 'Error: Command contains potentially unsafe characters\n');
      mainWindow?.webContents.send('task:done', id, 1);
      return { id };
    }
    cmd = customCmd;
  }

  let shellBin, shellArgs;
  if (process.platform === 'win32') {
    shellBin = process.env.COMSPEC || 'cmd.exe';
    shellArgs = ['/c', cmd];
  } else {
    shellBin = process.env.SHELL || '/bin/bash';
    shellArgs = ['-c', cmd];
  }

  const proc = spawn(shellBin, shellArgs, { cwd: rootPath, env: process.env });
  taskProcesses.set(id, proc);

  proc.stdout.on('data', (data) => mainWindow?.webContents.send('task:output', id, data.toString()));
  proc.stderr.on('data', (data) => mainWindow?.webContents.send('task:output', id, data.toString()));
  proc.on('close', (code) => {
    mainWindow?.webContents.send('task:done', id, code);
    taskProcesses.delete(id);
  });
  proc.on('error', (err) => {
    mainWindow?.webContents.send('task:output', id, `Error: ${err.message}\n`);
    mainWindow?.webContents.send('task:done', id, 1);
    taskProcesses.delete(id);
  });

  return { id };
});

ipcMain.on('task:kill', (_, id) => {
  const proc = taskProcesses.get(id);
  if (proc) { proc.kill(); taskProcesses.delete(id); }
});

// ═══════════════════════════════════════════════════
//  IPC: Workspace Settings
// ═══════════════════════════════════════════════════
ipcMain.handle('workspace:loadSettings', async (_, rootPath) => {
  try {
    const settingsPath = path.join(rootPath, '.merecode.json');
    const content = await fs.promises.readFile(settingsPath, 'utf-8');
    return { settings: JSON.parse(content) };
  } catch { return { settings: {} }; }
});

ipcMain.handle('workspace:saveSettings', async (_, rootPath, settings) => {
  try {
    const settingsPath = path.join(rootPath, '.merecode.json');
    await fs.promises.writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    return { success: true };
  } catch (err) { return { error: err.message }; }
});

// ═══��════════════════════��══════════════════════════
//  IPC: App
// ══════════════════��════════════════════════════════
ipcMain.handle('app:getVersion', () => app.getVersion());
ipcMain.handle('app:getAppPath', () => __dirname);
ipcMain.on('app:openExternal', (_, u) => {
  // Validate URL before opening — only allow http/https/mailto
  try {
    const parsed = new URL(u);
    if (['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
      shell.openExternal(u);
    } else {
      console.warn('[Mere Code] Blocked openExternal with unsafe protocol:', parsed.protocol);
    }
  } catch {
    console.warn('[Mere Code] Blocked openExternal with invalid URL:', u);
  }
});
ipcMain.handle('app:getPlatform', () => process.platform);

// ═══════════════════════════════════════════════════
//  IPC: LSP — Language Server Protocol
// ═══════════════════════════════════════════════════
const lspProcesses = new Map(); // langId → ChildProcess

const LSP_SERVERS = {
  typescript: { cmd: 'typescript-language-server', args: ['--stdio'] },
  javascript: { cmd: 'typescript-language-server', args: ['--stdio'] },
  python:     { cmd: 'pylsp',                      args: [] },
  rust:       { cmd: 'rust-analyzer',              args: [] },
  go:         { cmd: 'gopls',                      args: ['serve'] },
};

ipcMain.handle('lsp:start', (_, langId, rootPath) => {
  if (lspProcesses.has(langId)) return { success: true };
  const config = LSP_SERVERS[langId];
  if (!config) return { error: `No LSP server configured for: ${langId}` };

  try {
    const proc = spawn(config.cmd, config.args, {
      cwd: rootPath || process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let buf = '';
    const LSP_BUF_MAX = 1024 * 1024; // 1MB max buffer
    proc.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf-8');
      // Prevent unbounded memory growth from malformed LSP
      if (buf.length > LSP_BUF_MAX) {
        console.warn(`[LSP:${langId}] Buffer exceeded ${LSP_BUF_MAX} bytes, resetting`);
        buf = '';
        return;
      }
      // LSP framing: "Content-Length: N\r\n\r\n<json>"
      let iterations = 0;
      while (iterations++ < 100) {
        const sep = buf.indexOf('\r\n\r\n');
        if (sep === -1) break;
        const header = buf.slice(0, sep);
        const lenMatch = header.match(/Content-Length:\s*(\d+)/i);
        if (!lenMatch) { buf = buf.slice(sep + 4); break; }
        const len = parseInt(lenMatch[1], 10);
        if (len > LSP_BUF_MAX) { buf = ''; break; } // Reject oversized messages
        const rest = buf.slice(sep + 4);
        if (rest.length < len) break;
        try {
          mainWindow?.webContents.send('lsp:message', langId, JSON.parse(rest.slice(0, len)));
        } catch { /* skip malformed JSON */ }
        buf = rest.slice(len);
      }
    });

    proc.stderr.on('data', (d) => console.log(`[LSP:${langId}]`, d.toString().trimEnd()));
    proc.on('error', (err) => {
      mainWindow?.webContents.send('lsp:error', langId, err.message);
      lspProcesses.delete(langId);
    });
    proc.on('exit', (code) => {
      mainWindow?.webContents.send('lsp:exit', langId, code);
      lspProcesses.delete(langId);
    });

    lspProcesses.set(langId, proc);
    return { success: true };
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.on('lsp:send', (_, langId, message) => {
  const proc = lspProcesses.get(langId);
  if (!proc) return;
  const json = JSON.stringify(message);
  proc.stdin.write(`Content-Length: ${Buffer.byteLength(json, 'utf-8')}\r\n\r\n${json}`);
});

ipcMain.on('lsp:stop', (_, langId) => {
  const proc = lspProcesses.get(langId);
  if (proc) { try { proc.kill(); } catch { /* ignore */ } lspProcesses.delete(langId); }
});

// ═══════════════════════════════════════════════════
//  IPC: Secure API Key Storage (safeStorage)
// ═══════════════════════════════════════════════════
const { safeStorage } = require('electron');

ipcMain.handle('secure:encrypt', (_, plaintext) => {
  try {
    if (!safeStorage.isEncryptionAvailable()) return { error: 'Encryption not available' };
    const encrypted = safeStorage.encryptString(plaintext);
    return { data: encrypted.toString('base64') };
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('secure:decrypt', (_, base64) => {
  try {
    if (!safeStorage.isEncryptionAvailable()) return { error: 'Encryption not available' };
    const buffer = Buffer.from(base64, 'base64');
    const decrypted = safeStorage.decryptString(buffer);
    return { data: decrypted };
  } catch (err) { return { error: err.message }; }
});

ipcMain.handle('secure:isAvailable', () => {
  return safeStorage.isEncryptionAvailable();
});

// ═══════════════════════════════════════════════════
//  API Proxy (avoids CORS in renderer)
// ═══════════════════════════════════════════════════
ipcMain.handle('api:chat', async (_, { endpoint, apiKey, body }) => {
  try {
    if (!validateEndpointUrl(endpoint)) {
      return { error: true, status: 0, body: 'Invalid API endpoint URL' };
    }
    const res = await net.fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { error: true, status: res.status, body: errText };
    }
    // Read the full SSE stream and return chunks
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    const chunks = [];
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          chunks.push(parsed);
          if (parsed.text) fullText += parsed.text;
        } catch {}
      }
    }
    return { error: false, chunks, fullText };
  } catch (err) {
    return { error: true, status: 0, body: err.message };
  }
});

// For streaming — sends chunks to renderer via events
ipcMain.handle('api:chatStream', async (event, { endpoint, apiKey, body }) => {
  try {
    if (!validateEndpointUrl(endpoint)) {
      return { error: true, status: 0, body: 'Invalid API endpoint URL' };
    }
    const res = await net.fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { error: true, status: res.status, body: errText };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('api:chatChunk', parsed);
          }
        } catch {}
      }
    }
    return { error: false, done: true };
  } catch (err) {
    return { error: true, status: 0, body: err.message };
  }
});

// ═══════════════════════════════════════════════════
//  Auto-Updater (electron-updater)
// ═══════════════════════════════════════════════════
let autoUpdater;
try {
  autoUpdater = require('electron-updater').autoUpdater;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
} catch { autoUpdater = null; }

function initAutoUpdater() {
  if (!autoUpdater) return;
  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('updater:available', { version: info.version });
  });
  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('updater:downloaded', { version: info.version });
  });
  autoUpdater.on('error', (err) => {
    console.log('[AutoUpdater] Error:', err?.message);
  });
  // Check for updates silently after launch
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 10000);
}

ipcMain.handle('updater:check', async () => {
  if (!autoUpdater) return { error: 'Auto-updater not available' };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { version: result?.updateInfo?.version };
  } catch (err) { return { error: err.message }; }
});

ipcMain.on('updater:download', () => { autoUpdater?.downloadUpdate().catch(() => {}); });
ipcMain.on('updater:install', () => { autoUpdater?.quitAndInstall(false, true); });

// ═══════════════════════════════════════════════════
//  App Lifecycle
// ═══════════════════════════════════════════════════
app.whenReady().then(async () => {
  const port = await createServer();
  createWindow(port);
  initAutoUpdater();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(port); });
});

// ═══════════════════════════════════════════════════
//  Crash Reporting (log to AppData/Logs)
// ═══════════════════════════════════════════════════
const { app: electronApp } = require('electron');

process.on('uncaughtException', (err) => {
  const logDir = path.join(electronApp.getPath('logs'));
  try {
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'crash.log');
    const entry = `[${new Date().toISOString()}] UNCAUGHT: ${err.stack || err.message}\n`;
    fs.appendFileSync(logFile, entry);
  } catch { /* ignore log write errors */ }
  console.error('[Mere Code] Uncaught exception:', err);
});

process.on('unhandledRejection', (reason) => {
  const logDir = path.join(electronApp.getPath('logs'));
  try {
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'crash.log');
    const entry = `[${new Date().toISOString()}] UNHANDLED REJECTION: ${reason}\n`;
    fs.appendFileSync(logFile, entry);
  } catch { /* ignore */ }
  console.error('[Mere Code] Unhandled rejection:', reason);
});

ipcMain.handle('app:getCrashLog', async () => {
  try {
    const logFile = path.join(electronApp.getPath('logs'), 'crash.log');
    const content = await fs.promises.readFile(logFile, 'utf-8');
    return { log: content.slice(-10000) };
  } catch { return { log: '' }; }
});

app.on('window-all-closed', () => {
  // Clean up all terminal processes
  for (const [, proc] of terminals) { try { proc.kill(); } catch { /* ignore */ } }
  terminals.clear();
  // Clean up file watcher
  if (fileWatcher) { fileWatcher.close(); fileWatcher = null; }
  if (process.platform !== 'darwin') app.quit();
});
