// fileExplorer.ts — File tree explorer with .gitignore support, file watcher, multi-select
import type { MereCodeApp } from './app.js';

export class FileExplorer {
  app: MereCodeApp;
  rootPath: string | null = null;
  expandedDirs: Set<string> = new Set();
  selectedPath: string | null = null;
  selectedPaths: Set<string> = new Set();
  treeEl: HTMLElement | null;
  placeholderEl: HTMLElement | null;
  private _fileWatcherCleanup: (() => void) | null = null;
  private _refreshDebounce: ReturnType<typeof setTimeout> | null = null;
  private _gitignorePatterns: string[] = [];

  constructor(app: MereCodeApp) {
    this.app = app;
    this.treeEl = document.getElementById('file-tree');
    this.placeholderEl = document.getElementById('no-folder-open');
    this._initActions();
    this._initContextMenu();
  }

  private _initActions(): void {
    document.getElementById('btn-new-file')?.addEventListener('click', () => this.promptNewFile());
    document.getElementById('btn-new-folder')?.addEventListener('click', () => this.promptNewFolder());
    document.getElementById('btn-refresh')?.addEventListener('click', () => this.refresh());
    document.getElementById('btn-open-folder')?.addEventListener('click', () => this.app.openFolder());
    document.getElementById('btn-open-folder-big')?.addEventListener('click', () => this.app.openFolder());
    this._initDragDrop();
  }

  private _initDragDrop(): void {
    const target = document.getElementById('panel-explorer');
    if (!target) return;
    const prevent = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
    target.addEventListener('dragover', (e: DragEvent) => { prevent(e); e.dataTransfer!.dropEffect = 'copy'; target.classList.add('drag-over'); });
    target.addEventListener('dragleave', (e: DragEvent) => { prevent(e); target.classList.remove('drag-over'); });
    target.addEventListener('drop', async (e: DragEvent) => {
      prevent(e);
      target.classList.remove('drag-over');
      const items = e.dataTransfer?.items;
      if (!items?.length) return;
      for (const item of items) {
        const entry = (item as any).webkitGetAsEntry?.();
        if (entry?.isDirectory) {
          const file = e.dataTransfer!.files[0] as any;
          if (file?.path) { this.app.openFolder(file.path); return; }
        }
      }
      const file = e.dataTransfer!.files[0] as any;
      if (file?.path) this.app.openFolder(file.path);
    });
  }

