// chat.ts — Mere X AI Chat with full project context, streaming, Apply/Edit, Terminal commands
import type { MereCodeApp } from './app.js';

interface ChatMessage {
  role: 'user' | 'model';
  content: string;
  timestamp: number;
}

interface CodeBlock {
  lang: string;
  code: string;
  filePath: string;
}

export class ChatManager {
  app: MereCodeApp;
  messages: ChatMessage[] = [];
  isStreaming = false;
  private _fileTreeCache = '';
  private _fileTreeCacheTime = 0;
  private _terminalOutput = '';
  private _terminalOutputMax = 8000;
  private _conversationHistory: ChatMessage[] = [];
  private _cleanupCallbacks: (() => void)[] = [];

  private messagesEl: HTMLElement | null;
  private inputEl: HTMLTextAreaElement | null;
  private sendBtn: HTMLElement | null;
  private modelSelect: HTMLSelectElement | null;
  private contextFileEl: HTMLElement | null;
  private apikeyBanner: HTMLElement | null;

  constructor(app: MereCodeApp) {
    this.app = app;
    this.messagesEl = document.getElementById('chat-messages');
    this.inputEl = document.getElementById('chat-input') as HTMLTextAreaElement | null;
    this.sendBtn = document.getElementById('btn-send-chat');
    this.modelSelect = document.getElementById('chat-model-select') as HTMLSelectElement | null;
    this.contextFileEl = document.getElementById('chat-context-file');
    this.apikeyBanner = document.getElementById('chat-apikey-banner');

    this.sendBtn?.addEventListener('click', () => this.send());
    this.inputEl?.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.send(); }
    });
    this.inputEl?.addEventListener('input', () => {
      this.inputEl!.style.height = 'auto';
      this.inputEl!.style.height = Math.min(this.inputEl!.scrollHeight, 140) + 'px';
    });

    document.getElementById('btn-close-chat')?.addEventListener('click', () => this.app.toggleChat());
    document.getElementById('btn-clear-chat')?.addEventListener('click', () => this.clear());
    document.getElementById('btn-new-chat')?.addEventListener('click', () => this.clear());

    this.modelSelect?.addEventListener('change', () => {
      localStorage.setItem('merecode-ai-model', this.modelSelect!.value);
      const settingsModel = document.getElementById('setting-ai-model') as HTMLSelectElement | null;
      if (settingsModel) settingsModel.value = this.modelSelect!.value;
    });

    document.getElementById('btn-set-apikey-chat')?.addEventListener('click', () => {
      this.app.switchPanel('settings');
      setTimeout(() => document.getElementById('setting-api-key')?.focus(), 100);
    });

    this._loadModel();
    this._renderWelcome();
    this._checkApiKey();
    this._loadConversationHistory();

    const termCleanup = window.merecode.terminal.onData((id, data) => {
      const clean = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
      this._terminalOutput += clean;
      if (this._terminalOutput.length > this._terminalOutputMax) {
        this._terminalOutput = this._terminalOutput.slice(-this._terminalOutputMax);
      }
    });
    this._cleanupCallbacks.push(termCleanup);

    this._bindCodeActions();

    document.getElementById('btn-prompt-templates')?.addEventListener('click', (e: Event) => {
      e.stopPropagation();
      this._showPromptTemplates();
    });
  }

  private _showPromptTemplates(): void {
    document.getElementById('prompt-template-menu')?.remove();

    const templates = [
      { label: 'Explain current file', prompt: 'Explain the current file in detail — what it does, how it works, and any potential improvements.' },
      { label: 'Find & fix bugs', prompt: 'Find all bugs and issues in the current file and fix them.' },
      { label: 'Add error handling', prompt: 'Add proper error handling to the current file.' },
      { label: 'Write unit tests', prompt: 'Write comprehensive unit tests for the current file.' },
      { label: 'Add JSDoc/docstrings', prompt: 'Add documentation comments (JSDoc or docstrings) to all functions and classes in the current file.' },
      { label: 'Refactor & clean up', prompt: 'Refactor the current file — improve readability, reduce duplication, and follow best practices.' },
      { label: 'Optimize performance', prompt: 'Analyze and optimize the performance of the current file.' },
      { label: 'Convert to TypeScript', prompt: 'Convert the current JavaScript file to TypeScript with proper types.' },
      { label: 'Review security', prompt: 'Review the current file for security vulnerabilities and fix them.' },
      { label: 'Generate README', prompt: 'Generate a comprehensive README.md for this project based on the file tree and code.' },
    ];

    const menu = document.createElement('div');
    menu.id = 'prompt-template-menu';
    menu.className = 'prompt-template-menu';
    menu.innerHTML = templates.map((t, i) =>
      `<div class="pt-item" data-idx="${i}">${this._esc(t.label)}</div>`
    ).join('');
    document.getElementById('chat-input-area')?.appendChild(menu);

    menu.querySelectorAll('.pt-item').forEach((el, i) => {
      el.addEventListener('click', () => {
        if (this.inputEl) {
          this.inputEl.value = templates[i].prompt;
          this.inputEl.dispatchEvent(new Event('input'));
          this.inputEl.focus();
        }
        menu.remove();
      });
    });

    const close = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node) && (e.target as Element).id !== 'btn-prompt-templates') {
        menu.remove();
        document.removeEventListener('click', close);
      }
    };
    setTimeout(() => document.addEventListener('click', close), 0);
  }

  private _loadModel(): void {
    const saved = localStorage.getItem('merecode-ai-model') || 'mere-nyx';
    if (this.modelSelect) this.modelSelect.value = saved;
  }

  _checkApiKey(): void {
    const hasKey = !!this._getApiKey();
    if (this.apikeyBanner) {
      this.apikeyBanner.classList.toggle('visible', !hasKey);
    }
    const dot = document.getElementById('setup-apikey-status')?.querySelector('.setup-dot');
    if (dot) {
      dot.classList.toggle('pending', !hasKey);
      dot.classList.toggle('done', hasKey);
    }
  }

  updateContextFile(fileName: string): void {
    if (this.contextFileEl) {
      this.contextFileEl.textContent = fileName || 'No file open';
    }
  }

  private _butterflyAvatar(): string {
    return `<img src="/assets/logo.png" width="18" height="18" alt="" draggable="false" style="border-radius:50%;">`;
  }

  private _renderWelcome(): void {
    if (!this.messagesEl) return;
    const hasKey = !!this._getApiKey();
    this.messagesEl.innerHTML = `
      <div class="chat-welcome">
        ${!hasKey ? `
        <div class="chat-welcome-setup">
          <div class="chat-setup-icon">🔑</div>
          <h3>Set Up Your API Key</h3>
          <p class="chat-welcome-hint">To start coding with AI, you need a Mere X API key.</p>
          <ol class="chat-welcome-steps">
            <li>Go to <a href="#" id="welcome-get-key">merex.ai</a> and sign in</li>
            <li>Navigate to <strong>Settings → API Keys</strong></li>
            <li>Generate a new key and copy it</li>
            <li>Paste it in <a href="#" id="welcome-open-settings">Settings</a> below</li>
          </ol>
          <button class="btn-accent btn-small" id="welcome-set-key-btn">Configure API Key</button>
        </div>
        ` : `
        <p class="chat-welcome-ready">I'm your AI coding agent — I edit your project files directly.</p>
        <div class="chat-suggestions">
          <button class="chat-suggestion" data-prompt="Explain the current file and suggest improvements">
            <span class="chat-suggestion-icon">📖</span>
            <span>Explain & improve</span>
          </button>
          <button class="chat-suggestion" data-prompt="Find and fix all bugs in the current file">
            <span class="chat-suggestion-icon">🐛</span>
            <span>Fix bugs</span>
          </button>
          <button class="chat-suggestion" data-prompt="Add comprehensive tests for this file">
            <span class="chat-suggestion-icon">🧪</span>
            <span>Add tests</span>
          </button>
          <button class="chat-suggestion" data-prompt="Refactor the current file — optimize and clean up the code">
            <span class="chat-suggestion-icon">⚡</span>
            <span>Refactor code</span>
          </button>
        </div>
        `}
      </div>`;

    this.messagesEl.querySelectorAll('.chat-suggestion').forEach(btn => {
      btn.addEventListener('click', () => {
        const prompt = (btn as HTMLElement).dataset.prompt!;
        if (this.inputEl) this.inputEl.value = prompt;
        this.send();
      });
    });

    document.getElementById('welcome-get-key')?.addEventListener('click', (e: Event) => {
      e.preventDefault();
      window.merecode.app?.openExternal?.('https://merex.ai/chat');
    });
    document.getElementById('welcome-open-settings')?.addEventListener('click', (e: Event) => {
      e.preventDefault();
      this.app.switchPanel('settings');
      setTimeout(() => document.getElementById('setting-api-key')?.focus(), 100);
    });
    document.getElementById('welcome-set-key-btn')?.addEventListener('click', () => {
      this.app.switchPanel('settings');
      setTimeout(() => document.getElementById('setting-api-key')?.focus(), 100);
    });
  }

  clear(): void {
    this.messages = [];
    this._conversationHistory = [];
    this._renderWelcome();
    this._saveConversationHistory();
  }

  private _getApiKey(): string { return localStorage.getItem('merecode-api-key') || ''; }
  private _getModel(): string  { return this.modelSelect?.value || localStorage.getItem('merecode-ai-model') || 'mere-nyx'; }
  private _getTemp(): number   { return parseFloat(localStorage.getItem('merecode-temperature') || '0.7'); }
  private _getApiEndpoint(): string { return 'https://merex.ai/api/v1/chat'; }

  private _saveConversationHistory(): void {
    try {
      const toSave = this.messages.slice(-50).map(m => ({ role: m.role, content: m.content.substring(0, 5000) }));
      localStorage.setItem('merecode-chat-history', JSON.stringify(toSave));
    } catch { /* ignore */ }
  }

  private _loadConversationHistory(): void {
    try {
      const saved = localStorage.getItem('merecode-chat-history');
      if (saved) {
        this.messages = JSON.parse(saved).map((m: any) => ({ ...m, timestamp: Date.now() }));
        if (this.messages.length > 0) this._renderMessages();
      }
    } catch { /* ignore */ }
  }

  private async _getFileTree(dir: string, prefix = '', depth = 0): Promise<string> {
    if (depth > 4) return prefix + '...\n';
    try {
      const entries = await window.merecode.fs.readdir(dir);
      if (!Array.isArray(entries)) return '';
      let tree = '';
      const filtered = (entries as DirEntry[]).filter(e => {
        const skip = ['.git', 'node_modules', '.next', '__pycache__', '.cache', 'dist', 'build', '.DS_Store', 'package-lock.json'];
        return !skip.includes(e.name);
      });
      for (const entry of filtered.slice(0, 80)) {
        const fullPath = window.merecode.path.join(dir, entry.name);
        if (entry.isDirectory) {
          tree += `${prefix}${entry.name}/\n`;
          tree += await this._getFileTree(fullPath, prefix + '  ', depth + 1);
        } else {
          tree += `${prefix}${entry.name}\n`;
        }
      }
      return tree;
    } catch { return ''; }
  }

  private async _getCachedFileTree(): Promise<string> {
    const root = this.app.rootPath;
    if (!root) return '';
    const now = Date.now();
    if (this._fileTreeCache && now - this._fileTreeCacheTime < 30000) return this._fileTreeCache;
    this._fileTreeCache = await this._getFileTree(root);
    this._fileTreeCacheTime = now;
    return this._fileTreeCache;
  }

  private async _resolveFileMentions(text: string): Promise<string> {
    const mentions = text.match(/@([\w.\/\\-]+)/g);
    if (!mentions || !this.app.rootPath) return '';
    let filesContent = '';
    for (const mention of mentions.slice(0, 5)) {
      const relPath = mention.slice(1);
      const fullPath = window.merecode.path.join(this.app.rootPath, relPath);
      const exists = await window.merecode.fs.exists(fullPath);
      if (exists) {
        const stat = await window.merecode.fs.stat(fullPath) as any;
        if (stat.isFile && stat.size < 100000) {
          const result = await window.merecode.fs.readFile(fullPath);
          if (result && result.content) {
            const ext = window.merecode.path.extname(relPath);
            const lang = this._extToLang(ext);
            filesContent += `\n[File: ${relPath}]:\n\`\`\`${lang}\n${result.content}\n\`\`\`\n`;
          }
        }
      }
    }
    return filesContent;
  }

  private _extToLang(ext: string): string {
    const map: Record<string, string> = { '.js':'javascript','.jsx':'javascript','.ts':'typescript','.tsx':'typescript','.py':'python',
      '.html':'html','.css':'css','.json':'json','.md':'markdown','.yaml':'yaml','.yml':'yaml',
      '.sh':'bash','.rs':'rust','.go':'go','.java':'java','.c':'c','.cpp':'cpp','.rb':'ruby','.php':'php' };
    return map[ext] || 'text';
  }

  private _validateFilePath(filePath: string): string | null {
    if (!filePath || !this.app.rootPath) return null;

    let normalized = filePath.replace(/\\/g, '/').trim();
    normalized = normalized.replace(/^\/+/, '');

    if (normalized.includes('..') || normalized.includes('~')) return null;

    if (window.merecode.path.isAbsolute(filePath)) {
      const resolvedRoot = window.merecode.path.resolve(this.app.rootPath).replace(/\\/g, '/');
      const resolvedFile = window.merecode.path.resolve(filePath).replace(/\\/g, '/');
      if (!resolvedFile.startsWith(resolvedRoot)) return null;
      return filePath;
    }

    const fullPath = window.merecode.path.join(this.app.rootPath, normalized);
    const resolvedRoot = window.merecode.path.resolve(this.app.rootPath).replace(/\\/g, '/');
    const resolvedFile = window.merecode.path.resolve(fullPath).replace(/\\/g, '/');

    if (!resolvedFile.startsWith(resolvedRoot)) return null;
    return fullPath;
  }

  async send(): Promise<void> {
    const text = this.inputEl?.value.trim();
    if (!text || this.isStreaming) return;

    const apiKey = this._getApiKey();
    if (!apiKey) {
      this.app.showToast('Please set your API key in Settings to start', 'warning');
      this.app.switchPanel('settings');
      setTimeout(() => document.getElementById('setting-api-key')?.focus(), 100);
      return;
    }

    this.inputEl!.value = '';
    this.inputEl!.style.height = 'auto';
    const context = this.app.editor?.getContext();

    let contextBlock = '';

    const fileTree = await this._getCachedFileTree();
    if (fileTree) {
      const rootName = this.app.rootPath ? window.merecode.path.basename(this.app.rootPath) : 'project';
      contextBlock += `[Project: ${rootName}]\nFile tree:\n${fileTree}\n`;
    }

    if (this.app.editor?.tabs?.length > 0) {
      const openFiles = this.app.editor.tabs.map((t: any) => t.name).join(', ');
      contextBlock += `[Open tabs: ${openFiles}]\n`;
    }

    if (context?.content) {
      contextBlock += `[Current file: ${context.fileName} (${context.language})]:\n\`\`\`${context.language}\n${context.content}\n\`\`\`\n`;
    }

    if (context?.selectedText) {
      contextBlock += `[Selected code]:\n\`\`\`${context.language}\n${context.selectedText}\n\`\`\`\n`;
    }

    const mentionedFiles = await this._resolveFileMentions(text);
    if (mentionedFiles) contextBlock += mentionedFiles;

    if (this._terminalOutput.trim()) {
      const recentOutput = this._terminalOutput.trim().slice(-3000);
      contextBlock += `[Recent terminal output]:\n\`\`\`\n${recentOutput}\n\`\`\`\n`;
    }

    const userContent = contextBlock ? `${contextBlock}\nUser request: ${text}` : text;

    this.messages.push({ role: 'user', content: text, timestamp: Date.now() });
    const aiMsg: ChatMessage = { role: 'model', content: '', timestamp: Date.now() };
    this.messages.push(aiMsg);
    this._renderMessages();
    this.isStreaming = true;
    this._setAIStatus('active');

    try {
      const model = this._getModel();
      const temp = this._getTemp();
      const apiEndpoint = this._getApiEndpoint();

      const platform = window.merecode.app?.platform || 'unknown';
      const systemPrompt = `You are Mere X AI — an expert coding agent built into Mere Code IDE. You work DIRECTLY on the user's project files.

CRITICAL RULES FOR ALL CODE CHANGES:
1. ALWAYS include a file path comment as the FIRST line of EVERY code block that modifies a file:
   - JavaScript/TypeScript/C/Java/Go: // File: relative/path/file.ext
   - Python/Shell/Ruby/YAML: # File: relative/path/file.ext
   - SQL: -- File: relative/path/file.ext
   - HTML/XML: <!-- File: relative/path/file.html -->
2. Provide the COMPLETE file content — never partial snippets. Your code is applied DIRECTLY to project files on disk.
3. For multiple file changes, use SEPARATE code blocks, each with its own file path as the first line.
4. For terminal commands (install deps, run scripts, build, test), use \`\`\`bash code blocks WITHOUT a file path.
5. NEVER say "here's the code" or show code without a file path — it MUST be applicable.

Environment:
- Editor: Mere Code (AI-native IDE)
- OS: ${platform}
- Project root: ${this.app.rootPath || 'No folder open'}

Your capabilities:
- Full project file tree is visible to you
- Currently active file content is visible to you
- All open tabs are visible to you
- Recent terminal output is visible to you (if any)
- Users can reference files with @filename syntax
- Code blocks with file paths are applied DIRECTLY to files via "Accept All" or "Apply"
- Bash/shell code blocks can be executed in the integrated terminal

When the user asks you to make changes, fix bugs, add features, or refactor:
- Write complete, production-ready, working code
- Include ALL necessary imports, dependencies, and boilerplate
- Output ALL files that need to change — don't skip any
- If packages need installing, include a \`\`\`bash block
- Briefly explain what you changed and why after the code blocks
- Be proactive: if you notice bugs or issues, fix them
- NEVER output code without a // File: path (unless it's a terminal command)`;

      const apiMessages = this.messages.slice(0, -1).map((m, i) => ({
        role: m.role,
        parts: [{ text: i === this.messages.length - 2 ? userContent : m.content }],
      }));

      const res = await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages: apiMessages, temperature: temp, systemPrompt }),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        let errMsg = '';
        try { errMsg = JSON.parse(errText)?.error || errText.slice(0, 300); } catch { errMsg = errText.slice(0, 300); }
        if (res.status === 401 || res.status === 403) {
          aiMsg.content = `**API Key Error**: Your API key is invalid or expired. Update it in Settings or generate a new one at [merex.ai](https://merex.ai/chat).\n\n\`Status ${res.status}\``;
        } else if (res.status === 402) {
          aiMsg.content = `**Insufficient Credits**: Your API credits have run out. Top up at [merex.ai](https://merex.ai/chat) → Settings → API Credits.`;
        } else if (res.status === 429) {
          aiMsg.content = `**Rate Limited**: Too many requests. Please wait a moment and try again.`;
        } else {
          aiMsg.content = `**Error ${res.status}**: ${errMsg}`;
        }
        this._renderMessages();
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (reader) {
        let buffer = '';
        while (true) {
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
              if (chunk) { aiMsg.content += chunk; this._renderMessages(); }
            } catch { /* skip */ }
          }
        }
      }
    } catch (err: any) {
      aiMsg.content = `**Connection Error**: ${err.message}\n\nPlease check your internet connection.`;
    } finally {
      this.isStreaming = false;
      this._setAIStatus('ready');
      this._renderMessages();
      this._saveConversationHistory();
      if (aiMsg.content) {
        const blocks = this._collectFileCodeBlocks(aiMsg.content);
        const terminalBlocks = this._collectTerminalBlocks(aiMsg.content);
        if (blocks.length > 0) this._showAcceptAllBar(blocks, terminalBlocks);
      }
    }
  }

  private _collectFileCodeBlocks(content: string): CodeBlock[] {
    const blocks: CodeBlock[] = [];
    const regex = /```(\w*)\n([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const lang = match[1];
      const code = match[2].trim();
      const isTerminal = ['bash', 'shell', 'sh', 'powershell', 'cmd', 'zsh', 'terminal'].includes(lang.toLowerCase());
      if (!isTerminal) {
        const filePath = this._extractFilePath(code);
        if (filePath) blocks.push({ lang, code, filePath });
      }
    }
    return blocks;
  }

  private _collectTerminalBlocks(content: string): { lang: string; code: string }[] {
    const blocks: { lang: string; code: string }[] = [];
    const regex = /```(\w*)\n([\s\S]*?)```/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      const lang = match[1];
      const code = match[2].trim();
      const isTerminal = ['bash', 'shell', 'sh', 'powershell', 'cmd', 'zsh', 'terminal'].includes(lang.toLowerCase());
      if (isTerminal && code) blocks.push({ lang, code });
    }
    return blocks;
  }

  private _showAcceptAllBar(blocks: CodeBlock[], terminalBlocks: { lang: string; code: string }[] = []): void {
    document.querySelector('.chat-accept-bar')?.remove();

    const fileNames = blocks.map(b => {
      const parts = b.filePath.replace(/\\/g, '/').split('/');
      return parts[parts.length - 1];
    });

    const bar = document.createElement('div');
    bar.className = 'chat-accept-bar';
    bar.innerHTML = `
      <div class="chat-accept-info">
        <span class="chat-accept-icon">📁</span>
        <span class="chat-accept-text">
          <strong>${blocks.length} file${blocks.length > 1 ? 's' : ''} to update:</strong>
          ${fileNames.map(f => `<span class="chat-accept-file">${this._esc(f)}</span>`).join(' ')}
        </span>
      </div>
      <div class="chat-accept-actions">
        <button class="btn-accept-all">Accept All</button>
        ${terminalBlocks.length > 0 ? `<button class="btn-run-commands">▶ Run Commands</button>` : ''}
        <button class="btn-dismiss-changes">Dismiss</button>
      </div>
    `;

    this.messagesEl!.appendChild(bar);
    this.messagesEl!.scrollTop = this.messagesEl!.scrollHeight;

    const acceptBtn = bar.querySelector('.btn-accept-all') as HTMLButtonElement;
    acceptBtn.addEventListener('click', async () => {
      acceptBtn.textContent = 'Applying...';
      acceptBtn.disabled = true;
      await this._applyAllChanges(blocks);
      acceptBtn.textContent = '✓ Applied';
      const runBtn = bar.querySelector('.btn-run-commands');
      if (runBtn) {
        runBtn.classList.add('btn-run-highlight');
      } else {
        setTimeout(() => bar.remove(), 2000);
      }
    });

    bar.querySelector('.btn-run-commands')?.addEventListener('click', async () => {
      for (const tb of terminalBlocks) {
        await this._handleRun(tb.code);
      }
      bar.remove();
    });

    (bar.querySelector('.btn-dismiss-changes') as HTMLButtonElement).addEventListener('click', () => bar.remove());
  }

  private async _applyAllChanges(blocks: CodeBlock[]): Promise<void> {
    let applied = 0, created = 0, failed = 0;
    const appliedFiles: string[] = [];

    for (const block of blocks) {
      try {
        const fullPath = this._validateFilePath(block.filePath);
        if (!fullPath) {
          this.app.showToast(`Blocked unsafe path: ${block.filePath}`, 'error');
          failed++;
          continue;
        }

        const cleanCode = block.code
          .replace(/^\/\/\s*File:.*\n?/, '')
          .replace(/^#\s*File:.*\n?/, '')
          .replace(/^--\s*File:.*\n?/, '')
          .replace(/^<!--\s*File:.*-->\n?/, '');

        const exists = await window.merecode.fs.exists(fullPath);
        if (!exists) {
          const dir = window.merecode.path.dirname(fullPath);
          await window.merecode.fs.mkdir(dir);
          created++;
        }

        await window.merecode.fs.writeFile(fullPath, cleanCode);

        const tab = this.app.editor.tabs.find((t: any) => t.filePath === fullPath);
        if (tab) {
          tab.model.setValue(cleanCode);
          tab.isDirty = false;
          this.app.editor._renderTabs();
        }

        appliedFiles.push(fullPath);
        applied++;
      } catch (err) {
        failed++;
        console.error('Apply failed:', block.filePath, err);
      }
    }

    this.app.fileExplorer?.refresh();
    this._fileTreeCache = '';

    const parts: string[] = [];
    if (applied > 0) parts.push(`${applied} file${applied > 1 ? 's' : ''} updated`);
    if (created > 0) parts.push(`${created} new`);
    if (failed > 0) parts.push(`${failed} failed`);
    this.app.showToast(parts.join(', '), failed > 0 ? 'warning' : 'success');

    if (appliedFiles.length > 0) this.app.editor.openFile(appliedFiles[0]);
  }

  private _setAIStatus(state: 'active' | 'ready'): void {
    const el = document.getElementById('status-ai');
    if (!el) return;
    if (state === 'active') {
      el.className = 'status-item status-ai-active';
      el.innerHTML = `<img src="/assets/logo.png" width="12" height="12" alt="" draggable="false"> Generating...`;
    } else {
      el.className = 'status-item status-ai-ready';
      el.innerHTML = `<img src="/assets/logo.png" width="12" height="12" alt="" draggable="false"> AI Ready`;
    }
  }

  private _renderMessages(): void {
    if (!this.messagesEl || this.messages.length === 0) return;

    if (this.isStreaming && this.messagesEl.children.length === this.messages.length) {
      const lastEl = this.messagesEl.lastElementChild;
      const lastMsg = this.messages[this.messages.length - 1];
      if (lastEl && lastMsg.role === 'model') {
        const contentEl = lastEl.querySelector('.chat-message-content');
        if (contentEl) {
          contentEl.innerHTML = this._fmt(lastMsg.content) + '<span class="chat-cursor"></span>';
          this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
          return;
        }
      }
    }

    this.messagesEl.innerHTML = this.messages.map(m => `
      <div class="chat-message ${m.role === 'user' ? 'user' : 'assistant'}">
        <div class="chat-message-avatar">
          ${m.role === 'user' ? 'U' : this._butterflyAvatar()}
        </div>
        <div class="chat-message-content">
          ${this._fmt(m.content)}
          ${this.isStreaming && m === this.messages[this.messages.length - 1] && m.role === 'model' ? '<span class="chat-cursor"></span>' : ''}
        </div>
      </div>
    `).join('');
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private _bindCodeActions(): void {
    if (!this.messagesEl) return;

    this.messagesEl.addEventListener('click', async (e: MouseEvent) => {
      const btn = (e.target as Element).closest('.chat-action-apply, .chat-action-insert, .chat-code-copy, .chat-action-run') as HTMLElement | null;
      if (!btn) return;

      const codeBlock = btn.closest('.chat-code-wrap') || btn.closest('.chat-message-content');
      const code = codeBlock?.querySelector('.chat-code code')?.textContent;
      if (!code && !btn.classList.contains('chat-code-copy')) return;

      if (btn.classList.contains('chat-action-apply')) {
        await this._handleApply(code!);
      } else if (btn.classList.contains('chat-action-insert')) {
        this._handleInsert(code!);
      } else if (btn.classList.contains('chat-code-copy')) {
        const copyCode = codeBlock?.querySelector('.chat-code code')?.textContent;
        if (copyCode) {
          navigator.clipboard.writeText(copyCode).then(() => { btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 2000); });
        }
      } else if (btn.classList.contains('chat-action-run')) {
        await this._handleRun(code!);
      }
    });
  }

  private async _handleApply(code: string): Promise<void> {
    if (!code) return;
    const filePath = this._extractFilePath(code);
    if (filePath && this.app.rootPath) {
      const fullPath = this._validateFilePath(filePath);
      if (!fullPath) {
        this.app.showToast(`Blocked unsafe file path: ${filePath}`, 'error');
        return;
      }
      const exists = await window.merecode.fs.exists(fullPath);
      const cleanCode = code.replace(/^\/\/\s*File:.*\n?/, '').replace(/^#\s*File:.*\n?/, '').replace(/^--\s*File:.*\n?/, '').replace(/^<!--\s*File:.*-->\n?/, '');
      if (exists) {
        this._showDiffModal(fullPath, cleanCode);
      } else {
        const dir = window.merecode.path.dirname(fullPath);
        await window.merecode.fs.mkdir(dir);
        await window.merecode.fs.writeFile(fullPath, cleanCode);
        this.app.showToast(`Created ${window.merecode.path.basename(fullPath)}`, 'success');
        this.app.editor.openFile(fullPath);
        this.app.fileExplorer?.refresh();
      }
    } else {
      const tab = this.app.editor.tabs.find((t: any) => t.id === this.app.editor.activeTabId);
      if (!tab) { this.app.showToast('No file open to apply code', 'warning'); return; }
      if (tab.filePath) {
        this._showDiffModal(tab.filePath, code);
      } else {
        tab.model.setValue(code);
        this.app.showToast('Code applied to current tab', 'success');
      }
    }
  }

  private _handleInsert(code: string): void {
    if (!code) return;
    const editor = this.app.editor.editor;
    if (!editor) return;
    const pos = editor.getPosition();
    editor.executeEdits('ai-insert', [{
      range: new this.app.editor.monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
      text: code,
    }]);
    this.app.showToast('Code inserted at cursor', 'success', 2000);
  }

  private async _handleRun(code: string): Promise<void> {
    if (!code) return;
    if (!this.app.isTerminalOpen) this.app.toggleTerminal();
    if (this.app.terminal.terminals.size === 0) await this.app.terminal.createTerminal();
    const activeId = this.app.terminal.activeTerminalId;
    if (activeId) {
      this._terminalOutput = '';
      const lines = code.trim().split('\n');
      for (const line of lines) {
        window.merecode.terminal.write(activeId, line + '\r');
      }
      this.app.showToast('Command sent to terminal', 'success', 2000);
    }
  }

  private _extractFilePath(code: string): string | null {
    const match = code.match(/^(?:\/\/|#|--)\s*File:\s*(.+?)(?:\s*$|\n)/m);
    if (!match) {
      const htmlMatch = code.match(/^<!--\s*File:\s*(.+?)\s*-->/m);
      return htmlMatch ? htmlMatch[1].trim() : null;
    }
    return match[1].trim();
  }

  private async _showDiffModal(filePath: string, newCode: string): Promise<void> {
    const existing = await window.merecode.fs.readFile(filePath);
    if (existing.error) {
      await window.merecode.fs.writeFile(filePath, newCode);
      this.app.showToast(`Written to ${window.merecode.path.basename(filePath)}`, 'success');
      this.app.editor.openFile(filePath);
      return;
    }

    const oldContent = existing.content || '';
    const fileName = window.merecode.path.basename(filePath);

    const modal = document.createElement('div');
    modal.className = 'diff-modal-overlay';
    modal.innerHTML = `
      <div class="diff-modal">
        <div class="diff-modal-header">
          <span class="diff-modal-title">Apply changes to ${this._esc(fileName)}?</span>
          <div class="diff-modal-actions">
            <button class="btn-small btn-primary" id="diff-accept">Accept & Apply</button>
            <button class="btn-small" id="diff-replace">Replace Entire File</button>
            <button class="btn-small" id="diff-cancel">Cancel</button>
          </div>
        </div>
        <div id="diff-editor-container" class="diff-editor-container"></div>
      </div>
    `;
    document.body.appendChild(modal);

    const diffContainer = document.getElementById('diff-editor-container')!;
    const monaco = this.app.editor.monaco;
    const originalModel = monaco.editor.createModel(oldContent, this.app.editor._langFromExt(window.merecode.path.extname(filePath)));
    const modifiedModel = monaco.editor.createModel(newCode, this.app.editor._langFromExt(window.merecode.path.extname(filePath)));

    const diffEditor = monaco.editor.createDiffEditor(diffContainer, {
      theme: this.app.editor._currentTheme,
      readOnly: false,
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

    document.getElementById('diff-accept')?.addEventListener('click', async () => {
      const modified = modifiedModel.getValue();
      await window.merecode.fs.writeFile(filePath, modified);
      this.app.showToast(`Applied changes to ${fileName}`, 'success');
      const tab = this.app.editor.tabs.find((t: any) => t.filePath === filePath);
      if (tab) { tab.model.setValue(modified); tab.isDirty = false; this.app.editor._renderTabs(); }
      else { this.app.editor.openFile(filePath); }
      cleanup();
    });

    document.getElementById('diff-replace')?.addEventListener('click', async () => {
      await window.merecode.fs.writeFile(filePath, newCode);
      this.app.showToast(`Replaced ${fileName}`, 'success');
      const tab = this.app.editor.tabs.find((t: any) => t.filePath === filePath);
      if (tab) { tab.model.setValue(newCode); tab.isDirty = false; this.app.editor._renderTabs(); }
      else { this.app.editor.openFile(filePath); }
      cleanup();
    });

    document.getElementById('diff-cancel')?.addEventListener('click', cleanup);
    modal.addEventListener('click', (e: MouseEvent) => { if (e.target === modal) cleanup(); });
  }

  private _fmt(content: string): string {
    if (!content) return `<span class="chat-thinking"><span class="chat-thinking-dots"><span></span><span></span><span></span></span> Thinking...</span>`;

    return content
      .replace(/```(\w*)\n([\s\S]*?)```/g, (_: string, lang: string, code: string) => {
        const langLabel = lang || 'code';
        const isTerminal = ['bash', 'shell', 'sh', 'powershell', 'cmd', 'zsh', 'terminal'].includes(langLabel.toLowerCase());
        const isCode = !isTerminal;
        return `<div class="chat-code-wrap">
          <div class="chat-code-header">
            <span>${langLabel}</span>
            <div class="chat-code-actions">
              <span class="chat-code-copy" title="Copy">Copy</span>
              ${isCode ? `<span class="chat-action-apply" title="Apply to file">Apply</span>` : ''}
              ${isCode ? `<span class="chat-action-insert" title="Insert at cursor">Insert</span>` : ''}
              ${isTerminal ? `<span class="chat-action-run" title="Run in terminal">▶ Run</span>` : ''}
            </div>
          </div>
          <pre class="chat-code"><code>${this._esc(code.trim())}</code></pre>
        </div>`;
      })
      .replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/\n/g, '<br>');
  }

  private _esc(s: string): string { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  dispose(): void {
    for (const cb of this._cleanupCallbacks) {
      if (typeof cb === 'function') cb();
    }
    this._cleanupCallbacks = [];
  }
}
