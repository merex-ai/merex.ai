class GitManager {
  constructor(app) {
    this.files = [];
    this.branch = "";
    this.ahead = 0;
    this.behind = 0;
    this._refreshTimer = null;
    this.app = app;
    this.changesEl = document.getElementById("git-changes");
    this.commitInput = document.getElementById("commit-message");
    document.getElementById("btn-commit")?.addEventListener("click", () => this.commit());
    document.getElementById("btn-git-push")?.addEventListener("click", () => this.push());
    document.getElementById("btn-git-pull")?.addEventListener("click", () => this.pull());
    document.getElementById("btn-git-refresh")?.addEventListener("click", () => this.refresh());
    document.getElementById("btn-git-stash")?.addEventListener("click", () => this.stash());
    document.getElementById("btn-git-stash-pop")?.addEventListener("click", () => this.stashPop());
    document.getElementById("btn-stage-all")?.addEventListener("click", () => this.stageAll());
    document.getElementById("btn-git-blame")?.addEventListener("click", () => {
      const filePath = this.app.editor?.tabs?.find((t) => t.id === this.app.editor.activeTabId)?.filePath;
      if (filePath) this.showBlame(filePath);
      else this.app.showToast("No file open to blame", "warning");
    });
    document.getElementById("btn-git-graph")?.addEventListener("click", () => this.showGraph());
    document.getElementById("btn-git-review")?.addEventListener("click", () => this.aiCodeReview());
    document.getElementById("btn-git-file-log")?.addEventListener("click", () => {
      const filePath = this.app.editor?.tabs?.find((t) => t.id === this.app.editor.activeTabId)?.filePath;
      if (filePath) this.showFileLog(filePath);
      else this.app.showToast("No file open for history", "warning");
    });
    document.getElementById("git-branch-select")?.addEventListener("click", () => this.showBranchPicker());
  }
  async refresh() {
    if (!this.app.rootPath) return;
    try {
      const status = await window.merecode.git.status(this.app.rootPath);
      if (status.error) {
        this._renderNoGit(status.error);
        return;
      }
      this.branch = status.branch || "unknown";
      this.files = status.files || [];
      this.ahead = status.ahead || 0;
      this.behind = status.behind || 0;
      this._render();
      this._updateStatusBar();
    } catch (err) {
      this._renderNoGit(err.message);
    }
  }
  _updateStatusBar() {
    const branchEl = document.getElementById("status-branch");
    if (branchEl) {
      let text = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="4" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="7" r="2"/><path d="M5 6v4M7 12h3c1.1 0 2-.9 2-2V7" fill="none" stroke="currentColor" stroke-width="1.2"/></svg> ${this._esc(this.branch)}`;
      if (this.ahead > 0) text += ` \u2191${this.ahead}`;
      if (this.behind > 0) text += ` \u2193${this.behind}`;
      branchEl.innerHTML = text;
    }
  }
  _renderNoGit(msg) {
    if (this.changesEl) {
      this.changesEl.innerHTML = `<div class="git-no-repo"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"><circle cx="12" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M12 8.5V15.5"/><path d="M14.5 7.5L16 9.5"/></svg><p>Not a Git repository</p></div>`;
    }
  }
  _render() {
    if (!this.changesEl) return;
    const staged = this.files.filter((f) => f.index && f.index !== " " && f.index !== "?");
    const unstaged = this.files.filter((f) => f.working_dir && f.working_dir !== " ");
    const untracked = this.files.filter((f) => f.index === "?" || f.working_dir === "?");
    let html = `<div class="git-branch-info">
      <span class="git-branch-name" id="git-branch-select" title="Switch branch">${this._esc(this.branch)}</span>
      ${this.ahead > 0 ? `<span class="git-sync-badge">\u2191${this.ahead}</span>` : ""}
      ${this.behind > 0 ? `<span class="git-sync-badge">\u2193${this.behind}</span>` : ""}
    </div>`;
    if (staged.length > 0) {
      html += `<div class="git-section"><div class="git-section-title">Staged Changes <span class="git-count">${staged.length}</span></div>`;
      for (const f of staged) html += this._renderFileItem(f, true);
      html += `</div>`;
    }
    const changes = [...unstaged, ...untracked.filter((f) => !unstaged.find((u) => u.path === f.path))];
    if (changes.length > 0) {
      html += `<div class="git-section"><div class="git-section-title">Changes <span class="git-count">${changes.length}</span></div>`;
      for (const f of changes) html += this._renderFileItem(f, false);
      html += `</div>`;
    }
    if (staged.length === 0 && changes.length === 0) {
      html += `<div class="git-clean"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><p>Working tree clean</p></div>`;
    }
    html += `<div class="git-section git-log-section"><div class="git-section-title git-log-toggle">Recent Commits</div><div class="git-log-list" id="git-log-list"></div></div>`;
    this.changesEl.innerHTML = html;
    this._bindFileActions();
    this._loadLog();
    document.getElementById("git-branch-select")?.addEventListener("click", () => this.showBranchPicker());
  }
  _renderFileItem(f, isStaged) {
    const fileName = this._esc(f.path.split("/").pop());
    const filePath = this._esc(f.path);
    const statusChar = isStaged ? f.index : f.working_dir === "?" ? "U" : f.working_dir;
    const safeStatus = this._esc(statusChar);
    const statusClass = { "M": "modified", "A": "added", "D": "deleted", "U": "untracked", "?": "untracked", "R": "renamed" }[statusChar] || "modified";
    return `<div class="git-file ${statusClass}" data-path="${filePath}" data-staged="${isStaged}">
      <span class="git-file-status">${safeStatus}</span>
      <span class="git-file-name" title="${filePath}">${fileName}</span>
      <span class="git-file-path">${filePath}</span>
      <div class="git-file-actions">
        ${isStaged ? `<button class="git-file-btn" data-action="unstage" title="Unstage">\u2212</button>` : `<button class="git-file-btn" data-action="stage" title="Stage">+</button><button class="git-file-btn" data-action="discard" title="Discard changes">\u21BA</button>`}
      </div>
    </div>`;
  }
  _bindFileActions() {
    this.changesEl.querySelectorAll(".git-file-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const fileEl = btn.closest(".git-file");
        const filePath = fileEl.dataset.path;
        const action = btn.dataset.action;
        if (action === "stage") {
          const result = await window.merecode.git.add(this.app.rootPath, [filePath]);
          if (result.error) this.app.showToast(`Stage failed: ${result.error}`, "error");
          this.refresh();
        } else if (action === "unstage") {
          const result = await window.merecode.git.unstage(this.app.rootPath, [filePath]);
          if (result.error) this.app.showToast(`Unstage failed: ${result.error}`, "error");
          this.refresh();
        } else if (action === "discard") {
          if (confirm(`Discard changes to "${filePath}"?`)) {
            const result = await window.merecode.git.discardFile(this.app.rootPath, filePath);
            if (result.error) this.app.showToast(`Discard failed: ${result.error}`, "error");
            this.refresh();
          }
        }
      });
    });
    this.changesEl.querySelectorAll(".git-file").forEach((el) => {
      el.addEventListener("click", async () => {
        const htmlEl = el;
        const filePath = htmlEl.dataset.path;
        const isStaged = htmlEl.dataset.staged === "true";
        const fullPath = window.merecode.path.join(this.app.rootPath, filePath);
        await this._showFileDiff(filePath, fullPath, isStaged);
      });
    });
    this.changesEl.querySelector(".git-log-toggle")?.addEventListener("click", () => {
      const list = document.getElementById("git-log-list");
      if (list) list.style.display = list.style.display === "none" ? "" : "none";
    });
  }
  async _showFileDiff(relPath, fullPath, isStaged) {
    try {
      const diffResult = isStaged ? await window.merecode.git.diffStaged(this.app.rootPath, relPath) : await window.merecode.git.diff(this.app.rootPath, relPath);
      if (diffResult.error) {
        this.app.showToast(`Diff failed: ${diffResult.error}`, "error");
        return;
      }
      const currentFile = await window.merecode.fs.readFile(fullPath);
      const currentContent = currentFile.error ? "" : currentFile.content || "";
      const originalContent = this._reconstructOriginal(currentContent, diffResult.diff || "");
      const hunks = isStaged ? [] : this._parseHunks(diffResult.diff || "", relPath);
      this._showDiffModal(relPath, originalContent, currentContent, hunks);
    } catch {
      this.app.editor.openFile(fullPath);
    }
  }
  // Parse diff into individual hunks for hunk-level staging
  _parseHunks(diffText, filePath) {
    if (!diffText || !diffText.trim()) return [];
    const lines = diffText.split('\n');
    const hunks = [];
    let headerLines = [];
    let currentHunk = null;

    for (const line of lines) {
      if (line.startsWith('diff --git') || line.startsWith('index ') || line.startsWith('---') || line.startsWith('+++') || line.startsWith('new file') || line.startsWith('old mode') || line.startsWith('new mode')) {
        headerLines.push(line);
      } else if (line.startsWith('@@')) {
        if (currentHunk) {
          hunks.push(currentHunk);
        }
        currentHunk = {
          header: line,
          lines: [line],
          headerLines: [...headerLines],
          filePath: filePath,
          additions: 0,
          deletions: 0
        };
      } else if (currentHunk) {
        currentHunk.lines.push(line);
        if (line.startsWith('+')) currentHunk.additions++;
        else if (line.startsWith('-')) currentHunk.deletions++;
      }
    }
    if (currentHunk) hunks.push(currentHunk);
    return hunks;
  }
  // Build a patch for a single hunk
  _buildHunkPatch(hunk) {
    const patch = [...hunk.headerLines, ...hunk.lines].join('\n') + '\n';
    return patch;
  }
  _reconstructOriginal(current, diffText) {
    if (!diffText || !diffText.trim()) return current;
    const lines = diffText.split("\n");
    const hasNewFile = lines.some((l) => l.startsWith("new file"));
    if (hasNewFile) return "";
    const original = [];
    let inHunk = false;
    for (const line of lines) {
      if (line.startsWith("@@")) {
        inHunk = true;
        continue;
      }
      if (!inHunk) continue;
      if (line.startsWith("-")) {
        original.push(line.slice(1));
      } else if (line.startsWith("+")) {
      } else if (line.startsWith(" ")) {
        original.push(line.slice(1));
      }
    }
    return original.length > 0 ? original.join("\n") : current;
  }
  _showDiffModal(fileName, originalContent, modifiedContent, hunks = []) {
    const modal = document.createElement("div");
    modal.className = "diff-modal-overlay";
    const hunkButtons = hunks.length > 0 ? hunks.map((h, i) => 
      `<button class="btn-small btn-hunk-stage" data-hunk="${i}" title="Stage this hunk (+${h.additions}/-${h.deletions})">Stage Hunk ${i + 1}</button>`
    ).join(' ') : '';
    modal.innerHTML = `
      <div class="diff-modal">
        <div class="diff-modal-header">
          <span class="diff-modal-title">Diff: ${this._esc(fileName)}</span>
          <div class="diff-modal-actions">
            ${hunkButtons}
            <button class="btn-small" id="diff-close-btn">Close</button>
          </div>
        </div>
        <div id="diff-editor-container" class="diff-editor-container"></div>
      </div>
    `;
    document.body.appendChild(modal);
    const diffContainer = document.getElementById("diff-editor-container");
    const monaco = this.app.editor.monaco;
    const ext = window.merecode.path.extname(fileName);
    const lang = this.app.editor._langFromExt(ext);
    const originalModel = monaco.editor.createModel(originalContent, lang);
    const modifiedModel = monaco.editor.createModel(modifiedContent, lang);
    const diffEditor = monaco.editor.createDiffEditor(diffContainer, {
      theme: this.app.editor._currentTheme,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: true,
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true
    });
    diffEditor.setModel({ original: originalModel, modified: modifiedModel });
    const cleanup = () => {
      diffEditor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
      modal.remove();
    };
    document.getElementById("diff-close-btn")?.addEventListener("click", cleanup);
    // Hunk-level staging buttons
    modal.querySelectorAll('.btn-hunk-stage').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.hunk);
        const hunk = hunks[idx];
        if (!hunk) return;
        const patch = this._buildHunkPatch(hunk);
        const result = await window.merecode.git.stageHunk(this.app.rootPath, patch);
        if (result.error) {
          this.app.showToast(`Stage hunk failed: ${result.error}`, 'error');
        } else {
          this.app.showToast(`Hunk ${idx + 1} staged`, 'success', 1500);
          btn.disabled = true;
          btn.textContent = `Hunk ${idx + 1} ✓`;
          this.refresh();
        }
      });
    });
    modal.addEventListener("click", (e) => {
      if (e.target === modal) cleanup();
    });
    document.addEventListener("keydown", function handler(e) {
      if (e.key === "Escape") {
        cleanup();
        document.removeEventListener("keydown", handler);
      }
    });
  }
  async _loadLog() {
    const logEl = document.getElementById("git-log-list");
    if (!logEl || !this.app.rootPath) return;
    try {
      const logs = await window.merecode.git.log(this.app.rootPath);
      if (Array.isArray(logs) && logs.length > 0) {
        logEl.innerHTML = logs.slice(0, 20).map((c) => `
          <div class="git-commit" title="${this._esc(c.message)}">
            <span class="git-commit-hash">${this._esc(c.hash)}</span>
            <span class="git-commit-msg">${this._esc(c.message.substring(0, 60))}</span>
            <span class="git-commit-author">${this._esc(c.author)}</span>
          </div>
        `).join("");
      } else {
        logEl.innerHTML = '<div class="git-no-commits">No commits yet</div>';
      }
    } catch {
      logEl.innerHTML = "";
    }
  }
  async stageAll() {
    if (!this.app.rootPath) return;
    const result = await window.merecode.git.add(this.app.rootPath, ["."]);
    if (result.error) {
      this.app.showToast(`Stage all failed: ${result.error}`, "error");
    } else {
      this.app.showToast("All changes staged", "success", 2e3);
    }
    this.refresh();
  }
  async commit() {
    const message = this.commitInput?.value.trim();
    if (!message) {
      this.app.showToast("Please enter a commit message", "warning");
      this.commitInput?.focus();
      return;
    }
    if (!this.app.rootPath) return;
    const result = await window.merecode.git.commit(this.app.rootPath, message);
    if (result.error) {
      this.app.showToast(`Commit failed: ${result.error}`, "error");
    } else {
      this.commitInput.value = "";
      this.app.showToast(`Committed: ${message.substring(0, 50)}`, "success");
      this.refresh();
    }
  }
  async push() {
    if (!this.app.rootPath) return;
    this.app.showToast("Pushing...", "info", 2e3);
    const result = await window.merecode.git.push(this.app.rootPath);
    if (result.error) {
      this.app.showToast(`Push failed: ${result.error}`, "error");
    } else {
      this.app.showToast("Pushed successfully", "success");
      this.refresh();
    }
  }
  async pull() {
    if (!this.app.rootPath) return;
    this.app.showToast("Pulling...", "info", 2e3);
    const result = await window.merecode.git.pull(this.app.rootPath);
    if (result.error) {
      this.app.showToast(`Pull failed: ${result.error}`, "error");
    } else {
      this.app.showToast("Pull completed", "success");
      this.refresh();
      this.app.fileExplorer?.refresh();
    }
  }
  async stash() {
    if (!this.app.rootPath) return;
    const result = await window.merecode.git.stash(this.app.rootPath);
    if (result.error) {
      this.app.showToast(`Stash failed: ${result.error}`, "error");
    } else {
      this.app.showToast("Changes stashed", "success");
      this.refresh();
    }
  }
  async stashPop() {
    if (!this.app.rootPath) return;
    const result = await window.merecode.git.stashPop(this.app.rootPath);
    if (result.error) {
      this.app.showToast(`Stash pop failed: ${result.error}`, "error");
    } else {
      this.app.showToast("Stash applied", "success");
      this.refresh();
    }
  }
  async showBranchPicker() {
    if (!this.app.rootPath) return;
    const branches = await window.merecode.git.branches(this.app.rootPath);
    if (branches.error) {
      this.app.showToast(`Branch list failed: ${branches.error}`, "error");
      return;
    }
    const bData = branches;
    const app = this.app;
    const origCommands = app.commands;
    const branchCommands = bData.all.filter((b) => !b.startsWith("remotes/")).map((b) => ({
      id: `git.branch.${b}`,
      label: `${b === bData.current ? "\u25CF " : "  "}${b}`,
      shortcut: b === bData.current ? "current" : "",
      fn: async () => {
        if (b === bData.current) return;
        const r = await window.merecode.git.checkout(app.rootPath, b);
        if (r.error) app.showToast(`Checkout failed: ${r.error}`, "error");
        else {
          app.showToast(`Switched to ${b}`, "success");
          this.refresh();
          app.fileExplorer?.refresh();
        }
      }
    }));
    branchCommands.push({
      id: "git.branch.new",
      label: "+ Create new branch...",
      shortcut: "",
      fn: async () => {
        const name = prompt("New branch name:");
        if (!name) return;
        const r = await window.merecode.git.createBranch(app.rootPath, name);
        if (r.error) app.showToast(`Create branch failed: ${r.error}`, "error");
        else {
          app.showToast(`Created & switched to ${name}`, "success");
          this.refresh();
        }
      }
    });
    app.commands = branchCommands;
    app.toggleCommandPalette();
    document.getElementById("command-input").placeholder = "Switch branch...";
    document.getElementById("command-input").value = "";
    app._renderCommands("");
    const observer = new MutationObserver(() => {
      if (!document.getElementById("command-palette")?.classList.contains("open")) {
        app.commands = origCommands;
        observer.disconnect();
      }
    });
    observer.observe(document.getElementById("command-palette"), { attributes: true, attributeFilter: ["class"] });
  }
  async showGraph() {
    if (!this.app.rootPath) return;
    const result = await window.merecode.git.graph(this.app.rootPath);
    if (result.error) {
      this.app.showToast(`Graph failed: ${result.error}`, "error");
      return;
    }
    this._showGraphModal(result.graph || "");
  }
  _showGraphModal(graphText) {
    const modal = document.createElement("div");
    modal.className = "diff-modal-overlay";
    modal.innerHTML = `
      <div class="diff-modal graph-modal">
        <div class="diff-modal-header">
          <span class="diff-modal-title">Git Graph</span>
          <div class="diff-modal-actions">
            <button class="btn-small" id="graph-close-btn">Close</button>
          </div>
        </div>
        <div class="graph-container">
          <pre class="graph-pre">${this._colorizeGraph(this._esc(graphText))}</pre>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const cleanup = () => modal.remove();
    document.getElementById("graph-close-btn")?.addEventListener("click", cleanup);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) cleanup();
    });
    document.addEventListener("keydown", function h(e) {
      if (e.key === "Escape") {
        cleanup();
        document.removeEventListener("keydown", h);
      }
    });
  }
  _colorizeGraph(escaped) {
    return escaped.replace(/\|/g, '<span class="gg-pipe">|</span>').replace(/\*/g, '<span class="gg-commit">*</span>').replace(/\\(?!n)/g, '<span class="gg-line">\\</span>').replace(/\//g, '<span class="gg-line">/</span>').replace(/(HEAD -&gt; )([^,&\s]+)/g, '$1<span class="gg-head">$2</span>').replace(/origin\/([^\s,)&]+)/g, '<span class="gg-origin">origin/$1</span>');
  }
  async showFileLog(filePath) {
    if (!this.app.rootPath) return;
    const relPath = filePath.replace(/\\/g, "/").replace(this.app.rootPath.replace(/\\/g, "/") + "/", "");
    const logs = await window.merecode.git.fileLog(this.app.rootPath, relPath);
    if (logs.error) {
      this.app.showToast(`History failed: ${logs.error}`, "error");
      return;
    }
    this._showFileLogModal(relPath, logs);
  }
  _showFileLogModal(fileName, logs) {
    const modal = document.createElement("div");
    modal.className = "diff-modal-overlay";
    const rows = logs.map(
      (c) => `<tr class="blame-row" data-hash="${this._esc(c.fullHash || "")}">
        <td class="blame-hash">${this._esc(c.hash)}</td>
        <td class="blame-author">${this._esc(c.author)}</td>
        <td class="blame-date">${this._esc(c.date ? c.date.slice(0, 10) : "")}</td>
        <td class="blame-code">${this._esc(c.message)}</td>
        <td><button class="btn-small file-log-diff-btn" data-hash="${this._esc(c.fullHash || "")}">Diff</button></td>
      </tr>`
    ).join("");
    modal.innerHTML = `
      <div class="diff-modal blame-modal">
        <div class="diff-modal-header">
          <span class="diff-modal-title">History: ${this._esc(fileName)}</span>
          <div class="diff-modal-actions">
            <button class="btn-small" id="file-log-close">Close</button>
          </div>
        </div>
        <div class="blame-container">
          <table class="blame-table">
            <thead><tr>
              <th class="blame-hash">Commit</th>
              <th class="blame-author">Author</th>
              <th class="blame-date">Date</th>
              <th class="blame-code">Message</th>
              <th></th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const cleanup = () => modal.remove();
    document.getElementById("file-log-close")?.addEventListener("click", cleanup);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) cleanup();
    });
  }
  async checkAndShowConflicts() {
    if (!this.app.rootPath) return;
    const result = await window.merecode.git.getConflicts(this.app.rootPath);
    if (result.error || !result.files?.length) return;
    this.app.showToast(`${result.files.length} merge conflict${result.files.length > 1 ? "s" : ""} \u2014 click Git panel to resolve`, "warning", 6e3);
    this._renderConflictBanner(result.files);
  }
  _renderConflictBanner(files) {
    const existing = document.getElementById("conflict-banner");
    if (existing) existing.remove();
    const banner = document.createElement("div");
    banner.id = "conflict-banner";
    banner.className = "conflict-banner";
    banner.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 16 16" fill="#ef4444"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7.5 4h1v5h-1V4zm.5 8a.75.75 0 110-1.5.75.75 0 010 1.5z"/></svg>
      <span><strong>${files.length} merge conflict${files.length > 1 ? "s" : ""}</strong> \u2014 ${files.map((f) => this._esc(f)).join(", ")}</span>
      <button class="btn-small btn-danger" id="btn-resolve-conflicts">Resolve</button>
      <button class="conflict-banner-close">\xD7</button>
    `;
    document.getElementById("editor-container")?.prepend(banner);
    document.getElementById("btn-resolve-conflicts")?.addEventListener("click", () => this.showConflictResolver(files));
    banner.querySelector(".conflict-banner-close")?.addEventListener("click", () => banner.remove());
  }
  async showConflictResolver(files) {
    if (!files) {
      const result = await window.merecode.git.getConflicts(this.app.rootPath);
      if (result.error || !result.files?.length) {
        this.app.showToast("No conflicts found", "success", 2e3);
        return;
      }
      files = result.files;
    }
    const filePath = files[0];
    const fullPath = window.merecode.path.join(this.app.rootPath, filePath);
    const fileResult = await window.merecode.fs.readFile(fullPath);
    if (fileResult.error) return;
    this._showConflictModal(filePath, fullPath, fileResult.content || "", files);
  }
  _showConflictModal(relPath, fullPath, content, allFiles) {
    const sections = this._parseConflicts(content);
    const modal = document.createElement("div");
    modal.className = "diff-modal-overlay";
    modal.innerHTML = `
      <div class="diff-modal conflict-modal">
        <div class="diff-modal-header">
          <span class="diff-modal-title">Resolve Conflicts: ${this._esc(relPath)}</span>
          <div class="diff-modal-actions">
            ${allFiles.length > 1 ? `<span class="conflict-count">${allFiles.length} files</span>` : ""}
            <button class="btn-small btn-primary" id="conflict-accept-all-ours">Accept Ours</button>
            <button class="btn-small btn-primary" id="conflict-accept-all-theirs">Accept Theirs</button>
            <button class="btn-small" id="conflict-close">Cancel</button>
          </div>
        </div>
        <div class="conflict-panels">
          <div class="conflict-panel conflict-ours">
            <div class="conflict-panel-label">Ours (HEAD)</div>
            <div id="conflict-ours-editor" class="conflict-editor-pane"></div>
          </div>
          <div class="conflict-panel conflict-theirs">
            <div class="conflict-panel-label">Theirs (Incoming)</div>
            <div id="conflict-theirs-editor" class="conflict-editor-pane"></div>
          </div>
        </div>
        <div class="conflict-result-panel">
          <div class="conflict-panel-label">
            Result (editable)
            <button class="btn-small btn-primary" id="conflict-apply" style="margin-left:8px;">Apply & Stage</button>
          </div>
          <div id="conflict-result-editor" class="conflict-result-pane"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const monaco = this.app.editor.monaco;
    const ext = window.merecode.path.extname(relPath);
    const lang = this.app.editor._langFromExt(ext);
    const oursContent = sections.map((s) => s.ours).join("\n");
    const theirsContent = sections.map((s) => s.theirs).join("\n");
    const resultContent = content.replace(/^<<<<<<< .+$/gm, "").replace(/^=======$\n/gm, "").replace(/^>>>>>>> .+$/gm, "");
    const oursModel = monaco.editor.createModel(oursContent, lang);
    const theirsModel = monaco.editor.createModel(theirsContent, lang);
    const resultModel = monaco.editor.createModel(resultContent, lang);
    const opts = { theme: this.app.editor._currentTheme, readOnly: true, minimap: { enabled: false }, fontSize: 12, scrollBeyondLastLine: false, automaticLayout: true };
    monaco.editor.create(document.getElementById("conflict-ours-editor"), { ...opts, model: oursModel });
    monaco.editor.create(document.getElementById("conflict-theirs-editor"), { ...opts, model: theirsModel });
    monaco.editor.create(document.getElementById("conflict-result-editor"), { ...opts, readOnly: false, model: resultModel });
    const cleanup = () => {
      modal.remove();
    };
    document.getElementById("conflict-close")?.addEventListener("click", cleanup);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) cleanup();
    });
    document.getElementById("conflict-accept-all-ours")?.addEventListener("click", () => {
      resultModel.setValue(oursContent);
      this.app.showToast("Using our version", "info", 1500);
    });
    document.getElementById("conflict-accept-all-theirs")?.addEventListener("click", () => {
      resultModel.setValue(theirsContent);
      this.app.showToast("Using their version", "info", 1500);
    });
    document.getElementById("conflict-apply")?.addEventListener("click", async () => {
      const resolved = resultModel.getValue();
      const result = await window.merecode.git.resolveConflict(this.app.rootPath, relPath, resolved);
      if (result.error) {
        this.app.showToast(`Resolve failed: ${result.error}`, "error");
        return;
      }
      this.app.showToast(`Resolved ${relPath}`, "success");
      cleanup();
      document.getElementById("conflict-banner")?.remove();
      this.refresh();
      this.app.editor.openFile(fullPath);
    });
  }
  _parseConflicts(content) {
    const sections = [];
    const conflictRegex = /^<<<<<<< .+\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>> .+$/gm;
    let match;
    while ((match = conflictRegex.exec(content)) !== null) {
      sections.push({ ours: match[1], theirs: match[2] });
    }
    return sections.length > 0 ? sections : [{ ours: content, theirs: content }];
  }
  async aiCodeReview() {
    if (!this.app.rootPath) return;
    const diff = await window.merecode.git.diff(this.app.rootPath, "");
    if (diff.error || !diff.diff?.trim()) {
      this.app.showToast("No unstaged changes to review", "warning");
      return;
    }
    if (!this.app.isChatOpen) this.app.toggleChat();
    const reviewPrompt = `Please review the following git diff for bugs, security issues, code quality, and best practices. Provide specific, actionable feedback:

\`\`\`diff
${diff.diff.slice(0, 8e3)}
\`\`\``;
    const chatInput = document.getElementById("chat-input");
    if (chatInput) {
      chatInput.value = reviewPrompt;
      chatInput.dispatchEvent(new Event("input"));
      setTimeout(() => this.app.chat?.send(), 100);
    }
  }
  async showBlame(filePath) {
    if (!this.app.rootPath || !filePath) return;
    const relPath = filePath.replace(/\\/g, "/").replace(this.app.rootPath.replace(/\\/g, "/") + "/", "");
    const result = await window.merecode.git.blame(this.app.rootPath, relPath);
    if (result.error) {
      this.app.showToast(`Blame failed: ${result.error}`, "error");
      return;
    }
    const parsed = this._parseBlame(result.blame || "");
    this._showBlameModal(relPath, parsed);
  }
  _parseBlame(raw) {
    if (!raw) return [];
    const lines = raw.split("\n");
    const result = [];
    let current = {};
    for (const line of lines) {
      if (/^[0-9a-f]{40}/.test(line)) {
        const parts = line.split(" ");
        current = { hash: parts[0].slice(0, 8) };
      } else if (line.startsWith("author ")) {
        current.author = line.slice(7).trim();
      } else if (line.startsWith("author-time ")) {
        const ts = parseInt(line.slice(12));
        const d = new Date(ts * 1e3);
        current.date = d.toLocaleDateString();
      } else if (line.startsWith("summary ")) {
        current.summary = line.slice(8).trim().substring(0, 50);
      } else if (line.startsWith("	")) {
        result.push({ ...current, text: line.slice(1) });
        current = {};
      }
    }
    return result;
  }
  _showBlameModal(fileName, blame) {
    const modal = document.createElement("div");
    modal.className = "diff-modal-overlay";
    const rows = blame.map(
      (b, i) => `<tr class="blame-row">
        <td class="blame-line">${i + 1}</td>
        <td class="blame-hash" title="${this._esc(b.summary || "")}">${this._esc(b.hash || "")}</td>
        <td class="blame-author">${this._esc(b.author || "")}</td>
        <td class="blame-date">${this._esc(b.date || "")}</td>
        <td class="blame-code">${this._esc(b.text || "")}</td>
      </tr>`
    ).join("");
    modal.innerHTML = `
      <div class="diff-modal blame-modal">
        <div class="diff-modal-header">
          <span class="diff-modal-title">Blame: ${this._esc(fileName)}</span>
          <div class="diff-modal-actions">
            <button class="btn-small" id="blame-close-btn">Close</button>
          </div>
        </div>
        <div class="blame-container">
          <table class="blame-table">
            <thead><tr>
              <th class="blame-line">#</th>
              <th class="blame-hash">Commit</th>
              <th class="blame-author">Author</th>
              <th class="blame-date">Date</th>
              <th class="blame-code">Code</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    const cleanup = () => modal.remove();
    document.getElementById("blame-close-btn")?.addEventListener("click", cleanup);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) cleanup();
    });
    document.addEventListener("keydown", function handler(e) {
      if (e.key === "Escape") {
        cleanup();
        document.removeEventListener("keydown", handler);
      }
    });
  }
  _esc(s) {
    return s ? s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") : "";
  }
}
export {
  GitManager
};
//# sourceMappingURL=gitManager.js.map
