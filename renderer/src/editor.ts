// editor.ts — Monaco Editor management with AI completions, themes, diagnostics, XSS-safe markdown
import type { MereCodeApp } from './app.js';

interface EditorTab {
  id: string;
  filePath: string | null;
  name: string;
  model: any;
  viewState: any;
  isDirty: boolean;
  _saving: boolean;
  _autoSaveDebounce: ReturnType<typeof setTimeout> | null;
}

export class EditorManager {
  app: MereCodeApp;
  editor: any = null;
  monaco: any = null;
  tabs: EditorTab[] = [];
  activeTabId: string | null = null;
  untitledCount = 0;
  minimapEnabled = true;
  wordWrapMode = 'off';
  _currentTheme = 'mere-dark';
  private _completionTimer: any = null;
  private _completionDisposable: any = null;
  private _outlineRefreshTimer: any = null;
  private _autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  private _autoSaveDebounce: any = null;
  private _disposables: any[] = [];
  private _splitEditor: any = null;
  private _mdPreviewDisposable: any = null;
  private _codeActionToolbar: HTMLElement | null = null;
  private _codeActionTimer: any = null;
  private _resizeHandler: (() => void) | null = null;

  constructor(app: MereCodeApp) {
    this.app = app;
  }

  async init(): Promise<void> {
    return new Promise((resolve) => {
      (window as any).require.config({ paths: { vs: '/node_modules/monaco-editor/min/vs' } });

      (self as any).MonacoEnvironment = {
        getWorkerUrl(_: string, label: string) {
          return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
            self.MonacoEnvironment = { baseUrl: '${location.origin}/node_modules/monaco-editor/min/' };
            importScripts('${location.origin}/node_modules/monaco-editor/min/vs/base/worker/workerMain.js');
          `)}`;
        }
      };

      (window as any).require(['vs/editor/editor.main'], (monaco: any) => {
        this.monaco = monaco;
        this._defineTheme(monaco);
        this._createEditor(monaco);
        this._bindEvents();
        resolve();
      });
    });
  }

