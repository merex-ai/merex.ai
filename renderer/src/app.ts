// app.ts — Mere Code — Main Application Orchestrator
import { EditorManager } from './editor.js';
import { FileExplorer } from './fileExplorer.js';
import { TerminalManager } from './terminal.js';
import { ChatManager } from './chat.js';
import { SearchManager } from './search.js';
import { GitManager } from './gitManager.js';

interface AppCommand {
  id: string;
  label: string;
  shortcut: string;
  fn: () => void;
}

interface QuickOpenFile {
  path: string;
  name: string;
  relativePath: string;
}

interface WorkspaceSettings {
  theme?: string;
  fontSize?: number;
  tabSize?: number;
  wordWrap?: string;
  [key: string]: unknown;
}

export class MereCodeApp {
  rootPath: string | null = null;
  editor!: EditorManager;
  fileExplorer!: FileExplorer;
  terminal!: TerminalManager;
  chat!: ChatManager;
  search!: SearchManager;
  git!: GitManager;
  activePanel = 'explorer';
  isChatOpen = false;
  isTerminalOpen = false;
  commands: AppCommand[] = [];
  private _zoomLevel = 1.0;
  private _zenMode = false;
  private _quickOpenMode = false;
  private _quickOpenFiles: QuickOpenFile[] = [];
  private _taskScripts: Record<string, string> = {};
  private _taskPackageName = '';
  private _workspaceSettings: WorkspaceSettings = {};
  private _outlineRefreshTimer: any = null;

  async init(): Promise<void> {
    this._initWindowControls();

    this.editor = new EditorManager(this);
    this.fileExplorer = new FileExplorer(this);
    this.terminal = new TerminalManager(this);
    this.chat = new ChatManager(this);
    this.search = new SearchManager(this);
    this.git = new GitManager(this);

    await this.editor.init();

    this._initActivityBar();
    this._initKeyboard();
    this._initResizing();
    this._initCommandPalette();
    this._initSettings();
    this._initWelcomeActions();
    this._initExtensionsPanel();
    this._loadRecentFolders();
    this._initTheme();
    this._initZenMode();
    this._initOutlinePanel();
    this._loadZoom();
    this._initTaskPanel();

    this.showWelcome();
    this._loadVersion();
  }

  private async _loadVersion(): Promise<void> {
    try {
      const ver = await window.merecode.app.getVersion();
      if (ver) {
        const aboutEl = document.getElementById('about-version');
        const welcomeEl = document.getElementById('welcome-version');
        if (aboutEl) aboutEl.textContent = `v${ver}`;
        if (welcomeEl) welcomeEl.textContent = `v${ver}`;
      }
    } catch {}
  }

