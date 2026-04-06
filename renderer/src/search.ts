// search.ts — Project-wide Search & Replace
import type { MereCodeApp } from './app.js';

export class SearchManager {
  app: MereCodeApp;
  results: SearchResult[] = [];
  query = '';
  replaceText = '';
  caseSensitive = false;
  wholeWord = false;
  useRegex = false;
  private _searching = false;
  private _debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private _pendingSearch = false;

  private searchInput: HTMLInputElement | null;
  private replaceInput: HTMLInputElement | null;
  private resultsEl: HTMLElement | null;

  constructor(app: MereCodeApp) {
    this.app = app;
    this.searchInput = document.getElementById('search-input') as HTMLInputElement | null;
    this.replaceInput = document.getElementById('replace-input') as HTMLInputElement | null;
    this.resultsEl = document.getElementById('search-results');

    this.searchInput?.addEventListener('input', () => this._onSearchInput());
    this.replaceInput?.addEventListener('input', () => { this.replaceText = this.replaceInput!.value; });

    document.getElementById('opt-case')?.addEventListener('click', (e) => {
      this.caseSensitive = !this.caseSensitive;
      (e.target as Element).classList.toggle('active', this.caseSensitive);
      this._performSearch();
    });
    document.getElementById('opt-word')?.addEventListener('click', (e) => {
      this.wholeWord = !this.wholeWord;
      (e.target as Element).classList.toggle('active', this.wholeWord);
      this._performSearch();
    });
    document.getElementById('opt-regex')?.addEventListener('click', (e) => {
      this.useRegex = !this.useRegex;
      (e.target as Element).classList.toggle('active', this.useRegex);
      this._performSearch();
    });

    document.getElementById('btn-replace-all')?.addEventListener('click', () => this._replaceAll());
  }

  private _onSearchInput(): void {
    this.query = this.searchInput!.value;
    clearTimeout(this._debounceTimer!);
    this._debounceTimer = setTimeout(() => this._performSearch(), 300);
  }

  private async _performSearch(): Promise<void> {
    const query = this.query.trim();
    if (!query || query.length < 2 || !this.app.rootPath) {
      this.results = [];
      this._renderResults();
      return;
    }

    if (this._searching) { this._pendingSearch = true; return; }
    this._searching = true;

    if (this.resultsEl) {
      this.resultsEl.innerHTML = '<div class="search-loading"><span class="search-spinner"></span> Searching...</div>';
    }

    let searchQuery = query;
    if (this.wholeWord && !this.useRegex) {
      searchQuery = `\\b${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`;
    }

    try {
      const results = await window.merecode.fs.search(this.app.rootPath, this.useRegex || this.wholeWord ? searchQuery : query, {
        regex: this.useRegex || this.wholeWord,
        caseSensitive: this.caseSensitive,
        maxResults: 300,
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

  private _renderResults(): void {
    if (!this.resultsEl) return;

    if (this.results.length === 0 && this.query.trim().length >= 2) {
      this.resultsEl.innerHTML = '<div class="search-no-results">No results found</div>';
      return;
    }

    if (this.results.length === 0) {
      this.resultsEl.innerHTML = '';
      return;
    }

    const grouped: Record<string, SearchResult[]> = {};
    for (const r of this.results) {
      if (!grouped[r.file]) grouped[r.file] = [];
      grouped[r.file].push(r);
    }

    const fileCount = Object.keys(grouped).length;
    const totalCount = this.results.length;

    let html = `<div class="search-summary">${totalCount} results in ${fileCount} files</div>`;

    for (const [file, matches] of Object.entries(grouped)) {
      const relPath = matches[0].relativePath;
      const fileName = relPath.split(/[/\\]/).pop()!;
      html += `<div class="search-file-group">`;
      html += `<div class="search-file-header" data-path="${this._esc(file)}">
        <span class="tree-arrow expanded">▶</span>
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

    this.resultsEl.querySelectorAll('.search-match').forEach(el => {
      el.addEventListener('click', () => {
        const htmlEl = el as HTMLElement;
        const file = htmlEl.dataset.file!;
        const line = parseInt(htmlEl.dataset.line!);
        this.app.editor.openFile(file).then(() => {
          setTimeout(() => {
            this.app.editor.editor?.revealLineInCenter(line);
            this.app.editor.editor?.setPosition({ lineNumber: line, column: 1 });
            this.app.editor.editor?.focus();
          }, 100);
        });
      });
    });

    this.resultsEl.querySelectorAll('.search-file-header').forEach(el => {
      el.addEventListener('click', () => {
        const matches = (el as HTMLElement).nextElementSibling as HTMLElement;
        const arrow = el.querySelector('.tree-arrow');
        if (matches.style.display === 'none') {
          matches.style.display = '';
          arrow?.classList.add('expanded');
        } else {
          matches.style.display = 'none';
          arrow?.classList.remove('expanded');
        }
      });
    });
  }

  private _highlightMatch(text: string, query: string): string {
    const escaped = this._esc(text);
    if (!query) return escaped;
    try {
      const flags = this.caseSensitive ? 'g' : 'gi';
      const pattern = this.useRegex ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
      return escaped.replace(pattern, '<mark class="search-highlight">$&</mark>');
    } catch {
      return escaped;
    }
  }

  private async _replaceAll(): Promise<void> {
    if (!this.results.length || (!this.replaceText && this.replaceText !== '')) return;
    if (!this.app.rootPath) return;

    const files = [...new Set(this.results.map(r => r.file))];
    let totalReplaced = 0;

    for (const file of files) {
      const result = await window.merecode.fs.replaceInFile(file, this.query, this.replaceText, {
        regex: this.useRegex,
        caseSensitive: this.caseSensitive,
      });
      if (result.replaced) totalReplaced += result.replaced;
    }

    this.app.showToast(`Replaced ${totalReplaced} occurrences in ${files.length} files`, 'success');
    this._performSearch();
  }

  private _esc(s: string): string {
    return s ? s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '';
  }
}