  private _defineTheme(monaco: any): void {
    monaco.editor.defineTheme('mere-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment',  foreground: '8a8279', fontStyle: 'italic' },
        { token: 'keyword',  foreground: 'c96442' },
        { token: 'string',   foreground: '34d399' },
        { token: 'number',   foreground: 'f59e0b' },
        { token: 'type',     foreground: '60a5fa' },
        { token: 'function', foreground: 'f5f0e8' },
        { token: 'variable', foreground: 'c4bdb2' },
        { token: 'constant', foreground: 'f97316' },
        { token: 'regexp',   foreground: 'e879f9' },
        { token: 'tag',      foreground: 'c96442' },
        { token: 'attribute.name', foreground: '60a5fa' },
        { token: 'attribute.value', foreground: '34d399' },
      ],
      colors: {
        'editor.background':               '#191918',
        'editor.foreground':               '#f5f0e8',
        'editor.lineHighlightBackground':  '#232322',
        'editor.selectionBackground':      'rgba(201,100,66,0.3)',
        'editorCursor.foreground':         '#c96442',
        'editorWhitespace.foreground':     '#2a2a29',
        'editorIndentGuide.background':    '#2a2a29',
        'editorIndentGuide.activeBackground': '#5a5550',
        'editor.findMatchBackground':      'rgba(201,100,66,0.35)',
        'editor.findMatchHighlightBackground': 'rgba(201,100,66,0.15)',
        'editorBracketMatch.background':   'rgba(201,100,66,0.2)',
        'editorBracketMatch.border':       '#c96442',
        'editorGutter.background':         '#191918',
        'editorLineNumber.foreground':     '#5a5550',
        'editorLineNumber.activeForeground': '#8a8279',
        'scrollbarSlider.background':      'rgba(255,255,255,0.08)',
        'scrollbarSlider.hoverBackground': 'rgba(255,255,255,0.14)',
        'scrollbarSlider.activeBackground':'rgba(201,100,66,0.3)',
        'minimap.background':              '#191918',
      },
    });

    monaco.editor.defineTheme('mere-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment',  foreground: '8a8279', fontStyle: 'italic' },
        { token: 'keyword',  foreground: 'b5533d' },
        { token: 'string',   foreground: '1a8a5c' },
        { token: 'number',   foreground: 'c88a0a' },
        { token: 'type',     foreground: '3b7dd8' },
        { token: 'function', foreground: '2d2d2c' },
        { token: 'variable', foreground: '4a4540' },
        { token: 'constant', foreground: 'd4630f' },
        { token: 'regexp',   foreground: 'b05cc0' },
        { token: 'tag',      foreground: 'b5533d' },
        { token: 'attribute.name', foreground: '3b7dd8' },
        { token: 'attribute.value', foreground: '1a8a5c' },
      ],
      colors: {
        'editor.background':               '#faf8f5',
        'editor.foreground':               '#2d2d2c',
        'editor.lineHighlightBackground':  '#f0ede8',
        'editor.selectionBackground':      'rgba(201,100,66,0.2)',
        'editorCursor.foreground':         '#c96442',
        'editorWhitespace.foreground':     '#e0dcd5',
        'editorIndentGuide.background':    '#e0dcd5',
        'editorIndentGuide.activeBackground': '#c4bdb2',
        'editor.findMatchBackground':      'rgba(201,100,66,0.25)',
        'editor.findMatchHighlightBackground': 'rgba(201,100,66,0.1)',
        'editorBracketMatch.background':   'rgba(201,100,66,0.15)',
        'editorBracketMatch.border':       '#c96442',
        'editorGutter.background':         '#faf8f5',
        'editorLineNumber.foreground':     '#c4bdb2',
        'editorLineNumber.activeForeground': '#8a8279',
        'scrollbarSlider.background':      'rgba(0,0,0,0.08)',
        'scrollbarSlider.hoverBackground': 'rgba(0,0,0,0.14)',
        'scrollbarSlider.activeBackground':'rgba(201,100,66,0.3)',
        'minimap.background':              '#faf8f5',
      },
    });
  }

  setTheme(themeName: string): void {
    this._currentTheme = themeName;
    this.monaco?.editor.setTheme(themeName);
    localStorage.setItem('merecode-theme', themeName);
    if (this._splitEditor) this._splitEditor.updateOptions({ theme: themeName });
    this.app.terminal?.updateTheme();
  }

  splitEditor(): void {
    if (this._splitEditor) { this.closeSplit(); return; }
    const container = document.getElementById('editor-container')!;
    const splitEl = document.createElement('div');
    splitEl.id = 'split-editor-container';
    container.classList.add('split-active');
    container.appendChild(splitEl);

    const tab = this.tabs.find(t => t.id === this.activeTabId);
    this._splitEditor = this.monaco.editor.create(splitEl, {
      model: tab?.model || null,
      theme: this._currentTheme,
      fontSize: parseInt(localStorage.getItem('merecode-font-size') || '14'),
      fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, monospace",
      fontLigatures: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      readOnly: false,
      bracketPairColorization: { enabled: true },
      padding: { top: 8 },
    });
    this.layout();
    this.app.showToast('Split editor opened', 'info', 1500);
  }

  closeSplit(): void {
    if (!this._splitEditor) return;
    this._splitEditor.dispose();
    this._splitEditor = null;
    document.getElementById('split-editor-container')?.remove();
    document.getElementById('editor-container')!.classList.remove('split-active');
    this.layout();
  }

  updateBreadcrumbs(filePath: string | null): void {
    const el = document.getElementById('breadcrumbs');
    if (!el) return;
    if (!filePath) { el.innerHTML = ''; el.style.display = 'none'; return; }
    el.style.display = 'flex';

    let relPath = filePath;
    if (this.app.rootPath) {
      const root = this.app.rootPath.replace(/\\/g, '/');
      relPath = filePath.replace(/\\/g, '/').replace(root, '').replace(/^\//, '');
    }

    const parts = relPath.split(/[/\\]/);
    el.innerHTML = parts.map((part, i) => {
      const isLast = i === parts.length - 1;
      const partialPath = parts.slice(0, i + 1).join('/');
      return `<span class="bc-item${isLast ? ' bc-active' : ''}" data-path="${this._escText(partialPath)}" data-is-dir="${!isLast}">${this._escText(part)}</span>${isLast ? '' : '<span class="bc-sep">›</span>'}`;
    }).join('');

    el.querySelectorAll('.bc-item').forEach(item => {
      (item as HTMLElement).style.cursor = 'pointer';
      item.addEventListener('click', () => {
        const partial = (item as HTMLElement).dataset.path;
        if (!partial) return;
        const isDir = (item as HTMLElement).dataset.isDir === 'true';
        if (isDir && this.app.rootPath) {
          const fullDir = window.merecode.path.join(this.app.rootPath, partial);
          this.app.fileExplorer?.expandedDirs?.add(fullDir);
          this.app.fileExplorer?.refresh();
        }
      });
    });
  }

  private _escText(s: string): string { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  startAutoSave(): void {
    this.stopAutoSave();
    if (localStorage.getItem('merecode-auto-save') !== 'true') return;
    this._autoSaveTimer = setInterval(() => {
      this._flushDirtyTabs();
    }, 2000);
  }

  private _flushDirtyTabs(): void {
    for (const tab of this.tabs) {
      if (tab.isDirty && tab.filePath && !tab._saving) {
        tab._saving = true;
        window.merecode.fs.writeFile(tab.filePath, tab.model.getValue()).then((r: any) => {
          tab._saving = false;
          if (!r.error) { tab.isDirty = false; this._renderTabs(); }
        }).catch(() => { tab._saving = false; });
      }
    }
  }

  _markDirtyWithDebounce(tab: EditorTab): void {
    if (!tab.isDirty) {
      tab.isDirty = true;
      this._renderTabs();
    }
    if (localStorage.getItem('merecode-auto-save') === 'true' && tab.filePath) {
      clearTimeout(tab._autoSaveDebounce!);
      tab._autoSaveDebounce = setTimeout(() => {
        if (tab.isDirty && tab.filePath && !tab._saving) {
          tab._saving = true;
          window.merecode.fs.writeFile(tab.filePath, tab.model.getValue()).then((r: any) => {
            tab._saving = false;
            if (!r.error) { tab.isDirty = false; this._renderTabs(); }
          }).catch(() => { tab._saving = false; });
        }
      }, 1000);
    }
  }

  stopAutoSave(): void {
    if (this._autoSaveTimer) { clearInterval(this._autoSaveTimer); this._autoSaveTimer = null; }
  }

  async showImagePreview(filePath: string): Promise<void> {
    this.hideImagePreview();
    this.app.hideWelcome();
    document.getElementById('monaco-container')!.style.display = 'none';

    const container = document.getElementById('editor-container')!;
    const preview = document.createElement('div');
    preview.id = 'image-preview';
    const name = window.merecode.path.basename(filePath);

    const result = await window.merecode.fs.readFileBase64(filePath) as any;
    if (result.error) {
      preview.innerHTML = `<div class="image-preview-wrap"><div class="image-error">Cannot load image: ${this._escText(result.error)}</div></div>`;
    } else {
      preview.innerHTML = `
        <div class="image-preview-wrap">
          <img src="data:${result.mime};base64,${result.data}" alt="${this._escText(name)}" draggable="false">
          <div class="image-preview-info">${this._escText(name)}</div>
        </div>`;
    }
    container.appendChild(preview);
    document.getElementById('titlebar-filename')!.textContent = name;
    this.updateBreadcrumbs(filePath);
  }

  hideImagePreview(): void {
    document.getElementById('image-preview')?.remove();
  }

  toggleMarkdownPreview(): void {
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    if (!tab) return;

    const container = document.getElementById('editor-container')!;
    let preview = document.getElementById('markdown-preview');

    if (preview) {
      preview.remove();
      container.classList.remove('md-preview-active');
      this._mdPreviewDisposable?.dispose();
      this._mdPreviewDisposable = null;
      this.layout();
      return;
    }

    container.classList.add('md-preview-active');
    preview = document.createElement('div');
    preview.id = 'markdown-preview';
    preview.innerHTML = `<div class="md-body">${this._renderMarkdown(tab.model.getValue())}</div>`;
    container.appendChild(preview);

    this._mdPreviewDisposable = tab.model.onDidChangeContent(() => {
      const el = document.getElementById('markdown-preview');
      if (el) el.innerHTML = `<div class="md-body">${this._renderMarkdown(tab.model.getValue())}</div>`;
    });
    this.layout();
  }

  private _renderMarkdown(md: string): string {
    let safe = md
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return safe
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^\- (.+)$/gm, '<li>$1</li>')
      .replace(/^\d+\. (.+)$/gm, '<li>$1</li>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_: string, text: string, href: string) => {
        if (/^(https?:\/\/|mailto:|#)/.test(href)) {
          return `<a href="${href}" rel="noopener">${text}</a>`;
        }
        return `${text} (${href})`;
      })
      .replace(/^---$/gm, '<hr>')
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>');
  }

  getOutline(): { name: string; kind: string; line: number; icon: string }[] {
    const model = this.editor?.getModel();
    if (!model) return [];
    const text = model.getValue();
    const symbols: { name: string; kind: string; line: number; icon: string }[] = [];
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m: RegExpMatchArray | null;
      if ((m = line.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/))) {
        symbols.push({ name: m[1], kind: 'function', line: i + 1, icon: 'ƒ' });
      } else if ((m = line.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[\w]+)\s*=>/))) {
        symbols.push({ name: m[1], kind: 'function', line: i + 1, icon: 'ƒ' });
      } else if ((m = line.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function/))) {
        symbols.push({ name: m[1], kind: 'function', line: i + 1, icon: 'ƒ' });
      } else if ((m = line.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/))) {
        symbols.push({ name: m[1], kind: 'function', line: i + 1, icon: 'ƒ' });
      } else if ((m = line.match(/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/))) {
        symbols.push({ name: m[1], kind: 'class', line: i + 1, icon: 'C' });
      } else if ((m = line.match(/^\s+(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?(\w+)\s*\([^)]*\)\s*\{/))) {
        if (!['if', 'for', 'while', 'switch', 'catch', 'else', 'return', 'new', 'typeof'].includes(m[1])) {
          symbols.push({ name: m[1], kind: 'method', line: i + 1, icon: 'm' });
        }
      } else if ((m = line.match(/^(?:export\s+)?(?:interface|type)\s+(\w+)/))) {
        symbols.push({ name: m[1], kind: 'interface', line: i + 1, icon: 'I' });
      } else if ((m = line.match(/^(?:export\s+)?enum\s+(\w+)/))) {
        symbols.push({ name: m[1], kind: 'enum', line: i + 1, icon: 'E' });
      } else if ((m = line.match(/^(?:async\s+)?def\s+(\w+)/))) {
        symbols.push({ name: m[1], kind: 'function', line: i + 1, icon: 'ƒ' });
      } else if ((m = line.match(/^class\s+(\w+)/))) {
        symbols.push({ name: m[1], kind: 'class', line: i + 1, icon: 'C' });
      } else if ((m = line.match(/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/))) {
        symbols.push({ name: m[1], kind: 'function', line: i + 1, icon: 'ƒ' });
      } else if ((m = line.match(/^func\s+(?:\([^)]+\)\s+)?(\w+)/))) {
        symbols.push({ name: m[1], kind: 'function', line: i + 1, icon: 'ƒ' });
      }
    }
    return symbols;
  }

  private _initInlineCompletions(monaco: any): void {
    const self = this;
    this._completionDisposable = monaco.languages.registerInlineCompletionsProvider('*', {
      provideInlineCompletions: async (model: any, position: any, context: any, token: any) => {
        const apiKey = localStorage.getItem('merecode-api-key');
        if (!apiKey) return { items: [] };
        if (token.isCancellationRequested) return { items: [] };

        const textBeforeCursor = model.getValueInRange({
          startLineNumber: Math.max(1, position.lineNumber - 20),
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column,
        });
        const textAfterCursor = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: Math.min(model.getLineCount(), position.lineNumber + 5),
          endColumn: model.getLineMaxColumn(Math.min(model.getLineCount(), position.lineNumber + 5)),
        });

        if (textBeforeCursor.trim().length < 5) return { items: [] };

        try {
          const language = model.getLanguageId();
          const tab = self.tabs.find(t => t.id === self.activeTabId);
          const fileName = tab?.name || 'untitled';

          const controller = new AbortController();
          const cancelListener = token.onCancellationRequested(() => controller.abort());
          const timeoutId = setTimeout(() => controller.abort(), 5000);

          const apiEndpoint = 'https://merex.ai/api/v1/chat';

          const res = await fetch(apiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: 'mere-nyx',
              messages: [{ role: 'user', parts: [{ text: `Complete the following ${language} code. File: ${fileName}\n\nCode before cursor:\n${textBeforeCursor}\n\nCode after cursor:\n${textAfterCursor}\n\nProvide ONLY the completion text (what goes at the cursor position). No explanation, no markdown, no code fences. Just the raw code to insert.` }] }],
              temperature: 0.2,
              systemPrompt: 'You are an inline code completion engine. Output ONLY the raw code continuation. Never include markdown, explanations, or code fences. Output exactly what should be typed next. Keep completions short (1-3 lines max).',
            }),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);
          cancelListener.dispose();

          if (!res.ok) return { items: [] };

          const reader = res.body?.getReader();
          const decoder = new TextDecoder();
          let fullText = '';
          if (reader) {
            let buffer = '';
            while (true) {
              if (token.isCancellationRequested) { reader.cancel(); return { items: [] }; }
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
                  const chunk = parsed?.text || parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
                  if (chunk) fullText += chunk;
                } catch { /* skip */ }
              }
            }
          }

          fullText = fullText.replace(/^```\w*\n?/, '').replace(/\n?```$/, '').trim();
          if (!fullText || fullText.length > 500) return { items: [] };

          return {
            items: [{
              insertText: fullText,
              range: {
                startLineNumber: position.lineNumber,
                startColumn: position.column,
                endLineNumber: position.lineNumber,
                endColumn: position.column,
              },
            }],
          };
        } catch {
          return { items: [] };
        }
      },
      freeInlineCompletions() {},
    });
  }

  private _createEditor(monaco: any): void {
    const savedTheme = localStorage.getItem('merecode-theme') || 'mere-dark';
    this._currentTheme = savedTheme;

    this.editor = monaco.editor.create(document.getElementById('monaco-container'), {
      value: '',
      language: 'plaintext',
      theme: savedTheme,
      fontSize: parseInt(localStorage.getItem('merecode-font-size') || '14'),
      fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, monospace",
      fontLigatures: true,
      minimap: { enabled: localStorage.getItem('merecode-minimap') !== 'false' },
      scrollBeyondLastLine: false,
      renderWhitespace: 'selection',
      smoothScrolling: true,
      cursorSmoothCaretAnimation: 'on',
      cursorBlinking: 'smooth',
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      wordWrap: localStorage.getItem('merecode-word-wrap') || 'off',
      automaticLayout: false,
      tabSize: parseInt(localStorage.getItem('merecode-tab-size') || '2'),
      insertSpaces: true,
      quickSuggestions: true,
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnCommitCharacter: true,
      inlineSuggest: { enabled: true },
      autoClosingBrackets: 'always',
      autoClosingQuotes: 'always',
      autoIndent: 'full',
      folding: true,
      foldingStrategy: 'indentation',
      links: true,
      mouseWheelZoom: true,
      padding: { top: 8 },
      lineNumbers: 'on',
      contextmenu: true,
    });

    this._initInlineCompletions(monaco);
    this._registerContextMenuActions();
    this.startAutoSave();
  }

  private _bindEvents(): void {
    const d1 = this.editor.onDidChangeCursorPosition((e: any) => {
      const pos = e.position;
      document.getElementById('status-position')!.textContent = `Ln ${pos.lineNumber}, Col ${pos.column}`;
    });
    this._disposables.push(d1);

    const d2 = this.editor.onDidChangeModelContent(() => {
      const tab = this.tabs.find(t => t.id === this.activeTabId);
      if (tab) this._markDirtyWithDebounce(tab);
      clearTimeout(this._outlineRefreshTimer);
      this._outlineRefreshTimer = setTimeout(() => this.app.refreshOutline?.(), 500);
    });
    this._disposables.push(d2);

    this._initCodeActions();

    this._resizeHandler = () => this.layout();
    window.addEventListener('resize', this._resizeHandler);
  }

  private _initCodeActions(): void {
    const toolbar = document.createElement('div');
    toolbar.id = 'code-action-toolbar';
    toolbar.className = 'code-action-toolbar';
    toolbar.innerHTML = `
      <button class="ca-btn" data-action="fix" title="Ask AI to fix bugs in selection">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zM7.5 4h1v5h-1V4zm.5 8a.75.75 0 110-1.5.75.75 0 010 1.5z"/></svg>
        Fix Bug
      </button>
      <button class="ca-btn" data-action="explain" title="Ask AI to explain selection">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 100 16A8 8 0 008 0zm1 12H7v-5h2v5zm0-7H7V3h2v2z"/></svg>
        Explain
      </button>
      <button class="ca-btn" data-action="refactor" title="Ask AI to refactor selection">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M2.24 7.56L1 8.8l4 4 8-8-1.24-1.24L5 10.32l-2.76-2.76zM12 2l-1 1 2 2 1-1-2-2z" opacity=".5"/><path d="M8 0l2 4H6L8 0zm0 16l-2-4h4l-2 4z"/></svg>
        Refactor
      </button>
      <button class="ca-btn" data-action="docs" title="Ask AI to add documentation">
        <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M1 2.5A1.5 1.5 0 012.5 1h11A1.5 1.5 0 0115 2.5v9.75A1.5 1.5 0 0113.5 13.75H9.5l-3 2.25V13.75H2.5A1.5 1.5 0 011 12.25V2.5z"/></svg>
        Add Docs
      </button>
    `;
    document.body.appendChild(toolbar);
    this._codeActionToolbar = toolbar;

    this._codeActionTimer = null;
    const d = this.editor.onDidChangeCursorSelection((e: any) => {
      clearTimeout(this._codeActionTimer);
      const sel = e.selection;
      if (sel.isEmpty()) { toolbar.classList.remove('visible'); return; }
      this._codeActionTimer = setTimeout(() => { this._positionCodeActionToolbar(sel); }, 400);
    });
    this._disposables.push(d);

    const d2 = this.editor.onDidScrollChange(() => { toolbar.classList.remove('visible'); });
    this._disposables.push(d2);

    toolbar.addEventListener('mousedown', (e: Event) => { e.preventDefault(); });
    toolbar.addEventListener('click', (e: MouseEvent) => {
      const btn = (e.target as Element).closest('.ca-btn') as HTMLElement | null;
      if (!btn) return;
      const action = btn.dataset.action!;
      const sel = this.editor.getSelection();
      const code = this.editor.getModel()?.getValueInRange(sel) || '';
      if (!code.trim()) return;
      toolbar.classList.remove('visible');
      this._triggerCodeAction(action, code);
    });
  }

  private _positionCodeActionToolbar(selection: any): void {
    const toolbar = this._codeActionToolbar;
    if (!toolbar) return;
    const container = document.getElementById('monaco-container');
    if (!container) return;

    const pos = this.editor.getScrolledVisiblePosition({
      lineNumber: selection.startLineNumber,
      column: selection.startColumn,
    });
    if (!pos) { toolbar.classList.remove('visible'); return; }

    const containerRect = container.getBoundingClientRect();
    let top = containerRect.top + pos.top - 40;
    let left = containerRect.left + pos.left;

    top = Math.max(containerRect.top + 2, top);
    const toolbarWidth = 280;
    left = Math.min(left, window.innerWidth - toolbarWidth - 8);
    left = Math.max(containerRect.left + 4, left);

    toolbar.style.top = top + 'px';
    toolbar.style.left = left + 'px';
    toolbar.classList.add('visible');
  }

  private _triggerCodeAction(action: string, code: string): void {
    const lang = this.editor.getModel()?.getLanguageId() || '';
    const fence = lang ? `\`\`\`${lang}` : '```';
    const prompts: Record<string, string> = {
      fix: `Fix the bug(s) in this code:\n${fence}\n${code}\n\`\`\``,
      explain: `Explain what this code does, step by step:\n${fence}\n${code}\n\`\`\``,
      refactor: `Refactor this code to be cleaner, more efficient, and follow best practices:\n${fence}\n${code}\n\`\`\``,
      docs: `Add JSDoc/docstring comments to this code:\n${fence}\n${code}\n\`\`\``,
    };
    const prompt = prompts[action];
    if (!prompt) return;

    if (!this.app.isChatOpen) this.app.toggleChat();
    const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement | null;
    if (chatInput) {
      chatInput.value = prompt;
      chatInput.dispatchEvent(new Event('input'));
      setTimeout(() => chatInput.focus(), 100);
    }
  }

  private _registerContextMenuActions(): void {
    const actions = [
      { id: 'mere.fix', label: 'Mere X: Fix Bug', action: 'fix' },
      { id: 'mere.explain', label: 'Mere X: Explain Code', action: 'explain' },
      { id: 'mere.refactor', label: 'Mere X: Refactor', action: 'refactor' },
      { id: 'mere.docs', label: 'Mere X: Add Documentation', action: 'docs' },
    ];
    for (const a of actions) {
      this.editor.addAction({
        id: a.id,
        label: a.label,
        contextMenuGroupId: 'mere-x',
        contextMenuOrder: 1,
        run: (ed: any) => {
          const sel = ed.getSelection();
          const code = sel && !sel.isEmpty()
            ? ed.getModel().getValueInRange(sel)
            : ed.getModel().getValue();
          this._triggerCodeAction(a.action, code);
        },
      });
    }
  }

  layout(): void { this.editor?.layout(); }

  async openFile(filePath: string): Promise<void> {
    const existing = this.tabs.find(t => t.filePath === filePath);
    if (existing) { this.activateTab(existing.id); return; }

    const ext = window.merecode.path.extname(filePath).toLowerCase();

    const imageExts = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp'];
    if (imageExts.includes(ext)) {
      this.hideImagePreview();
      document.getElementById('monaco-container')!.style.display = 'none';
      await this.showImagePreview(filePath);
      return;
    }

    this.hideImagePreview();
    document.getElementById('monaco-container')!.style.display = 'block';

    const result = await window.merecode.fs.readFile(filePath);
    if (result.error) {
      this.app.showToast(`Failed to open file: ${result.error}`, 'error');
      return;
    }

    const language = this._langFromExt(ext);
    const name = window.merecode.path.basename(filePath);
    const uri = this.monaco.Uri.file(filePath);
    let model = this.monaco.editor.getModel(uri);
    if (model) model.setValue(result.content);
    else model = this.monaco.editor.createModel(result.content, language, uri);

    const tab: EditorTab = { id: `t${Date.now()}`, filePath, name, model, viewState: null, isDirty: false, _saving: false, _autoSaveDebounce: null };
    this.tabs.push(tab);
    this.activateTab(tab.id);
    document.getElementById('status-language')!.textContent = this._languageLabel(language);
    this.app.hideWelcome();
  }

  createUntitledTab(): void {
    this.untitledCount++;
    const name = `Untitled-${this.untitledCount}`;
    const uri = this.monaco.Uri.parse(`untitled:${name}`);
    const model = this.monaco.editor.createModel('', 'plaintext', uri);
    const tab: EditorTab = { id: `t${Date.now()}`, filePath: null, name, model, viewState: null, isDirty: false, _saving: false, _autoSaveDebounce: null };
    this.tabs.push(tab);
    this.activateTab(tab.id);
    this.app.hideWelcome();
  }

  activateTab(tabId: string): void {
    if (this.activeTabId) {
      const cur = this.tabs.find(t => t.id === this.activeTabId);
      if (cur) cur.viewState = this.editor.saveViewState();
    }
    this.activeTabId = tabId;
    const tab = this.tabs.find(t => t.id === tabId);
    if (tab) {
      this.editor.setModel(tab.model);
      if (tab.viewState) this.editor.restoreViewState(tab.viewState);
      this.editor.focus();
      const ext = tab.filePath ? window.merecode.path.extname(tab.filePath).toLowerCase() : '';
      document.getElementById('status-language')!.textContent = this._languageLabel(this._langFromExt(ext));
      document.getElementById('titlebar-filename')!.textContent = tab.name;
      this.app.chat?.updateContextFile(tab.name);
      this.updateBreadcrumbs(tab.filePath);
      this.app.refreshOutline?.();

      if (this._splitEditor) this._splitEditor.setModel(tab.model);

      this.hideImagePreview();
      document.getElementById('monaco-container')!.style.display = 'block';
    }
    this._renderTabs();
  }

  closeTab(tabId: string): void {
    const idx = this.tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;
    const tab = this.tabs[idx];
    if (tab.isDirty) {
      const save = confirm(`Do you want to save changes to ${tab.name}?`);
      if (save && tab.filePath) {
        window.merecode.fs.writeFile(tab.filePath, tab.model.getValue());
      }
    }
    clearTimeout(tab._autoSaveDebounce!);
    tab.model.dispose();
    this.tabs.splice(idx, 1);

    if (this.tabs.length === 0) { this.activeTabId = null; this.app.showWelcome(); }
    else if (this.activeTabId === tabId) { this.activateTab(this.tabs[Math.min(idx, this.tabs.length - 1)].id); }
    this._renderTabs();
  }

  closeActiveTab(): void { if (this.activeTabId) this.closeTab(this.activeTabId); }

  nextTab(): void {
    if (this.tabs.length <= 1) return;
    const idx = this.tabs.findIndex(t => t.id === this.activeTabId);
    this.activateTab(this.tabs[(idx + 1) % this.tabs.length].id);
  }

  _renderTabs(): void {
    const list = document.getElementById('tabs-list')!;
    list.innerHTML = this.tabs.map(t => `
      <div class="tab ${t.id === this.activeTabId ? 'active' : ''}" data-id="${t.id}">
        <span class="tab-icon">${this._fileIcon(t.name)}</span>
        <span class="tab-name">${this._escText(t.name)}</span>
        ${t.isDirty ? '<span class="tab-dirty">●</span>' : ''}
        <button class="tab-close" data-id="${t.id}">×</button>
      </div>
    `).join('');

    list.querySelectorAll('.tab').forEach(el => {
      el.addEventListener('click', (e: Event) => { if (!(e.target as Element).classList.contains('tab-close')) this.activateTab((el as HTMLElement).dataset.id!); });
      el.addEventListener('mousedown', (e: MouseEvent) => { if (e.button === 1) { e.preventDefault(); this.closeTab((el as HTMLElement).dataset.id!); } });
    });
    list.querySelectorAll('.tab-close').forEach(btn => {
      btn.addEventListener('click', (e: Event) => { e.stopPropagation(); this.closeTab((btn as HTMLElement).dataset.id!); });
    });
  }

  async saveCurrentFile(): Promise<void> {
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    if (!tab) return;
    if (!tab.filePath) {
      const fp = await window.merecode.dialog.saveFile(tab.name);
      if (!fp) return;
      tab.filePath = fp;
      tab.name = window.merecode.path.basename(fp);
    }
    if (localStorage.getItem('merecode-format-on-save') === 'true') {
      try { await this.editor.getAction('editor.action.formatDocument')?.run(); } catch { /* ignore */ }
    }
    const result = await window.merecode.fs.writeFile(tab.filePath, tab.model.getValue());
    if (!result.error) { tab.isDirty = false; this._renderTabs(); }
    else this.app.showToast(`Save failed: ${result.error}`, 'error');
  }

  formatDocument(): void { this.editor?.getAction('editor.action.formatDocument')?.run(); }
  toggleMinimap(): void { this.minimapEnabled = !this.minimapEnabled; this.editor?.updateOptions({ minimap: { enabled: this.minimapEnabled } }); }
  toggleWordWrap(): void { this.wordWrapMode = this.wordWrapMode === 'off' ? 'on' : 'off'; this.editor?.updateOptions({ wordWrap: this.wordWrapMode }); }

  updateFontSize(size: number): void { this.editor?.updateOptions({ fontSize: size }); }
  updateTabSize(size: number): void  { this.editor?.getModel()?.updateOptions({ tabSize: size }); }

  getContext(): { filePath: string | null; fileName: string; language: string; content: string; selectedText: string } | null {
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    if (!tab) return null;
    const sel = this.editor.getSelection();
    const selectedText = sel ? this.editor.getModel().getValueInRange(sel) : '';
    return { filePath: tab.filePath, fileName: tab.name, language: tab.model.getLanguageId(), content: tab.model.getValue(), selectedText };
  }

  _langFromExt(ext: string): string {
    const map: Record<string, string> = {
      '.js':'javascript','.jsx':'javascript','.mjs':'javascript','.cjs':'javascript',
      '.ts':'typescript','.tsx':'typescript','.mts':'typescript','.cts':'typescript',
      '.py':'python','.pyw':'python','.html':'html','.htm':'html','.css':'css','.scss':'scss','.less':'less',
      '.json':'json','.jsonc':'json','.md':'markdown','.mdx':'markdown',
      '.xml':'xml','.svg':'xml','.yaml':'yaml','.yml':'yaml',
      '.sh':'shell','.bash':'shell','.zsh':'shell','.ps1':'powershell',
      '.java':'java','.c':'c','.h':'c','.cpp':'cpp','.hpp':'cpp','.cc':'cpp',
      '.cs':'csharp','.go':'go','.rs':'rust','.rb':'ruby','.php':'php','.swift':'swift',
      '.sql':'sql','.graphql':'graphql','.gql':'graphql',
      '.dockerfile':'dockerfile','.toml':'ini','.ini':'ini','.cfg':'ini',
      '.env':'plaintext','.txt':'plaintext','.log':'plaintext',
      '.r':'r','.kt':'kotlin','.kts':'kotlin','.dart':'dart','.lua':'lua',
      '.vue':'html','.svelte':'html','.astro':'html',
    };
    return map[ext] || 'plaintext';
  }

  private _languageLabel(lang: string): string {
    const labels: Record<string, string> = { javascript:'JavaScript', typescript:'TypeScript', python:'Python', html:'HTML', css:'CSS', json:'JSON', markdown:'Markdown', plaintext:'Plain Text', shell:'Shell', rust:'Rust', go:'Go', java:'Java', csharp:'C#', cpp:'C++', ruby:'Ruby', php:'PHP', swift:'Swift', kotlin:'Kotlin', dart:'Dart' };
    return labels[lang] || lang.charAt(0).toUpperCase() + lang.slice(1);
  }

  private _fileIcon(name: string): string {
    const ext = name.includes('.') ? '.' + name.split('.').pop()!.toLowerCase() : '';
    const icons: Record<string, string> = {
      '.js':'<span class="tab-fi" style="color:#f0db4f">JS</span>',
      '.ts':'<span class="tab-fi" style="color:#3178c6">TS</span>',
      '.jsx':'<span class="tab-fi" style="color:#61dafb">⚛</span>',
      '.tsx':'<span class="tab-fi" style="color:#61dafb">⚛</span>',
      '.py':'<span class="tab-fi" style="color:#3776ab">Py</span>',
      '.html':'<span class="tab-fi" style="color:#e34f26">&lt;&gt;</span>',
      '.css':'<span class="tab-fi" style="color:#1572b6">#</span>',
      '.scss':'<span class="tab-fi" style="color:#cc6699">#</span>',
      '.json':'<span class="tab-fi" style="color:#f5a623">{}</span>',
      '.md':'<span class="tab-fi" style="color:#519aba">MD</span>',
      '.svg':'<span class="tab-fi" style="color:#ffb13b">◇</span>',
      '.png':'<span class="tab-fi" style="color:#4caf50">Img</span>',
      '.jpg':'<span class="tab-fi" style="color:#4caf50">Img</span>',
      '.yaml':'<span class="tab-fi" style="color:#cb171e">yml</span>',
      '.yml':'<span class="tab-fi" style="color:#cb171e">yml</span>',
      '.sh':'<span class="tab-fi" style="color:#89e051">$_</span>',
      '.go':'<span class="tab-fi" style="color:#00add8">Go</span>',
      '.rs':'<span class="tab-fi" style="color:#dea584">Rs</span>',
      '.java':'<span class="tab-fi" style="color:#b07219">J</span>',
      '.rb':'<span class="tab-fi" style="color:#cc342d">Rb</span>',
      '.php':'<span class="tab-fi" style="color:#777bb4">php</span>',
    };
    return icons[ext] || '<span class="tab-fi" style="opacity:.5">F</span>';
  }

  dispose(): void {
    this.stopAutoSave();
    clearTimeout(this._outlineRefreshTimer);
    this._completionDisposable?.dispose();
    this._mdPreviewDisposable?.dispose();
    for (const d of this._disposables) d.dispose();
    this._disposables = [];
    if (this._resizeHandler) window.removeEventListener('resize', this._resizeHandler);
    if (this._splitEditor) { this._splitEditor.dispose(); this._splitEditor = null; }
    for (const tab of this.tabs) {
      clearTimeout(tab._autoSaveDebounce!);
      tab.model?.dispose();
    }
    this.editor?.dispose();
  }
}
