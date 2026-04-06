import { EditorManager } from "./editor.js";
import { FileExplorer } from "./fileExplorer.js";
import { TerminalManager } from "./terminal.js";
import { ChatManager } from "./chat.js";
import { SearchManager } from "./search.js";
import { GitManager } from "./gitManager.js";
class MereCodeApp {
  constructor() {
    this.rootPath = null;
    this.activePanel = "explorer";
    this.isChatOpen = false;
    this.isTerminalOpen = false;
    this.commands = [];
    this._zoomLevel = 1;
    this._zenMode = false;
    this._quickOpenMode = false;
    this._quickOpenFiles = [];
    this._taskScripts = {};
    this._taskPackageName = "";
    this._workspaceSettings = {};
    this._outlineRefreshTimer = null;
  }
  async init() {
    // Clean up deprecated localStorage keys
    localStorage.removeItem("merecode-api-endpoint");
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
    this._initProblemsPanel();
    this._loadRecentFolders();
    this._initTheme();
    this._initZenMode();
    this._initOutlinePanel();
    this._loadZoom();
    this._initTaskPanel();
    this._initUpdater();
    this._initStatusBar();
    this.showWelcome();
    this._loadVersion();
  }
  async _loadVersion() {
    try {
      const ver = await window.merecode.app.getVersion();
      if (ver) {
        const aboutEl = document.getElementById("about-version");
        const welcomeEl = document.getElementById("welcome-version");
        if (aboutEl) aboutEl.textContent = `v${ver}`;
        if (welcomeEl) welcomeEl.textContent = `v${ver}`;
      }
    } catch {
    }
  }
  // ─── Toast Notifications ───
  showToast(message, type = "info", duration = 4e3) {
    const container = document.getElementById("toast-container");
    if (!container) return;
    const icons = {
      success: "\u2713",
      error: "\u2715",
      warning: "\u26A0",
      info: "\u2139"
    };
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span class="toast-message">${this._escHtml(message)}</span>
      <span class="toast-close" title="Dismiss">\u2715</span>
    `;
    toast.querySelector(".toast-close")?.addEventListener("click", () => this._dismissToast(toast));
    container.appendChild(toast);
    if (duration > 0) {
      setTimeout(() => this._dismissToast(toast), duration);
    }
  }
  _dismissToast(toast) {
    if (!toast || toast.classList.contains("toast-exit")) return;
    toast.classList.add("toast-exit");
    // Remove after animation with fallback timeout
    const cleanup = () => toast.remove();
    toast.addEventListener("animationend", cleanup, { once: true });
    setTimeout(cleanup, 500); // Fallback if animation doesn't fire
  }
  _escHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
  // ─── Window Controls ───
  _initWindowControls() {
    document.getElementById("btn-minimize")?.addEventListener("click", () => window.merecode.window.minimize());
    document.getElementById("btn-maximize")?.addEventListener("click", () => window.merecode.window.maximize());
    document.getElementById("btn-close")?.addEventListener("click", () => window.merecode.window.close());
    window.merecode.window.onStateChange?.((maximized) => {
      document.getElementById("btn-maximize").title = maximized ? "Restore" : "Maximize";
    });
    // Unsaved changes warning on close
    window.merecode.window.onBeforeClose?.(() => {
      const dirtyTabs = this.editor?.tabs?.filter(t => t.isDirty) || [];
      if (dirtyTabs.length > 0) {
        const names = dirtyTabs.map(t => t.name).join(", ");
        if (!confirm(`You have unsaved changes in: ${names}\n\nClose without saving?`)) {
          return; // Don't close
        }
      }
      // Save session before closing
      this.editor?.saveSession();
      window.merecode.window.forceClose();
    });
  }
  // ─── Activity Bar ───
  _initActivityBar() {
    document.querySelectorAll(".ab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const panel = btn.dataset.panel;
        if (panel === "chat") {
          this.toggleChat();
          return;
        }
        if (panel === this.activePanel) {
          this.toggleSidebar();
          return;
        }
        this.switchPanel(panel);
      });
    });
  }
  switchPanel(panelId) {
    document.querySelectorAll(".ab-btn").forEach((b) => {
      if (b.dataset.panel !== "chat") b.classList.toggle("active", b.dataset.panel === panelId);
    });
    document.querySelectorAll(".sidebar-panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${panelId}`));
    this.activePanel = panelId;
    document.getElementById("sidebar").style.display = "flex";
    this.editor?.layout();
  }
  toggleSidebar() {
    const sb = document.getElementById("sidebar");
    const vis = sb.style.display !== "none";
    sb.style.display = vis ? "none" : "flex";
    this.editor?.layout();
  }
  toggleChat() {
    this.isChatOpen = !this.isChatOpen;
    document.getElementById("chat-sidebar").style.display = this.isChatOpen ? "flex" : "none";
    document.getElementById("ab-chat-btn")?.classList.toggle("active", this.isChatOpen);
    if (this.isChatOpen) {
      document.getElementById("chat-input")?.focus();
      this.chat?._checkApiKey();
    }
    this.editor?.layout();
  }
  toggleTerminal() {
    this.isTerminalOpen = !this.isTerminalOpen;
    document.getElementById("terminal-panel").style.display = this.isTerminalOpen ? "flex" : "none";
    document.getElementById("terminal-resize-handle").style.display = this.isTerminalOpen ? "block" : "none";
    if (this.isTerminalOpen && this.terminal.terminals.size === 0) this.terminal.createTerminal();
    this.editor?.layout();
  }
  // ─── Folder management ───
  async openFolder(folderPath) {
    if (!folderPath) folderPath = await window.merecode.dialog.openFolder();
    if (!folderPath) return;
    this.rootPath = folderPath;
    const folderName = window.merecode.path.basename(folderPath);
    document.getElementById("titlebar-title").textContent = "Mere Code";
    document.getElementById("titlebar-filename").textContent = folderName;
    await this.fileExplorer.setRoot(folderPath);
    this.switchPanel("explorer");
    // Restore previous session tabs if any
    await this.editor.restoreSession();
    if (this.editor.tabs.length > 0) this.hideWelcome();
    this.git?.refresh();
    this.git?.checkAndShowConflicts?.();
    this._addRecentFolder(folderPath);
    this._loadWorkspaceSettings(folderPath);
    this._loadTaskScripts(folderPath);
    this._loadCustomKeybinds();
    this._detectProjectType(folderPath);
    this.showToast(`Opened ${folderName}`, "success", 2e3);
  }
  // ─── Workspace Settings ───
  async _loadWorkspaceSettings(rootPath) {
    if (!window.merecode.workspace) return;
    const result = await window.merecode.workspace.load(rootPath);
    const ws = result.settings || {};
    if (ws.theme) {
      this.editor?.setTheme(ws.theme);
      this._applyUITheme(ws.theme);
    }
    if (ws.fontSize) this.editor?.updateFontSize(ws.fontSize);
    if (ws.tabSize) this.editor?.updateTabSize(ws.tabSize);
    if (ws.wordWrap) this.editor?.editor?.updateOptions({ wordWrap: ws.wordWrap });
    this._workspaceSettings = ws;
  }
  async _saveWorkspaceSetting(key, value) {
    if (!this.rootPath || !window.merecode.workspace) return;
    const current = this._workspaceSettings || {};
    current[key] = value;
    this._workspaceSettings = current;
    await window.merecode.workspace.save(this.rootPath, current);
  }
  // ─── Task Runner ───
  async _loadTaskScripts(rootPath) {
    if (!window.merecode.task) return;
    const result = await window.merecode.task.list(rootPath);
    this._taskScripts = result.scripts || {};
    this._taskPackageName = result.name || "";
    this._renderTaskPanel();
  }
  _renderTaskPanel() {
    const container = document.getElementById("task-list");
    if (!container) return;
    const scripts = this._taskScripts || {};
    const keys = Object.keys(scripts);
    if (keys.length === 0) {
      container.innerHTML = '<div class="task-empty">No scripts found in package.json</div>';
      return;
    }
    container.innerHTML = keys.map((name) => `
      <div class="task-item" role="listitem">
        <div class="task-info">
          <span class="task-name">${this._escHtml(name)}</span>
          <span class="task-cmd">${this._escHtml(scripts[name])}</span>
        </div>
        <button class="task-run-btn" data-task="${this._escHtml(name)}" aria-label="Run ${this._escHtml(name)}" title="Run">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M4 2l10 6-10 6V2z"/></svg>
        </button>
      </div>
    `).join("");
    container.querySelectorAll(".task-run-btn").forEach((btn) => {
      btn.addEventListener("click", () => this._runTask(btn.dataset.task));
    });
  }
  async _runTask(scriptName) {
    if (!this.rootPath || !window.merecode.task) return;
    if (!this.isTerminalOpen) this.toggleTerminal();
    if (this.terminal.terminals.size === 0) await this.terminal.createTerminal();
    const cmd = `npm run ${scriptName}`;
    this.showToast(`Running: ${scriptName}`, "info", 2e3);
    const result = window.merecode.task.run(this.rootPath, scriptName, cmd);
    const taskId = result.id;
    const cleanupOutput = window.merecode.task.onOutput((id, data) => {
      if (id !== taskId) return;
      const activeId = this.terminal.activeTerminalId;
      if (activeId) this.terminal.terminals.get(activeId)?.xterm.write(data);
    });
    const cleanupDone = window.merecode.task.onDone((id, code) => {
      if (id !== taskId) return;
      const msg = code === 0 ? `\u2713 ${scriptName} completed` : `\u2717 ${scriptName} exited with code ${code}`;
      this.showToast(msg, code === 0 ? "success" : "error");
      cleanupOutput();
      cleanupDone();
    });
  }
  _initTaskPanel() {
    document.getElementById("btn-task-refresh")?.addEventListener("click", () => {
      if (this.rootPath) this._loadTaskScripts(this.rootPath);
    });
    document.getElementById("btn-task-custom")?.addEventListener("click", () => {
      const cmd = prompt("Enter command to run:");
      if (cmd?.trim() && this.rootPath) this._runTask(cmd.trim());
    });
  }
  async _updateGitStatus() {
    if (!this.rootPath) return;
    try {
      const s = await window.merecode.git.status(this.rootPath);
      if (s && !s.error) {
        const branchEl = document.getElementById("status-branch");
        if (branchEl) {
          branchEl.innerHTML = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="4" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="7" r="2"/><path d="M5 6v4M7 12h3c1.1 0 2-.9 2-2V7" fill="none" stroke="currentColor" stroke-width="1.2"/></svg> ${s.branch || "no branch"}`;
        }
      }
    } catch {
    }
  }
  // ─── Recent Folders ───
  _addRecentFolder(folderPath) {
    let recent = JSON.parse(localStorage.getItem("merecode-recent-folders") || "[]");
    recent = recent.filter((f) => f !== folderPath);
    recent.unshift(folderPath);
    recent = recent.slice(0, 8);
    localStorage.setItem("merecode-recent-folders", JSON.stringify(recent));
    this._loadRecentFolders();
  }
  _loadRecentFolders() {
    const container = document.getElementById("welcome-recent");
    if (!container) return;
    const recent = JSON.parse(localStorage.getItem("merecode-recent-folders") || "[]");
    if (recent.length === 0) {
      container.innerHTML = '<p class="welcome-no-recent">No recent folders</p>';
      return;
    }
    container.innerHTML = recent.map((f) => {
      const name = f.split(/[/\\]/).pop();
      return `<div class="welcome-recent-item" data-path="${this._escHtml(f)}" title="${this._escHtml(f)}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5"><path d="M3 7V17C3 18.1 3.9 19 5 19H19C20.1 19 21 18.1 21 17V9C21 7.9 20.1 7 19 7H11L9 5H5C3.9 5 3 5.9 3 7Z"/></svg>
        <div>
          <div>${this._escHtml(name)}</div>
          <div class="welcome-recent-path">${this._escHtml(f)}</div>
        </div>
      </div>`;
    }).join("");
    container.querySelectorAll(".welcome-recent-item").forEach((el) => {
      el.addEventListener("click", () => {
        const path = el.dataset.path;
        if (path) this.openFolder(path);
      });
    });
  }
  showWelcome() {
    document.getElementById("welcome-screen").style.display = "flex";
    document.getElementById("monaco-container").style.display = "none";
    const bc = document.getElementById("breadcrumbs");
    if (bc) {
      bc.innerHTML = "";
      bc.style.display = "none";
    }
  }
  hideWelcome() {
    document.getElementById("welcome-screen").style.display = "none";
    document.getElementById("monaco-container").style.display = "block";
    this.editor?.layout();
  }
  _initWelcomeActions() {
    document.getElementById("welcome-open-folder")?.addEventListener("click", () => this.openFolder());
    document.getElementById("btn-open-folder-big")?.addEventListener("click", () => this.openFolder());
    document.getElementById("welcome-new-file")?.addEventListener("click", () => this.editor.createUntitledTab());
    document.getElementById("welcome-toggle-terminal")?.addEventListener("click", () => this.toggleTerminal());
    document.getElementById("welcome-ai-chat")?.addEventListener("click", () => this.toggleChat());
    document.getElementById("welcome-command-palette")?.addEventListener("click", () => this.toggleCommandPalette());
    document.getElementById("btn-setup-apikey")?.addEventListener("click", () => {
      this.switchPanel("settings");
      setTimeout(() => document.getElementById("setting-api-key")?.focus(), 100);
    });
    document.getElementById("btn-split-editor")?.addEventListener("click", () => this.editor.splitEditor());
  }
  // ─── Keyboard Shortcuts ───
  _initKeyboard() {
    this._customKeybinds = {};
    this._loadCustomKeybinds();
    document.addEventListener("keydown", (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const keyCombo = this._keyCombo(e);
      // Check custom keybinds first
      if (this._customKeybinds[keyCombo]) {
        e.preventDefault();
        const cmd = this.commands.find(c => c.id === this._customKeybinds[keyCombo]);
        if (cmd) cmd.fn();
        return;
      }
      if (ctrl && e.shiftKey && e.key === "P") {
        e.preventDefault();
        this.toggleCommandPalette();
      } else if (ctrl && e.key === "`") {
        e.preventDefault();
        this.toggleTerminal();
      } else if (ctrl && e.key === "s") {
        e.preventDefault();
        this.editor.saveCurrentFile();
        this.showToast("File saved", "success", 1500);
      } else if (ctrl && e.shiftKey && e.key === "E") {
        e.preventDefault();
        this.switchPanel("explorer");
      } else if (ctrl && e.shiftKey && e.key === "F") {
        e.preventDefault();
        this.switchPanel("search");
        document.getElementById("search-input")?.focus();
      } else if (ctrl && e.shiftKey && e.key === "G") {
        e.preventDefault();
        this.switchPanel("git");
      } else if (ctrl && e.shiftKey && e.key === "X") {
        e.preventDefault();
        this.switchPanel("extensions");
      } else if (ctrl && e.shiftKey && e.key === "O") {
        e.preventDefault();
        this.switchPanel("outline");
        this.refreshOutline();
      } else if (ctrl && e.shiftKey && e.key === "A") {
        e.preventDefault();
        this.toggleChat();
      } else if (ctrl && e.key === ",") {
        e.preventDefault();
        this.switchPanel("settings");
      } else if (ctrl && e.shiftKey && e.key === "T") {
        e.preventDefault();
        this.switchPanel("tasks");
        if (this.rootPath) this._loadTaskScripts(this.rootPath);
      } else if (ctrl && !e.shiftKey && e.key === "t") {
        e.preventDefault();
        this._showWorkspaceSymbolSearch();
      } else if (ctrl && e.key === "n") {
        e.preventDefault();
        this.editor.createUntitledTab();
      } else if (ctrl && e.key === "w") {
        e.preventDefault();
        this.editor.closeActiveTab();
      } else if (ctrl && e.key === "Tab") {
        e.preventDefault();
        this.editor.nextTab();
      } else if (ctrl && !e.shiftKey && e.key === "p") {
        e.preventDefault();
        this.toggleCommandPalette(true);
      } else if (ctrl && e.key === "b") {
        e.preventDefault();
        this.toggleSidebar();
      } else if (ctrl && e.key === "\\") {
        e.preventDefault();
        this.editor.splitEditor();
      } else if (ctrl && e.shiftKey && e.key === "M") {
        e.preventDefault();
        this.editor.toggleMarkdownPreview();
      } else if (e.key === "F11") {
        e.preventDefault();
        this.toggleZenMode();
      } else if (e.shiftKey && e.altKey && e.key === "F") {
        e.preventDefault();
        this.editor.formatDocument();
      } else if (e.key === "Escape") {
        this.closeCommandPalette();
        if (this._zenMode) this.toggleZenMode();
      } else if (ctrl && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        this._uiZoom(1);
      } else if (ctrl && e.key === "-") {
        e.preventDefault();
        this._uiZoom(-1);
      } else if (ctrl && e.key === "0") {
        e.preventDefault();
        this._uiZoom(0);
      }
    });
  }
  // ─── UI Zoom ───
  _uiZoom(delta) {
    const levels = [0.75, 0.85, 0.9, 1, 1.1, 1.2, 1.35, 1.5];
    if (delta === 0) {
      this._zoomLevel = 1;
    } else {
      const cur = parseFloat(document.body.style.zoom) || 1;
      const idx = levels.findIndex((l) => l >= cur - 0.01);
      const next = delta > 0 ? levels[Math.min(idx + 1, levels.length - 1)] : levels[Math.max((idx === -1 ? levels.length - 1 : idx) - 1, 0)];
      this._zoomLevel = next;
    }
    document.body.style.zoom = this._zoomLevel;
    localStorage.setItem("merecode-ui-zoom", String(this._zoomLevel));
    if (this._zoomLevel !== 1) {
      this.showToast(`Zoom: ${Math.round(this._zoomLevel * 100)}%`, "info", 1200);
    }
    this.editor?.layout();
  }
  _loadZoom() {
    const saved = parseFloat(localStorage.getItem("merecode-ui-zoom") || "1");
    if (saved !== 1) {
      document.body.style.zoom = saved;
      this._zoomLevel = saved;
    }
  }
  // ─── Resizing ───
  _initResizing() {
    this._drag("sidebar-resize-handle", "sidebar", "width", 180, 600);
    this._drag("terminal-resize-handle", "terminal-panel", "height", 80, 500, true);
  }
  _drag(handleId, targetId, dim, min, max, invert = false) {
    const handle = document.getElementById(handleId);
    const target = document.getElementById(targetId);
    if (!handle || !target) return;
    handle.addEventListener("mousedown", (e) => {
      const startPos = dim === "width" ? e.clientX : e.clientY;
      const startSize = dim === "width" ? target.offsetWidth : target.offsetHeight;
      const move = (e2) => {
        const pos = dim === "width" ? e2.clientX : e2.clientY;
        const delta = invert ? startPos - pos : pos - startPos;
        target.style[dim] = Math.min(max, Math.max(min, startSize + delta)) + "px";
        this.editor?.layout();
      };
      const up = () => {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
      document.body.style.cursor = dim === "width" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    });
  }
  // ─── Command Palette ───
  _initCommandPalette() {
    this.commands = [
      { id: "folder.open", label: "Open Folder...", shortcut: "", fn: () => this.openFolder() },
      { id: "file.new", label: "New File", shortcut: "Ctrl+N", fn: () => this.editor.createUntitledTab() },
      { id: "file.save", label: "Save", shortcut: "Ctrl+S", fn: () => this.editor.saveCurrentFile() },
      { id: "terminal.toggle", label: "Toggle Terminal", shortcut: "Ctrl+`", fn: () => this.toggleTerminal() },
      { id: "terminal.new", label: "New Terminal", shortcut: "", fn: () => this.terminal.createTerminal() },
      { id: "view.sidebar", label: "Toggle Sidebar", shortcut: "Ctrl+B", fn: () => this.toggleSidebar() },
      { id: "view.chat", label: "Toggle Mere X AI Chat", shortcut: "Ctrl+Shift+A", fn: () => this.toggleChat() },
      { id: "view.explorer", label: "Show Explorer", shortcut: "Ctrl+Shift+E", fn: () => this.switchPanel("explorer") },
      { id: "view.search", label: "Show Search", shortcut: "Ctrl+Shift+F", fn: () => this.switchPanel("search") },
      { id: "view.git", label: "Show Source Control", shortcut: "Ctrl+Shift+G", fn: () => this.switchPanel("git") },
      { id: "view.extensions", label: "Show Extensions", shortcut: "Ctrl+Shift+X", fn: () => this.switchPanel("extensions") },
      { id: "view.settings", label: "Open Settings", shortcut: "Ctrl+,", fn: () => this.switchPanel("settings") },
      { id: "editor.format", label: "Format Document", shortcut: "Shift+Alt+F", fn: () => this.editor.formatDocument() },
      { id: "editor.minimap", label: "Toggle Minimap", shortcut: "", fn: () => this.editor.toggleMinimap() },
      { id: "editor.wordWrap", label: "Toggle Word Wrap", shortcut: "Alt+Z", fn: () => this.editor.toggleWordWrap() },
      { id: "theme.dark", label: "Theme: Mere Dark", shortcut: "", fn: () => this.switchTheme("mere-dark") },
      { id: "theme.light", label: "Theme: Mere Light", shortcut: "", fn: () => this.switchTheme("mere-light") },
      { id: "git.commit", label: "Git: Commit", shortcut: "", fn: () => this.git?.commit() },
      { id: "git.push", label: "Git: Push", shortcut: "", fn: () => this.git?.push() },
      { id: "git.pull", label: "Git: Pull", shortcut: "", fn: () => this.git?.pull() },
      { id: "git.stash", label: "Git: Stash", shortcut: "", fn: () => this.git?.stash() },
      { id: "git.stashPop", label: "Git: Stash Pop", shortcut: "", fn: () => this.git?.stashPop() },
      { id: "git.branch", label: "Git: Switch Branch", shortcut: "", fn: () => this.git?.showBranchPicker() },
      { id: "editor.split", label: "Split Editor Right", shortcut: "Ctrl+\\", fn: () => this.editor.splitEditor() },
      { id: "editor.mdPreview", label: "Markdown: Toggle Preview", shortcut: "Ctrl+Shift+M", fn: () => this.editor.toggleMarkdownPreview() },
      { id: "view.outline", label: "Show Outline", shortcut: "Ctrl+Shift+O", fn: () => {
        this.switchPanel("outline");
        this.refreshOutline();
      } },
      { id: "view.zenMode", label: "Toggle Zen Mode", shortcut: "F11", fn: () => this.toggleZenMode() },
      { id: "view.shortcuts", label: "Show Keyboard Shortcuts", shortcut: "", fn: () => this.showKeyboardShortcuts() },
      { id: "editor.snippets", label: "Insert Snippet...", shortcut: "", fn: () => this.showSnippetPalette() },
      { id: "ai.testGen", label: "AI: Generate Tests", shortcut: "", fn: () => this._aiAction("Write comprehensive unit tests for the current file. Use the appropriate test framework for the language.") },
      { id: "ai.genDocs", label: "AI: Generate Documentation", shortcut: "", fn: () => this._aiAction("Generate comprehensive documentation for the current file. Include JSDoc/docstring comments for all public functions, classes, and methods.") },
      { id: "ai.bugDetect", label: "AI: Detect Bugs", shortcut: "", fn: () => this._aiAction("Analyze the current file for potential bugs, security vulnerabilities, race conditions, edge cases, and logic errors. Fix all issues you find.") },
      { id: "ai.fixErrors", label: "AI: Fix Errors", shortcut: "", fn: () => this._aiAction("Look at the recent terminal output for errors and fix all issues in the relevant files.") },
      { id: "ai.review", label: "AI: Code Review", shortcut: "", fn: () => this.git?.aiCodeReview() },
      { id: "ai.natural", label: "AI: Ask Anything...", shortcut: "Ctrl+Shift+A", fn: () => this.toggleChat() },
      { id: "editor.findReplace", label: "Find and Replace", shortcut: "Ctrl+H", fn: () => this.editor?.editor?.getAction("editor.action.startFindReplaceAction")?.run() },
      { id: "editor.find", label: "Find", shortcut: "Ctrl+F", fn: () => this.editor?.editor?.getAction("actions.find")?.run() },
      { id: "view.tasks", label: "Show Task Runner", shortcut: "Ctrl+Shift+T", fn: () => this.switchPanel("tasks") },
      { id: "keybindings.open", label: "Open Keyboard Shortcuts (JSON)", shortcut: "", fn: () => this._openKeybindingsFile() },
      { id: "editor.goToDefinition", label: "Go to Definition", shortcut: "F12", fn: () => this.editor?.editor?.getAction("editor.action.revealDefinition")?.run() },
      { id: "editor.findReferences", label: "Find All References", shortcut: "Shift+F12", fn: () => this.editor?.editor?.getAction("editor.action.referenceSearch.trigger")?.run() },
      { id: "editor.renameSymbol", label: "Rename Symbol", shortcut: "F2", fn: () => this.editor?.editor?.getAction("editor.action.rename")?.run() },
      { id: "editor.workspaceSymbols", label: "Go to Symbol in Workspace", shortcut: "Ctrl+T", fn: () => this._showWorkspaceSymbolSearch() },
      { id: "editor.extractRefactor", label: "Extract to Function/Variable", shortcut: "Ctrl+Shift+R", fn: () => this.editor?._showExtractMenu() },
      { id: "view.problems", label: "Show Problems", shortcut: "Ctrl+Shift+M", fn: () => { this.switchPanel("problems"); this.editor?._renderProblemsPanel(); } },
      { id: "editor.toggleStickyScroll", label: "Toggle Sticky Scroll", shortcut: "", fn: () => {
        const current = this.editor?.editor?.getOption(this.editor.monaco.editor.EditorOption.stickyScroll);
        this.editor?.editor?.updateOptions({ stickyScroll: { enabled: !current?.enabled } });
        this.showToast(!current?.enabled ? 'Sticky scroll enabled' : 'Sticky scroll disabled', 'info', 1500);
      }},
      { id: "git.inlineBlame", label: "Git: Toggle Inline Blame", shortcut: "", fn: () => {
        if (this.editor?._blameData) this.editor.hideInlineBlame();
        else this.editor?.showInlineBlame();
      }},
      { id: "chat.toggleWebSearch", label: "AI: Toggle Web Search", shortcut: "", fn: () => {
        if (this.chat) {
          this.chat._webSearchEnabled = !this.chat._webSearchEnabled;
          const btn = document.getElementById("btn-chat-web-search");
          if (btn) btn.classList.toggle("active", this.chat._webSearchEnabled);
          this.showToast(this.chat._webSearchEnabled ? 'Web search enabled' : 'Web search disabled', 'info', 1500);
        }
      }},
      { id: "chat.branches", label: "AI: Show Conversation Branches", shortcut: "", fn: () => this.chat?.showBranchPicker() },
      { id: "chat.branchHere", label: "AI: Branch Current Conversation", shortcut: "", fn: () => {
        if (this.chat?.messages?.length > 0) this.chat.branchConversation(this.chat.messages.length - 1);
        else this.showToast('No messages to branch', 'info', 2000);
      }}
    ];
    const input = document.getElementById("command-input");
    const list = document.getElementById("command-list");
    input?.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.closeCommandPalette();
      if (e.key === "Enter") {
        list.querySelector(".cmd-item.active")?.click();
      }
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = list.querySelectorAll(".cmd-item");
        const idx = Array.from(items).findIndex((i) => i.classList.contains("active"));
        items[idx]?.classList.remove("active");
        const next = e.key === "ArrowDown" ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
        items[next]?.classList.add("active");
        items[next]?.scrollIntoView({ block: "nearest" });
      }
    });
    document.getElementById("command-palette-backdrop")?.addEventListener("click", () => this.closeCommandPalette());
  }
  _renderCommands(query = "") {
    const list = document.getElementById("command-list");
    const filtered = this.commands.filter((c) => c.label.toLowerCase().includes(query));
    list.innerHTML = filtered.map(
      (c, i) => `<div class="cmd-item${i === 0 ? " active" : ""}" data-id="${c.id}">
        <span class="cmd-label">${c.label}</span>
        ${c.shortcut ? `<span class="cmd-shortcut">${c.shortcut}</span>` : ""}
      </div>`
    ).join("");
    list.querySelectorAll(".cmd-item").forEach((el) => {
      el.addEventListener("click", () => {
        this.commands.find((c) => c.id === el.dataset.id)?.fn();
        this.closeCommandPalette();
      });
    });
  }
  toggleCommandPalette(quickOpen = false) {
    const pal = document.getElementById("command-palette");
    const back = document.getElementById("command-palette-backdrop");
    const input = document.getElementById("command-input");
    const open = pal.classList.contains("open");
    if (open) {
      this.closeCommandPalette();
      return;
    }
    this._quickOpenMode = quickOpen;
    pal.classList.add("open");
    back.classList.add("open");
    input.value = quickOpen ? "" : "> ";
    input.placeholder = quickOpen ? "Search files by name..." : "> Type a command...";
    input.focus();
    if (quickOpen) {
      this._loadQuickOpenFiles();
    } else {
      this._renderCommands("");
    }
    input.oninput = () => {
      if (this._quickOpenMode) {
        this._filterQuickOpen(input.value);
      } else {
        const q = input.value.toLowerCase().replace(/^>\s*/, "");
        this._renderCommands(q);
      }
    };
  }
  closeCommandPalette() {
    document.getElementById("command-palette")?.classList.remove("open");
    document.getElementById("command-palette-backdrop")?.classList.remove("open");
  }
  // ─── Settings ───
  _initSettings() {
    const apiKeyInput = document.getElementById("setting-api-key");
    const modelSelect = document.getElementById("setting-ai-model");
    const fontSizeInput = document.getElementById("setting-font-size");
    const tabSizeSelect = document.getElementById("setting-tab-size");
    const wordWrapSelect = document.getElementById("setting-word-wrap");
    const minimapSelect = document.getElementById("setting-minimap");
    const temperatureSlider = document.getElementById("setting-temperature");
    const tempValue = document.getElementById("temp-value");
    const toggleKeyVis = document.getElementById("btn-toggle-key-vis");
    const chatModelSelect = document.getElementById("chat-model-select");
    const themeSelect = document.getElementById("setting-theme");
    if (apiKeyInput) {
      // Load API key from secure storage or fallback
      const plain = localStorage.getItem("merecode-api-key") || "";
      apiKeyInput.value = plain;
      // Async load from secure storage
      this.chat?._loadSecureApiKey?.().then(() => {
        const key = this.chat?._getApiKey?.() || "";
        if (key && apiKeyInput) apiKeyInput.value = key;
      });
    }
    if (modelSelect) modelSelect.value = localStorage.getItem("merecode-ai-model") || "mere-nyx";
    if (fontSizeInput) fontSizeInput.value = localStorage.getItem("merecode-font-size") || "14";
    if (tabSizeSelect) tabSizeSelect.value = localStorage.getItem("merecode-tab-size") || "2";
    if (wordWrapSelect) wordWrapSelect.value = localStorage.getItem("merecode-word-wrap") || "off";
    if (minimapSelect) minimapSelect.value = localStorage.getItem("merecode-minimap") || "true";
    const savedTemp = localStorage.getItem("merecode-temperature") || "0.7";
    if (temperatureSlider) temperatureSlider.value = String(Math.round(parseFloat(savedTemp) * 100));
    if (tempValue) tempValue.textContent = savedTemp;
    if (chatModelSelect) chatModelSelect.value = modelSelect?.value || "mere-nyx";
    apiKeyInput?.addEventListener("change", () => {
      this.chat?._saveApiKeySecure(apiKeyInput.value).then(() => {
        this.chat?._checkApiKey();
        if (apiKeyInput.value) this.showToast("API key saved securely", "success", 2e3);
      });
    });
    toggleKeyVis?.addEventListener("click", () => {
      const isPassword = apiKeyInput.type === "password";
      apiKeyInput.type = isPassword ? "text" : "password";
    });
    modelSelect?.addEventListener("change", () => {
      localStorage.setItem("merecode-ai-model", modelSelect.value);
      if (chatModelSelect) chatModelSelect.value = modelSelect.value;
    });
    temperatureSlider?.addEventListener("input", () => {
      const val = (parseFloat(temperatureSlider.value) / 100).toFixed(2);
      if (tempValue) tempValue.textContent = val;
      localStorage.setItem("merecode-temperature", val);
    });
    fontSizeInput?.addEventListener("change", () => {
      localStorage.setItem("merecode-font-size", fontSizeInput.value);
      this.editor.updateFontSize(parseInt(fontSizeInput.value));
    });
    tabSizeSelect?.addEventListener("change", () => {
      localStorage.setItem("merecode-tab-size", tabSizeSelect.value);
      this.editor.updateTabSize(parseInt(tabSizeSelect.value));
      document.getElementById("status-indent").textContent = `Spaces: ${tabSizeSelect.value}`;
    });
    wordWrapSelect?.addEventListener("change", () => {
      localStorage.setItem("merecode-word-wrap", wordWrapSelect.value);
      this.editor.editor?.updateOptions({ wordWrap: wordWrapSelect.value });
    });
    minimapSelect?.addEventListener("change", () => {
      localStorage.setItem("merecode-minimap", minimapSelect.value);
      this.editor.editor?.updateOptions({ minimap: { enabled: minimapSelect.value === "true" } });
    });
    const autoSaveSelect = document.getElementById("setting-auto-save");
    if (autoSaveSelect) {
      autoSaveSelect.value = localStorage.getItem("merecode-auto-save") || "false";
      autoSaveSelect.addEventListener("change", () => {
        localStorage.setItem("merecode-auto-save", autoSaveSelect.value);
        this.editor.startAutoSave();
        this.showToast(autoSaveSelect.value === "true" ? "Auto-save enabled" : "Auto-save disabled", "info", 2e3);
      });
    }
    if (themeSelect) {
      themeSelect.value = localStorage.getItem("merecode-theme") || "mere-dark";
      themeSelect.addEventListener("change", () => {
        this.switchTheme(themeSelect.value);
      });
    }
    const systemPromptInput = document.getElementById("setting-system-prompt");
    if (systemPromptInput) {
      systemPromptInput.value = localStorage.getItem("merecode-system-prompt") || "";
      systemPromptInput.addEventListener("change", () => {
        const val = systemPromptInput.value.trim();
        if (val) localStorage.setItem("merecode-system-prompt", val);
        else localStorage.removeItem("merecode-system-prompt");
        this.showToast("System prompt saved", "success", 2e3);
      });
    }
    const formatOnSaveSelect = document.getElementById("setting-format-on-save");
    if (formatOnSaveSelect) {
      formatOnSaveSelect.value = localStorage.getItem("merecode-format-on-save") || "false";
      formatOnSaveSelect.addEventListener("change", () => {
        localStorage.setItem("merecode-format-on-save", formatOnSaveSelect.value);
        this.showToast(formatOnSaveSelect.value === "true" ? "Format on save enabled" : "Format on save disabled", "info", 2e3);
      });
    }
    const fontLigSelect = document.getElementById("setting-font-ligatures");
    if (fontLigSelect) {
      fontLigSelect.value = localStorage.getItem("merecode-font-ligatures") || "true";
      fontLigSelect.addEventListener("change", () => {
        const enabled = fontLigSelect.value === "true";
        localStorage.setItem("merecode-font-ligatures", String(enabled));
        this.editor?.editor?.updateOptions({ fontLigatures: enabled });
        this.showToast(enabled ? "Font ligatures enabled" : "Font ligatures disabled", "info", 2e3);
      });
    }
    document.getElementById("link-get-key")?.addEventListener("click", (e) => {
      e.preventDefault();
      window.merecode.app?.openExternal?.("https://merex.ai");
    });
  }
  // ─── Theme Switching ───
  _initTheme() {
    const savedTheme = localStorage.getItem("merecode-theme") || "mere-dark";
    this._applyUITheme(savedTheme);
    const themeSelect = document.getElementById("setting-theme");
    if (themeSelect) themeSelect.value = savedTheme;
    const extThemeSelect = document.getElementById("ext-theme-select");
    if (extThemeSelect) extThemeSelect.value = savedTheme;
  }
  switchTheme(themeName) {
    this.editor?.setTheme(themeName);
    this._applyUITheme(themeName);
    localStorage.setItem("merecode-theme", themeName);
    const themeSelect = document.getElementById("setting-theme");
    if (themeSelect) themeSelect.value = themeName;
    const extThemeSelect = document.getElementById("ext-theme-select");
    if (extThemeSelect) extThemeSelect.value = themeName;
  }
  _applyUITheme(themeName) {
    document.body.dataset.theme = themeName === "mere-light" ? "light" : "dark";
  }
  // ─── Quick File Open (Ctrl+P) ───
  async _loadQuickOpenFiles() {
    if (!this.rootPath) {
      this._quickOpenFiles = [];
      this._renderQuickOpenFiles([]);
      return;
    }
    const list = document.getElementById("command-list");
    list.innerHTML = '<div class="cmd-item" style="color:var(--fg-faint)">Loading files...</div>';
    this._quickOpenFiles = await window.merecode.fs.listAllFiles(this.rootPath, 2e3) || [];
    this._renderQuickOpenFiles(this._quickOpenFiles.slice(0, 30));
  }
  _filterQuickOpen(query) {
    if (!this._quickOpenFiles) return;
    const q = query.toLowerCase();
    const filtered = q ? this._quickOpenFiles.filter((f) => f.relativePath.toLowerCase().includes(q) || f.name.toLowerCase().includes(q)) : this._quickOpenFiles;
    this._renderQuickOpenFiles(filtered.slice(0, 30));
  }
  _renderQuickOpenFiles(files) {
    const list = document.getElementById("command-list");
    if (files.length === 0) {
      list.innerHTML = '<div class="cmd-item" style="color:var(--fg-faint)">No matching files</div>';
      return;
    }
    list.innerHTML = files.map(
      (f, i) => `<div class="cmd-item${i === 0 ? " active" : ""}" data-path="${this._escHtml(f.path)}">
        <span class="cmd-label">${this._escHtml(f.name)}</span>
        <span class="cmd-shortcut" style="font-size:10px">${this._escHtml(f.relativePath)}</span>
      </div>`
    ).join("");
    list.querySelectorAll(".cmd-item").forEach((el) => {
      el.addEventListener("click", () => {
        const p = el.dataset.path;
        if (p) this.editor.openFile(p);
        this.closeCommandPalette();
      });
    });
  }
  // ─── Zen Mode ───
  _initZenMode() {
    this._zenMode = false;
  }
  toggleZenMode() {
    this._zenMode = !this._zenMode;
    document.body.classList.toggle("zen-mode", this._zenMode);
    this.editor?.layout();
    if (this._zenMode) {
      let exitBtn = document.getElementById("zen-exit-btn");
      if (!exitBtn) {
        exitBtn = document.createElement("button");
        exitBtn.id = "zen-exit-btn";
        exitBtn.className = "zen-exit-btn";
        exitBtn.textContent = "Exit Zen Mode";
        exitBtn.title = "Esc or F11 to exit";
        exitBtn.addEventListener("click", () => this.toggleZenMode());
        document.body.appendChild(exitBtn);
      }
      this.showToast("Zen Mode \u2014 Press Esc or F11 to exit", "info", 3e3);
    } else {
      document.getElementById("zen-exit-btn")?.remove();
    }
  }
  // ─── Keyboard Shortcuts Help ───
  showKeyboardShortcuts() {
    let overlay = document.getElementById("shortcuts-overlay");
    if (overlay) {
      overlay.remove();
      return;
    }
    const shortcuts = [
      ["General", [
        ["Ctrl+Shift+P", "Command Palette"],
        ["Ctrl+P", "Quick Open File"],
        ["Ctrl+,", "Settings"],
        ["Ctrl+B", "Toggle Sidebar"],
        ["F11", "Zen Mode"]
      ]],
      ["Editor", [
        ["Ctrl+S", "Save"],
        ["Ctrl+N", "New File"],
        ["Ctrl+W", "Close Tab"],
        ["Ctrl+Tab", "Next Tab"],
        ["Ctrl+\\\\", "Split Editor"],
        ["Ctrl+Shift+M", "Markdown Preview"],
        ["Alt+Z", "Toggle Word Wrap"],
        ["Shift+Alt+F", "Format Document"],
        ["Ctrl+Scroll", "Zoom"]
      ]],
      ["Navigation", [
        ["Ctrl+Shift+E", "Explorer"],
        ["Ctrl+Shift+F", "Search"],
        ["Ctrl+Shift+G", "Source Control"],
        ["Ctrl+Shift+X", "Extensions"],
        ["Ctrl+Shift+O", "Outline"],
        ["Ctrl+Shift+A", "AI Chat"],
        ["Ctrl+`", "Terminal"]
      ]]
    ];
    overlay = document.createElement("div");
    overlay.id = "shortcuts-overlay";
    overlay.innerHTML = `
      <div class="shortcuts-modal">
        <div class="shortcuts-header">
          <h2>Keyboard Shortcuts</h2>
          <button class="shortcuts-close" title="Close">\u2715</button>
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
              `).join("")}
            </div>
          `).join("")}
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.querySelector(".shortcuts-close")?.addEventListener("click", () => overlay.remove());
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }
  // ─── Snippets Palette ───
  showSnippetPalette() {
    const lang = this.editor?.editor?.getModel()?.getLanguageId() || "plaintext";
    const snippets = this._getSnippets(lang);
    const origCommands = this.commands;
    this.commands = snippets.map((s) => ({
      id: `snippet.${s.name}`,
      label: `${s.name}`,
      shortcut: s.lang,
      fn: () => {
        const editor = this.editor.editor;
        if (!editor) return;
        const controller = editor.getContribution("snippetController2");
        if (controller) {
          controller.insert(s.body);
        } else {
          const pos = editor.getPosition();
          editor.executeEdits("snippet", [{
            range: new this.editor.monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
            text: s.body.replace(/\$\d+/g, "")
          }]);
        }
        this.showToast(`Inserted "${s.name}"`, "success", 1500);
      }
    }));
    this.toggleCommandPalette();
    document.getElementById("command-input").placeholder = "Select a snippet...";
    document.getElementById("command-input").value = "";
    this._renderCommands("");
    const self = this;
    const origClose = this.closeCommandPalette;
    this.closeCommandPalette = function() {
      self.commands = origCommands;
      self.closeCommandPalette = origClose;
      origClose.call(self);
    };
  }
  _getSnippets(lang) {
    const all = {
      javascript: [
        { name: "console.log", body: "console.log('$1');", lang: "JS" },
        { name: "Arrow Function", body: "const $1 = ($2) => {\n  $3\n};", lang: "JS" },
        { name: "Async Function", body: "async function $1($2) {\n  $3\n}", lang: "JS" },
        { name: "Try/Catch", body: "try {\n  $1\n} catch (err) {\n  console.error(err);\n}", lang: "JS" },
        { name: "Import", body: "import { $1 } from '$2';", lang: "JS" },
        { name: "Fetch", body: "const res = await fetch('$1');\nconst data = await res.json();", lang: "JS" },
        { name: "forEach Loop", body: "$1.forEach(($2) => {\n  $3\n});", lang: "JS" },
        { name: "Map", body: "const $1 = $2.map(($3) => {\n  return $4;\n});", lang: "JS" },
        { name: "Express Route", body: "app.get('/$1', (req, res) => {\n  res.json({ $2 });\n});", lang: "JS" },
        { name: "React Component", body: "export default function $1() {\n  return (\n    <div>\n      $2\n    </div>\n  );\n}", lang: "JSX" }
      ],
      typescript: [
        { name: "Interface", body: "interface $1 {\n  $2: $3;\n}", lang: "TS" },
        { name: "Type", body: "type $1 = {\n  $2: $3;\n};", lang: "TS" },
        { name: "Async Function (typed)", body: "async function $1($2: $3): Promise<$4> {\n  $5\n}", lang: "TS" },
        { name: "console.log", body: "console.log('$1');", lang: "TS" },
        { name: "Arrow Function", body: "const $1 = ($2: $3): $4 => {\n  $5\n};", lang: "TS" },
        { name: "Try/Catch", body: "try {\n  $1\n} catch (err) {\n  console.error(err);\n}", lang: "TS" }
      ],
      python: [
        { name: "def function", body: "def $1($2):\n    $3", lang: "PY" },
        { name: "class", body: "class $1:\n    def __init__(self, $2):\n        $3", lang: "PY" },
        { name: "if __name__", body: "if __name__ == '__main__':\n    $1", lang: "PY" },
        { name: "try/except", body: "try:\n    $1\nexcept Exception as e:\n    print(e)", lang: "PY" },
        { name: "with open", body: "with open('$1', 'r') as f:\n    $2 = f.read()", lang: "PY" },
        { name: "list comprehension", body: "[$1 for $2 in $3]", lang: "PY" },
        { name: "async def", body: "async def $1($2):\n    $3", lang: "PY" },
        { name: "FastAPI Route", body: "@app.get('/$1')\nasync def $2():\n    return {'$3': $4}", lang: "PY" }
      ],
      html: [
        { name: "HTML5 Boilerplate", body: '<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>$1</title>\n</head>\n<body>\n  $2\n</body>\n</html>', lang: "HTML" },
        { name: "Link Stylesheet", body: '<link rel="stylesheet" href="$1">', lang: "HTML" },
        { name: "Script Tag", body: '<script src="$1"><\/script>', lang: "HTML" },
        { name: "div.class", body: '<div class="$1">\n  $2\n</div>', lang: "HTML" }
      ],
      css: [
        { name: "Flexbox Center", body: "display: flex;\nalign-items: center;\njustify-content: center;", lang: "CSS" },
        { name: "Grid", body: "display: grid;\ngrid-template-columns: repeat($1, 1fr);\ngap: $2;", lang: "CSS" },
        { name: "Media Query", body: "@media (max-width: $1px) {\n  $2\n}", lang: "CSS" },
        { name: "Animation", body: "@keyframes $1 {\n  from { $2 }\n  to { $3 }\n}", lang: "CSS" }
      ]
    };
    return all[lang] || all.javascript || [];
  }
  // ─── Outline Panel ───
  _initOutlinePanel() {
    this._outlineRefreshTimer = null;
    document.getElementById("btn-refresh-outline")?.addEventListener("click", () => this.refreshOutline());
  }
  refreshOutline() {
    const container = document.getElementById("outline-list");
    if (!container) return;
    const symbols = this.editor?.getOutline() || [];
    if (symbols.length === 0) {
      container.innerHTML = '<div class="outline-empty">No symbols found</div>';
      return;
    }
    container.innerHTML = symbols.map((s) => {
      const kindClass = s.kind;
      return `<div class="outline-item outline-${kindClass}" data-line="${s.line}" title="Line ${s.line}">
        <span class="outline-icon">${s.icon}</span>
        <span class="outline-name">${this._escHtml(s.name)}</span>
        <span class="outline-line">${s.line}</span>
      </div>`;
    }).join("");
    container.querySelectorAll(".outline-item").forEach((el) => {
      el.addEventListener("click", () => {
        const line = parseInt(el.dataset.line);
        this.editor.editor?.revealLineInCenter(line);
        this.editor.editor?.setPosition({ lineNumber: line, column: 1 });
        this.editor.editor?.focus();
      });
    });
  }
  // ─── Workspace Symbol Search (Ctrl+T) ───
  async _showWorkspaceSymbolSearch() {
    if (!this.rootPath) {
      this.showToast('Open a folder first', 'warning', 2000);
      return;
    }
    const origCommands = this.commands;
    // Collect symbols from all open tabs
    const allSymbols = [];
    for (const tab of this.editor?.tabs || []) {
      if (!tab.model) continue;
      const text = tab.model.getValue();
      const lines = text.split('\n');
      const fileName = tab.name || 'untitled';
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let m;
        if ((m = line.match(/(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/)) ||
            (m = line.match(/(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[\w]+)\s*=>/)) ||
            (m = line.match(/(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/)) ||
            (m = line.match(/(?:export\s+)?(?:interface|type)\s+(\w+)/)) ||
            (m = line.match(/(?:async\s+)?def\s+(\w+)/)) ||
            (m = line.match(/(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/))) {
          allSymbols.push({
            name: m[1],
            file: fileName,
            filePath: tab.filePath,
            line: i + 1,
            kind: line.includes('class') ? 'C' : line.includes('interface') || line.includes('type ') ? 'I' : 'ƒ'
          });
        }
      }
    }

    if (allSymbols.length === 0) {
      this.showToast('No symbols found in open files', 'info', 2000);
      return;
    }

    this.commands = allSymbols.map(s => ({
      id: `sym.${s.name}.${s.line}`,
      label: `${s.kind} ${s.name}`,
      shortcut: `${s.file}:${s.line}`,
      fn: () => {
        if (s.filePath) this.editor.openFile(s.filePath);
        this.editor.editor?.revealLineInCenter(s.line);
        this.editor.editor?.setPosition({ lineNumber: s.line, column: 1 });
        this.editor.editor?.focus();
      }
    }));
    this.toggleCommandPalette();
    document.getElementById('command-input').placeholder = 'Go to Symbol in Workspace...';
    document.getElementById('command-input').value = '';
    this._renderCommands('');
    const observer = new MutationObserver(() => {
      if (!document.getElementById('command-palette')?.classList.contains('open')) {
        this.commands = origCommands;
        observer.disconnect();
      }
    });
    observer.observe(document.getElementById('command-palette'), { attributes: true, attributeFilter: ['class'] });
  }

  // ─── Problems Panel ───
  _initProblemsPanel() {
    document.getElementById('btn-refresh-problems')?.addEventListener('click', () => {
      this.editor?._updateProblems();
    });
    // Click on status-errors to open problems panel
    document.getElementById('status-errors')?.addEventListener('click', () => {
      this.switchPanel('problems');
      this.editor?._renderProblemsPanel();
    });
  }

  // ─── Extensions Panel ───
  _initExtensionsPanel() {
    document.getElementById("ext-theme-select")?.addEventListener("change", (e) => {
      this.switchTheme(e.target.value);
    });
    document.getElementById("ext-inline-completions")?.addEventListener("change", (e) => {
      const checked = e.target.checked;
      this.editor?.editor?.updateOptions({ inlineSuggest: { enabled: checked } });
      localStorage.setItem("merecode-inline-completions", String(checked));
    });
    const savedInline = localStorage.getItem("merecode-inline-completions");
    if (savedInline === "false") {
      const cb = document.getElementById("ext-inline-completions");
      if (cb) cb.checked = false;
      this.editor?.editor?.updateOptions({ inlineSuggest: { enabled: false } });
    }
  }
  _initUpdater() {
    if (!window.merecode.updater) return;
    // Init interactive status bar
    this._initStatusBarEvents();
    window.merecode.updater.onAvailable?.((info) => {
      const el = document.getElementById("status-notifications");
      if (el) {
        el.innerHTML = `<span class="status-update-badge" title="Update v${info.version} available">⬆ Update</span>`;
        el.style.cursor = "pointer";
        el.onclick = () => {
          if (confirm(`Update v${info.version} is available. Download now?`)) {
            window.merecode.updater.download();
            this.showToast("Downloading update...", "info");
          }
        };
      }
      this.showToast(`Update v${info.version} available`, "info");
    });
    window.merecode.updater.onDownloaded?.((info) => {
      const el = document.getElementById("status-notifications");
      if (el) {
        el.innerHTML = `<span class="status-update-badge ready" title="Update ready — restart to install">⟳ Restart</span>`;
        el.onclick = () => {
          if (confirm("Restart now to install the update?")) {
            window.merecode.updater.install();
          }
        };
      }
      this.showToast(`Update v${info.version} downloaded. Restart to install.`, "success");
    });
  }
  // ─── Interactive Status Bar ───
  _initStatusBar() {
    // Go to Line on position click
    document.getElementById("status-position")?.addEventListener("click", () => {
      const line = prompt("Go to Line:");
      if (line && !isNaN(parseInt(line))) {
        const lineNum = parseInt(line);
        this.editor?.editor?.revealLineInCenter(lineNum);
        this.editor?.editor?.setPosition({ lineNumber: lineNum, column: 1 });
        this.editor?.editor?.focus();
      }
    });
    // Language mode selector
    document.getElementById("status-language")?.addEventListener("click", () => {
      this._showLanguagePicker();
    });
    // Indent size selector
    document.getElementById("status-indent")?.addEventListener("click", () => {
      const sizes = [2, 4, 8];
      const current = parseInt(localStorage.getItem("merecode-tab-size") || "2");
      const next = sizes[(sizes.indexOf(current) + 1) % sizes.length];
      localStorage.setItem("merecode-tab-size", String(next));
      this.editor?.updateTabSize(next);
      document.getElementById("status-indent").textContent = `Spaces: ${next}`;
      const tabSizeSelect = document.getElementById("setting-tab-size");
      if (tabSizeSelect) tabSizeSelect.value = String(next);
    });
    // EOL selector
    document.getElementById("status-eol")?.addEventListener("click", () => {
      const model = this.editor?.editor?.getModel();
      if (!model) return;
      const eol = model.getEOL() === "\n" ? 2 : 1; // 1=LF, 2=CRLF in Monaco
      model.setEOL(eol === 1 ? 2 : 1);
      document.getElementById("status-eol").textContent = eol === 1 ? "CRLF" : "LF";
    });
  }
  _initStatusBarEvents() {}
  _showLanguagePicker() {
    const languages = this.editor?.monaco?.languages.getLanguages() || [];
    const origCommands = this.commands;
    this.commands = languages.map(lang => ({
      id: `lang.${lang.id}`,
      label: lang.aliases?.[0] || lang.id,
      shortcut: lang.id,
      fn: () => {
        const model = this.editor?.editor?.getModel();
        if (model) {
          this.editor.monaco.editor.setModelLanguage(model, lang.id);
          document.getElementById("status-language").textContent = lang.aliases?.[0] || lang.id;
        }
      }
    }));
    this.toggleCommandPalette();
    document.getElementById("command-input").placeholder = "Select Language Mode...";
    document.getElementById("command-input").value = "";
    this._renderCommands("");
    const self = this;
    const origClose = this.closeCommandPalette;
    this.closeCommandPalette = function() {
      self.commands = origCommands;
      self.closeCommandPalette = origClose;
      origClose.call(self);
    };
  }
  _aiAction(prompt) {
    if (!this.isChatOpen) this.toggleChat();
    const chatInput = document.getElementById("chat-input");
    if (chatInput) {
      chatInput.value = prompt;
      chatInput.dispatchEvent(new Event("input"));
      setTimeout(() => this.chat?.send(), 100);
    }
  }
  // ─── Custom Keybindings ───
  _keyCombo(e) {
    const parts = [];
    if (e.ctrlKey || e.metaKey) parts.push("Ctrl");
    if (e.shiftKey) parts.push("Shift");
    if (e.altKey) parts.push("Alt");
    const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    if (!["Control", "Shift", "Alt", "Meta"].includes(e.key)) parts.push(key);
    return parts.join("+");
  }
  async _loadCustomKeybinds() {
    if (!this.rootPath) return;
    try {
      const fp = window.merecode.path.join(this.rootPath, ".merecode", "keybindings.json");
      const exists = await window.merecode.fs.exists(fp);
      if (!exists) return;
      const result = await window.merecode.fs.readFile(fp);
      if (result.content) {
        const bindings = JSON.parse(result.content);
        this._customKeybinds = {};
        for (const b of bindings) {
          if (b.key && b.command) {
            this._customKeybinds[b.key] = b.command;
          }
        }
      }
    } catch {
      // No custom keybindings or parse error — use defaults
    }
  }
  async _openKeybindingsFile() {
    if (!this.rootPath) {
      this.showToast("Open a folder first to configure keybindings", "warning");
      return;
    }
    const dir = window.merecode.path.join(this.rootPath, ".merecode");
    const fp = window.merecode.path.join(dir, "keybindings.json");
    const exists = await window.merecode.fs.exists(fp);
    if (!exists) {
      await window.merecode.fs.mkdir(dir);
      const defaultBindings = JSON.stringify([
        { "key": "Ctrl+Shift+P", "command": "commandPalette", "_comment": "Open command palette" },
        { "key": "Ctrl+Shift+A", "command": "view.chat", "_comment": "Toggle AI Chat" }
      ], null, 2);
      await window.merecode.fs.writeFile(fp, defaultBindings);
    }
    this.editor.openFile(fp);
    this.showToast("Edit keybindings.json and reopen folder to apply", "info", 4e3);
  }
  // ─── Project Type Detection ───
  async _detectProjectType(rootPath) {
    const checks = [
      { file: "package.json", type: "Node.js", icon: "⬡" },
      { file: "tsconfig.json", type: "TypeScript", icon: "TS" },
      { file: "requirements.txt", type: "Python", icon: "🐍" },
      { file: "pyproject.toml", type: "Python", icon: "🐍" },
      { file: "Pipfile", type: "Python (Pipenv)", icon: "🐍" },
      { file: "Cargo.toml", type: "Rust", icon: "🦀" },
      { file: "go.mod", type: "Go", icon: "Go" },
      { file: "pom.xml", type: "Java (Maven)", icon: "☕" },
      { file: "build.gradle", type: "Java (Gradle)", icon: "☕" },
      { file: "Gemfile", type: "Ruby", icon: "💎" },
      { file: "composer.json", type: "PHP", icon: "🐘" },
      { file: "pubspec.yaml", type: "Dart/Flutter", icon: "🎯" },
      { file: "Package.swift", type: "Swift", icon: "🍎" },
      { file: ".csproj", type: ".NET", icon: "#" },
      { file: "Dockerfile", type: "Docker", icon: "🐳" },
      { file: "next.config.js", type: "Next.js", icon: "▲" },
      { file: "next.config.ts", type: "Next.js", icon: "▲" },
      { file: "nuxt.config.ts", type: "Nuxt.js", icon: "N" },
      { file: "vite.config.ts", type: "Vite", icon: "⚡" },
      { file: "vite.config.js", type: "Vite", icon: "⚡" },
    ];
    const detected = [];
    for (const check of checks) {
      try {
        const fp = window.merecode.path.join(rootPath, check.file);
        const exists = await window.merecode.fs.exists(fp);
        if (exists) detected.push(check);
      } catch {}
    }
    const statusEl = document.getElementById("status-project-type");
    if (statusEl && detected.length > 0) {
      const primary = detected[0];
      statusEl.textContent = `${primary.icon} ${primary.type}`;
      statusEl.title = `Project: ${detected.map(d => d.type).join(", ")}`;
      statusEl.style.display = "inline-flex";
    } else if (statusEl) {
      statusEl.style.display = "none";
    }
  }
}
const mereCode = new MereCodeApp();
document.addEventListener("DOMContentLoaded", () => mereCode.init());
export {
  MereCodeApp
};
//# sourceMappingURL=app.js.map