  private _initContextMenu(): void {
    this.treeEl?.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
      const item = (e.target as Element).closest('.tree-item') as HTMLElement | null;
      if (!item) return;
      this._showContextMenu(e.clientX, e.clientY, item.dataset.path!, item.dataset.type === 'dir');
    });
  }

  private _showContextMenu(x: number, y: number, itemPath: string, isDir: boolean): void {
    document.getElementById('context-menu')?.remove();
    const menu = document.createElement('div');
    menu.id = 'context-menu';
    menu.className = 'context-menu';
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    document.body.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 4) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 4) + 'px';

    const multiPaths = this.selectedPaths.size > 1 ? Array.from(this.selectedPaths) : null;

    const actions: ({ label: string; fn: () => void } | null)[] = [
      ...(isDir ? [
        { label: 'New File', fn: () => this.promptNewFile(itemPath) },
        { label: 'New Folder', fn: () => this.promptNewFolder(itemPath) },
        null,
      ] : []),
      ...(!multiPaths ? [{ label: 'Rename', fn: () => this.promptRename(itemPath) }] : []),
      {
        label: multiPaths ? `Delete ${multiPaths.length} items` : 'Delete',
        fn: () => multiPaths ? this.deleteMultiple(multiPaths) : this.promptDelete(itemPath),
      },
      null,
      { label: 'Copy Path', fn: () => navigator.clipboard.writeText(multiPaths ? multiPaths.join('\n') : itemPath) },
      { label: 'Copy Relative Path', fn: () => {
        const paths = multiPaths || [itemPath];
        const rel = paths.map(p => this.rootPath ? p.replace(this.rootPath, '').replace(/^[/\\]/, '') : p);
        navigator.clipboard.writeText(rel.join('\n'));
      }},
      ...(isDir ? [{ label: 'Open in Terminal', fn: () => this.app.terminal.createTerminal(itemPath) }] : []),
      ...(!isDir && !multiPaths ? [{ label: 'Open File', fn: () => this.app.editor.openFile(itemPath) }] : []),
    ];

    menu.innerHTML = actions.map(a =>
      a ? `<div class="ctx-item">${a.label}</div>` : '<div class="ctx-separator"></div>'
    ).join('');

    const items = menu.querySelectorAll('.ctx-item');
    let ai = 0;
    actions.forEach(a => { if (a) { items[ai++]?.addEventListener('click', () => { a.fn(); menu.remove(); }); } });

    const close = (e: MouseEvent) => { if (!menu.contains(e.target as Node)) { menu.remove(); document.removeEventListener('click', close); } };
    setTimeout(() => document.addEventListener('click', close), 0);
  }

  async setRoot(rootPath: string): Promise<void> {
    this.rootPath = rootPath;
    this.expandedDirs.clear();
    this.expandedDirs.add(rootPath);
    this.treeEl!.style.display = 'block';
    this.placeholderEl!.style.display = 'none';

    await this._loadGitignore(rootPath);
    this._startFileWatcher(rootPath);

    try {
      await this.refresh();
    } catch (err) {
      console.error('[FileExplorer] setRoot failed:', err);
      this.treeEl!.innerHTML = `<div style="padding:12px;color:var(--fg-muted);font-size:12px;">Failed to load folder</div>`;
    }
  }

  private async _loadGitignore(rootPath: string): Promise<void> {
    try {
      const result = await window.merecode.fs.readFile(window.merecode.path.join(rootPath, '.gitignore'));
      if (result.content) {
        this._gitignorePatterns = result.content.split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('#'));
      }
    } catch { this._gitignorePatterns = []; }
  }

  private _isGitignored(name: string): boolean {
    return this._gitignorePatterns.some(pattern => {
      const cleaned = pattern.replace(/\/$/, '');
      if (cleaned === name) return true;
      if (cleaned.includes('*')) {
        const regex = new RegExp('^' + cleaned.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
        return regex.test(name);
      }
      return false;
    });
  }

  private _startFileWatcher(rootPath: string): void {
    if (this._fileWatcherCleanup) {
      this._fileWatcherCleanup();
      this._fileWatcherCleanup = null;
    }

    window.merecode.fs.watchDir(rootPath);
    this._fileWatcherCleanup = window.merecode.fs.onFileChanged(() => {
      clearTimeout(this._refreshDebounce!);
      this._refreshDebounce = setTimeout(() => {
        this.refresh();
        this.app.git?.refresh();
      }, 500);
    });
  }

  async refresh(): Promise<void> {
    if (!this.rootPath) return;
    this.treeEl!.innerHTML = '';
    await this._renderDir(this.rootPath, this.treeEl!, 0);
    if (this.treeEl!.children.length === 0) {
      this.treeEl!.innerHTML = '<div style="padding:12px;color:var(--fg-muted);font-size:12px;">Folder is empty</div>';
    }
  }

  private async _renderDir(dirPath: string, container: HTMLElement, depth: number): Promise<void> {
    if (depth > 15) return;
    let entries: DirEntry[] | { error: string };
    try {
      entries = await window.merecode.fs.readdir(dirPath);
    } catch (err) {
      console.error('[FileExplorer] readdir failed for:', dirPath, err);
      return;
    }
    if (!entries || (entries as any).error || !Array.isArray(entries)) return;

    const filtered = (entries as DirEntry[]).filter(entry => !this._isGitignored(entry.name));

    for (const entry of filtered) {
      const el = document.createElement('div');
      el.className = `tree-item ${entry.isDirectory ? 'dir' : 'file'}${entry.path === this.selectedPath ? ' selected' : ''}`;
      el.dataset.path = entry.path;
      el.dataset.type = entry.isDirectory ? 'dir' : 'file';
      el.style.paddingLeft = (depth * 16 + 8) + 'px';

      const isExpanded = this.expandedDirs.has(entry.path);

      if (entry.isDirectory) {
        el.innerHTML = `<span class="tree-arrow${isExpanded ? ' expanded' : ''}">▶</span><span class="tree-icon">${this._folderIcon(entry.name, isExpanded)}</span><span class="tree-name">${this._escHtml(entry.name)}</span>`;
        el.addEventListener('click', async (e: MouseEvent) => {
          e.stopPropagation();
          if (e.ctrlKey || e.metaKey) {
            this._toggleMultiSelect(entry.path);
            return;
          }
          this.selectedPath = entry.path;
          this.selectedPaths.clear();
          this._updateSelection();
          if (this.expandedDirs.has(entry.path)) {
            this.expandedDirs.delete(entry.path);
            const childC = el.nextElementSibling;
            if (childC?.classList.contains('tree-children')) childC.remove();
            el.querySelector('.tree-arrow')?.classList.remove('expanded');
            el.querySelector('.tree-icon')!.innerHTML = this._folderIcon(entry.name, false);
          } else {
            this.expandedDirs.add(entry.path);
            el.querySelector('.tree-arrow')?.classList.add('expanded');
            el.querySelector('.tree-icon')!.innerHTML = this._folderIcon(entry.name, true);
            const childC = document.createElement('div');
            childC.className = 'tree-children';
            el.after(childC);
            await this._renderDir(entry.path, childC, depth + 1);
          }
        });
      } else {
        el.innerHTML = `<span class="tree-arrow-placeholder"></span><span class="tree-icon">${this._fileIcon(entry.name)}</span><span class="tree-name">${this._escHtml(entry.name)}</span>`;
        el.addEventListener('click', (e: MouseEvent) => {
          e.stopPropagation();
          if (e.ctrlKey || e.metaKey) {
            this._toggleMultiSelect(entry.path);
            return;
          }
          this.selectedPath = entry.path;
          this.selectedPaths.clear();
          this._updateSelection();
          this.app.editor.openFile(entry.path);
        });
      }
      container.appendChild(el);

      if (entry.isDirectory && isExpanded) {
        const childC = document.createElement('div');
        childC.className = 'tree-children';
        container.appendChild(childC);
        await this._renderDir(entry.path, childC, depth + 1);
      }
    }
  }

  private _toggleMultiSelect(itemPath: string): void {
    if (this.selectedPaths.has(itemPath)) {
      this.selectedPaths.delete(itemPath);
    } else {
      this.selectedPaths.add(itemPath);
    }
    this._updateSelection();
    const count = this.selectedPaths.size;
    if (count > 0) this.app.showToast(`${count} item${count > 1 ? 's' : ''} selected (Ctrl+click to add/remove)`, 'info', 1500);
  }

  private _updateSelection(): void {
    this.treeEl!.querySelectorAll('.tree-item').forEach(el => {
      const htmlEl = el as HTMLElement;
      const isSelected = htmlEl.dataset.path === this.selectedPath || this.selectedPaths.has(htmlEl.dataset.path!);
      htmlEl.classList.toggle('selected', isSelected);
      htmlEl.classList.toggle('multi-selected', this.selectedPaths.has(htmlEl.dataset.path!));
    });
  }

  getSelectedPaths(): string[] {
    if (this.selectedPaths.size > 0) return Array.from(this.selectedPaths);
    if (this.selectedPath) return [this.selectedPath];
    return [];
  }

  private _escHtml(s: string): string {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  private _fileIcon(name: string): string {
    const ext = name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : '';
    const icons: Record<string, string> = {
      '.js':  '<svg class="file-icon fi-js" viewBox="0 0 16 16"><text x="2" y="12" font-size="9" font-weight="600" fill="#f0db4f">JS</text></svg>',
      '.jsx': '<svg class="file-icon fi-jsx" viewBox="0 0 16 16"><text x="0" y="12" font-size="8" font-weight="600" fill="#61dafb">⚛</text></svg>',
      '.ts':  '<svg class="file-icon fi-ts" viewBox="0 0 16 16"><text x="2" y="12" font-size="9" font-weight="600" fill="#3178c6">TS</text></svg>',
      '.tsx': '<svg class="file-icon fi-tsx" viewBox="0 0 16 16"><text x="0" y="12" font-size="8" font-weight="600" fill="#61dafb">⚛</text></svg>',
      '.py':  '<svg class="file-icon fi-py" viewBox="0 0 16 16"><text x="1" y="12" font-size="9" font-weight="600" fill="#3776ab">Py</text></svg>',
      '.html':'<svg class="file-icon fi-html" viewBox="0 0 16 16"><text x="0" y="12" font-size="8" font-weight="600" fill="#e34f26">&lt;&gt;</text></svg>',
      '.css': '<svg class="file-icon fi-css" viewBox="0 0 16 16"><text x="2" y="12" font-size="9" font-weight="600" fill="#1572b6">#</text></svg>',
      '.scss':'<svg class="file-icon fi-scss" viewBox="0 0 16 16"><text x="2" y="12" font-size="9" font-weight="600" fill="#cc6699">#</text></svg>',
      '.json':'<svg class="file-icon fi-json" viewBox="0 0 16 16"><text x="1" y="12" font-size="9" font-weight="600" fill="#f5a623">{}</text></svg>',
      '.md':  '<svg class="file-icon fi-md" viewBox="0 0 16 16"><text x="0" y="12" font-size="8" font-weight="600" fill="#519aba">MD</text></svg>',
      '.svg': '<svg class="file-icon fi-svg" viewBox="0 0 16 16"><text x="0" y="12" font-size="8" font-weight="600" fill="#ffb13b">◇</text></svg>',
      '.png': '<svg class="file-icon fi-img" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1" fill="none" stroke="#4caf50" stroke-width="1.5"/></svg>',
      '.jpg': '<svg class="file-icon fi-img" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1" fill="none" stroke="#4caf50" stroke-width="1.5"/></svg>',
      '.yaml':'<svg class="file-icon fi-yaml" viewBox="0 0 16 16"><text x="0" y="12" font-size="7" font-weight="600" fill="#cb171e">yml</text></svg>',
      '.yml': '<svg class="file-icon fi-yaml" viewBox="0 0 16 16"><text x="0" y="12" font-size="7" font-weight="600" fill="#cb171e">yml</text></svg>',
      '.go':  '<svg class="file-icon fi-go" viewBox="0 0 16 16"><text x="1" y="12" font-size="9" font-weight="600" fill="#00add8">Go</text></svg>',
      '.rs':  '<svg class="file-icon fi-rs" viewBox="0 0 16 16"><text x="1" y="12" font-size="9" font-weight="600" fill="#dea584">Rs</text></svg>',
      '.java':'<svg class="file-icon fi-java" viewBox="0 0 16 16"><text x="0" y="12" font-size="7" font-weight="600" fill="#b07219">J</text></svg>',
      '.rb':  '<svg class="file-icon fi-rb" viewBox="0 0 16 16"><text x="1" y="12" font-size="9" font-weight="600" fill="#cc342d">Rb</text></svg>',
      '.php': '<svg class="file-icon fi-php" viewBox="0 0 16 16"><text x="0" y="12" font-size="7" font-weight="600" fill="#777bb4">php</text></svg>',
      '.sh':  '<svg class="file-icon fi-sh" viewBox="0 0 16 16"><text x="1" y="12" font-size="8" font-weight="600" fill="#89e051">$_</text></svg>',
      '.env': '<svg class="file-icon fi-env" viewBox="0 0 16 16"><text x="1" y="12" font-size="8" font-weight="600" fill="#faf743">⚙</text></svg>',
      '.gitignore': '<svg class="file-icon fi-git" viewBox="0 0 16 16"><text x="1" y="12" font-size="9" font-weight="600" fill="#f05032">G</text></svg>',
    };
    return icons[ext] || '<svg class="file-icon fi-default" viewBox="0 0 16 16"><rect x="3" y="1" width="10" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="1" opacity="0.4"/></svg>';
  }

  private _folderIcon(name: string, isExpanded: boolean): string {
    const specialFolders: Record<string, string> = {
      'src': '#42a5f5', 'lib': '#42a5f5', 'app': '#42a5f5',
      'components': '#7c4dff', 'pages': '#7c4dff', 'views': '#7c4dff',
      'test': '#66bb6a', 'tests': '#66bb6a', '__tests__': '#66bb6a', 'spec': '#66bb6a',
      'public': '#ffa726', 'static': '#ffa726', 'assets': '#ffa726',
      'config': '#78909c', 'scripts': '#78909c', 'utils': '#78909c', 'helpers': '#78909c',
      'styles': '#ec407a', 'css': '#ec407a',
      'api': '#26c6da', 'routes': '#26c6da',
      'models': '#ab47bc', 'types': '#ab47bc',
    };
    const color = specialFolders[name.toLowerCase()] || '#90a4ae';
    if (isExpanded) {
      return `<svg class="file-icon" viewBox="0 0 16 16"><path d="M1.5 2h5l1.5 1.5H14.5v10h-13z" fill="${color}" opacity="0.85"/></svg>`;
    }
    return `<svg class="file-icon" viewBox="0 0 16 16"><path d="M1.5 2h5l1.5 1.5H14.5v10h-13z" fill="${color}" opacity="0.6"/></svg>`;
  }

  async promptNewFile(dirPath?: string): Promise<void> {
    const parent = dirPath || this.rootPath;
    if (!parent) return;
    const name = prompt('New file name:');
    if (!name) return;
    const fp = window.merecode.path.join(parent, name);
    const result = await window.merecode.fs.writeFile(fp, '');
    if (!result.error) { await this.refresh(); this.app.editor.openFile(fp); }
    else this.app.showToast(`Create file failed: ${result.error}`, 'error');
  }

  async promptNewFolder(dirPath?: string): Promise<void> {
    const parent = dirPath || this.rootPath;
    if (!parent) return;
    const name = prompt('New folder name:');
    if (!name) return;
    const result = await window.merecode.fs.mkdir(window.merecode.path.join(parent, name));
    if (!result.error) await this.refresh();
    else this.app.showToast(`Create folder failed: ${result.error}`, 'error');
  }

  async promptRename(itemPath: string): Promise<void> {
    const oldName = window.merecode.path.basename(itemPath);
    const newName = prompt('Rename to:', oldName);
    if (!newName || newName === oldName) return;
    const dir = window.merecode.path.dirname(itemPath);
    const result = await window.merecode.fs.rename(itemPath, window.merecode.path.join(dir, newName));
    if (!result.error) await this.refresh();
    else this.app.showToast(`Rename failed: ${result.error}`, 'error');
  }

  async promptDelete(itemPath: string): Promise<void> {
    const name = window.merecode.path.basename(itemPath);
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    const result = await window.merecode.fs.delete(itemPath);
    if (!result.error) { this.selectedPaths.clear(); await this.refresh(); }
    else this.app.showToast(`Delete failed: ${result.error}`, 'error');
  }

  async deleteMultiple(paths: string[]): Promise<void> {
    if (!confirm(`Delete ${paths.length} items? This cannot be undone.`)) return;
    let failed = 0;
    for (const p of paths) {
      const r = await window.merecode.fs.delete(p);
      if (r.error) failed++;
    }
    this.selectedPaths.clear();
    await this.refresh();
    if (failed > 0) this.app.showToast(`${failed} item(s) could not be deleted`, 'error');
    else this.app.showToast(`Deleted ${paths.length} items`, 'success');
  }

  dispose(): void {
    if (this._fileWatcherCleanup) {
      this._fileWatcherCleanup();
      this._fileWatcherCleanup = null;
    }
    window.merecode.fs.unwatchDir();
  }
}
