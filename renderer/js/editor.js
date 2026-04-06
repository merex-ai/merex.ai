class EditorManager {
  constructor(app) {
    this.editor = null;
    this.monaco = null;
    this.tabs = [];
    this.activeTabId = null;
    this.untitledCount = 0;
    this.minimapEnabled = true;
    this.wordWrapMode = "off";
    this._currentTheme = "mere-dark";
    this._completionTimer = null;
    this._completionDisposable = null;
    this._outlineRefreshTimer = null;
    this._autoSaveTimer = null;
    this._autoSaveDebounce = null;
    this._disposables = [];
    this._splitEditor = null;
    this._mdPreviewDisposable = null;
    this._codeActionToolbar = null;
    this._codeActionTimer = null;
    this._resizeHandler = null;
    this.app = app;
  }
  async init() {
    return new Promise((resolve) => {
      window.require.config({ paths: { vs: "/node_modules/monaco-editor/min/vs" } });
      self.MonacoEnvironment = {
        getWorkerUrl(_, label) {
          return `data:text/javascript;charset=utf-8,${encodeURIComponent(`
            self.MonacoEnvironment = { baseUrl: '${location.origin}/node_modules/monaco-editor/min/' };
            importScripts('${location.origin}/node_modules/monaco-editor/min/vs/base/worker/workerMain.js');
          `)}`;
        }
      };
      window.require(["vs/editor/editor.main"], (monaco) => {
        this.monaco = monaco;
        this._defineTheme(monaco);
        this._createEditor(monaco);
        this._bindEvents();
        resolve();
      });
    });
  }
  _defineTheme(monaco) {
    monaco.editor.defineTheme("mere-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "8a8279", fontStyle: "italic" },
        { token: "keyword", foreground: "c96442" },
        { token: "string", foreground: "34d399" },
        { token: "number", foreground: "f59e0b" },
        { token: "type", foreground: "60a5fa" },
        { token: "function", foreground: "f5f0e8" },
        { token: "variable", foreground: "c4bdb2" },
        { token: "constant", foreground: "f97316" },
        { token: "regexp", foreground: "e879f9" },
        { token: "tag", foreground: "c96442" },
        { token: "attribute.name", foreground: "60a5fa" },
        { token: "attribute.value", foreground: "34d399" }
      ],
      colors: {
        "editor.background": "#191918",
        "editor.foreground": "#f5f0e8",
        "editor.lineHighlightBackground": "#232322",
        "editor.selectionBackground": "rgba(201,100,66,0.3)",
        "editorCursor.foreground": "#c96442",
        "editorWhitespace.foreground": "#2a2a29",
        "editorIndentGuide.background": "#2a2a29",
        "editorIndentGuide.activeBackground": "#5a5550",
        "editor.findMatchBackground": "rgba(201,100,66,0.35)",
        "editor.findMatchHighlightBackground": "rgba(201,100,66,0.15)",
        "editorBracketMatch.background": "rgba(201,100,66,0.2)",
        "editorBracketMatch.border": "#c96442",
        "editorGutter.background": "#191918",
        "editorLineNumber.foreground": "#5a5550",
        "editorLineNumber.activeForeground": "#8a8279",
        "scrollbarSlider.background": "rgba(255,255,255,0.08)",
        "scrollbarSlider.hoverBackground": "rgba(255,255,255,0.14)",
        "scrollbarSlider.activeBackground": "rgba(201,100,66,0.3)",
        "minimap.background": "#191918"
      }
    });
    monaco.editor.defineTheme("mere-light", {
      base: "vs",
      inherit: true,
      rules: [
        { token: "comment", foreground: "8a8279", fontStyle: "italic" },
        { token: "keyword", foreground: "b5533d" },
        { token: "string", foreground: "1a8a5c" },
        { token: "number", foreground: "c88a0a" },
        { token: "type", foreground: "3b7dd8" },
        { token: "function", foreground: "2d2d2c" },
        { token: "variable", foreground: "4a4540" },
        { token: "constant", foreground: "d4630f" },
        { token: "regexp", foreground: "b05cc0" },
        { token: "tag", foreground: "b5533d" },
        { token: "attribute.name", foreground: "3b7dd8" },
        { token: "attribute.value", foreground: "1a8a5c" }
      ],
      colors: {
        "editor.background": "#faf8f5",
        "editor.foreground": "#2d2d2c",
        "editor.lineHighlightBackground": "#f0ede8",
        "editor.selectionBackground": "rgba(201,100,66,0.2)",
        "editorCursor.foreground": "#c96442",
        "editorWhitespace.foreground": "#e0dcd5",
        "editorIndentGuide.background": "#e0dcd5",
        "editorIndentGuide.activeBackground": "#c4bdb2",
        "editor.findMatchBackground": "rgba(201,100,66,0.25)",
        "editor.findMatchHighlightBackground": "rgba(201,100,66,0.1)",
        "editorBracketMatch.background": "rgba(201,100,66,0.15)",
        "editorBracketMatch.border": "#c96442",
        "editorGutter.background": "#faf8f5",
        "editorLineNumber.foreground": "#c4bdb2",
        "editorLineNumber.activeForeground": "#8a8279",
        "scrollbarSlider.background": "rgba(0,0,0,0.08)",
        "scrollbarSlider.hoverBackground": "rgba(0,0,0,0.14)",
        "scrollbarSlider.activeBackground": "rgba(201,100,66,0.3)",
        "minimap.background": "#faf8f5"
      }
    });
  }
  setTheme(themeName) {
    this._currentTheme = themeName;
    this.monaco?.editor.setTheme(themeName);
    localStorage.setItem("merecode-theme", themeName);
    if (this._splitEditor) this._splitEditor.updateOptions({ theme: themeName });
    this.app.terminal?.updateTheme();
  }
  splitEditor() {
    if (this._splitEditor) {
      this.closeSplit();
      return;
    }
    const container = document.getElementById("editor-container");
    const splitEl = document.createElement("div");
    splitEl.id = "split-editor-container";
    container.classList.add("split-active");
    container.appendChild(splitEl);
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    this._splitEditor = this.monaco.editor.create(splitEl, {
      model: tab?.model || null,
      theme: this._currentTheme,
      fontSize: parseInt(localStorage.getItem("merecode-font-size") || "14"),
      fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, monospace",
      fontLigatures: localStorage.getItem("merecode-font-ligatures") !== "false",
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      readOnly: false,
      bracketPairColorization: { enabled: true },
      padding: { top: 8 }
    });
    this.layout();
    this.app.showToast("Split editor opened", "info", 1500);
  }
  closeSplit() {
    if (!this._splitEditor) return;
    this._splitEditor.dispose();
    this._splitEditor = null;
    document.getElementById("split-editor-container")?.remove();
    document.getElementById("editor-container").classList.remove("split-active");
    this.layout();
  }
  updateBreadcrumbs(filePath) {
    const el = document.getElementById("breadcrumbs");
    if (!el) return;
    if (!filePath) {
      el.innerHTML = "";
      el.style.display = "none";
      return;
    }
    el.style.display = "flex";
    let relPath = filePath;
    if (this.app.rootPath) {
      const root = this.app.rootPath.replace(/\\/g, "/");
      relPath = filePath.replace(/\\/g, "/").replace(root, "").replace(/^\//, "");
    }
    const parts = relPath.split(/[/\\]/);
    el.innerHTML = parts.map((part, i) => {
      const isLast = i === parts.length - 1;
      const partialPath = parts.slice(0, i + 1).join("/");
      return `<span class="bc-item${isLast ? " bc-active" : ""}" data-path="${this._escText(partialPath)}" data-is-dir="${!isLast}">${this._escText(part)}</span>${isLast ? "" : '<span class="bc-sep">\u203A</span>'}`;
    }).join("");
    el.querySelectorAll(".bc-item").forEach((item) => {
      item.style.cursor = "pointer";
      item.addEventListener("click", () => {
        const partial = item.dataset.path;
        if (!partial) return;
        const isDir = item.dataset.isDir === "true";
        if (isDir && this.app.rootPath) {
          const fullDir = window.merecode.path.join(this.app.rootPath, partial);
          this.app.fileExplorer?.expandedDirs?.add(fullDir);
          this.app.fileExplorer?.refresh();
        }
      });
    });
  }
  _escText(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
  startAutoSave() {
    this.stopAutoSave();
    if (localStorage.getItem("merecode-auto-save") !== "true") return;
    this._autoSaveTimer = setInterval(() => {
      this._flushDirtyTabs();
    }, 2e3);
  }
  _flushDirtyTabs() {
    for (const tab of this.tabs) {
      if (tab.isDirty && tab.filePath && !tab._saving) {
        tab._saving = true;
        window.merecode.fs.writeFile(tab.filePath, tab.model.getValue()).then((r) => {
          tab._saving = false;
          if (!r.error) {
            tab.isDirty = false;
            this._renderTabs();
          }
        }).catch(() => {
          tab._saving = false;
        });
      }
    }
  }
  _markDirtyWithDebounce(tab) {
    if (!tab.isDirty) {
      tab.isDirty = true;
      this._renderTabs();
    }
    if (localStorage.getItem("merecode-auto-save") === "true" && tab.filePath) {
      clearTimeout(tab._autoSaveDebounce);
      tab._autoSaveDebounce = setTimeout(() => {
        if (tab.isDirty && tab.filePath && !tab._saving) {
          tab._saving = true;
          window.merecode.fs.writeFile(tab.filePath, tab.model.getValue()).then((r) => {
            tab._saving = false;
            if (!r.error) {
              tab.isDirty = false;
              this._renderTabs();
            }
          }).catch(() => {
            tab._saving = false;
          });
        }
      }, 1e3);
    }
  }
  stopAutoSave() {
    if (this._autoSaveTimer) {
      clearInterval(this._autoSaveTimer);
      this._autoSaveTimer = null;
    }
  }
  async showImagePreview(filePath) {
    this.hideImagePreview();
    this.app.hideWelcome();
    document.getElementById("monaco-container").style.display = "none";
    const container = document.getElementById("editor-container");
    const preview = document.createElement("div");
    preview.id = "image-preview";
    const name = window.merecode.path.basename(filePath);
    const result = await window.merecode.fs.readFileBase64(filePath);
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
    document.getElementById("titlebar-filename").textContent = name;
    this.updateBreadcrumbs(filePath);
  }
  hideImagePreview() {
    document.getElementById("image-preview")?.remove();
  }
  toggleMarkdownPreview() {
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    if (!tab) return;
    const container = document.getElementById("editor-container");
    let preview = document.getElementById("markdown-preview");
    if (preview) {
      preview.remove();
      container.classList.remove("md-preview-active");
      this._mdPreviewDisposable?.dispose();
      this._mdPreviewDisposable = null;
      this.layout();
      return;
    }
    container.classList.add("md-preview-active");
    preview = document.createElement("div");
    preview.id = "markdown-preview";
    preview.innerHTML = `<div class="md-body">${this._renderMarkdown(tab.model.getValue())}</div>`;
    container.appendChild(preview);
    this._mdPreviewDisposable = tab.model.onDidChangeContent(() => {
      const el = document.getElementById("markdown-preview");
      if (el) el.innerHTML = `<div class="md-body">${this._renderMarkdown(tab.model.getValue())}</div>`;
    });
    this.layout();
  }
  _renderMarkdown(md) {
    let safe = md.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return safe.replace(/^### (.+)$/gm, "<h3>$1</h3>").replace(/^## (.+)$/gm, "<h2>$1</h2>").replace(/^# (.+)$/gm, "<h1>$1</h1>").replace(/```(\w*)\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>").replace(/^\- (.+)$/gm, "<li>$1</li>").replace(/^\d+\. (.+)$/gm, "<li>$1</li>").replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => {
      if (/^(https?:\/\/|mailto:|#)/.test(href)) {
        return `<a href="${href}" rel="noopener">${text}</a>`;
      }
      return `${text} (${href})`;
    }).replace(/^---$/gm, "<hr>").replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>");
  }
  getOutline() {
    const model = this.editor?.getModel();
    if (!model) return [];
    const text = model.getValue();
    const symbols = [];
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      let m;
      if (m = line.match(/^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+(\w+)/)) {
        symbols.push({ name: m[1], kind: "function", line: i + 1, icon: "\u0192" });
      } else if (m = line.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[\w]+)\s*=>/)) {
        symbols.push({ name: m[1], kind: "function", line: i + 1, icon: "\u0192" });
      } else if (m = line.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function/)) {
        symbols.push({ name: m[1], kind: "function", line: i + 1, icon: "\u0192" });
      } else if (m = line.match(/^(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/)) {
        symbols.push({ name: m[1], kind: "function", line: i + 1, icon: "\u0192" });
      } else if (m = line.match(/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/)) {
        symbols.push({ name: m[1], kind: "class", line: i + 1, icon: "C" });
      } else if (m = line.match(/^\s+(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?(\w+)\s*\([^)]*\)\s*\{/)) {
        if (!["if", "for", "while", "switch", "catch", "else", "return", "new", "typeof"].includes(m[1])) {
          symbols.push({ name: m[1], kind: "method", line: i + 1, icon: "m" });
        }
      } else if (m = line.match(/^(?:export\s+)?(?:interface|type)\s+(\w+)/)) {
        symbols.push({ name: m[1], kind: "interface", line: i + 1, icon: "I" });
      } else if (m = line.match(/^(?:export\s+)?enum\s+(\w+)/)) {
        symbols.push({ name: m[1], kind: "enum", line: i + 1, icon: "E" });
      } else if (m = line.match(/^(?:async\s+)?def\s+(\w+)/)) {
        symbols.push({ name: m[1], kind: "function", line: i + 1, icon: "\u0192" });
      } else if (m = line.match(/^class\s+(\w+)/)) {
        symbols.push({ name: m[1], kind: "class", line: i + 1, icon: "C" });
      } else if (m = line.match(/^(?:pub\s+)?(?:async\s+)?fn\s+(\w+)/)) {
        symbols.push({ name: m[1], kind: "function", line: i + 1, icon: "\u0192" });
      } else if (m = line.match(/^func\s+(?:\([^)]+\)\s+)?(\w+)/)) {
        symbols.push({ name: m[1], kind: "function", line: i + 1, icon: "\u0192" });
      }
    }
    return symbols;
  }
  _initInlineCompletions(monaco) {
    const self2 = this;
    this._completionDisposable = monaco.languages.registerInlineCompletionsProvider("*", {
      provideInlineCompletions: async (model, position, context, token) => {
        const apiKey = localStorage.getItem("merecode-api-key");
        if (!apiKey) return { items: [] };
        if (token.isCancellationRequested) return { items: [] };
        const textBeforeCursor = model.getValueInRange({
          startLineNumber: Math.max(1, position.lineNumber - 20),
          startColumn: 1,
          endLineNumber: position.lineNumber,
          endColumn: position.column
        });
        const textAfterCursor = model.getValueInRange({
          startLineNumber: position.lineNumber,
          startColumn: position.column,
          endLineNumber: Math.min(model.getLineCount(), position.lineNumber + 5),
          endColumn: model.getLineMaxColumn(Math.min(model.getLineCount(), position.lineNumber + 5))
        });
        if (textBeforeCursor.trim().length < 5) return { items: [] };
        try {
          const language = model.getLanguageId();
          const tab = self2.tabs.find((t) => t.id === self2.activeTabId);
          const fileName = tab?.name || "untitled";
          const controller = new AbortController();
          const cancelListener = token.onCancellationRequested(() => controller.abort());
          const timeoutId = setTimeout(() => controller.abort(), 15e3);
          const apiEndpoint = "https://merex.ai/api/v1/chat";
          let fullText = "";
          try {
            const result = await window.merecode.api.chatStream({
              endpoint: apiEndpoint,
              apiKey,
              body: {
                model: "mere-nyx",
                messages: [{ role: "user", parts: [{ text: `Complete the following ${language} code. File: ${fileName}\n\nCode before cursor:\n${textBeforeCursor}\n\nCode after cursor:\n${textAfterCursor}\n\nProvide ONLY the completion text (what goes at the cursor position). No explanation, no markdown, no code fences. Just the raw code to insert.` }] }],
                temperature: 0.2,
                systemPrompt: "You are an inline code completion engine. Output ONLY the raw code continuation. Never include markdown, explanations, or code fences. Output exactly what should be typed next. Keep completions short (1-3 lines max)."
              }
            });
            // Collect chunks via IPC listener
            const chunkCollector = new Promise((resolve) => {
              const cleanup = window.merecode.api.onChatChunk((parsed) => {
                if (parsed?.text) fullText += parsed.text;
                if (parsed?.type === 'done' || parsed?.error) {
                  cleanup();
                  resolve();
                }
              });
              // Resolve when main stream completes
              if (result && !result.error) setTimeout(() => { cleanup(); resolve(); }, 100);
              else { cleanup(); resolve(); }
            });
            await chunkCollector;
          } finally {
            clearTimeout(timeoutId);
            cancelListener.dispose();
          }
          fullText = fullText.replace(/^```\w*\n?/, "").replace(/\n?```$/, "").trim();
          if (!fullText || fullText.length > 500) return { items: [] };
          return {
            items: [{
              insertText: fullText,
              range: {
                startLineNumber: position.lineNumber,
                startColumn: position.column,
                endLineNumber: position.lineNumber,
                endColumn: position.column
              }
            }]
          };
        } catch {
          return { items: [] };
        }
      },
      freeInlineCompletions() {
      }
    });
  }
  _createEditor(monaco) {
    const savedTheme = localStorage.getItem("merecode-theme") || "mere-dark";
    this._currentTheme = savedTheme;
    this.editor = monaco.editor.create(document.getElementById("monaco-container"), {
      value: "",
      language: "plaintext",
      theme: savedTheme,
      fontSize: parseInt(localStorage.getItem("merecode-font-size") || "14"),
      fontFamily: "'Cascadia Code', 'JetBrains Mono', 'Fira Code', Consolas, monospace",
      fontLigatures: localStorage.getItem("merecode-font-ligatures") !== "false",
      minimap: { enabled: localStorage.getItem("merecode-minimap") !== "false" },
      scrollBeyondLastLine: false,
      renderWhitespace: "selection",
      smoothScrolling: true,
      cursorSmoothCaretAnimation: "on",
      cursorBlinking: "smooth",
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      wordWrap: localStorage.getItem("merecode-word-wrap") || "off",
      automaticLayout: false,
      tabSize: parseInt(localStorage.getItem("merecode-tab-size") || "2"),
      insertSpaces: true,
      quickSuggestions: true,
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnCommitCharacter: true,
      inlineSuggest: { enabled: true },
      autoClosingBrackets: "always",
      autoClosingQuotes: "always",
      autoIndent: "full",
      folding: true,
      foldingStrategy: "indentation",
      links: true,
      mouseWheelZoom: true,
      padding: { top: 8 },
      lineNumbers: "on",
      contextmenu: true,
      stickyScroll: { enabled: true },
      multiCursorModifier: "alt"
    });
    this._initInlineCompletions(monaco);
    this._registerContextMenuActions();
    this._registerLanguageProviders(monaco);
    this._registerSnippetProvider(monaco);
    this._initProblemsTracking(monaco);
    this.startAutoSave();
  }
  // ─── Session Save / Restore ───
  saveSession() {
    try {
      const session = {
        tabs: this.tabs.filter(t => t.filePath).map(t => {
          const isActive = t.id === this.activeTabId;
          const viewState = isActive && this.editor ? this.editor.saveViewState() : (t._viewState || null);
          return {
            filePath: t.filePath,
            name: t.name,
            isActive,
            cursorLine: viewState?.cursorState?.[0]?.position?.lineNumber || 1,
            cursorColumn: viewState?.cursorState?.[0]?.position?.column || 1,
            scrollTop: viewState?.viewState?.scrollTop || 0
          };
        }),
        rootPath: this.app.rootPath || null
      };
      localStorage.setItem("merecode-session", JSON.stringify(session));
    } catch (e) {
      // localStorage quota exceeded — try with fewer tabs
      try {
        const minimal = { tabs: session.tabs.slice(-10), rootPath: session.rootPath };
        localStorage.setItem("merecode-session", JSON.stringify(minimal));
      } catch {
        console.warn("[Editor] Failed to save session:", e?.message);
      }
    }
  }
  async restoreSession() {
    try {
      const saved = localStorage.getItem("merecode-session");
      if (!saved) return;
      const session = JSON.parse(saved);
      if (!session.tabs?.length) return;
      // Only restore if same project
      if (session.rootPath && session.rootPath !== this.app.rootPath) return;
      let activeFile = null;
      let activeState = null;
      for (const tab of session.tabs) {
        const exists = await window.merecode.fs.exists(tab.filePath);
        if (exists) {
          await this.openFile(tab.filePath);
          if (tab.isActive) {
            activeFile = tab.filePath;
            activeState = tab;
          }
        }
      }
      // Re-activate the previously active tab and restore position
      if (activeFile) {
        const tab = this.tabs.find(t => t.filePath === activeFile);
        if (tab) {
          this.activateTab(tab.id);
          if (activeState && this.editor) {
            setTimeout(() => {
              if (activeState.cursorLine) {
                this.editor.setPosition({ lineNumber: activeState.cursorLine, column: activeState.cursorColumn || 1 });
                this.editor.revealLineInCenter(activeState.cursorLine);
              }
              if (activeState.scrollTop) {
                this.editor.setScrollTop(activeState.scrollTop);
              }
            }, 50);
          }
        }
      }
    } catch {}
  }
  _bindEvents() {
    const d1 = this.editor.onDidChangeCursorPosition((e) => {
      const pos = e.position;
      document.getElementById("status-position").textContent = `Ln ${pos.lineNumber}, Col ${pos.column}`;
    });
    this._disposables.push(d1);
    const d2 = this.editor.onDidChangeModelContent(() => {
      const tab = this.tabs.find((t) => t.id === this.activeTabId);
      if (tab) this._markDirtyWithDebounce(tab);
      clearTimeout(this._outlineRefreshTimer);
      this._outlineRefreshTimer = setTimeout(() => this.app.refreshOutline?.(), 500);
    });
    this._disposables.push(d2);
    // Track resize handler for cleanup
    this._initCodeActions();
    this._resizeHandler = () => this.layout();
    window.addEventListener("resize", this._resizeHandler);
  }
  _initCodeActions() {
    const toolbar = document.createElement("div");
    toolbar.id = "code-action-toolbar";
    toolbar.className = "code-action-toolbar";
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
    const d = this.editor.onDidChangeCursorSelection((e) => {
      clearTimeout(this._codeActionTimer);
      const sel = e.selection;
      if (sel.isEmpty()) {
        toolbar.classList.remove("visible");
        return;
      }
      this._codeActionTimer = setTimeout(() => {
        this._positionCodeActionToolbar(sel);
      }, 400);
    });
    this._disposables.push(d);
    const d2 = this.editor.onDidScrollChange(() => {
      toolbar.classList.remove("visible");
    });
    this._disposables.push(d2);
    toolbar.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });
    toolbar.addEventListener("click", (e) => {
      const btn = e.target.closest(".ca-btn");
      if (!btn) return;
      const action = btn.dataset.action;
      const sel = this.editor.getSelection();
      const code = this.editor.getModel()?.getValueInRange(sel) || "";
      if (!code.trim()) return;
      toolbar.classList.remove("visible");
      this._triggerCodeAction(action, code);
    });
  }
  _positionCodeActionToolbar(selection) {
    const toolbar = this._codeActionToolbar;
    if (!toolbar) return;
    const container = document.getElementById("monaco-container");
    if (!container) return;
    const pos = this.editor.getScrolledVisiblePosition({
      lineNumber: selection.startLineNumber,
      column: selection.startColumn
    });
    if (!pos) {
      toolbar.classList.remove("visible");
      return;
    }
    const containerRect = container.getBoundingClientRect();
    let top = containerRect.top + pos.top - 40;
    let left = containerRect.left + pos.left;
    top = Math.max(containerRect.top + 2, top);
    const toolbarWidth = 280;
    left = Math.min(left, window.innerWidth - toolbarWidth - 8);
    left = Math.max(containerRect.left + 4, left);
    toolbar.style.top = top + "px";
    toolbar.style.left = left + "px";
    toolbar.classList.add("visible");
  }
  _triggerCodeAction(action, code) {
    const lang = this.editor.getModel()?.getLanguageId() || "";
    const fence = lang ? `\`\`\`${lang}` : "```";
    const prompts = {
      fix: `Fix the bug(s) in this code:
${fence}
${code}
\`\`\``,
      explain: `Explain what this code does, step by step:
${fence}
${code}
\`\`\``,
      refactor: `Refactor this code to be cleaner, more efficient, and follow best practices:
${fence}
${code}
\`\`\``,
      docs: `Add JSDoc/docstring comments to this code:
${fence}
${code}
\`\`\``
    };
    const prompt = prompts[action];
    if (!prompt) return;
    if (!this.app.isChatOpen) this.app.toggleChat();
    const chatInput = document.getElementById("chat-input");
    if (chatInput) {
      chatInput.value = prompt;
      chatInput.dispatchEvent(new Event("input"));
      setTimeout(() => chatInput.focus(), 100);
    }
  }
  _registerContextMenuActions() {
    const actions = [
      { id: "mere.fix", label: "Mere X: Fix Bug", action: "fix" },
      { id: "mere.explain", label: "Mere X: Explain Code", action: "explain" },
      { id: "mere.refactor", label: "Mere X: Refactor", action: "refactor" },
      { id: "mere.docs", label: "Mere X: Add Documentation", action: "docs" }
    ];
    for (const a of actions) {
      this.editor.addAction({
        id: a.id,
        label: a.label,
        contextMenuGroupId: "mere-x",
        contextMenuOrder: 1,
        run: (ed) => {
          const sel = ed.getSelection();
          const code = sel && !sel.isEmpty() ? ed.getModel().getValueInRange(sel) : ed.getModel().getValue();
          this._triggerCodeAction(a.action, code);
        }
      });
    }
  }
  layout() {
    this.editor?.layout();
  }
  async openFile(filePath) {
    const existing = this.tabs.find((t) => t.filePath === filePath);
    if (existing) {
      this.activateTab(existing.id);
      return;
    }
    const ext = window.merecode.path.extname(filePath).toLowerCase();
    const imageExts = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".ico", ".bmp"];
    if (imageExts.includes(ext)) {
      this.hideImagePreview();
      document.getElementById("monaco-container").style.display = "none";
      await this.showImagePreview(filePath);
      return;
    }
    this.hideImagePreview();
    document.getElementById("monaco-container").style.display = "block";
    const result = await window.merecode.fs.readFile(filePath);
    if (result.error) {
      this.app.showToast(`Failed to open file: ${result.error}`, "error");
      return;
    }
    const language = this._langFromExt(ext);
    const name = window.merecode.path.basename(filePath);
    const uri = this.monaco.Uri.file(filePath);
    let model = this.monaco.editor.getModel(uri);
    if (model) model.setValue(result.content);
    else model = this.monaco.editor.createModel(result.content, language, uri);
    const tab = { id: `t${Date.now()}`, filePath, name, model, viewState: null, isDirty: false, _saving: false, _autoSaveDebounce: null };
    this.tabs.push(tab);
    this.activateTab(tab.id);
    document.getElementById("status-language").textContent = this._languageLabel(language);
    this.app.hideWelcome();
  }
  createUntitledTab() {
    this.untitledCount++;
    const name = `Untitled-${this.untitledCount}`;
    const uri = this.monaco.Uri.parse(`untitled:${name}`);
    const model = this.monaco.editor.createModel("", "plaintext", uri);
    const tab = { id: `t${Date.now()}`, filePath: null, name, model, viewState: null, isDirty: false, _saving: false, _autoSaveDebounce: null };
    this.tabs.push(tab);
    this.activateTab(tab.id);
    this.app.hideWelcome();
  }
  activateTab(tabId) {
    if (this.activeTabId) {
      const cur = this.tabs.find((t) => t.id === this.activeTabId);
      if (cur) {
        cur.viewState = this.editor.saveViewState();
        cur._viewState = cur.viewState; // Persist for session save
      }
    }
    this.activeTabId = tabId;
    const tab = this.tabs.find((t) => t.id === tabId);
    if (tab) {
      this.editor.setModel(tab.model);
      if (tab.viewState) this.editor.restoreViewState(tab.viewState);
      this.editor.focus();
      const ext = tab.filePath ? window.merecode.path.extname(tab.filePath).toLowerCase() : "";
      document.getElementById("status-language").textContent = this._languageLabel(this._langFromExt(ext));
      document.getElementById("titlebar-filename").textContent = tab.name;
      this.app.chat?.updateContextFile(tab.name);
      this.updateBreadcrumbs(tab.filePath);
      this.app.refreshOutline?.();
      if (this._splitEditor) this._splitEditor.setModel(tab.model);
      this.hideImagePreview();
      document.getElementById("monaco-container").style.display = "block";
    }
    this._renderTabs();
    this.saveSession();
  }
  closeTab(tabId) {
    const idx = this.tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    const tab = this.tabs[idx];
    if (tab.isDirty) {
      const save = confirm(`Do you want to save changes to ${tab.name}?`);
      if (save && tab.filePath) {
        window.merecode.fs.writeFile(tab.filePath, tab.model.getValue());
      }
    }
    clearTimeout(tab._autoSaveDebounce);
    tab.model.dispose();
    this.tabs.splice(idx, 1);
    if (this.tabs.length === 0) {
      this.activeTabId = null;
      this.app.showWelcome();
    } else if (this.activeTabId === tabId) {
      this.activateTab(this.tabs[Math.min(idx, this.tabs.length - 1)].id);
    }
    this._renderTabs();
    this.saveSession();
  }
  closeActiveTab() {
    if (this.activeTabId) this.closeTab(this.activeTabId);
  }
  nextTab() {
    if (this.tabs.length <= 1) return;
    const idx = this.tabs.findIndex((t) => t.id === this.activeTabId);
    this.activateTab(this.tabs[(idx + 1) % this.tabs.length].id);
  }
  _renderTabs() {
    const list = document.getElementById("tabs-list");
    list.innerHTML = this.tabs.map((t) => `
      <div class="tab ${t.id === this.activeTabId ? "active" : ""}" data-id="${t.id}">
        <span class="tab-icon">${this._fileIcon(t.name)}</span>
        <span class="tab-name">${this._escText(t.name)}</span>
        ${t.isDirty ? '<span class="tab-dirty">\u25CF</span>' : ""}
        <button class="tab-close" data-id="${t.id}">\xD7</button>
      </div>
    `).join("");
    list.querySelectorAll(".tab").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (!e.target.classList.contains("tab-close")) this.activateTab(el.dataset.id);
      });
      el.addEventListener("mousedown", (e) => {
        if (e.button === 1) {
          e.preventDefault();
          this.closeTab(el.dataset.id);
        }
      });
    });
    list.querySelectorAll(".tab-close").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.closeTab(btn.dataset.id);
      });
    });
  }
  async saveCurrentFile() {
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    if (!tab) return;
    if (!tab.filePath) {
      const fp = await window.merecode.dialog.saveFile(tab.name);
      if (!fp) return;
      tab.filePath = fp;
      tab.name = window.merecode.path.basename(fp);
    }
    if (localStorage.getItem("merecode-format-on-save") === "true") {
      try {
        await this.editor.getAction("editor.action.formatDocument")?.run();
      } catch {
      }
    }
    const result = await window.merecode.fs.writeFile(tab.filePath, tab.model.getValue());
    if (!result.error) {
      tab.isDirty = false;
      this._renderTabs();
    } else this.app.showToast(`Save failed: ${result.error}`, "error");
  }
  formatDocument() {
    this.editor?.getAction("editor.action.formatDocument")?.run();
  }
  toggleMinimap() {
    this.minimapEnabled = !this.minimapEnabled;
    this.editor?.updateOptions({ minimap: { enabled: this.minimapEnabled } });
  }
  toggleWordWrap() {
    this.wordWrapMode = this.wordWrapMode === "off" ? "on" : "off";
    this.editor?.updateOptions({ wordWrap: this.wordWrapMode });
  }
  updateFontSize(size) {
    this.editor?.updateOptions({ fontSize: size });
  }
  updateTabSize(size) {
    this.editor?.getModel()?.updateOptions({ tabSize: size });
  }
  getContext() {
    const tab = this.tabs.find((t) => t.id === this.activeTabId);
    if (!tab) return null;
    const sel = this.editor.getSelection();
    const selectedText = sel ? this.editor.getModel().getValueInRange(sel) : "";
    return { filePath: tab.filePath, fileName: tab.name, language: tab.model.getLanguageId(), content: tab.model.getValue(), selectedText };
  }
  _langFromExt(ext) {
    const map = {
      ".js": "javascript",
      ".jsx": "javascript",
      ".mjs": "javascript",
      ".cjs": "javascript",
      ".ts": "typescript",
      ".tsx": "typescript",
      ".mts": "typescript",
      ".cts": "typescript",
      ".py": "python",
      ".pyw": "python",
      ".html": "html",
      ".htm": "html",
      ".css": "css",
      ".scss": "scss",
      ".less": "less",
      ".json": "json",
      ".jsonc": "json",
      ".md": "markdown",
      ".mdx": "markdown",
      ".xml": "xml",
      ".svg": "xml",
      ".yaml": "yaml",
      ".yml": "yaml",
      ".sh": "shell",
      ".bash": "shell",
      ".zsh": "shell",
      ".ps1": "powershell",
      ".java": "java",
      ".c": "c",
      ".h": "c",
      ".cpp": "cpp",
      ".hpp": "cpp",
      ".cc": "cpp",
      ".cs": "csharp",
      ".go": "go",
      ".rs": "rust",
      ".rb": "ruby",
      ".php": "php",
      ".swift": "swift",
      ".sql": "sql",
      ".graphql": "graphql",
      ".gql": "graphql",
      ".dockerfile": "dockerfile",
      ".toml": "ini",
      ".ini": "ini",
      ".cfg": "ini",
      ".env": "plaintext",
      ".txt": "plaintext",
      ".log": "plaintext",
      ".r": "r",
      ".kt": "kotlin",
      ".kts": "kotlin",
      ".dart": "dart",
      ".lua": "lua",
      ".vue": "html",
      ".svelte": "html",
      ".astro": "html"
    };
    return map[ext] || "plaintext";
  }
  _languageLabel(lang) {
    const labels = { javascript: "JavaScript", typescript: "TypeScript", python: "Python", html: "HTML", css: "CSS", json: "JSON", markdown: "Markdown", plaintext: "Plain Text", shell: "Shell", rust: "Rust", go: "Go", java: "Java", csharp: "C#", cpp: "C++", ruby: "Ruby", php: "PHP", swift: "Swift", kotlin: "Kotlin", dart: "Dart" };
    return labels[lang] || lang.charAt(0).toUpperCase() + lang.slice(1);
  }
  _fileIcon(name) {
    const ext = name.includes(".") ? "." + name.split(".").pop().toLowerCase() : "";
    const icons = {
      ".js": '<span class="tab-fi" style="color:#f0db4f">JS</span>',
      ".ts": '<span class="tab-fi" style="color:#3178c6">TS</span>',
      ".jsx": '<span class="tab-fi" style="color:#61dafb">\u269B</span>',
      ".tsx": '<span class="tab-fi" style="color:#61dafb">\u269B</span>',
      ".py": '<span class="tab-fi" style="color:#3776ab">Py</span>',
      ".html": '<span class="tab-fi" style="color:#e34f26">&lt;&gt;</span>',
      ".css": '<span class="tab-fi" style="color:#1572b6">#</span>',
      ".scss": '<span class="tab-fi" style="color:#cc6699">#</span>',
      ".json": '<span class="tab-fi" style="color:#f5a623">{}</span>',
      ".md": '<span class="tab-fi" style="color:#519aba">MD</span>',
      ".svg": '<span class="tab-fi" style="color:#ffb13b">\u25C7</span>',
      ".png": '<span class="tab-fi" style="color:#4caf50">Img</span>',
      ".jpg": '<span class="tab-fi" style="color:#4caf50">Img</span>',
      ".yaml": '<span class="tab-fi" style="color:#cb171e">yml</span>',
      ".yml": '<span class="tab-fi" style="color:#cb171e">yml</span>',
      ".sh": '<span class="tab-fi" style="color:#89e051">$_</span>',
      ".go": '<span class="tab-fi" style="color:#00add8">Go</span>',
      ".rs": '<span class="tab-fi" style="color:#dea584">Rs</span>',
      ".java": '<span class="tab-fi" style="color:#b07219">J</span>',
      ".rb": '<span class="tab-fi" style="color:#cc342d">Rb</span>',
      ".php": '<span class="tab-fi" style="color:#777bb4">php</span>'
    };
    return icons[ext] || '<span class="tab-fi" style="opacity:.5">F</span>';
  }
  // ─── Language Providers (Go to Definition, Find References, Rename Symbol) ───
  _registerLanguageProviders(monaco) {
    const self = this;

    // Helper: find symbol definition across open tabs and project files
    const _findSymbolInProject = async (symbolName) => {
      const results = [];
      // Search open tabs first
      for (const tab of self.tabs) {
        if (!tab.model) continue;
        const text = tab.model.getValue();
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          // Definition patterns
          const defPatterns = [
            new RegExp(`(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s+${symbolName}\\b`),
            new RegExp(`(?:export\\s+)?(?:const|let|var)\\s+${symbolName}\\s*=`),
            new RegExp(`(?:export\\s+)?(?:default\\s+)?(?:abstract\\s+)?class\\s+${symbolName}\\b`),
            new RegExp(`(?:export\\s+)?(?:interface|type)\\s+${symbolName}\\b`),
            new RegExp(`(?:async\\s+)?def\\s+${symbolName}\\b`),
            new RegExp(`(?:pub\\s+)?(?:async\\s+)?fn\\s+${symbolName}\\b`),
            new RegExp(`^\\s+(?:static\\s+)?(?:async\\s+)?(?:get\\s+|set\\s+)?${symbolName}\\s*\\(`),
          ];
          for (const pat of defPatterns) {
            if (pat.test(line)) {
              const col = line.indexOf(symbolName) + 1;
              results.push({
                filePath: tab.filePath || tab.name,
                uri: tab.model.uri,
                lineNumber: i + 1,
                column: col,
                endColumn: col + symbolName.length,
                isDefinition: true
              });
              break;
            }
          }
        }
      }
      // If no results from tabs and we have project root, search project files
      if (results.length === 0 && self.app.rootPath) {
        try {
          const searchResult = await window.merecode.fs.search(self.app.rootPath, symbolName, { maxResults: 20, regex: false });
          if (searchResult && Array.isArray(searchResult)) {
            for (const match of searchResult) {
              const line = match.line || '';
              const defPatterns = [
                /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+/,
                /(?:export\s+)?(?:const|let|var)\s+/,
                /(?:export\s+)?(?:default\s+)?class\s+/,
                /(?:export\s+)?(?:interface|type)\s+/,
                /(?:async\s+)?def\s+/,
                /(?:pub\s+)?fn\s+/,
              ];
              const isDef = defPatterns.some(p => p.test(line));
              results.push({
                filePath: match.file,
                lineNumber: match.lineNumber || 1,
                column: (match.column || 0) + 1,
                endColumn: (match.column || 0) + 1 + symbolName.length,
                isDefinition: isDef
              });
            }
          }
        } catch {}
      }
      return results;
    }

    // Helper: find all references to a symbol
    const _findReferencesInProject = async (symbolName) => {
      const results = [];
      for (const tab of self.tabs) {
        if (!tab.model) continue;
        const text = tab.model.getValue();
        const lines = text.split('\n');
        const regex = new RegExp(`\\b${symbolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
        for (let i = 0; i < lines.length; i++) {
          let match;
          while ((match = regex.exec(lines[i])) !== null) {
            results.push({
              uri: tab.model.uri,
              filePath: tab.filePath || tab.name,
              range: new monaco.Range(i + 1, match.index + 1, i + 1, match.index + 1 + symbolName.length)
            });
          }
        }
      }
      // Search project files too
      if (self.app.rootPath) {
        try {
          const searchResult = await window.merecode.fs.search(self.app.rootPath, symbolName, { maxResults: 100, regex: false });
          if (searchResult && Array.isArray(searchResult)) {
            for (const match of searchResult) {
              // Skip if already found in open tabs
              const alreadyFound = results.some(r => r.filePath === match.file && r.range.startLineNumber === match.lineNumber);
              if (alreadyFound) continue;
              const col = (match.column || 0) + 1;
              results.push({
                uri: monaco.Uri.file(match.file),
                filePath: match.file,
                range: new monaco.Range(match.lineNumber || 1, col, match.lineNumber || 1, col + symbolName.length)
              });
            }
          }
        } catch {}
      }
      return results;
    }

    // Go to Definition Provider (F12 / Ctrl+Click)
    this._disposables.push(monaco.languages.registerDefinitionProvider('*', {
      provideDefinition: async (model, position) => {
        const word = model.getWordAtPosition(position);
        if (!word) return null;
        const symbolName = word.word;
        const results = await _findSymbolInProject(symbolName);
        const defs = results.filter(r => r.isDefinition);
        if (defs.length === 0) return null;
        return defs.map(d => {
          const uri = d.uri || monaco.Uri.file(d.filePath);
          return {
            uri: uri,
            range: new monaco.Range(d.lineNumber, d.column, d.lineNumber, d.endColumn)
          };
        });
      }
    }));

    // Find All References Provider (Shift+F12)
    this._disposables.push(monaco.languages.registerReferenceProvider('*', {
      provideReferences: async (model, position, context) => {
        const word = model.getWordAtPosition(position);
        if (!word) return [];
        const symbolName = word.word;
        const refs = await _findReferencesInProject(symbolName);
        return refs.map(r => ({
          uri: r.uri,
          range: r.range
        }));
      }
    }));

    // Rename Symbol Provider (F2)
    this._disposables.push(monaco.languages.registerRenameProvider('*', {
      provideRenameEdits: async (model, position, newName) => {
        const word = model.getWordAtPosition(position);
        if (!word) return null;
        const symbolName = word.word;
        const refs = await _findReferencesInProject(symbolName);
        const edits = [];
        // Group by URI
        const byUri = new Map();
        for (const ref of refs) {
          const key = ref.uri.toString();
          if (!byUri.has(key)) byUri.set(key, { uri: ref.uri, edits: [] });
          byUri.get(key).edits.push({ range: ref.range, text: newName });
        }
        return { edits: Array.from(byUri.values()) };
      },
      resolveRenameLocation: async (model, position) => {
        const word = model.getWordAtPosition(position);
        if (!word) return { rejectReason: 'No symbol found at cursor' };
        return {
          range: new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn),
          text: word.word
        };
      }
    }));

    // Code Action Provider (Extract function/variable)
    this._disposables.push(monaco.languages.registerCodeActionProvider('*', {
      provideCodeActions: (model, range, context) => {
        const selection = self.editor.getSelection();
        if (!selection || selection.isEmpty()) return { actions: [], dispose: () => {} };
        const selectedText = model.getValueInRange(selection);
        if (!selectedText.trim() || selectedText.length < 2) return { actions: [], dispose: () => {} };
        const actions = [];
        // Extract to variable
        actions.push({
          title: '↳ Extract to Variable',
          kind: 'refactor.extract.variable',
          edit: {
            edits: [{
              resource: model.uri,
              textEdit: {
                range: selection,
                text: 'extracted'
              },
              versionId: undefined
            }]
          },
          command: {
            id: 'merecode.extractVariable',
            title: 'Extract Variable',
            arguments: [model, selection, selectedText]
          }
        });
        // Extract to function
        actions.push({
          title: '↳ Extract to Function',
          kind: 'refactor.extract.function',
          edit: {
            edits: [{
              resource: model.uri,
              textEdit: {
                range: selection,
                text: 'extracted()'
              },
              versionId: undefined
            }]
          },
          command: {
            id: 'merecode.extractFunction',
            title: 'Extract Function',
            arguments: [model, selection, selectedText]
          }
        });
        return { actions, dispose: () => {} };
      }
    }));

    // Register extract commands
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyR, () => {
      this._showExtractMenu();
    });

    // Handle file navigation from Go to Definition
    this.editor.onDidChangeModel(() => {});
    const origOpenFile = this.openFile.bind(this);
    const editorInstance = this.editor;
    // Override Monaco's openCodeEditor to handle cross-file navigation
    const openerService = this.editor._codeEditorService || monaco.editor;
    if (openerService?.registerCodeEditorOpenHandler) {
      openerService.registerCodeEditorOpenHandler(async (input) => {
        const uri = input.resource;
        if (uri?.scheme === 'file') {
          const filePath = uri.fsPath || uri.path;
          await origOpenFile(filePath);
          if (input.options?.selection) {
            const sel = input.options.selection;
            editorInstance.revealLineInCenter(sel.startLineNumber);
            editorInstance.setPosition({ lineNumber: sel.startLineNumber, column: sel.startColumn });
          }
          return editorInstance;
        }
        return null;
      });
    }
  }

  // ─── Extract Refactoring Menu ───
  _showExtractMenu() {
    const selection = this.editor?.getSelection();
    if (!selection || selection.isEmpty()) {
      this.app.showToast('Select code to extract', 'warning', 2000);
      return;
    }
    const model = this.editor.getModel();
    const selectedText = model.getValueInRange(selection);
    if (!selectedText.trim()) return;

    const name = prompt('Enter name for extracted symbol:');
    if (!name) return;

    const lang = model.getLanguageId();
    const indent = model.getLineContent(selection.startLineNumber).match(/^(\s*)/)?.[1] || '';
    const isPython = lang === 'python';

    // Determine if it's an expression (extract to variable) or statements (extract to function)
    const isExpression = !selectedText.includes('\n') && !selectedText.trim().endsWith(';');

    if (isExpression) {
      // Extract to variable
      const decl = isPython ? `${name} = ${selectedText}\n${indent}` : `const ${name} = ${selectedText};\n${indent}`;
      this.editor.executeEdits('extract-variable', [
        { range: selection, text: name },
        { range: new this.monaco.Range(selection.startLineNumber, 1, selection.startLineNumber, 1), text: decl }
      ]);
      this.app.showToast(`Extracted to variable "${name}"`, 'success', 2000);
    } else {
      // Extract to function
      const params = '';
      let funcDef;
      if (isPython) {
        funcDef = `\ndef ${name}(${params}):\n    ${selectedText.split('\n').join('\n    ')}\n\n`;
      } else {
        funcDef = `\nfunction ${name}(${params}) {\n  ${selectedText.split('\n').join('\n  ')}\n}\n`;
      }
      const callText = isPython ? `${name}()` : `${name}();`;
      // Insert function at end of file, replace selection with call
      const lastLine = model.getLineCount();
      this.editor.executeEdits('extract-function', [
        { range: selection, text: callText },
        { range: new this.monaco.Range(lastLine + 1, 1, lastLine + 1, 1), text: funcDef }
      ]);
      this.app.showToast(`Extracted to function "${name}"`, 'success', 2000);
    }
  }

  // ─── Snippet Provider with Tabstops ───
  _registerSnippetProvider(monaco) {
    const self = this;
    const snippetsByLang = {
      javascript: [
        { label: 'log', insertText: "console.log('${1:message}', ${2:value});", detail: 'console.log' },
        { label: 'fn', insertText: "function ${1:name}(${2:params}) {\n\t${3}\n}", detail: 'Function declaration' },
        { label: 'afn', insertText: "const ${1:name} = (${2:params}) => {\n\t${3}\n};", detail: 'Arrow function' },
        { label: 'iife', insertText: "(() => {\n\t${1}\n})();", detail: 'IIFE' },
        { label: 'tc', insertText: "try {\n\t${1}\n} catch (${2:err}) {\n\t${3:console.error($2);}\n}", detail: 'Try/Catch' },
        { label: 'imp', insertText: "import { ${2:module} } from '${1:package}';", detail: 'Import' },
        { label: 'prom', insertText: "new Promise((resolve, reject) => {\n\t${1}\n});", detail: 'Promise' },
        { label: 'fore', insertText: "${1:array}.forEach((${2:item}) => {\n\t${3}\n});", detail: 'forEach' },
        { label: 'map', insertText: "${1:array}.map((${2:item}) => ${3});", detail: 'map' },
        { label: 'filter', insertText: "${1:array}.filter((${2:item}) => ${3});", detail: 'filter' },
        { label: 'ternary', insertText: "${1:condition} ? ${2:true} : ${3:false}", detail: 'Ternary' },
        { label: 'timeout', insertText: "setTimeout(() => {\n\t${2}\n}, ${1:1000});", detail: 'setTimeout' },
        { label: 'interval', insertText: "setInterval(() => {\n\t${2}\n}, ${1:1000});", detail: 'setInterval' },
        { label: 'class', insertText: "class ${1:Name} {\n\tconstructor(${2:params}) {\n\t\t${3}\n\t}\n}", detail: 'Class' },
        { label: 'fetch', insertText: "const ${1:response} = await fetch('${2:url}');\nconst ${3:data} = await $1.json();", detail: 'Fetch' },
      ],
      typescript: [
        { label: 'intf', insertText: "interface ${1:Name} {\n\t${2:prop}: ${3:type};\n}", detail: 'Interface' },
        { label: 'type', insertText: "type ${1:Name} = {\n\t${2:prop}: ${3:type};\n};", detail: 'Type alias' },
        { label: 'enum', insertText: "enum ${1:Name} {\n\t${2:Value},\n}", detail: 'Enum' },
        { label: 'gtype', insertText: "type ${1:Name}<${2:T}> = {\n\t${3:prop}: $2;\n};", detail: 'Generic type' },
        { label: 'log', insertText: "console.log('${1:message}', ${2:value});", detail: 'console.log' },
        { label: 'afn', insertText: "const ${1:name} = (${2:params}: ${3:type}): ${4:ReturnType} => {\n\t${5}\n};", detail: 'Typed arrow function' },
      ],
      python: [
        { label: 'def', insertText: "def ${1:name}(${2:params}):\n\t${3:pass}", detail: 'Function' },
        { label: 'cls', insertText: "class ${1:Name}:\n\tdef __init__(self${2:, params}):\n\t\t${3:pass}", detail: 'Class' },
        { label: 'main', insertText: "if __name__ == '__main__':\n\t${1:main()}", detail: 'if __name__' },
        { label: 'tc', insertText: "try:\n\t${1:pass}\nexcept ${2:Exception} as ${3:e}:\n\t${4:print($3)}", detail: 'try/except' },
        { label: 'with', insertText: "with open('${1:file}', '${2:r}') as ${3:f}:\n\t${4:data = $3.read()}", detail: 'with open' },
        { label: 'lc', insertText: "[${1:x} for ${2:x} in ${3:iterable}]", detail: 'List comprehension' },
        { label: 'dc', insertText: "{${1:k}: ${2:v} for ${3:k}, ${4:v} in ${5:iterable}}", detail: 'Dict comprehension' },
        { label: 'dec', insertText: "def ${1:decorator}(func):\n\tdef wrapper(*args, **kwargs):\n\t\t${2}\n\t\treturn func(*args, **kwargs)\n\treturn wrapper", detail: 'Decorator' },
      ],
      html: [
        { label: '!', insertText: "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n\t<meta charset=\"UTF-8\">\n\t<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n\t<title>${1:Document}</title>\n</head>\n<body>\n\t${2}\n</body>\n</html>", detail: 'HTML5 boilerplate' },
        { label: 'div', insertText: "<div class=\"${1:class}\">\n\t${2}\n</div>", detail: 'div.class' },
        { label: 'link', insertText: "<link rel=\"stylesheet\" href=\"${1:styles.css}\">", detail: 'Link stylesheet' },
        { label: 'script', insertText: "<script src=\"${1:script.js}\"><\/script>", detail: 'Script tag' },
      ],
      css: [
        { label: 'flex', insertText: "display: flex;\nalign-items: ${1:center};\njustify-content: ${2:center};", detail: 'Flexbox' },
        { label: 'grid', insertText: "display: grid;\ngrid-template-columns: repeat(${1:3}, 1fr);\ngap: ${2:1rem};", detail: 'Grid' },
        { label: 'mq', insertText: "@media (max-width: ${1:768}px) {\n\t${2}\n}", detail: 'Media query' },
        { label: 'anim', insertText: "@keyframes ${1:name} {\n\tfrom { ${2} }\n\tto { ${3} }\n}", detail: 'Animation' },
      ],
      rust: [
        { label: 'fn', insertText: "fn ${1:name}(${2:params}) -> ${3:ReturnType} {\n\t${4}\n}", detail: 'Function' },
        { label: 'struct', insertText: "struct ${1:Name} {\n\t${2:field}: ${3:Type},\n}", detail: 'Struct' },
        { label: 'impl', insertText: "impl ${1:Name} {\n\t${2}\n}", detail: 'Impl block' },
        { label: 'match', insertText: "match ${1:value} {\n\t${2:pattern} => ${3:result},\n\t_ => ${4:default},\n}", detail: 'Match' },
      ],
      go: [
        { label: 'func', insertText: "func ${1:name}(${2:params}) ${3:returnType} {\n\t${4}\n}", detail: 'Function' },
        { label: 'struct', insertText: "type ${1:Name} struct {\n\t${2:Field} ${3:Type}\n}", detail: 'Struct' },
        { label: 'iferr', insertText: "if err != nil {\n\t${1:return err}\n}", detail: 'if err != nil' },
      ]
    };
    // Also include JSX/TSX under their parent langs
    snippetsByLang.javascriptreact = snippetsByLang.javascript;
    snippetsByLang.typescriptreact = snippetsByLang.typescript;

    this._disposables.push(monaco.languages.registerCompletionItemProvider('*', {
      triggerCharacters: [],
      provideCompletionItems: (model, position) => {
        const lang = model.getLanguageId();
        const snippets = snippetsByLang[lang] || snippetsByLang.javascript || [];
        const word = model.getWordUntilPosition(position);
        const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
        const suggestions = snippets.map(s => ({
          label: s.label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: s.insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: s.detail,
          range: range,
          sortText: '0' + s.label // Sort snippets first
        }));
        return { suggestions };
      }
    }));
  }

  // ─── Problems Tracking (Errors/Warnings from Monaco markers) ───
  _initProblemsTracking(monaco) {
    this._problems = [];
    // Listen for marker changes to update the problems count and panel
    this._disposables.push(monaco.editor.onDidChangeMarkers((uris) => {
      this._updateProblems(monaco);
    }));
  }

  _updateProblems(monaco) {
    if (!monaco) monaco = this.monaco;
    const allMarkers = monaco.editor.getModelMarkers({});
    this._problems = allMarkers;
    let errors = 0, warnings = 0;
    for (const m of allMarkers) {
      if (m.severity === monaco.MarkerSeverity.Error) errors++;
      else if (m.severity === monaco.MarkerSeverity.Warning) warnings++;
    }
    const errorEl = document.getElementById('error-count');
    const warningEl = document.getElementById('warning-count');
    if (errorEl) errorEl.textContent = String(errors);
    if (warningEl) warningEl.textContent = String(warnings);
    // Update problems panel if open
    this._renderProblemsPanel();
  }

  _renderProblemsPanel() {
    const container = document.getElementById('problems-list');
    if (!container) return;
    const monaco = this.monaco;
    if (!monaco) return;
    const markers = this._problems || [];
    if (markers.length === 0) {
      container.innerHTML = '<div class="problems-empty">No problems detected</div>';
      return;
    }
    const severityIcon = (s) => {
      if (s === monaco.MarkerSeverity.Error) return '<span class="problem-icon problem-error">✕</span>';
      if (s === monaco.MarkerSeverity.Warning) return '<span class="problem-icon problem-warning">⚠</span>';
      return '<span class="problem-icon problem-info">ℹ</span>';
    };
    container.innerHTML = markers.map((m, idx) => {
      const file = m.resource?.path?.split('/').pop() || 'unknown';
      return `<div class="problem-item" data-idx="${idx}" title="${this._escHtml(m.message)}">
        ${severityIcon(m.severity)}
        <span class="problem-message">${this._escHtml(m.message)}</span>
        <span class="problem-source">${this._escHtml(m.source || '')}</span>
        <span class="problem-location">${this._escHtml(file)}:${m.startLineNumber}:${m.startColumn}</span>
      </div>`;
    }).join('');
    container.querySelectorAll('.problem-item').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx);
        const marker = markers[idx];
        if (!marker) return;
        // Try to open the file and go to the position
        const filePath = marker.resource?.fsPath || marker.resource?.path;
        if (filePath) {
          const tab = this.tabs.find(t => t.model?.uri?.toString() === marker.resource?.toString());
          if (tab) {
            this.activateTab(tab.id);
          }
        }
        this.editor?.revealLineInCenter(marker.startLineNumber);
        this.editor?.setPosition({ lineNumber: marker.startLineNumber, column: marker.startColumn });
        this.editor?.focus();
      });
    });
  }

  _escHtml(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ─── Inline Git Blame ───
  _inlineBlameDecoration = [];
  async showInlineBlame() {
    const tab = this.tabs.find(t => t.id === this.activeTabId);
    if (!tab?.filePath || !this.app.rootPath) return;
    try {
      const relPath = tab.filePath.replace(/\\/g, '/').replace(this.app.rootPath.replace(/\\/g, '/') + '/', '');
      const result = await window.merecode.git.blameLines(this.app.rootPath, relPath);
      if (result.error || !result.lines) return;
      this._blameData = result.lines;
      this._updateBlameDecoration();
      // Update blame on cursor move
      if (this._blameCursorDisposable) this._blameCursorDisposable.dispose();
      this._blameCursorDisposable = this.editor.onDidChangeCursorPosition(() => {
        this._updateBlameDecoration();
      });
      this.app.showToast('Inline blame enabled', 'success', 1500);
    } catch {
      this.app.showToast('Could not load blame info', 'error', 2000);
    }
  }

  hideInlineBlame() {
    this._blameData = null;
    if (this._blameCursorDisposable) {
      this._blameCursorDisposable.dispose();
      this._blameCursorDisposable = null;
    }
    this._inlineBlameDecoration = this.editor?.deltaDecorations(this._inlineBlameDecoration, []) || [];
  }

  _updateBlameDecoration() {
    if (!this._blameData || !this.editor) return;
    const pos = this.editor.getPosition();
    if (!pos) return;
    const lineIdx = pos.lineNumber - 1;
    const blame = this._blameData[lineIdx];
    if (!blame) {
      this._inlineBlameDecoration = this.editor.deltaDecorations(this._inlineBlameDecoration, []);
      return;
    }
    const text = ` // ${blame.author || '?'} • ${(blame.date || '').slice(0, 10)} • ${(blame.summary || '').slice(0, 50)}`;
    this._inlineBlameDecoration = this.editor.deltaDecorations(this._inlineBlameDecoration, [{
      range: new this.monaco.Range(pos.lineNumber, 1, pos.lineNumber, 1),
      options: {
        after: {
          content: text,
          inlineClassName: 'inline-blame-decoration',
          cursorStops: 1
        },
        isWholeLine: true
      }
    }]);
  }

  dispose() {
    this.stopAutoSave();
    clearTimeout(this._outlineRefreshTimer);
    clearTimeout(this._codeActionTimer);
    this._completionDisposable?.dispose();
    this._mdPreviewDisposable?.dispose();
    this._blameCursorDisposable?.dispose();
    for (const d of this._disposables) d.dispose();
    this._disposables = [];
    if (this._resizeHandler) window.removeEventListener("resize", this._resizeHandler);
    this._codeActionToolbar?.remove();
    if (this._splitEditor) {
      this._splitEditor.dispose();
      this._splitEditor = null;
    }
    for (const tab of this.tabs) {
      clearTimeout(tab._autoSaveDebounce);
      tab.model?.dispose();
    }
    this.editor?.dispose();
  }
}
export {
  EditorManager
};
//# sourceMappingURL=editor.js.map
