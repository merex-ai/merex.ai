class FileExplorer {
  constructor(app) {
    this.rootPath = null;
    this.expandedDirs = /* @__PURE__ */ new Set();
    this.selectedPath = null;
    this.selectedPaths = /* @__PURE__ */ new Set();
    this._fileWatcherCleanup = null;
    this._refreshDebounce = null;
    this._gitignorePatterns = [];
    this._flatTree = []; // Flattened tree for virtual scrolling
    this._itemHeight = 26; // px per item (matches .tree-item height)
    this._visibleBuffer = 10; // extra items above/below viewport
    this.app = app;
    this.treeEl = document.getElementById("file-tree");
    this.placeholderEl = document.getElementById("no-folder-open");
    this._initActions();
    this._initContextMenu();
    this._initVirtualScroll();
    // Dynamically measure actual item height
    this._measureItemHeight();
  }
  _measureItemHeight() {
    if (!this.treeEl) return;
    const probe = document.createElement("div");
    probe.className = "tree-item";
    probe.style.visibility = "hidden";
    probe.style.position = "absolute";
    probe.innerHTML = '<span class="tree-arrow-placeholder"></span><span class="tree-icon">📄</span><span class="tree-name">probe</span>';
    this.treeEl.appendChild(probe);
    const h = probe.getBoundingClientRect().height;
    probe.remove();
    if (h > 0) this._itemHeight = Math.round(h);
  }
  _initActions() {
    document.getElementById("btn-new-file")?.addEventListener("click", () => this.promptNewFile());
    document.getElementById("btn-new-folder")?.addEventListener("click", () => this.promptNewFolder());
    document.getElementById("btn-refresh")?.addEventListener("click", () => this.refresh());
    document.getElementById("btn-open-folder")?.addEventListener("click", () => this.app.openFolder());
    document.getElementById("btn-open-folder-big")?.addEventListener("click", () => this.app.openFolder());
    this._initDragDrop();
  }
  _initDragDrop() {
    const target = document.getElementById("panel-explorer");
    if (!target) return;
    const prevent = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    target.addEventListener("dragover", (e) => {
      prevent(e);
      e.dataTransfer.dropEffect = "copy";
      target.classList.add("drag-over");
    });
    target.addEventListener("dragleave", (e) => {
      prevent(e);
      target.classList.remove("drag-over");
    });
    target.addEventListener("drop", async (e) => {
      prevent(e);
      target.classList.remove("drag-over");
      const items = e.dataTransfer?.items;
      if (!items?.length) return;
      for (const item of items) {
        const entry = item.webkitGetAsEntry?.();
        if (entry?.isDirectory) {
          const file2 = e.dataTransfer.files[0];
          if (file2?.path) {
            this.app.openFolder(file2.path);
            return;
          }
        }
      }
      const file = e.dataTransfer.files[0];
      if (file?.path) this.app.openFolder(file.path);
    });
  }
  _initContextMenu() {
    this.treeEl?.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const item = e.target.closest(".tree-item");
      if (!item) return;
      this._showContextMenu(e.clientX, e.clientY, item.dataset.path, item.dataset.type === "dir");
    });
  }
  _showContextMenu(x, y, itemPath, isDir) {
    document.getElementById("context-menu")?.remove();
    const menu = document.createElement("div");
    menu.id = "context-menu";
    menu.className = "context-menu";
    menu.style.left = x + "px";
    menu.style.top = y + "px";
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) menu.style.left = window.innerWidth - rect.width - 4 + "px";
    if (rect.bottom > window.innerHeight) menu.style.top = window.innerHeight - rect.height - 4 + "px";
    const multiPaths = this.selectedPaths.size > 1 ? Array.from(this.selectedPaths) : null;
    const actions = [
      ...isDir ? [
        { label: "New File", fn: () => this.promptNewFile(itemPath) },
        { label: "New Folder", fn: () => this.promptNewFolder(itemPath) },
        null
      ] : [],
      ...!multiPaths ? [{ label: "Rename", fn: () => this.promptRename(itemPath) }] : [],
      {
        label: multiPaths ? `Delete ${multiPaths.length} items` : "Delete",
        fn: () => multiPaths ? this.deleteMultiple(multiPaths) : this.promptDelete(itemPath)
      },
      null,
      { label: "Copy Path", fn: () => navigator.clipboard.writeText(multiPaths ? multiPaths.join("\n") : itemPath) },
      { label: "Copy Relative Path", fn: () => {
        const paths = multiPaths || [itemPath];
        const rel = paths.map((p) => this.rootPath ? p.replace(this.rootPath, "").replace(/^[/\\]/, "") : p);
        navigator.clipboard.writeText(rel.join("\n"));
      } },
      ...isDir ? [{ label: "Open in Terminal", fn: () => this.app.terminal.createTerminal(itemPath) }] : [],
      ...!isDir && !multiPaths ? [{ label: "Open File", fn: () => this.app.editor.openFile(itemPath) }] : []
    ];
    menu.innerHTML = actions.map(
      (a) => a ? `<div class="ctx-item">${a.label}</div>` : '<div class="ctx-separator"></div>'
    ).join("");
    const items = menu.querySelectorAll(".ctx-item");
    let ai = 0;
    actions.forEach((a) => {
      if (a) {
        items[ai++]?.addEventListener("click", () => {
          a.fn();
          menu.remove();
        });
      }
    });
    const close = (e) => {
      if (!menu.contains(e.target)) {
        menu.remove();
        document.removeEventListener("click", close);
      }
    };
    setTimeout(() => document.addEventListener("click", close), 0);
  }
  async setRoot(rootPath) {
    this.rootPath = rootPath;
    this.expandedDirs.clear();
    this.expandedDirs.add(rootPath);
    this.treeEl.style.display = "block";
    this.placeholderEl.style.display = "none";
    await this._loadGitignore(rootPath);
    this._startFileWatcher(rootPath);
    try {
      await this.refresh();
    } catch (err) {
      console.error("[FileExplorer] setRoot failed:", err);
      this.treeEl.innerHTML = `<div style="padding:12px;color:var(--fg-muted);font-size:12px;">Failed to load folder</div>`;
    }
  }
  async _loadGitignore(rootPath) {
    try {
      const result = await window.merecode.fs.readFile(window.merecode.path.join(rootPath, ".gitignore"));
      if (result.content) {
        this._gitignorePatterns = result.content.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
      }
    } catch {
      this._gitignorePatterns = [];
    }
  }
  _isGitignored(name) {
    return this._gitignorePatterns.some((pattern) => {
      const cleaned = pattern.replace(/\/$/, "");
      if (cleaned === name) return true;
      if (cleaned.includes("*")) {
        const regex = new RegExp("^" + cleaned.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
        return regex.test(name);
      }
      return false;
    });
  }
  _startFileWatcher(rootPath) {
    if (this._fileWatcherCleanup) {
      this._fileWatcherCleanup();
      this._fileWatcherCleanup = null;
    }
    window.merecode.fs.watchDir(rootPath);
    this._fileWatcherCleanup = window.merecode.fs.onFileChanged(() => {
      clearTimeout(this._refreshDebounce);
      this._refreshDebounce = setTimeout(() => {
        this.refresh();
        this.app.git?.refresh();
      }, 500);
    });
  }
  async refresh() {
    if (!this.rootPath) return;
    this._flatTree = [];
    await this._buildFlatTree(this.rootPath, 0);
    this._renderVirtual();
  }
  _initVirtualScroll() {
    if (!this.treeEl) return;
    this.treeEl.addEventListener("scroll", () => {
      this._renderVirtual();
    });
  }
  async _buildFlatTree(dirPath, depth) {
    if (depth > 15) return;
    let entries;
    try {
      entries = await window.merecode.fs.readdir(dirPath);
    } catch (err) {
      console.error("[FileExplorer] readdir failed for:", dirPath, err);
      return;
    }
    if (!entries || entries.error || !Array.isArray(entries)) return;
    const filtered = entries.filter((entry) => !this._isGitignored(entry.name));
    for (const entry of filtered) {
      if (entry.isDirectory) {
        // Compact folder: merge single-child directory chains (like VS Code)
        let compactPath = entry.path;
        let compactName = entry.name;
        let currentDir = entry.path;
        while (true) {
          let subEntries;
          try {
            subEntries = await window.merecode.fs.readdir(currentDir);
          } catch { break; }
          if (!subEntries || subEntries.error || !Array.isArray(subEntries)) break;
          const subFiltered = subEntries.filter(e => !this._isGitignored(e.name));
          if (subFiltered.length === 1 && subFiltered[0].isDirectory) {
            compactName += '/' + subFiltered[0].name;
            compactPath = subFiltered[0].path;
            currentDir = subFiltered[0].path;
            // Auto-expand compacted intermediate dirs
            this.expandedDirs.add(subFiltered[0].path);
          } else {
            break;
          }
        }
        const isExpanded = this.expandedDirs.has(entry.path) || this.expandedDirs.has(compactPath);
        this._flatTree.push({
          name: compactName,
          path: compactPath,
          originalPath: entry.path,
          isDirectory: true,
          isFile: false,
          depth,
          isExpanded,
          isCompact: compactName !== entry.name
        });
        if (isExpanded) {
          await this._buildFlatTree(compactPath, depth + 1);
        }
      } else {
        this._flatTree.push({
          name: entry.name,
          path: entry.path,
          isDirectory: false,
          isFile: true,
          depth,
          isExpanded: false
        });
      }
    }
  }
  _renderVirtual() {
    if (!this.treeEl) return;
    const items = this._flatTree;
    if (items.length === 0) {
      this.treeEl.innerHTML = '<div style="padding:12px;color:var(--fg-muted);font-size:12px;">Folder is empty</div>';
      return;
    }
    const totalHeight = items.length * this._itemHeight;
    const scrollTop = this.treeEl.scrollTop;
    const viewportHeight = this.treeEl.clientHeight;
    const startIdx = Math.max(0, Math.floor(scrollTop / this._itemHeight) - this._visibleBuffer);
    const endIdx = Math.min(items.length, Math.ceil((scrollTop + viewportHeight) / this._itemHeight) + this._visibleBuffer);
    // Use a container with padding to maintain scroll height
    let html = `<div style="height:${startIdx * this._itemHeight}px"></div>`;
    for (let i = startIdx; i < endIdx; i++) {
      const entry = items[i];
      const isSelected = entry.path === this.selectedPath || this.selectedPaths.has(entry.path);
      const isMulti = this.selectedPaths.has(entry.path);
      const paddingLeft = entry.depth * 16 + 8;
      if (entry.isDirectory) {
        html += `<div class="tree-item dir${isSelected ? " selected" : ""}${isMulti ? " multi-selected" : ""}" data-path="${this._escHtml(entry.path)}" data-type="dir" data-idx="${i}" style="padding-left:${paddingLeft}px;height:${this._itemHeight}px;line-height:${this._itemHeight}px;">
          <span class="tree-arrow${entry.isExpanded ? " expanded" : ""}">\u25B6</span>
          <span class="tree-icon">${this._folderIcon(entry.name, entry.isExpanded)}</span>
          <span class="tree-name">${this._escHtml(entry.name)}</span>
        </div>`;
      } else {
        html += `<div class="tree-item file${isSelected ? " selected" : ""}${isMulti ? " multi-selected" : ""}" data-path="${this._escHtml(entry.path)}" data-type="file" data-idx="${i}" style="padding-left:${paddingLeft}px;height:${this._itemHeight}px;line-height:${this._itemHeight}px;">
          <span class="tree-arrow-placeholder"></span>
          <span class="tree-icon">${this._fileIcon(entry.name)}</span>
          <span class="tree-name">${this._escHtml(entry.name)}</span>
        </div>`;
      }
    }
    html += `<div style="height:${(items.length - endIdx) * this._itemHeight}px"></div>`;
    this.treeEl.innerHTML = html;
    // Bind click events on visible items
    this.treeEl.querySelectorAll(".tree-item").forEach(el => {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = parseInt(el.dataset.idx);
        const entry = this._flatTree[idx];
        if (!entry) return;
        if (e.ctrlKey || e.metaKey) {
          this._toggleMultiSelect(entry.path);
          return;
        }
        this.selectedPath = entry.path;
        this.selectedPaths.clear();
        if (entry.isDirectory) {
          if (this.expandedDirs.has(entry.path)) {
            this.expandedDirs.delete(entry.path);
            if (entry.originalPath) this.expandedDirs.delete(entry.originalPath);
          } else {
            this.expandedDirs.add(entry.path);
            if (entry.originalPath) this.expandedDirs.add(entry.originalPath);
          }
          this.refresh();
        } else {
          this._renderVirtual(); // Update selection highlighting
          this.app.editor.openFile(entry.path);
        }
      });
    });
  }
  async _renderDir(dirPath, container, depth) {
    // Legacy method kept as fallback — primary rendering uses _renderVirtual()
    if (depth > 15) return;
    let entries;
    try {
      entries = await window.merecode.fs.readdir(dirPath);
    } catch (err) {
      console.error("[FileExplorer] readdir failed for:", dirPath, err);
      return;
    }
    if (!entries || entries.error || !Array.isArray(entries)) return;
    const filtered = entries.filter((entry) => !this._isGitignored(entry.name));
    for (const entry of filtered) {
      const el = document.createElement("div");
      el.className = `tree-item ${entry.isDirectory ? "dir" : "file"}${entry.path === this.selectedPath ? " selected" : ""}`;
      el.dataset.path = entry.path;
      el.dataset.type = entry.isDirectory ? "dir" : "file";
      el.style.paddingLeft = depth * 16 + 8 + "px";
      const isExpanded = this.expandedDirs.has(entry.path);
      if (entry.isDirectory) {
        el.innerHTML = `<span class="tree-arrow${isExpanded ? " expanded" : ""}">\u25B6</span><span class="tree-icon">${this._folderIcon(entry.name, isExpanded)}</span><span class="tree-name">${this._escHtml(entry.name)}</span>`;
        el.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (e.ctrlKey || e.metaKey) {
            this._toggleMultiSelect(entry.path);
            return;
          }
          this.selectedPath = entry.path;
          this.selectedPaths.clear();
          if (this.expandedDirs.has(entry.path)) {
            this.expandedDirs.delete(entry.path);
          } else {
            this.expandedDirs.add(entry.path);
          }
          this.refresh();
        });
      } else {
        el.innerHTML = `<span class="tree-arrow-placeholder"></span><span class="tree-icon">${this._fileIcon(entry.name)}</span><span class="tree-name">${this._escHtml(entry.name)}</span>`;
        el.addEventListener("click", (e) => {
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
        const childC = document.createElement("div");
        childC.className = "tree-children";
        container.appendChild(childC);
        await this._renderDir(entry.path, childC, depth + 1);
      }
    }
  }
  _toggleMultiSelect(itemPath) {
    if (this.selectedPaths.has(itemPath)) {
      this.selectedPaths.delete(itemPath);
    } else {
      this.selectedPaths.add(itemPath);
    }
    this._updateSelection();
    const count = this.selectedPaths.size;
    if (count > 0) this.app.showToast(`${count} item${count > 1 ? "s" : ""} selected (Ctrl+click to add/remove)`, "info", 1500);
  }
  _updateSelection() {
    this.treeEl.querySelectorAll(".tree-item").forEach((el) => {
      const htmlEl = el;
      const isSelected = htmlEl.dataset.path === this.selectedPath || this.selectedPaths.has(htmlEl.dataset.path);
      htmlEl.classList.toggle("selected", isSelected);
      htmlEl.classList.toggle("multi-selected", this.selectedPaths.has(htmlEl.dataset.path));
    });
  }
  getSelectedPaths() {
    if (this.selectedPaths.size > 0) return Array.from(this.selectedPaths);
    if (this.selectedPath) return [this.selectedPath];
    return [];
  }
  _escHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
  _fileIcon(name) {
    const ext = name.includes(".") ? "." + name.split(".").pop().toLowerCase() : "";
    const icons = {
      ".js": '<svg class="file-icon fi-js" viewBox="0 0 16 16"><text x="2" y="12" font-size="9" font-weight="600" fill="#f0db4f">JS</text></svg>',
      ".jsx": '<svg class="file-icon fi-jsx" viewBox="0 0 16 16"><text x="0" y="12" font-size="8" font-weight="600" fill="#61dafb">\u269B</text></svg>',
      ".ts": '<svg class="file-icon fi-ts" viewBox="0 0 16 16"><text x="2" y="12" font-size="9" font-weight="600" fill="#3178c6">TS</text></svg>',
      ".tsx": '<svg class="file-icon fi-tsx" viewBox="0 0 16 16"><text x="0" y="12" font-size="8" font-weight="600" fill="#61dafb">\u269B</text></svg>',
      ".py": '<svg class="file-icon fi-py" viewBox="0 0 16 16"><text x="1" y="12" font-size="9" font-weight="600" fill="#3776ab">Py</text></svg>',
      ".html": '<svg class="file-icon fi-html" viewBox="0 0 16 16"><text x="0" y="12" font-size="8" font-weight="600" fill="#e34f26">&lt;&gt;</text></svg>',
      ".css": '<svg class="file-icon fi-css" viewBox="0 0 16 16"><text x="2" y="12" font-size="9" font-weight="600" fill="#1572b6">#</text></svg>',
      ".scss": '<svg class="file-icon fi-scss" viewBox="0 0 16 16"><text x="2" y="12" font-size="9" font-weight="600" fill="#cc6699">#</text></svg>',
      ".json": '<svg class="file-icon fi-json" viewBox="0 0 16 16"><text x="1" y="12" font-size="9" font-weight="600" fill="#f5a623">{}</text></svg>',
      ".md": '<svg class="file-icon fi-md" viewBox="0 0 16 16"><text x="0" y="12" font-size="8" font-weight="600" fill="#519aba">MD</text></svg>',
      ".svg": '<svg class="file-icon fi-svg" viewBox="0 0 16 16"><text x="0" y="12" font-size="8" font-weight="600" fill="#ffb13b">\u25C7</text></svg>',
      ".png": '<svg class="file-icon fi-img" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1" fill="none" stroke="#4caf50" stroke-width="1.5"/></svg>',
      ".jpg": '<svg class="file-icon fi-img" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="1" fill="none" stroke="#4caf50" stroke-width="1.5"/></svg>',
      ".yaml": '<svg class="file-icon fi-yaml" viewBox="0 0 16 16"><text x="0" y="12" font-size="7" font-weight="600" fill="#cb171e">yml</text></svg>',
      ".yml": '<svg class="file-icon fi-yaml" viewBox="0 0 16 16"><text x="0" y="12" font-size="7" font-weight="600" fill="#cb171e">yml</text></svg>',
      ".go": '<svg class="file-icon fi-go" viewBox="0 0 16 16"><text x="1" y="12" font-size="9" font-weight="600" fill="#00add8">Go</text></svg>',
      ".rs": '<svg class="file-icon fi-rs" viewBox="0 0 16 16"><text x="1" y="12" font-size="9" font-weight="600" fill="#dea584">Rs</text></svg>',
      ".java": '<svg class="file-icon fi-java" viewBox="0 0 16 16"><text x="0" y="12" font-size="7" font-weight="600" fill="#b07219">J</text></svg>',
      ".rb": '<svg class="file-icon fi-rb" viewBox="0 0 16 16"><text x="1" y="12" font-size="9" font-weight="600" fill="#cc342d">Rb</text></svg>',
      ".php": '<svg class="file-icon fi-php" viewBox="0 0 16 16"><text x="0" y="12" font-size="7" font-weight="600" fill="#777bb4">php</text></svg>',
      ".sh": '<svg class="file-icon fi-sh" viewBox="0 0 16 16"><text x="1" y="12" font-size="8" font-weight="600" fill="#89e051">$_</text></svg>',
      ".env": '<svg class="file-icon fi-env" viewBox="0 0 16 16"><text x="1" y="12" font-size="8" font-weight="600" fill="#faf743">\u2699</text></svg>',
      ".gitignore": '<svg class="file-icon fi-git" viewBox="0 0 16 16"><text x="1" y="12" font-size="9" font-weight="600" fill="#f05032">G</text></svg>'
    };
    return icons[ext] || '<svg class="file-icon fi-default" viewBox="0 0 16 16"><rect x="3" y="1" width="10" height="14" rx="1" fill="none" stroke="currentColor" stroke-width="1" opacity="0.4"/></svg>';
  }
  _folderIcon(name, isExpanded) {
    const specialFolders = {
      "src": "#42a5f5",
      "lib": "#42a5f5",
      "app": "#42a5f5",
      "components": "#7c4dff",
      "pages": "#7c4dff",
      "views": "#7c4dff",
      "test": "#66bb6a",
      "tests": "#66bb6a",
      "__tests__": "#66bb6a",
      "spec": "#66bb6a",
      "public": "#ffa726",
      "static": "#ffa726",
      "assets": "#ffa726",
      "config": "#78909c",
      "scripts": "#78909c",
      "utils": "#78909c",
      "helpers": "#78909c",
      "styles": "#ec407a",
      "css": "#ec407a",
      "api": "#26c6da",
      "routes": "#26c6da",
      "models": "#ab47bc",
      "types": "#ab47bc"
    };
    const color = specialFolders[name.toLowerCase()] || "#90a4ae";
    if (isExpanded) {
      return `<svg class="file-icon" viewBox="0 0 16 16"><path d="M1.5 2h5l1.5 1.5H14.5v10h-13z" fill="${color}" opacity="0.85"/></svg>`;
    }
    return `<svg class="file-icon" viewBox="0 0 16 16"><path d="M1.5 2h5l1.5 1.5H14.5v10h-13z" fill="${color}" opacity="0.6"/></svg>`;
  }
  async promptNewFile(dirPath) {
    const parent = dirPath || this.rootPath;
    if (!parent) return;
    const name = prompt("New file name:");
    if (!name) return;
    const fp = window.merecode.path.join(parent, name);
    const result = await window.merecode.fs.writeFile(fp, "");
    if (!result.error) {
      await this.refresh();
      this.app.editor.openFile(fp);
    } else this.app.showToast(`Create file failed: ${result.error}`, "error");
  }
  async promptNewFolder(dirPath) {
    const parent = dirPath || this.rootPath;
    if (!parent) return;
    const name = prompt("New folder name:");
    if (!name) return;
    const result = await window.merecode.fs.mkdir(window.merecode.path.join(parent, name));
    if (!result.error) await this.refresh();
    else this.app.showToast(`Create folder failed: ${result.error}`, "error");
  }
  async promptRename(itemPath) {
    const oldName = window.merecode.path.basename(itemPath);
    const newName = prompt("Rename to:", oldName);
    if (!newName || newName === oldName) return;
    const dir = window.merecode.path.dirname(itemPath);
    const result = await window.merecode.fs.rename(itemPath, window.merecode.path.join(dir, newName));
    if (!result.error) await this.refresh();
    else this.app.showToast(`Rename failed: ${result.error}`, "error");
  }
  async promptDelete(itemPath) {
    const name = window.merecode.path.basename(itemPath);
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    const result = await window.merecode.fs.delete(itemPath);
    if (!result.error) {
      this.selectedPaths.clear();
      await this.refresh();
    } else this.app.showToast(`Delete failed: ${result.error}`, "error");
  }
  async deleteMultiple(paths) {
    if (!confirm(`Delete ${paths.length} items? This cannot be undone.`)) return;
    let failed = 0;
    for (const p of paths) {
      const r = await window.merecode.fs.delete(p);
      if (r.error) failed++;
    }
    this.selectedPaths.clear();
    await this.refresh();
    if (failed > 0) this.app.showToast(`${failed} item(s) could not be deleted`, "error");
    else this.app.showToast(`Deleted ${paths.length} items`, "success");
  }
  dispose() {
    if (this._fileWatcherCleanup) {
      this._fileWatcherCleanup();
      this._fileWatcherCleanup = null;
    }
    clearTimeout(this._refreshDebounce);
    this._refreshDebounce = null;
    window.merecode.fs.unwatchDir();
  }
}
export {
  FileExplorer
};
//# sourceMappingURL=fileExplorer.js.map
