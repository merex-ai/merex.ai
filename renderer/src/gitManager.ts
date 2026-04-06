// gitManager.ts — Full Git GUI with diff viewer, blame, XSS-safe rendering
import type { MereCodeApp } from './app.js';

export class GitManager {
  app: MereCodeApp;
  files: GitFile[] = [];
  branch = '';
  ahead = 0;
  behind = 0;
  private _refreshTimer: ReturnType<typeof setTimeout> | null = null;

  private changesEl: HTMLElement | null;
  private commitInput: HTMLInputElement | null;

  constructor(app: MereCodeApp) {
    this.app = app;
    this.changesEl = document.getElementById('git-changes');
    this.commitInput = document.getElementById('commit-message') as HTMLInputElement | null;

    document.getElementById('btn-commit')?.addEventListener('click', () => this.commit());
    document.getElementById('btn-git-push')?.addEventListener('click', () => this.push());
    document.getElementById('btn-git-pull')?.addEventListener('click', () => this.pull());
    document.getElementById('btn-git-refresh')?.addEventListener('click', () => this.refresh());
    document.getElementById('btn-git-stash')?.addEventListener('click', () => this.stash());
    document.getElementById('btn-git-stash-pop')?.addEventListener('click', () => this.stashPop());
    document.getElementById('btn-stage-all')?.addEventListener('click', () => this.stageAll());
    document.getElementById('btn-git-blame')?.addEventListener('click', () => {
      const filePath = this.app.editor?.tabs?.find(t => t.id === this.app.editor.activeTabId)?.filePath;
      if (filePath) this.showBlame(filePath);
      else this.app.showToast('No file open to blame', 'warning');
    });
    document.getElementById('btn-git-graph')?.addEventListener('click', () => this.showGraph());
    document.getElementById('btn-git-review')?.addEventListener('click', () => this.aiCodeReview());
    document.getElementById('btn-git-file-log')?.addEventListener('click', () => {
      const filePath = this.app.editor?.tabs?.find(t => t.id === this.app.editor.activeTabId)?.filePath;
      if (filePath) this.showFileLog(filePath);
      else this.app.showToast('No file open for history', 'warning');
    });

    document.getElementById('git-branch-select')?.addEventListener('click', () => this.showBranchPicker());
  }

  async refresh(): Promise<void> {
    if (!this.app.rootPath) return;
    try {
      const status = await window.merecode.git.status(this.app.rootPath);
      if (status.error) {
        this._renderNoGit(status.error);
        return;
      }
      this.branch = status.branch || 'unknown';
      this.files = status.files || [];
      this.ahead = status.ahead || 0;
      this.behind = status.behind || 0;
      this._render();
      this._updateStatusBar();
    } catch (err: any) {
      this._renderNoGit(err.message);
    }
  }

