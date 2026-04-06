class SearchManager {
  constructor(app) {
    this.results = [];
    this.query = "";
    this.replaceText = "";
    this.caseSensitive = false;
    this.wholeWord = false;
    this.useRegex = false;
    this._searching = false;
    this._debounceTimer = null;
    this._pendingSearch = false;
    this._searchHistory = [];
    this.app = app;
    this.searchInput = document.getElementById("search-input");
    this.replaceInput = document.getElementById("replace-input");
    this.resultsEl = document.getElementById("search-results");
    this._loadSearchHistory();
    this.searchInput?.addEventListener("input", () => this._onSearchInput());
    this.replaceInput?.addEventListener("input", () => {
      this.replaceText = this.replaceInput.value;
    });
    document.getElementById("opt-case")?.addEventListener("click", (e) => {
      this.caseSensitive = !this.caseSensitive;
      e.target.classList.toggle("active", this.caseSensitive);
      this._performSearch();
    });
    document.getElementById("opt-word")?.addEventListener("click", (e) => {
      this.wholeWord = !this.wholeWord;
      e.target.classList.toggle("active", this.wholeWord);
      this._performSearch();
    });
    document.getElementById("opt-regex")?.addEventListener("click", (e) => {
      this.useRegex = !this.useRegex;
      e.target.classList.toggle("active", this.useRegex);
      this._performSearch();
    });
    document.getElementById("btn-replace-all")?.addEventListener("click", () => this._replaceAll());
    document.getElementById("btn-search-history")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this._toggleSearchHistory();
    });
  }
  _loadSearchHistory() {
    try {
      this._searchHistory = JSON.parse(localStorage.getItem("merecode-search-history") || "[]").slice(0, 20);
    } catch { this._searchHistory = []; }
  }
  _saveSearchHistory(query) {
    if (!query || query.length < 2) return;
    this._searchHistory = this._searchHistory.filter(q => q !== query);
    this._searchHistory.unshift(query);
    this._searchHistory = this._searchHistory.slice(0, 20);
    try { localStorage.setItem("merecode-search-history", JSON.stringify(this._searchHistory)); } catch {}
  }
  _toggleSearchHistory() {
    const dropdown = document.getElementById("search-history-dropdown");
    if (!dropdown) return;
    if (dropdown.style.display !== "none") {
      dropdown.style.display = "none";
      return;
    }
    if (this._searchHistory.length === 0) {
      dropdown.innerHTML = '<div class="sh-empty">No search history</div>';
    } else {
      dropdown.innerHTML = `<div class="sh-header"><span>Recent Searches</span><button class="sh-clear" id="sh-clear-btn">Clear</button></div>` +
        this._searchHistory.map((q, i) =>
          `<div class="sh-item" data-idx="${i}" title="${this._esc(q)}">${this._esc(q.length > 40 ? q.slice(0, 40) + '…' : q)}</div>`
        ).join("");
    }
    dropdown.style.display = "block";
    dropdown.querySelectorAll(".sh-item").forEach(el => {
      el.addEventListener("click", () => {
        const q = this._searchHistory[parseInt(el.dataset.idx)];
        if (q && this.searchInput) {
          this.searchInput.value = q;
          this.query = q;
          this._performSearch();
        }
        dropdown.style.display = "none";
      });
    });
    document.getElementById("sh-clear-btn")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this._searchHistory = [];
      localStorage.removeItem("merecode-search-history");
      dropdown.style.display = "none";
    });
    const close = (e) => {
      if (!dropdown.contains(e.target) && e.target.id !== "btn-search-history") {
        dropdown.style.display = "none";
        document.removeEventListener("click", close);
      }
    };
    setTimeout(() => document.addEventListener("click", close), 0);
  }
  _onSearchInput() {
    this.query = this.searchInput.value;
    clearTimeout(this._debounceTimer);
    this._debounceTimer = setTimeout(() => this._performSearch(), 300);
  }
  async _performSearch() {
    const query = this.query.trim();
    if (!query || query.length < 2 || !this.app.rootPath) {
      this.results = [];
      this._renderResults();
      return;
    }
    if (this._searching) {
      this._pendingSearch = true;
      return;
    }
    this._searching = true;
    this._saveSearchHistory(query);
    if (this.resultsEl) {
      this.resultsEl.innerHTML = '<div class="search-loading"><span class="search-spinner"></span> Searching...</div>';
    }
    let searchQuery = query;
    if (this.wholeWord && !this.useRegex) {
      searchQuery = `\\b${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`;
    }
    try {
      const results = await window.merecode.fs.search(this.app.rootPath, this.useRegex || this.wholeWord ? searchQuery : query, {
        regex: this.useRegex || this.wholeWord,
        caseSensitive: this.caseSensitive,
        maxResults: 300
      });
      this.results = Array.isArray(results) ? results : [];
    } catch {
      this.results = [];
    }
    this._searching = false;
    this._renderResults();
    if (this._pendingSearch) {
      this._pendingSearch = false;
      this._performSearch();
    }
  }
  _renderResults() {
    if (!this.resultsEl) return;
    if (this.results.length === 0 && this.query.trim().length >= 2) {
      this.resultsEl.innerHTML = '<div class="search-no-results">No results found</div>';
      return;
    }
    if (this.results.length === 0) {
      this.resultsEl.innerHTML = "";
      return;
    }
    const grouped = {};
    for (const r of this.results) {
      if (!grouped[r.file]) grouped[r.file] = [];
      grouped[r.file].push(r);
    }
    const fileCount = Object.keys(grouped).length;
    const totalCount = this.results.length;
    let html = `<div class="search-summary">${totalCount} results in ${fileCount} files</div>`;
    for (const [file, matches] of Object.entries(grouped)) {
      const relPath = matches[0].relativePath;
      const fileName = relPath.split(/[/\\]/).pop();
      html += `<div class="search-file-group">`;
      html += `<div class="search-file-header" data-path="${this._esc(file)}">
        <span class="tree-arrow expanded">\u25B6</span>
        <span class="search-file-name">${this._esc(fileName)}</span>
        <span class="search-file-path">${this._esc(relPath)}</span>
        <span class="search-file-count">${matches.length}</span>
      </div>`;
      html += `<div class="search-file-matches">`;
      for (const m of matches) {
        const highlighted = this._highlightMatch(m.text, this.query);
        html += `<div class="search-match" data-file="${this._esc(m.file)}" data-line="${m.line}">
          <span class="search-line-num">${m.line}</span>
          <span class="search-line-text">${highlighted}</span>
        </div>`;
      }
      html += `</div></div>`;
    }
    this.resultsEl.innerHTML = html;
    this.resultsEl.querySelectorAll(".search-match").forEach((el) => {
      el.addEventListener("click", () => {
        const htmlEl = el;
        const file = htmlEl.dataset.file;
        const line = parseInt(htmlEl.dataset.line);
        this.app.editor.openFile(file).then(() => {
          setTimeout(() => {
            this.app.editor.editor?.revealLineInCenter(line);
            this.app.editor.editor?.setPosition({ lineNumber: line, column: 1 });
            this.app.editor.editor?.focus();
          }, 100);
        });
      });
    });
    this.resultsEl.querySelectorAll(".search-file-header").forEach((el) => {
      el.addEventListener("click", () => {
        const matches = el.nextElementSibling;
        const arrow = el.querySelector(".tree-arrow");
        if (matches.style.display === "none") {
          matches.style.display = "";
          arrow?.classList.add("expanded");
        } else {
          matches.style.display = "none";
          arrow?.classList.remove("expanded");
        }
      });
    });
  }
  _highlightMatch(text, query) {
    const escaped = this._esc(text);
    if (!query) return escaped;
    try {
      const flags = this.caseSensitive ? "g" : "gi";
      const pattern = this.useRegex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
      return escaped.replace(pattern, '<mark class="search-highlight">$&</mark>');
    } catch {
      return escaped;
    }
  }
  async _replaceAll() {
    if (!this.results.length || !this.replaceText && this.replaceText !== "") return;
    if (!this.app.rootPath) return;
    const files = [...new Set(this.results.map((r) => r.file))];
    const totalMatches = this.results.length;
    // Confirm before destructive bulk operation
    if (!confirm(`Replace ${totalMatches} occurrences across ${files.length} file${files.length > 1 ? "s" : ""}?\n\n"${this.query}" → "${this.replaceText}"\n\nYou can undo with Ctrl+Z in each file.`)) return;
    // Create backups for undo
    const backups = [];
    for (const file of files) {
      try {
        const res = await window.merecode.fs.readFile(file);
        if (res.content) backups.push({ file, content: res.content });
      } catch {}
    }
    let totalReplaced = 0;
    for (const file of files) {
      const result = await window.merecode.fs.replaceInFile(file, this.query, this.replaceText, {
        regex: this.useRegex,
        caseSensitive: this.caseSensitive
      });
      if (result.replaced) totalReplaced += result.replaced;
      // Update open editor tabs
      const tab = this.app.editor?.tabs?.find((t) => t.filePath === file);
      if (tab) {
        const newRes = await window.merecode.fs.readFile(file);
        if (newRes.content) {
          tab.model.setValue(newRes.content);
          tab.isDirty = false;
          this.app.editor._renderTabs();
        }
      }
    }
    this._lastReplaceBackup = backups;
    this.app.showToast(`Replaced ${totalReplaced} occurrences in ${files.length} files`, "success");
    this._performSearch();
  }
  async undoLastReplace() {
    if (!this._lastReplaceBackup?.length) {
      this.app.showToast("Nothing to undo", "warning");
      return;
    }
    let restored = 0;
    for (const b of this._lastReplaceBackup) {
      try {
        await window.merecode.fs.writeFile(b.file, b.content);
        const tab = this.app.editor?.tabs?.find((t) => t.filePath === b.file);
        if (tab) {
          tab.model.setValue(b.content);
          tab.isDirty = false;
          this.app.editor._renderTabs();
        }
        restored++;
      } catch {}
    }
    this._lastReplaceBackup = [];
    this.app.showToast(`Restored ${restored} files`, "success");
    this._performSearch();
  }
  _esc(s) {
    return s ? s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") : "";
  }
}
export {
  SearchManager
};
//# sourceMappingURL=search.js.map