  // ─── Toast Notifications ───
  showToast(message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info', duration = 4000): void {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const icons: Record<string, string> = {
      success: '✓',
      error: '✕',
      warning: '⚠',
      info: 'ℹ',
    };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span class="toast-message">${this._escHtml(message)}</span>
      <span class="toast-close" title="Dismiss">✕</span>
    `;

    toast.querySelector('.toast-close')?.addEventListener('click', () => this._dismissToast(toast));
    container.appendChild(toast);

    if (duration > 0) {
      setTimeout(() => this._dismissToast(toast), duration);
    }
  }

  private _dismissToast(toast: HTMLElement): void {
    if (!toast || toast.classList.contains('toast-exit')) return;
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => toast.remove());
  }

  private _escHtml(s: string): string {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ─── Window Controls ───
  private _initWindowControls(): void {
    document.getElementById('btn-minimize')?.addEventListener('click', () => window.merecode.window.minimize());
    document.getElementById('btn-maximize')?.addEventListener('click', () => window.merecode.window.maximize());
    document.getElementById('btn-close')?.addEventListener('click', () => window.merecode.window.close());
    window.merecode.window.onStateChange?.((maximized: boolean) => {
      document.getElementById('btn-maximize')!.title = maximized ? 'Restore' : 'Maximize';
    });
  }

  // ─── Activity Bar ───
  private _initActivityBar(): void {
    document.querySelectorAll('.ab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const panel = (btn as HTMLElement).dataset.panel!;
        if (panel === 'chat') { this.toggleChat(); return; }
        if (panel === this.activePanel) { this.toggleSidebar(); return; }
        this.switchPanel(panel);
      });
    });
  }

  switchPanel(panelId: string): void {
    document.querySelectorAll('.ab-btn').forEach(b => {
      if ((b as HTMLElement).dataset.panel !== 'chat') b.classList.toggle('active', (b as HTMLElement).dataset.panel === panelId);
    });
    document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.toggle('active', p.id === `panel-${panelId}`));
    this.activePanel = panelId;
    document.getElementById('sidebar')!.style.display = 'flex';
    this.editor?.layout();
  }

  toggleSidebar(): void {
    const sb = document.getElementById('sidebar')!;
    const vis = sb.style.display !== 'none';
    sb.style.display = vis ? 'none' : 'flex';
    this.editor?.layout();
  }

  toggleChat(): void {
    this.isChatOpen = !this.isChatOpen;
    document.getElementById('chat-sidebar')!.style.display = this.isChatOpen ? 'flex' : 'none';
    document.getElementById('ab-chat-btn')?.classList.toggle('active', this.isChatOpen);
    if (this.isChatOpen) {
      document.getElementById('chat-input')?.focus();
      this.chat?._checkApiKey();
    }
    this.editor?.layout();
  }

  toggleTerminal(): void {
    this.isTerminalOpen = !this.isTerminalOpen;
    document.getElementById('terminal-panel')!.style.display = this.isTerminalOpen ? 'flex' : 'none';
    document.getElementById('terminal-resize-handle')!.style.display = this.isTerminalOpen ? 'block' : 'none';
    if (this.isTerminalOpen && this.terminal.terminals.size === 0) this.terminal.createTerminal();
    this.editor?.layout();
  }

  // ─── Folder management ───
  async openFolder(folderPath?: string | null): Promise<void> {
    if (!folderPath) folderPath = await window.merecode.dialog.openFolder();
    if (!folderPath) return;
    this.rootPath = folderPath;
    const folderName = window.merecode.path.basename(folderPath);
    document.getElementById('titlebar-title')!.textContent = 'Mere Code';
    document.getElementById('titlebar-filename')!.textContent = folderName;
    await this.fileExplorer.setRoot(folderPath);
    this.switchPanel('explorer');
    if (this.editor.tabs.length > 0) this.hideWelcome();
    this.git?.refresh();
    this.git?.checkAndShowConflicts?.();
    this._addRecentFolder(folderPath);
    this._loadWorkspaceSettings(folderPath);
    this._loadTaskScripts(folderPath);
    this.showToast(`Opened ${folderName}`, 'success', 2000);
  }

  // ─── Workspace Settings ───
  private async _loadWorkspaceSettings(rootPath: string): Promise<void> {
    if (!window.merecode.workspace) return;
    const result = await window.merecode.workspace.load(rootPath);
    const ws = result.settings || {};
    if (ws.theme) { this.editor?.setTheme(ws.theme); this._applyUITheme(ws.theme); }
    if (ws.fontSize) this.editor?.updateFontSize(ws.fontSize);
    if (ws.tabSize) this.editor?.updateTabSize(ws.tabSize);
    if (ws.wordWrap) this.editor?.editor?.updateOptions({ wordWrap: ws.wordWrap });
    this._workspaceSettings = ws;
  }

  private async _saveWorkspaceSetting(key: string, value: unknown): Promise<void> {
    if (!this.rootPath || !window.merecode.workspace) return;
    const current = this._workspaceSettings || {};
    (current as any)[key] = value;
    this._workspaceSettings = current;
    await window.merecode.workspace.save(this.rootPath, current);
  }

  // ─── Task Runner ───
  private async _loadTaskScripts(rootPath: string): Promise<void> {
    if (!window.merecode.task) return;
    const result = await window.merecode.task.list(rootPath);
    this._taskScripts = result.scripts || {};
    this._taskPackageName = result.name || '';
    this._renderTaskPanel();
  }

  private _renderTaskPanel(): void {
    const container = document.getElementById('task-list');
    if (!container) return;
    const scripts = this._taskScripts || {};
    const keys = Object.keys(scripts);

    if (keys.length === 0) {
      container.innerHTML = '<div class="task-empty">No scripts found in package.json</div>';
      return;
    }

    container.innerHTML = keys.map(name => `
      <div class="task-item" role="listitem">
        <div class="task-info">
          <span class="task-name">${this._escHtml(name)}</span>
          <span class="task-cmd">${this._escHtml(scripts[name])}</span>
        </div>
        <button class="task-run-btn" data-task="${this._escHtml(name)}" aria-label="Run ${this._escHtml(name)}" title="Run">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2l10 6-10 6V2z"/></svg>
        </button>
      </div>
    `).join('');

    container.querySelectorAll('.task-run-btn').forEach(btn => {
      btn.addEventListener('click', () => this._runTask((btn as HTMLElement).dataset.task!));
    });
  }

  private async _runTask(scriptName: string): Promise<void> {
    if (!this.rootPath || !window.merecode.task) return;
    if (!this.isTerminalOpen) this.toggleTerminal();
    if (this.terminal.terminals.size === 0) await this.terminal.createTerminal();

    const cmd = `npm run ${scriptName}`;
    this.showToast(`Running: ${scriptName}`, 'info', 2000);

    const result = window.merecode.task.run(this.rootPath, scriptName, cmd);
    const taskId = result.id;

    const cleanupOutput = window.merecode.task.onOutput((id, data) => {
      if (id !== taskId) return;
      const activeId = this.terminal.activeTerminalId;
      if (activeId) this.terminal.terminals.get(activeId)?.xterm.write(data);
    });
    const cleanupDone = window.merecode.task.onDone((id, code) => {
      if (id !== taskId) return;
      const msg = code === 0 ? `✓ ${scriptName} completed` : `✗ ${scriptName} exited with code ${code}`;
      this.showToast(msg, code === 0 ? 'success' : 'error');
      cleanupOutput();
      cleanupDone();
    });
  }

  private _initTaskPanel(): void {
    document.getElementById('btn-task-refresh')?.addEventListener('click', () => {
      if (this.rootPath) this._loadTaskScripts(this.rootPath);
    });
    document.getElementById('btn-task-custom')?.addEventListener('click', () => {
      const cmd = prompt('Enter command to run:');
      if (cmd?.trim() && this.rootPath) this._runTask(cmd.trim());
    });
  }

  private async _updateGitStatus(): Promise<void> {
    if (!this.rootPath) return;
    try {
      const s = await window.merecode.git.status(this.rootPath);
      if (s && !s.error) {
        const branchEl = document.getElementById('status-branch');
        if (branchEl) {
          branchEl.innerHTML =
            `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="4" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="7" r="2"/><path d="M5 6v4M7 12h3c1.1 0 2-.9 2-2V7" fill="none" stroke="currentColor" stroke-width="1.2"/></svg> ${s.branch || 'no branch'}`;
        }
      }
    } catch {}
  }

  // ─── Recent Folders ───
  private _addRecentFolder(folderPath: string): void {
    let recent: string[] = JSON.parse(localStorage.getItem('merecode-recent-folders') || '[]');
    recent = recent.filter(f => f !== folderPath);
    recent.unshift(folderPath);
    recent = recent.slice(0, 8);
    localStorage.setItem('merecode-recent-folders', JSON.stringify(recent));
    this._loadRecentFolders();
  }

  private _loadRecentFolders(): void {
    const container = document.getElementById('welcome-recent');
    if (!container) return;
    const recent: string[] = JSON.parse(localStorage.getItem('merecode-recent-folders') || '[]');
    if (recent.length === 0) {
      container.innerHTML = '<p class="welcome-no-recent">No recent folders</p>';
      return;
    }
    container.innerHTML = recent.map(f => {
      const name = f.split(/[/\\]/).pop()!;
      return `<div class="welcome-recent-item" data-path="${this._escHtml(f)}" title="${this._escHtml(f)}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5"><path d="M3 7V17C3 18.1 3.9 19 5 19H19C20.1 19 21 18.1 21 17V9C21 7.9 20.1 7 19 7H11L9 5H5C3.9 5 3 5.9 3 7Z"/></svg>
        <div>
          <div>${this._escHtml(name)}</div>
          <div class="welcome-recent-path">${this._escHtml(f)}</div>
        </div>
      </div>`;
    }).join('');

    container.querySelectorAll('.welcome-recent-item').forEach(el => {
      el.addEventListener('click', () => {
        const path = (el as HTMLElement).dataset.path;
        if (path) this.openFolder(path);
      });
    });
  }

  showWelcome(): void {
    document.getElementById('welcome-screen')!.style.display = 'flex';
    document.getElementById('monaco-container')!.style.display = 'none';
    const bc = document.getElementById('breadcrumbs');
    if (bc) { bc.innerHTML = ''; bc.style.display = 'none'; }
  }

  hideWelcome(): void {
    document.getElementById('welcome-screen')!.style.display = 'none';
    document.getElementById('monaco-container')!.style.display = 'block';
    this.editor?.layout();
  }

  private _initWelcomeActions(): void {
    document.getElementById('welcome-open-folder')?.addEventListener('click', () => this.openFolder());
    document.getElementById('btn-open-folder-big')?.addEventListener('click', () => this.openFolder());
    document.getElementById('welcome-new-file')?.addEventListener('click', () => this.editor.createUntitledTab());
    document.getElementById('welcome-toggle-terminal')?.addEventListener('click', () => this.toggleTerminal());
    document.getElementById('welcome-ai-chat')?.addEventListener('click', () => this.toggleChat());
    document.getElementById('welcome-command-palette')?.addEventListener('click', () => this.toggleCommandPalette());
    document.getElementById('btn-setup-apikey')?.addEventListener('click', () => {
      this.switchPanel('settings');
      setTimeout(() => document.getElementById('setting-api-key')?.focus(), 100);
    });
    document.getElementById('btn-split-editor')?.addEventListener('click', () => this.editor.splitEditor());
  }

  // ─── Keyboard Shortcuts ───
  private _initKeyboard(): void {
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.shiftKey && e.key === 'P') { e.preventDefault(); this.toggleCommandPalette(); }
      else if (ctrl && e.key === '`') { e.preventDefault(); this.toggleTerminal(); }
      else if (ctrl && e.key === 's') {
        e.preventDefault();
        this.editor.saveCurrentFile();
        this.showToast('File saved', 'success', 1500);
      }
      else if (ctrl && e.shiftKey && e.key === 'E') { e.preventDefault(); this.switchPanel('explorer'); }
      else if (ctrl && e.shiftKey && e.key === 'F') { e.preventDefault(); this.switchPanel('search'); document.getElementById('search-input')?.focus(); }
      else if (ctrl && e.shiftKey && e.key === 'G') { e.preventDefault(); this.switchPanel('git'); }
      else if (ctrl && e.shiftKey && e.key === 'X') { e.preventDefault(); this.switchPanel('extensions'); }
      else if (ctrl && e.shiftKey && e.key === 'O') { e.preventDefault(); this.switchPanel('outline'); this.refreshOutline(); }
      else if (ctrl && e.shiftKey && e.key === 'A') { e.preventDefault(); this.toggleChat(); }
      else if (ctrl && e.key === ',') { e.preventDefault(); this.switchPanel('settings'); }
      else if (ctrl && e.shiftKey && e.key === 'T') { e.preventDefault(); this.switchPanel('tasks'); if (this.rootPath) this._loadTaskScripts(this.rootPath); }
      else if (ctrl && e.key === 'n') { e.preventDefault(); this.editor.createUntitledTab(); }
      else if (ctrl && e.key === 'w') { e.preventDefault(); this.editor.closeActiveTab(); }
      else if (ctrl && e.key === 'Tab') { e.preventDefault(); this.editor.nextTab(); }
      else if (ctrl && !e.shiftKey && e.key === 'p') { e.preventDefault(); this.toggleCommandPalette(true); }
      else if (ctrl && e.key === 'b') { e.preventDefault(); this.toggleSidebar(); }
      else if (ctrl && e.key === '\\') { e.preventDefault(); this.editor.splitEditor(); }
      else if (ctrl && e.shiftKey && e.key === 'M') { e.preventDefault(); this.editor.toggleMarkdownPreview(); }
      else if (e.key === 'F11') { e.preventDefault(); this.toggleZenMode(); }
      else if (e.key === 'Escape') { this.closeCommandPalette(); if (this._zenMode) this.toggleZenMode(); }
      else if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); this._uiZoom(1); }
      else if (ctrl && e.key === '-') { e.preventDefault(); this._uiZoom(-1); }
      else if (ctrl && e.key === '0') { e.preventDefault(); this._uiZoom(0); }
    });
  }

  // ─── UI Zoom ───
  private _uiZoom(delta: number): void {
    const levels = [0.75, 0.85, 0.9, 1.0, 1.1, 1.2, 1.35, 1.5];
    if (delta === 0) {
      this._zoomLevel = 1.0;
    } else {
      const cur = parseFloat((document.body.style as any).zoom) || 1.0;
      const idx = levels.findIndex(l => l >= cur - 0.01);
      const next = delta > 0
        ? levels[Math.min(idx + 1, levels.length - 1)]
        : levels[Math.max((idx === -1 ? levels.length - 1 : idx) - 1, 0)];
      this._zoomLevel = next;
    }
    (document.body.style as any).zoom = this._zoomLevel;
    localStorage.setItem('merecode-ui-zoom', String(this._zoomLevel));
    if (this._zoomLevel !== 1.0) {
      this.showToast(`Zoom: ${Math.round(this._zoomLevel * 100)}%`, 'info', 1200);
    }
    this.editor?.layout();
  }

  private _loadZoom(): void {
    const saved = parseFloat(localStorage.getItem('merecode-ui-zoom') || '1');
    if (saved !== 1.0) { (document.body.style as any).zoom = saved; this._zoomLevel = saved; }
  }

  // ─── Resizing ───
  private _initResizing(): void {
    this._drag('sidebar-resize-handle', 'sidebar', 'width', 180, 600);
    this._drag('terminal-resize-handle', 'terminal-panel', 'height', 80, 500, true);
  }

  private _drag(handleId: string, targetId: string, dim: 'width' | 'height', min: number, max: number, invert = false): void {
    const handle = document.getElementById(handleId);
    const target = document.getElementById(targetId);
    if (!handle || !target) return;
    handle.addEventListener('mousedown', (e: MouseEvent) => {
      const startPos = dim === 'width' ? e.clientX : e.clientY;
      const startSize = dim === 'width' ? target.offsetWidth : target.offsetHeight;
      const move = (e: MouseEvent) => {
        const pos = dim === 'width' ? e.clientX : e.clientY;
        const delta = invert ? (startPos - pos) : (pos - startPos);
        target.style[dim] = Math.min(max, Math.max(min, startSize + delta)) + 'px';
        this.editor?.layout();
      };
      const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); document.body.style.cursor = ''; document.body.style.userSelect = ''; };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
      document.body.style.cursor = dim === 'width' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    });
  }

  // ─── Command Palette ───
  private _initCommandPalette(): void {
    this.commands = [
      { id: 'folder.open', label: 'Open Folder...', shortcut: '', fn: () => this.openFolder() },
      { id: 'file.new', label: 'New File', shortcut: 'Ctrl+N', fn: () => this.editor.createUntitledTab() },
      { id: 'file.save', label: 'Save', shortcut: 'Ctrl+S', fn: () => this.editor.saveCurrentFile() },
      { id: 'terminal.toggle', label: 'Toggle Terminal', shortcut: 'Ctrl+`', fn: () => this.toggleTerminal() },
      { id: 'terminal.new', label: 'New Terminal', shortcut: '', fn: () => this.terminal.createTerminal() },
      { id: 'view.sidebar', label: 'Toggle Sidebar', shortcut: 'Ctrl+B', fn: () => this.toggleSidebar() },
      { id: 'view.chat', label: 'Toggle Mere X AI Chat', shortcut: 'Ctrl+Shift+A', fn: () => this.toggleChat() },
      { id: 'view.explorer', label: 'Show Explorer', shortcut: 'Ctrl+Shift+E', fn: () => this.switchPanel('explorer') },
      { id: 'view.search', label: 'Show Search', shortcut: 'Ctrl+Shift+F', fn: () => this.switchPanel('search') },
      { id: 'view.git', label: 'Show Source Control', shortcut: 'Ctrl+Shift+G', fn: () => this.switchPanel('git') },
      { id: 'view.extensions', label: 'Show Extensions', shortcut: 'Ctrl+Shift+X', fn: () => this.switchPanel('extensions') },
      { id: 'view.settings', label: 'Open Settings', shortcut: 'Ctrl+,', fn: () => this.switchPanel('settings') },
      { id: 'editor.format', label: 'Format Document', shortcut: 'Shift+Alt+F', fn: () => this.editor.formatDocument() },
      { id: 'editor.minimap', label: 'Toggle Minimap', shortcut: '', fn: () => this.editor.toggleMinimap() },
      { id: 'editor.wordWrap', label: 'Toggle Word Wrap', shortcut: 'Alt+Z', fn: () => this.editor.toggleWordWrap() },
      { id: 'theme.dark', label: 'Theme: Mere Dark', shortcut: '', fn: () => this.switchTheme('mere-dark') },
      { id: 'theme.light', label: 'Theme: Mere Light', shortcut: '', fn: () => this.switchTheme('mere-light') },
      { id: 'git.commit', label: 'Git: Commit', shortcut: '', fn: () => this.git?.commit() },
      { id: 'git.push', label: 'Git: Push', shortcut: '', fn: () => this.git?.push() },
      { id: 'git.pull', label: 'Git: Pull', shortcut: '', fn: () => this.git?.pull() },
      { id: 'git.stash', label: 'Git: Stash', shortcut: '', fn: () => this.git?.stash() },
      { id: 'git.stashPop', label: 'Git: Stash Pop', shortcut: '', fn: () => this.git?.stashPop() },
      { id: 'git.branch', label: 'Git: Switch Branch', shortcut: '', fn: () => this.git?.showBranchPicker() },
      { id: 'editor.split', label: 'Split Editor Right', shortcut: 'Ctrl+\\', fn: () => this.editor.splitEditor() },
      { id: 'editor.mdPreview', label: 'Markdown: Toggle Preview', shortcut: 'Ctrl+Shift+M', fn: () => this.editor.toggleMarkdownPreview() },
      { id: 'view.outline', label: 'Show Outline', shortcut: 'Ctrl+Shift+O', fn: () => { this.switchPanel('outline'); this.refreshOutline(); } },
      { id: 'view.zenMode', label: 'Toggle Zen Mode', shortcut: 'F11', fn: () => this.toggleZenMode() },
      { id: 'view.shortcuts', label: 'Show Keyboard Shortcuts', shortcut: '', fn: () => this.showKeyboardShortcuts() },
      { id: 'editor.snippets', label: 'Insert Snippet...', shortcut: '', fn: () => this.showSnippetPalette() },
    ];

    const input = document.getElementById('command-input') as HTMLInputElement | null;
    const list = document.getElementById('command-list')!;

    input?.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.closeCommandPalette();
      if (e.key === 'Enter') { (list.querySelector('.cmd-item.active') as HTMLElement)?.click(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = list.querySelectorAll('.cmd-item');
        const idx = Array.from(items).findIndex(i => i.classList.contains('active'));
        items[idx]?.classList.remove('active');
        const next = e.key === 'ArrowDown' ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
        items[next]?.classList.add('active');
        items[next]?.scrollIntoView({ block: 'nearest' });
      }
    });

    document.getElementById('command-palette-backdrop')?.addEventListener('click', () => this.closeCommandPalette());
  }

  _renderCommands(query = ''): void {
    const list = document.getElementById('command-list')!;
    const filtered = this.commands.filter(c => c.label.toLowerCase().includes(query));
    list.innerHTML = filtered.map((c, i) =>
      `<div class="cmd-item${i === 0 ? ' active' : ''}" data-id="${c.id}">
        <span class="cmd-label">${c.label}</span>
        ${c.shortcut ? `<span class="cmd-shortcut">${c.shortcut}</span>` : ''}
      </div>`
    ).join('');
    list.querySelectorAll('.cmd-item').forEach(el => {
      el.addEventListener('click', () => {
        this.commands.find(c => c.id === (el as HTMLElement).dataset.id)?.fn();
        this.closeCommandPalette();
      });
    });
  }

  toggleCommandPalette(quickOpen = false): void {
    const pal = document.getElementById('command-palette')!;
    const back = document.getElementById('command-palette-backdrop')!;
    const input = document.getElementById('command-input') as HTMLInputElement;
    const open = pal.classList.contains('open');
    if (open) { this.closeCommandPalette(); return; }
    this._quickOpenMode = quickOpen;
    pal.classList.add('open');
    back.classList.add('open');
    input.value = quickOpen ? '' : '> ';
    input.placeholder = quickOpen ? 'Search files by name...' : '> Type a command...';
    input.focus();
    if (quickOpen) {
      this._loadQuickOpenFiles();
    } else {
      this._renderCommands('');
    }

    input.oninput = () => {
      if (this._quickOpenMode) {
        this._filterQuickOpen(input.value);
      } else {
        const q = input.value.toLowerCase().replace(/^>\s*/, '');
        this._renderCommands(q);
      }
    };
  }

  closeCommandPalette(): void {
    document.getElementById('command-palette')?.classList.remove('open');
    document.getElementById('command-palette-backdrop')?.classList.remove('open');
  }

  // ─── Settings ───
  private _initSettings(): void {
    const apiKeyInput = document.getElementById('setting-api-key') as HTMLInputElement | null;
    const modelSelect = document.getElementById('setting-ai-model') as HTMLSelectElement | null;
    const fontSizeInput = document.getElementById('setting-font-size') as HTMLInputElement | null;
    const tabSizeSelect = document.getElementById('setting-tab-size') as HTMLSelectElement | null;
    const wordWrapSelect = document.getElementById('setting-word-wrap') as HTMLSelectElement | null;
    const minimapSelect = document.getElementById('setting-minimap') as HTMLSelectElement | null;
    const temperatureSlider = document.getElementById('setting-temperature') as HTMLInputElement | null;
    const tempValue = document.getElementById('temp-value');
    const toggleKeyVis = document.getElementById('btn-toggle-key-vis');
    const chatModelSelect = document.getElementById('chat-model-select') as HTMLSelectElement | null;
    const themeSelect = document.getElementById('setting-theme') as HTMLSelectElement | null;

    if (apiKeyInput) apiKeyInput.value = localStorage.getItem('merecode-api-key') || '';
    if (modelSelect) modelSelect.value = localStorage.getItem('merecode-ai-model') || 'mere-nyx';
    if (fontSizeInput) fontSizeInput.value = localStorage.getItem('merecode-font-size') || '14';
    if (tabSizeSelect) tabSizeSelect.value = localStorage.getItem('merecode-tab-size') || '2';
    if (wordWrapSelect) wordWrapSelect.value = localStorage.getItem('merecode-word-wrap') || 'off';
    if (minimapSelect) minimapSelect.value = localStorage.getItem('merecode-minimap') || 'true';

    const savedTemp = localStorage.getItem('merecode-temperature') || '0.7';
    if (temperatureSlider) temperatureSlider.value = String(Math.round(parseFloat(savedTemp) * 100));
    if (tempValue) tempValue.textContent = savedTemp;

    if (chatModelSelect) chatModelSelect.value = modelSelect?.value || 'mere-nyx';

    apiKeyInput?.addEventListener('change', () => {
      localStorage.setItem('merecode-api-key', apiKeyInput.value);
      this.chat?._checkApiKey();
      if (apiKeyInput.value) this.showToast('API key saved', 'success', 2000);
    });

    toggleKeyVis?.addEventListener('click', () => {
      const isPassword = apiKeyInput!.type === 'password';
      apiKeyInput!.type = isPassword ? 'text' : 'password';
    });

    modelSelect?.addEventListener('change', () => {
      localStorage.setItem('merecode-ai-model', modelSelect.value);
      if (chatModelSelect) chatModelSelect.value = modelSelect.value;
    });

    temperatureSlider?.addEventListener('input', () => {
      const val = (parseFloat(temperatureSlider.value) / 100).toFixed(2);
      if (tempValue) tempValue.textContent = val;
      localStorage.setItem('merecode-temperature', val);
    });

    fontSizeInput?.addEventListener('change', () => {
      localStorage.setItem('merecode-font-size', fontSizeInput.value);
      this.editor.updateFontSize(parseInt(fontSizeInput.value));
    });

    tabSizeSelect?.addEventListener('change', () => {
      localStorage.setItem('merecode-tab-size', tabSizeSelect.value);
      this.editor.updateTabSize(parseInt(tabSizeSelect.value));
      document.getElementById('status-indent')!.textContent = `Spaces: ${tabSizeSelect.value}`;
    });

    wordWrapSelect?.addEventListener('change', () => {
      localStorage.setItem('merecode-word-wrap', wordWrapSelect.value);
      this.editor.editor?.updateOptions({ wordWrap: wordWrapSelect.value });
    });

    minimapSelect?.addEventListener('change', () => {
      localStorage.setItem('merecode-minimap', minimapSelect.value);
      this.editor.editor?.updateOptions({ minimap: { enabled: minimapSelect.value === 'true' } });
    });

    const autoSaveSelect = document.getElementById('setting-auto-save') as HTMLSelectElement | null;
    if (autoSaveSelect) {
      autoSaveSelect.value = localStorage.getItem('merecode-auto-save') || 'false';
      autoSaveSelect.addEventListener('change', () => {
        localStorage.setItem('merecode-auto-save', autoSaveSelect.value);
        this.editor.startAutoSave();
        this.showToast(autoSaveSelect.value === 'true' ? 'Auto-save enabled' : 'Auto-save disabled', 'info', 2000);
      });
    }

    if (themeSelect) {
      themeSelect.value = localStorage.getItem('merecode-theme') || 'mere-dark';
      themeSelect.addEventListener('change', () => {
        this.switchTheme(themeSelect.value);
      });
    }



    const formatOnSaveSelect = document.getElementById('setting-format-on-save') as HTMLSelectElement | null;
    if (formatOnSaveSelect) {
      formatOnSaveSelect.value = localStorage.getItem('merecode-format-on-save') || 'false';
      formatOnSaveSelect.addEventListener('change', () => {
        localStorage.setItem('merecode-format-on-save', formatOnSaveSelect.value);
        this.showToast(formatOnSaveSelect.value === 'true' ? 'Format on save enabled' : 'Format on save disabled', 'info', 2000);
      });
    }

    document.getElementById('link-get-key')?.addEventListener('click', (e: Event) => {
      e.preventDefault();
      window.merecode.app?.openExternal?.('https://merex.ai/chat');
    });
  }

  // ─── Theme Switching ───
  private _initTheme(): void {
    const savedTheme = localStorage.getItem('merecode-theme') || 'mere-dark';
    this._applyUITheme(savedTheme);
    const themeSelect = document.getElementById('setting-theme') as HTMLSelectElement | null;
    if (themeSelect) themeSelect.value = savedTheme;
    const extThemeSelect = document.getElementById('ext-theme-select') as HTMLSelectElement | null;
    if (extThemeSelect) extThemeSelect.value = savedTheme;
  }

  switchTheme(themeName: string): void {
    this.editor?.setTheme(themeName);
    this._applyUITheme(themeName);
    localStorage.setItem('merecode-theme', themeName);
    const themeSelect = document.getElementById('setting-theme') as HTMLSelectElement | null;
    if (themeSelect) themeSelect.value = themeName;
    const extThemeSelect = document.getElementById('ext-theme-select') as HTMLSelectElement | null;
    if (extThemeSelect) extThemeSelect.value = themeName;
  }

  private _applyUITheme(themeName: string): void {
    document.body.dataset.theme = themeName === 'mere-light' ? 'light' : 'dark';
  }

  // ─── Quick File Open (Ctrl+P) ───
  private async _loadQuickOpenFiles(): Promise<void> {
    if (!this.rootPath) {
      this._quickOpenFiles = [];
      this._renderQuickOpenFiles([]);
      return;
    }
    const list = document.getElementById('command-list')!;
    list.innerHTML = '<div class="cmd-item" style="color:var(--fg-faint)">Loading files...</div>';
    this._quickOpenFiles = (await window.merecode.fs.listAllFiles(this.rootPath, 2000) as any) || [];
    this._renderQuickOpenFiles(this._quickOpenFiles.slice(0, 30));
  }

  private _filterQuickOpen(query: string): void {
    if (!this._quickOpenFiles) return;
    const q = query.toLowerCase();
    const filtered = q ? this._quickOpenFiles.filter(f => f.relativePath.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)) : this._quickOpenFiles;
    this._renderQuickOpenFiles(filtered.slice(0, 30));
  }

  private _renderQuickOpenFiles(files: QuickOpenFile[]): void {
    const list = document.getElementById('command-list')!;
    if (files.length === 0) {
      list.innerHTML = '<div class="cmd-item" style="color:var(--fg-faint)">No matching files</div>';
      return;
    }
    list.innerHTML = files.map((f, i) =>
      `<div class="cmd-item${i === 0 ? ' active' : ''}" data-path="${this._escHtml(f.path)}">
        <span class="cmd-label">${this._escHtml(f.name)}</span>
        <span class="cmd-shortcut" style="font-size:10px">${this._escHtml(f.relativePath)}</span>
      </div>`
    ).join('');
    list.querySelectorAll('.cmd-item').forEach(el => {
      el.addEventListener('click', () => {
        const p = (el as HTMLElement).dataset.path;
        if (p) this.editor.openFile(p);
        this.closeCommandPalette();
      });
    });
  }

  // ─── Zen Mode ───
  private _initZenMode(): void {
    this._zenMode = false;
  }

  toggleZenMode(): void {
    this._zenMode = !this._zenMode;
    document.body.classList.toggle('zen-mode', this._zenMode);
    this.editor?.layout();
    if (this._zenMode) {
      let exitBtn = document.getElementById('zen-exit-btn') as HTMLButtonElement | null;
      if (!exitBtn) {
        exitBtn = document.createElement('button');
        exitBtn.id = 'zen-exit-btn';
        exitBtn.className = 'zen-exit-btn';
        exitBtn.textContent = 'Exit Zen Mode';
        exitBtn.title = 'Esc or F11 to exit';
        exitBtn.addEventListener('click', () => this.toggleZenMode());
        document.body.appendChild(exitBtn);
      }
      this.showToast('Zen Mode — Press Esc or F11 to exit', 'info', 3000);
    } else {
      document.getElementById('zen-exit-btn')?.remove();
    }
  }

  // ─── Keyboard Shortcuts Help ───
  showKeyboardShortcuts(): void {
    let overlay = document.getElementById('shortcuts-overlay');
    if (overlay) { overlay.remove(); return; }

    const shortcuts: [string, [string, string][]][] = [
      ['General', [
        ['Ctrl+Shift+P', 'Command Palette'],
        ['Ctrl+P', 'Quick Open File'],
        ['Ctrl+,', 'Settings'],
        ['Ctrl+B', 'Toggle Sidebar'],
        ['F11', 'Zen Mode'],
      ]],
      ['Editor', [
        ['Ctrl+S', 'Save'],
        ['Ctrl+N', 'New File'],
        ['Ctrl+W', 'Close Tab'],
        ['Ctrl+Tab', 'Next Tab'],
        ['Ctrl+\\\\', 'Split Editor'],
        ['Ctrl+Shift+M', 'Markdown Preview'],
        ['Alt+Z', 'Toggle Word Wrap'],
        ['Shift+Alt+F', 'Format Document'],
        ['Ctrl+Scroll', 'Zoom'],
      ]],
      ['Navigation', [
        ['Ctrl+Shift+E', 'Explorer'],
        ['Ctrl+Shift+F', 'Search'],
        ['Ctrl+Shift+G', 'Source Control'],
        ['Ctrl+Shift+X', 'Extensions'],
        ['Ctrl+Shift+O', 'Outline'],
        ['Ctrl+Shift+A', 'AI Chat'],
        ['Ctrl+`', 'Terminal'],
      ]],
    ];

    overlay = document.createElement('div');
    overlay.id = 'shortcuts-overlay';
    overlay.innerHTML = `
      <div class="shortcuts-modal">
        <div class="shortcuts-header">
          <h2>Keyboard Shortcuts</h2>
          <button class="shortcuts-close" title="Close">✕</button>
        </div>
        <div class="shortcuts-grid">
          ${shortcuts.map(([group, items]) => `
            <div class="shortcuts-group">
              <h3>${group}</h3>
              ${items.map(([key, desc]) => `
                <div class="shortcut-row">
                  <kbd>${key}</kbd>
                  <span>${desc}</span>
                </div>
              `).join('')}
            </div>
          `).join('')}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector('.shortcuts-close')?.addEventListener('click', () => overlay!.remove());
    overlay.addEventListener('click', (e: MouseEvent) => { if (e.target === overlay) overlay!.remove(); });
  }

  // ─── Snippets Palette ───
  showSnippetPalette(): void {
    const lang = this.editor?.editor?.getModel()?.getLanguageId() || 'plaintext';
    const snippets = this._getSnippets(lang);

    const origCommands = this.commands;
    this.commands = snippets.map(s => ({
      id: `snippet.${s.name}`,
      label: `${s.name}`,
      shortcut: s.lang,
      fn: () => {
        const editor = this.editor.editor;
        if (!editor) return;
        const controller = editor.getContribution('snippetController2');
        if (controller) {
          controller.insert(s.body);
        } else {
          const pos = editor.getPosition();
          editor.executeEdits('snippet', [{
            range: new this.editor.monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
            text: s.body.replace(/\$\d+/g, ''),
          }]);
        }
        this.showToast(`Inserted "${s.name}"`, 'success', 1500);
      },
    }));

    this.toggleCommandPalette();
    (document.getElementById('command-input') as HTMLInputElement).placeholder = 'Select a snippet...';
    (document.getElementById('command-input') as HTMLInputElement).value = '';
    this._renderCommands('');

    const self = this;
    const origClose = this.closeCommandPalette;
    this.closeCommandPalette = function() {
      self.commands = origCommands;
      self.closeCommandPalette = origClose;
      origClose.call(self);
    };
  }

  private _getSnippets(lang: string): { name: string; body: string; lang: string }[] {
    const all: Record<string, { name: string; body: string; lang: string }[]> = {
      javascript: [
        { name: 'console.log', body: "console.log('$1');", lang: 'JS' },
        { name: 'Arrow Function', body: 'const $1 = ($2) => {\n  $3\n};', lang: 'JS' },
        { name: 'Async Function', body: 'async function $1($2) {\n  $3\n}', lang: 'JS' },
        { name: 'Try/Catch', body: 'try {\n  $1\n} catch (err) {\n  console.error(err);\n}', lang: 'JS' },
        { name: 'Import', body: "import { $1 } from '$2';", lang: 'JS' },
        { name: 'Fetch', body: "const res = await fetch('$1');\nconst data = await res.json();", lang: 'JS' },
        { name: 'forEach Loop', body: '$1.forEach(($2) => {\n  $3\n});', lang: 'JS' },
        { name: 'Map', body: 'const $1 = $2.map(($3) => {\n  return $4;\n});', lang: 'JS' },
        { name: 'Express Route', body: "app.get('/$1', (req, res) => {\n  res.json({ $2 });\n});", lang: 'JS' },
        { name: 'React Component', body: "export default function $1() {\n  return (\n    <div>\n      $2\n    </div>\n  );\n}", lang: 'JSX' },
      ],
      typescript: [
        { name: 'Interface', body: 'interface $1 {\n  $2: $3;\n}', lang: 'TS' },
        { name: 'Type', body: 'type $1 = {\n  $2: $3;\n};', lang: 'TS' },
        { name: 'Async Function (typed)', body: 'async function $1($2: $3): Promise<$4> {\n  $5\n}', lang: 'TS' },
        { name: 'console.log', body: "console.log('$1');", lang: 'TS' },
        { name: 'Arrow Function', body: 'const $1 = ($2: $3): $4 => {\n  $5\n};', lang: 'TS' },
        { name: 'Try/Catch', body: 'try {\n  $1\n} catch (err) {\n  console.error(err);\n}', lang: 'TS' },
      ],
      python: [
        { name: 'def function', body: 'def $1($2):\n    $3', lang: 'PY' },
        { name: 'class', body: 'class $1:\n    def __init__(self, $2):\n        $3', lang: 'PY' },
        { name: 'if __name__', body: "if __name__ == '__main__':\n    $1", lang: 'PY' },
        { name: 'try/except', body: 'try:\n    $1\nexcept Exception as e:\n    print(e)', lang: 'PY' },
        { name: 'with open', body: "with open('$1', 'r') as f:\n    $2 = f.read()", lang: 'PY' },
        { name: 'list comprehension', body: '[$1 for $2 in $3]', lang: 'PY' },
        { name: 'async def', body: 'async def $1($2):\n    $3', lang: 'PY' },
        { name: 'FastAPI Route', body: "@app.get('/$1')\nasync def $2():\n    return {'$3': $4}", lang: 'PY' },
      ],
      html: [
        { name: 'HTML5 Boilerplate', body: '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>$1</title>\n</head>\n<body>\n  $2\n</body>\n</html>', lang: 'HTML' },
        { name: 'Link Stylesheet', body: '<link rel="stylesheet" href="$1">', lang: 'HTML' },
        { name: 'Script Tag', body: '<script src="$1"></script>', lang: 'HTML' },
        { name: 'div.class', body: '<div class="$1">\n  $2\n</div>', lang: 'HTML' },
      ],
      css: [
        { name: 'Flexbox Center', body: 'display: flex;\nalign-items: center;\njustify-content: center;', lang: 'CSS' },
        { name: 'Grid', body: 'display: grid;\ngrid-template-columns: repeat($1, 1fr);\ngap: $2;', lang: 'CSS' },
        { name: 'Media Query', body: '@media (max-width: $1px) {\n  $2\n}', lang: 'CSS' },
        { name: 'Animation', body: '@keyframes $1 {\n  from { $2 }\n  to { $3 }\n}', lang: 'CSS' },
      ],
    };
    return all[lang] || all.javascript || [];
  }

  // ─── Outline Panel ───
  private _initOutlinePanel(): void {
    this._outlineRefreshTimer = null;
    document.getElementById('btn-refresh-outline')?.addEventListener('click', () => this.refreshOutline());
  }

  refreshOutline(): void {
    const container = document.getElementById('outline-list');
    if (!container) return;

    const symbols = this.editor?.getOutline() || [];
    if (symbols.length === 0) {
      container.innerHTML = '<div class="outline-empty">No symbols found</div>';
      return;
    }

    container.innerHTML = symbols.map(s => {
      const kindClass = s.kind;
      return `<div class="outline-item outline-${kindClass}" data-line="${s.line}" title="Line ${s.line}">
        <span class="outline-icon">${s.icon}</span>
        <span class="outline-name">${this._escHtml(s.name)}</span>
        <span class="outline-line">${s.line}</span>
      </div>`;
    }).join('');

    container.querySelectorAll('.outline-item').forEach(el => {
      el.addEventListener('click', () => {
        const line = parseInt((el as HTMLElement).dataset.line!);
        this.editor.editor?.revealLineInCenter(line);
        this.editor.editor?.setPosition({ lineNumber: line, column: 1 });
        this.editor.editor?.focus();
      });
    });
  }

  // ─── Extensions Panel ───
  private _initExtensionsPanel(): void {
    document.getElementById('ext-theme-select')?.addEventListener('change', (e: Event) => {
      this.switchTheme((e.target as HTMLSelectElement).value);
    });

    document.getElementById('ext-inline-completions')?.addEventListener('change', (e: Event) => {
      const checked = (e.target as HTMLInputElement).checked;
      this.editor?.editor?.updateOptions({ inlineSuggest: { enabled: checked } });
      localStorage.setItem('merecode-inline-completions', String(checked));
    });

    const savedInline = localStorage.getItem('merecode-inline-completions');
    if (savedInline === 'false') {
      const cb = document.getElementById('ext-inline-completions') as HTMLInputElement | null;
      if (cb) cb.checked = false;
      this.editor?.editor?.updateOptions({ inlineSuggest: { enabled: false } });
    }
  }
}

// ═══ Boot ═══
const mereCode = new MereCodeApp();
document.addEventListener('DOMContentLoaded', () => mereCode.init());