  private _updateStatusBar(): void {
    const branchEl = document.getElementById('status-branch');
    if (branchEl) {
      let text = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><circle cx="5" cy="4" r="2"/><circle cx="5" cy="12" r="2"/><circle cx="12" cy="7" r="2"/><path d="M5 6v4M7 12h3c1.1 0 2-.9 2-2V7" fill="none" stroke="currentColor" stroke-width="1.2"/></svg> ${this._esc(this.branch)}`;
      if (this.ahead > 0) text += ` ↑${this.ahead}`;
      if (this.behind > 0) text += ` ↓${this.behind}`;
      branchEl.innerHTML = text;
    }
  }

  private _renderNoGit(msg: string): void {
    if (this.changesEl) {
      this.changesEl.innerHTML = `<div class="git-no-repo"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3"><circle cx="12" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M12 8.5V15.5"/><path d="M14.5 7.5L16 9.5"/></svg><p>Not a Git repository</p></div>`;
    }
  }

  private _render(): void {
    if (!this.changesEl) return;

    const staged = this.files.filter(f => f.index && f.index !== ' ' && f.index !== '?');
    const unstaged = this.files.filter(f => f.working_dir && f.working_dir !== ' ');
    const untracked = this.files.filter(f => f.index === '?' || f.working_dir === '?');

    let html = `<div class="git-branch-info">
      <span class="git-branch-name" id="git-branch-select" title="Switch branch">${this._esc(this.branch)}</span>
      ${this.ahead > 0 ? `<span class="git-sync-badge">↑${this.ahead}</span>` : ''}
      ${this.behind > 0 ? `<span class="git-sync-badge">↓${this.behind}</span>` : ''}
    </div>`;

    if (staged.length > 0) {
      html += `<div class="git-section"><div class="git-section-title">Staged Changes <span class="git-count">${staged.length}</span></div>`;
      for (const f of staged) html += this._renderFileItem(f, true);
      html += `</div>`;
    }

    const changes = [...unstaged, ...untracked.filter(f => !unstaged.find(u => u.path === f.path))];
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

    document.getElementById('git-branch-select')?.addEventListener('click', () => this.showBranchPicker());
  }

  private _renderFileItem(f: GitFile, isStaged: boolean): string {
    const fileName = this._esc(f.path.split('/').pop()!);
    const filePath = this._esc(f.path);
    const statusChar = isStaged ? f.index : (f.working_dir === '?' ? 'U' : f.working_dir);
    const safeStatus = this._esc(statusChar);
    const statusClass = ({ 'M': 'modified', 'A': 'added', 'D': 'deleted', 'U': 'untracked', '?': 'untracked', 'R': 'renamed' } as Record<string, string>)[statusChar] || 'modified';
    return `<div class="git-file ${statusClass}" data-path="${filePath}" data-staged="${isStaged}">
      <span class="git-file-status">${safeStatus}</span>
      <span class="git-file-name" title="${filePath}">${fileName}</span>
      <span class="git-file-path">${filePath}</span>
      <div class="git-file-actions">
        ${isStaged
          ? `<button class="git-file-btn" data-action="unstage" title="Unstage">−</button>`
          : `<button class="git-file-btn" data-action="stage" title="Stage">+</button><button class="git-file-btn" data-action="discard" title="Discard changes">↺</button>`
        }
      </div>
    </div>`;
  }

  private _bindFileActions(): void {
    this.changesEl!.querySelectorAll('.git-file-btn').forEach(btn => {
      btn.addEventListener('click', async (e: Event) => {
        e.stopPropagation();
        const fileEl = (btn as Element).closest('.git-file') as HTMLElement;
        const filePath = fileEl.dataset.path!;
        const action = (btn as HTMLElement).dataset.action;

        if (action === 'stage') {
          const result = await window.merecode.git.add(this.app.rootPath!, [filePath]);
          if (result.error) this.app.showToast(`Stage failed: ${result.error}`, 'error');
          this.refresh();
        } else if (action === 'unstage') {
          const result = await window.merecode.git.unstage(this.app.rootPath!, [filePath]);
          if (result.error) this.app.showToast(`Unstage failed: ${result.error}`, 'error');
          this.refresh();
        } else if (action === 'discard') {
          if (confirm(`Discard changes to "${filePath}"?`)) {
            const result = await window.merecode.git.discardFile(this.app.rootPath!, filePath);
            if (result.error) this.app.showToast(`Discard failed: ${result.error}`, 'error');
            this.refresh();
          }
        }
      });
    });

    this.changesEl!.querySelectorAll('.git-file').forEach(el => {
      el.addEventListener('click', async () => {
        const htmlEl = el as HTMLElement;
        const filePath = htmlEl.dataset.path!;
        const isStaged = htmlEl.dataset.staged === 'true';
        const fullPath = window.merecode.path.join(this.app.rootPath!, filePath);
        await this._showFileDiff(filePath, fullPath, isStaged);
      });
    });

    this.changesEl!.querySelector('.git-log-toggle')?.addEventListener('click', () => {
      const list = document.getElementById('git-log-list') as HTMLElement;
      if (list) list.style.display = list.style.display === 'none' ? '' : 'none';
    });
  }

  private async _showFileDiff(relPath: string, fullPath: string, isStaged: boolean): Promise<void> {
    try {
      const diffResult = isStaged
        ? await window.merecode.git.diffStaged(this.app.rootPath!, relPath)
        : await window.merecode.git.diff(this.app.rootPath!, relPath);

      if (diffResult.error) {
        this.app.showToast(`Diff failed: ${diffResult.error}`, 'error');
        return;
      }

      const currentFile = await window.merecode.fs.readFile(fullPath);
      const currentContent = currentFile.error ? '' : (currentFile.content || '');
      const originalContent = this._reconstructOriginal(currentContent, diffResult.diff || '');
      this._showDiffModal(relPath, originalContent, currentContent);
    } catch {
      this.app.editor.openFile(fullPath);
    }
  }

  private _reconstructOriginal(current: string, diffText: string): string {
    if (!diffText || !diffText.trim()) return current;
    const lines = diffText.split('\n');
    const hasNewFile = lines.some(l => l.startsWith('new file'));
    if (hasNewFile) return '';
    const original: string[] = [];
    let inHunk = false;
    for (const line of lines) {
      if (line.startsWith('@@')) { inHunk = true; continue; }
      if (!inHunk) continue;
      if (line.startsWith('-')) {
        original.push(line.slice(1));
      } else if (line.startsWith('+')) {
        // skip added lines
      } else if (line.startsWith(' ')) {
        original.push(line.slice(1));
      }
    }
    return original.length > 0 ? original.join('\n') : current;
  }

  private _showDiffModal(fileName: string, originalContent: string, modifiedContent: string): void {
    const modal = document.createElement('div');
    modal.className = 'diff-modal-overlay';
    modal.innerHTML = `
      <div class="diff-modal">
        <div class="diff-modal-header">
          <span class="diff-modal-title">Diff: ${this._esc(fileName)}</span>
          <div class="diff-modal-actions">
            <button class="btn-small" id="diff-close-btn">Close</button>
          </div>
        </div>
        <div id="diff-editor-container" class="diff-editor-container"></div>
      </div>
    `;
    document.body.appendChild(modal);

    const diffContainer = document.getElementById('diff-editor-container')!;
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
      automaticLayout: true,
    });
    diffEditor.setModel({ original: originalModel, modified: modifiedModel });

    const cleanup = () => {
      diffEditor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
      modal.remove();
    };

    document.getElementById('diff-close-btn')?.addEventListener('click', cleanup);
    modal.addEventListener('click', (e) => { if (e.target === modal) cleanup(); });
    document.addEventListener('keydown', function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') { cleanup(); document.removeEventListener('keydown', handler); }
    });
  }

  private async _loadLog(): Promise<void> {
    const logEl = document.getElementById('git-log-list');
    if (!logEl || !this.app.rootPath) return;
    try {
      const logs = await window.merecode.git.log(this.app.rootPath);
      if (Array.isArray(logs) && logs.length > 0) {
        logEl.innerHTML = logs.slice(0, 20).map(c => `
          <div class="git-commit" title="${this._esc(c.message)}">
            <span class="git-commit-hash">${this._esc(c.hash)}</span>
            <span class="git-commit-msg">${this._esc(c.message.substring(0, 60))}</span>
            <span class="git-commit-author">${this._esc(c.author)}</span>
          </div>
        `).join('');
      } else {
        logEl.innerHTML = '<div class="git-no-commits">No commits yet</div>';
      }
    } catch {
      logEl.innerHTML = '';
    }
  }

  async stageAll(): Promise<void> {
    if (!this.app.rootPath) return;
    const result = await window.merecode.git.add(this.app.rootPath, ['.']);
    if (result.error) {
      this.app.showToast(`Stage all failed: ${result.error}`, 'error');
    } else {
      this.app.showToast('All changes staged', 'success', 2000);
    }
    this.refresh();
  }

  async commit(): Promise<void> {
    const message = this.commitInput?.value.trim();
    if (!message) {
      this.app.showToast('Please enter a commit message', 'warning');
      this.commitInput?.focus();
      return;
    }
    if (!this.app.rootPath) return;

    const result = await window.merecode.git.commit(this.app.rootPath, message);
    if (result.error) {
      this.app.showToast(`Commit failed: ${result.error}`, 'error');
    } else {
      this.commitInput!.value = '';
      this.app.showToast(`Committed: ${message.substring(0, 50)}`, 'success');
      this.refresh();
    }
  }

  async push(): Promise<void> {
    if (!this.app.rootPath) return;
    this.app.showToast('Pushing...', 'info', 2000);
    const result = await window.merecode.git.push(this.app.rootPath);
    if (result.error) {
      this.app.showToast(`Push failed: ${result.error}`, 'error');
    } else {
      this.app.showToast('Pushed successfully', 'success');
      this.refresh();
    }
  }

  async pull(): Promise<void> {
    if (!this.app.rootPath) return;
    this.app.showToast('Pulling...', 'info', 2000);
    const result = await window.merecode.git.pull(this.app.rootPath);
    if (result.error) {
      this.app.showToast(`Pull failed: ${result.error}`, 'error');
    } else {
      this.app.showToast('Pull completed', 'success');
      this.refresh();
      this.app.fileExplorer?.refresh();
    }
  }

  async stash(): Promise<void> {
    if (!this.app.rootPath) return;
    const result = await window.merecode.git.stash(this.app.rootPath);
    if (result.error) {
      this.app.showToast(`Stash failed: ${result.error}`, 'error');
    } else {
      this.app.showToast('Changes stashed', 'success');
      this.refresh();
    }
  }

  async stashPop(): Promise<void> {
    if (!this.app.rootPath) return;
    const result = await window.merecode.git.stashPop(this.app.rootPath);
    if (result.error) {
      this.app.showToast(`Stash pop failed: ${result.error}`, 'error');
    } else {
      this.app.showToast('Stash applied', 'success');
      this.refresh();
    }
  }

  async showBranchPicker(): Promise<void> {
    if (!this.app.rootPath) return;
    const branches = await window.merecode.git.branches(this.app.rootPath);
    if ((branches as any).error) {
      this.app.showToast(`Branch list failed: ${(branches as any).error}`, 'error');
      return;
    }

    const bData = branches as GitBranches;
    const app = this.app;
    const origCommands = app.commands;
    const branchCommands = bData.all
      .filter(b => !b.startsWith('remotes/'))
      .map(b => ({
        id: `git.branch.${b}`,
        label: `${b === bData.current ? '● ' : '  '}${b}`,
        shortcut: b === bData.current ? 'current' : '',
        fn: async () => {
          if (b === bData.current) return;
          const r = await window.merecode.git.checkout(app.rootPath!, b);
          if (r.error) app.showToast(`Checkout failed: ${r.error}`, 'error');
          else { app.showToast(`Switched to ${b}`, 'success'); this.refresh(); app.fileExplorer?.refresh(); }
        },
      }));

    branchCommands.push({
      id: 'git.branch.new',
      label: '+ Create new branch...',
      shortcut: '',
      fn: async () => {
        const name = prompt('New branch name:');
        if (!name) return;
        const r = await window.merecode.git.createBranch(app.rootPath!, name);
        if (r.error) app.showToast(`Create branch failed: ${r.error}`, 'error');
        else { app.showToast(`Created & switched to ${name}`, 'success'); this.refresh(); }
      },
    });

    app.commands = branchCommands;
    app.toggleCommandPalette();
    (document.getElementById('command-input') as HTMLInputElement).placeholder = 'Switch branch...';
    (document.getElementById('command-input') as HTMLInputElement).value = '';
    app._renderCommands('');

    const observer = new MutationObserver(() => {
      if (!document.getElementById('command-palette')?.classList.contains('open')) {
        app.commands = origCommands;
        observer.disconnect();
      }
    });
    observer.observe(document.getElementById('command-palette')!, { attributes: true, attributeFilter: ['class'] });
  }

  async showGraph(): Promise<void> {
    if (!this.app.rootPath) return;
    const result = await window.merecode.git.graph(this.app.rootPath);
    if (result.error) { this.app.showToast(`Graph failed: ${result.error}`, 'error'); return; }
    this._showGraphModal(result.graph || '');
  }

  private _showGraphModal(graphText: string): void {
    const modal = document.createElement('div');
    modal.className = 'diff-modal-overlay';
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
    document.getElementById('graph-close-btn')?.addEventListener('click', cleanup);
    modal.addEventListener('click', (e) => { if (e.target === modal) cleanup(); });
    document.addEventListener('keydown', function h(e: KeyboardEvent) { if (e.key === 'Escape') { cleanup(); document.removeEventListener('keydown', h); } });
  }

  private _colorizeGraph(escaped: string): string {
    return escaped
      .replace(/\|/g, '<span class="gg-pipe">|</span>')
      .replace(/\*/g, '<span class="gg-commit">*</span>')
      .replace(/\\(?!n)/g, '<span class="gg-line">\\</span>')
      .replace(/\//g, '<span class="gg-line">/</span>')
      .replace(/(HEAD -&gt; )([^,&\s]+)/g, '$1<span class="gg-head">$2</span>')
      .replace(/origin\/([^\s,)&]+)/g, '<span class="gg-origin">origin/$1</span>');
  }

  async showFileLog(filePath: string): Promise<void> {
    if (!this.app.rootPath) return;
    const relPath = filePath.replace(/\\/g, '/').replace(this.app.rootPath.replace(/\\/g, '/') + '/', '');
    const logs = await window.merecode.git.fileLog(this.app.rootPath, relPath);
    if ((logs as any).error) { this.app.showToast(`History failed: ${(logs as any).error}`, 'error'); return; }
    this._showFileLogModal(relPath, logs as GitCommit[]);
  }

  private _showFileLogModal(fileName: string, logs: GitCommit[]): void {
    const modal = document.createElement('div');
    modal.className = 'diff-modal-overlay';
    const rows = logs.map(c =>
      `<tr class="blame-row" data-hash="${this._esc(c.fullHash || '')}">
        <td class="blame-hash">${this._esc(c.hash)}</td>
        <td class="blame-author">${this._esc(c.author)}</td>
        <td class="blame-date">${this._esc(c.date ? c.date.slice(0, 10) : '')}</td>
        <td class="blame-code">${this._esc(c.message)}</td>
        <td><button class="btn-small file-log-diff-btn" data-hash="${this._esc(c.fullHash || '')}">Diff</button></td>
      </tr>`
    ).join('');

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
    document.getElementById('file-log-close')?.addEventListener('click', cleanup);
    modal.addEventListener('click', (e) => { if (e.target === modal) cleanup(); });
  }

  async checkAndShowConflicts(): Promise<void> {
    if (!this.app.rootPath) return;
    const result = await window.merecode.git.getConflicts(this.app.rootPath);
    if (result.error || !result.files?.length) return;
    this.app.showToast(`${result.files.length} merge conflict${result.files.length > 1 ? 's' : ''} — click Git panel to resolve`, 'warning', 6000);
    this._renderConflictBanner(result.files);
  }

  private _renderConflictBanner(files: string[]): void {
    const existing = document.getElementById('conflict-banner');
    if (existing) existing.remove();
    const banner = document.createElement('div');
    banner.id = 'conflict-banner';
    banner.className = 'conflict-banner';
    banner.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 16 16" fill="#ef4444"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7.5 4h1v5h-1V4zm.5 8a.75.75 0 110-1.5.75.75 0 010 1.5z"/></svg>
      <span><strong>${files.length} merge conflict${files.length > 1 ? 's' : ''}</strong> — ${files.map(f => this._esc(f)).join(', ')}</span>
      <button class="btn-small btn-danger" id="btn-resolve-conflicts">Resolve</button>
      <button class="conflict-banner-close">×</button>
    `;
    document.getElementById('editor-container')?.prepend(banner);
    document.getElementById('btn-resolve-conflicts')?.addEventListener('click', () => this.showConflictResolver(files));
    banner.querySelector('.conflict-banner-close')?.addEventListener('click', () => banner.remove());
  }

  async showConflictResolver(files?: string[]): Promise<void> {
    if (!files) {
      const result = await window.merecode.git.getConflicts(this.app.rootPath!);
      if (result.error || !result.files?.length) { this.app.showToast('No conflicts found', 'success', 2000); return; }
      files = result.files;
    }

    const filePath = files[0];
    const fullPath = window.merecode.path.join(this.app.rootPath!, filePath);
    const fileResult = await window.merecode.fs.readFile(fullPath);
    if (fileResult.error) return;

    this._showConflictModal(filePath, fullPath, fileResult.content || '', files);
  }

  private _showConflictModal(relPath: string, fullPath: string, content: string, allFiles: string[]): void {
    const sections = this._parseConflicts(content);

    const modal = document.createElement('div');
    modal.className = 'diff-modal-overlay';
    modal.innerHTML = `
      <div class="diff-modal conflict-modal">
        <div class="diff-modal-header">
          <span class="diff-modal-title">Resolve Conflicts: ${this._esc(relPath)}</span>
          <div class="diff-modal-actions">
            ${allFiles.length > 1 ? `<span class="conflict-count">${allFiles.length} files</span>` : ''}
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

    const oursContent = sections.map(s => s.ours).join('\n');
    const theirsContent = sections.map(s => s.theirs).join('\n');
    const resultContent = content
      .replace(/^<<<<<<< .+$/gm, '')
      .replace(/^=======$\n/gm, '')
      .replace(/^>>>>>>> .+$/gm, '');

    const oursModel = monaco.editor.createModel(oursContent, lang);
    const theirsModel = monaco.editor.createModel(theirsContent, lang);
    const resultModel = monaco.editor.createModel(resultContent, lang);

    const opts = { theme: this.app.editor._currentTheme, readOnly: true, minimap: { enabled: false }, fontSize: 12, scrollBeyondLastLine: false, automaticLayout: true };
    monaco.editor.create(document.getElementById('conflict-ours-editor'), { ...opts, model: oursModel });
    monaco.editor.create(document.getElementById('conflict-theirs-editor'), { ...opts, model: theirsModel });
    monaco.editor.create(document.getElementById('conflict-result-editor'), { ...opts, readOnly: false, model: resultModel });

    const cleanup = () => { modal.remove(); };

    document.getElementById('conflict-close')?.addEventListener('click', cleanup);
    modal.addEventListener('click', (e) => { if (e.target === modal) cleanup(); });

    document.getElementById('conflict-accept-all-ours')?.addEventListener('click', () => {
      resultModel.setValue(oursContent); this.app.showToast('Using our version', 'info', 1500);
    });
    document.getElementById('conflict-accept-all-theirs')?.addEventListener('click', () => {
      resultModel.setValue(theirsContent); this.app.showToast('Using their version', 'info', 1500);
    });

    document.getElementById('conflict-apply')?.addEventListener('click', async () => {
      const resolved = resultModel.getValue();
      const result = await window.merecode.git.resolveConflict(this.app.rootPath!, relPath, resolved);
      if (result.error) { this.app.showToast(`Resolve failed: ${result.error}`, 'error'); return; }
      this.app.showToast(`Resolved ${relPath}`, 'success');
      cleanup();
      document.getElementById('conflict-banner')?.remove();
      this.refresh();
      this.app.editor.openFile(fullPath);
    });
  }

  private _parseConflicts(content: string): { ours: string; theirs: string }[] {
    const sections: { ours: string; theirs: string }[] = [];
    const conflictRegex = /^<<<<<<< .+\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>> .+$/gm;
    let match;
    while ((match = conflictRegex.exec(content)) !== null) {
      sections.push({ ours: match[1], theirs: match[2] });
    }
    return sections.length > 0 ? sections : [{ ours: content, theirs: content }];
  }

  async aiCodeReview(): Promise<void> {
    if (!this.app.rootPath) return;
    const diff = await window.merecode.git.diff(this.app.rootPath, '');
    if (diff.error || !diff.diff?.trim()) {
      this.app.showToast('No unstaged changes to review', 'warning'); return;
    }
    if (!this.app.isChatOpen) this.app.toggleChat();
    const reviewPrompt = `Please review the following git diff for bugs, security issues, code quality, and best practices. Provide specific, actionable feedback:\n\n\`\`\`diff\n${diff.diff.slice(0, 8000)}\n\`\`\``;
    const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
    if (chatInput) {
      chatInput.value = reviewPrompt;
      chatInput.dispatchEvent(new Event('input'));
      setTimeout(() => this.app.chat?.send(), 100);
    }
  }

  async showBlame(filePath: string): Promise<void> {
    if (!this.app.rootPath || !filePath) return;
    const relPath = filePath.replace(/\\/g, '/').replace(this.app.rootPath.replace(/\\/g, '/') + '/', '');

    const result = await window.merecode.git.blame(this.app.rootPath, relPath);
    if (result.error) {
      this.app.showToast(`Blame failed: ${result.error}`, 'error');
      return;
    }

    const parsed = this._parseBlame(result.blame || '');
    this._showBlameModal(relPath, parsed);
  }

  private _parseBlame(raw: string): any[] {
    if (!raw) return [];
    const lines = raw.split('\n');
    const result: any[] = [];
    let current: any = {};
    for (const line of lines) {
      if (/^[0-9a-f]{40}/.test(line)) {
        const parts = line.split(' ');
        current = { hash: parts[0].slice(0, 8) };
      } else if (line.startsWith('author ')) {
        current.author = line.slice(7).trim();
      } else if (line.startsWith('author-time ')) {
        const ts = parseInt(line.slice(12));
        const d = new Date(ts * 1000);
        current.date = d.toLocaleDateString();
      } else if (line.startsWith('summary ')) {
        current.summary = line.slice(8).trim().substring(0, 50);
      } else if (line.startsWith('\t')) {
        result.push({ ...current, text: line.slice(1) });
        current = {};
      }
    }
    return result;
  }

  private _showBlameModal(fileName: string, blame: any[]): void {
    const modal = document.createElement('div');
    modal.className = 'diff-modal-overlay';
    const rows = blame.map((b: any, i: number) =>
      `<tr class="blame-row">
        <td class="blame-line">${i + 1}</td>
        <td class="blame-hash" title="${this._esc(b.summary || '')}">${this._esc(b.hash || '')}</td>
        <td class="blame-author">${this._esc(b.author || '')}</td>
        <td class="blame-date">${this._esc(b.date || '')}</td>
        <td class="blame-code">${this._esc(b.text || '')}</td>
      </tr>`
    ).join('');

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
    document.getElementById('blame-close-btn')?.addEventListener('click', cleanup);
    modal.addEventListener('click', (e) => { if (e.target === modal) cleanup(); });
    document.addEventListener('keydown', function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') { cleanup(); document.removeEventListener('keydown', handler); }
    });
  }

  private _esc(s: string): string {
    return s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '';
  }
}
