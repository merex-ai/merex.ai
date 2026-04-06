class ChatManager {
  constructor(app) {
    this.messages = [];
    this.isStreaming = false;
    this._fileTreeCache = "";
    this._fileTreeCacheTime = 0;
    this._terminalOutput = "";
    this._terminalOutputMax = 8e3;
    this._conversationHistory = [];
    this._cleanupCallbacks = [];
    this._continuationCount = 0;
    this.app = app;
    this.messagesEl = document.getElementById("chat-messages");
    this.inputEl = document.getElementById("chat-input");
    this.sendBtn = document.getElementById("btn-send-chat");
    this.modelSelect = document.getElementById("chat-model-select");
    this.contextFileEl = document.getElementById("chat-context-file");
    this.apikeyBanner = document.getElementById("chat-apikey-banner");
    this._abortController = null;
    this._webSearchEnabled = false;
    this.sendBtn?.addEventListener("click", () => {
      if (this.isStreaming) { this.stopGeneration(); } else { this.send(); }
    });
    this.inputEl?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });
    this.inputEl?.addEventListener("input", () => {
      this.inputEl.style.height = "auto";
      this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 140) + "px";
    });
    document.getElementById("btn-close-chat")?.addEventListener("click", () => this.app.toggleChat());
    document.getElementById("btn-clear-chat")?.addEventListener("click", () => this.clear());
    document.getElementById("btn-new-chat")?.addEventListener("click", () => this.clear());
    document.getElementById("btn-chat-web-search")?.addEventListener("click", () => {
      this._webSearchEnabled = !this._webSearchEnabled;
      const btn = document.getElementById("btn-chat-web-search");
      if (btn) btn.classList.toggle("active", this._webSearchEnabled);
      this.app.showToast(this._webSearchEnabled ? 'Web search enabled' : 'Web search disabled', 'info', 1500);
    });
    document.getElementById("btn-chat-branches")?.addEventListener("click", () => this.showBranchPicker());
    this.modelSelect?.addEventListener("change", () => {
      localStorage.setItem("merecode-ai-model", this.modelSelect.value);
      const settingsModel = document.getElementById("setting-ai-model");
      if (settingsModel) settingsModel.value = this.modelSelect.value;
    });
    document.getElementById("btn-set-apikey-chat")?.addEventListener("click", () => {
      this.app.switchPanel("settings");
      setTimeout(() => document.getElementById("setting-api-key")?.focus(), 100);
    });
    this._loadModel();
    this._cachedApiKey = "";
    this._loadSecureApiKey().then(() => {
      this._renderWelcome();
      this._checkApiKey();
    });
    this._loadConversationHistory();
    const termCleanup = window.merecode.terminal.onData((id, data) => {
      const clean = data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "");
      this._terminalOutput += clean;
      if (this._terminalOutput.length > this._terminalOutputMax) {
        this._terminalOutput = this._terminalOutput.slice(-this._terminalOutputMax);
      }
    });
    this._cleanupCallbacks.push(termCleanup);
    this._bindCodeActions();
    document.getElementById("btn-prompt-templates")?.addEventListener("click", (e) => {
      e.stopPropagation();
      this._showPromptTemplates();
    });
  }
  _showPromptTemplates() {
    document.getElementById("prompt-template-menu")?.remove();
    const templates = [
      { label: "Explain current file", prompt: "Explain the current file in detail \u2014 what it does, how it works, and any potential improvements." },
      { label: "Find & fix bugs", prompt: "Find all bugs and issues in the current file and fix them." },
      { label: "Add error handling", prompt: "Add proper error handling to the current file." },
      { label: "Write unit tests", prompt: "Write comprehensive unit tests for the current file." },
      { label: "Add JSDoc/docstrings", prompt: "Add documentation comments (JSDoc or docstrings) to all functions and classes in the current file." },
      { label: "Refactor & clean up", prompt: "Refactor the current file \u2014 improve readability, reduce duplication, and follow best practices." },
      { label: "Optimize performance", prompt: "Analyze and optimize the performance of the current file." },
      { label: "Convert to TypeScript", prompt: "Convert the current JavaScript file to TypeScript with proper types." },
      { label: "Review security", prompt: "Review the current file for security vulnerabilities and fix them." },
      { label: "Generate README", prompt: "Generate a comprehensive README.md for this project based on the file tree and code." }
    ];
    const menu = document.createElement("div");
    menu.id = "prompt-template-menu";
    menu.className = "prompt-template-menu";
    menu.innerHTML = templates.map(
      (t, i) => `<div class="pt-item" data-idx="${i}">${this._esc(t.label)}</div>`
    ).join("");
    document.getElementById("chat-input-area")?.appendChild(menu);
    menu.querySelectorAll(".pt-item").forEach((el, i) => {
      el.addEventListener("click", () => {
        if (this.inputEl) {
          this.inputEl.value = templates[i].prompt;
          this.inputEl.dispatchEvent(new Event("input"));
          this.inputEl.focus();
        }
        menu.remove();
      });
    });
    const close = (e) => {
      if (!menu.contains(e.target) && e.target.id !== "btn-prompt-templates") {
        menu.remove();
        document.removeEventListener("click", close);
      }
    };
    setTimeout(() => document.addEventListener("click", close), 0);
  }
  _loadModel() {
    const saved = localStorage.getItem("merecode-ai-model") || "mere-nyx";
    if (this.modelSelect) this.modelSelect.value = saved;
  }
  _checkApiKey() {
    const hasKey = !!this._getApiKey();
    if (this.apikeyBanner) {
      this.apikeyBanner.classList.toggle("visible", !hasKey);
    }
    const dot = document.getElementById("setup-apikey-status")?.querySelector(".setup-dot");
    if (dot) {
      dot.classList.toggle("pending", !hasKey);
      dot.classList.toggle("done", hasKey);
    }
  }
  updateContextFile(fileName) {
    if (this.contextFileEl) {
      this.contextFileEl.textContent = fileName || "No file open";
    }
  }
  _butterflyAvatar() {
    return `<img src="/assets/logo.png" width="18" height="18" alt="" draggable="false" style="border-radius:50%;">`;
  }
  _renderWelcome() {
    if (!this.messagesEl) return;
    const hasKey = !!this._getApiKey();
    this.messagesEl.innerHTML = `
      <div class="chat-welcome">
        ${!hasKey ? `
        <div class="chat-welcome-setup">
          <div class="chat-setup-icon">\u{1F511}</div>
          <h3>Set Up Your API Key</h3>
          <p class="chat-welcome-hint">To start coding with AI, you need a Mere X API key.</p>
          <ol class="chat-welcome-steps">
            <li>Go to <a href="#" id="welcome-get-key">merex.ai</a> and sign in</li>
            <li>Navigate to <strong>Settings \u2192 API Keys</strong></li>
            <li>Generate a new key and copy it</li>
            <li>Paste it in <a href="#" id="welcome-open-settings">Settings</a> below</li>
          </ol>
          <button class="btn-accent btn-small" id="welcome-set-key-btn">Configure API Key</button>
        </div>
        ` : `
        <p class="chat-welcome-ready">I'm your AI coding agent \u2014 I edit your project files directly.</p>
        <div class="chat-suggestions">
          <button class="chat-suggestion" data-prompt="Explain the current file and suggest improvements">
            <span class="chat-suggestion-icon">\u{1F4D6}</span>
            <span>Explain & improve</span>
          </button>
          <button class="chat-suggestion" data-prompt="Find and fix all bugs in the current file">
            <span class="chat-suggestion-icon">\u{1F41B}</span>
            <span>Fix bugs</span>
          </button>
          <button class="chat-suggestion" data-prompt="Add comprehensive tests for this file">
            <span class="chat-suggestion-icon">\u{1F9EA}</span>
            <span>Add tests</span>
          </button>
          <button class="chat-suggestion" data-prompt="Refactor the current file \u2014 optimize and clean up the code">
            <span class="chat-suggestion-icon">\u26A1</span>
            <span>Refactor code</span>
          </button>
        </div>
        `}
      </div>`;
    this.messagesEl.querySelectorAll(".chat-suggestion").forEach((btn) => {
      btn.addEventListener("click", () => {
        const prompt = btn.dataset.prompt;
        if (this.inputEl) this.inputEl.value = prompt;
        this.send();
      });
    });
    document.getElementById("welcome-get-key")?.addEventListener("click", (e) => {
      e.preventDefault();
      window.merecode.app?.openExternal?.("https://merex.ai/chat");
    });
    document.getElementById("welcome-open-settings")?.addEventListener("click", (e) => {
      e.preventDefault();
      this.app.switchPanel("settings");
      setTimeout(() => document.getElementById("setting-api-key")?.focus(), 100);
    });
    document.getElementById("welcome-set-key-btn")?.addEventListener("click", () => {
      this.app.switchPanel("settings");
      setTimeout(() => document.getElementById("setting-api-key")?.focus(), 100);
    });
  }
  clear() {
    this.messages = [];
    this._conversationHistory = [];
    this._renderWelcome();
    this._saveConversationHistory();
  }

  // ─── Conversation Branching ───
  branchConversation(atMessageIndex) {
    // Save current conversation as a branch, then truncate to the branch point
    const branchId = `branch-${Date.now()}`;
    const branches = JSON.parse(localStorage.getItem('merecode-chat-branches') || '[]');
    branches.push({
      id: branchId,
      name: `Branch from message ${atMessageIndex + 1}`,
      timestamp: Date.now(),
      messages: [...this.messages]
    });
    // Keep last 20 branches max, and limit total storage to 500KB
    while (branches.length > 20) branches.shift();
    const branchJson = JSON.stringify(branches);
    if (branchJson.length > 500000) branches.shift(); // drop oldest if too large
    try { localStorage.setItem('merecode-chat-branches', JSON.stringify(branches)); } catch { /* quota exceeded — drop oldest */ branches.shift(); try { localStorage.setItem('merecode-chat-branches', JSON.stringify(branches)); } catch {} }

    // Truncate current conversation to branch point
    this.messages = this.messages.slice(0, atMessageIndex + 1);
    this._conversationHistory = this.messages.map(m => ({ role: m.role, content: m.content }));
    this._renderMessages();
    this._saveConversationHistory();
    this.app.showToast(`Conversation branched. You can switch branches via the branch menu.`, 'success', 3000);
  }

  showBranchPicker() {
    const branches = JSON.parse(localStorage.getItem('merecode-chat-branches') || '[]');
    if (branches.length === 0) {
      this.app.showToast('No conversation branches saved', 'info', 2000);
      return;
    }
    const origCommands = this.app.commands;
    this.app.commands = branches.map((b, i) => ({
      id: `branch.${b.id}`,
      label: `${b.name} (${b.messages.length} messages)`,
      shortcut: new Date(b.timestamp).toLocaleTimeString(),
      fn: () => {
        this.messages = b.messages;
        this._conversationHistory = b.messages.map(m => ({ role: m.role, content: m.content }));
        this._renderMessages();
        this._saveConversationHistory();
        this.app.showToast(`Switched to "${b.name}"`, 'success', 2000);
      }
    }));
    this.app.commands.push({
      id: 'branch.clearAll',
      label: '✕ Clear All Branches',
      shortcut: '',
      fn: () => {
        localStorage.removeItem('merecode-chat-branches');
        this.app.showToast('All branches cleared', 'info', 2000);
      }
    });
    this.app.toggleCommandPalette();
    document.getElementById('command-input').placeholder = 'Select conversation branch...';
    document.getElementById('command-input').value = '';
    this.app._renderCommands('');
    const observer = new MutationObserver(() => {
      if (!document.getElementById('command-palette')?.classList.contains('open')) {
        this.app.commands = origCommands;
        observer.disconnect();
      }
    });
    observer.observe(document.getElementById('command-palette'), { attributes: true, attributeFilter: ['class'] });
  }
  _getApiKey() {
    // Try encrypted key first, fall back to plaintext for migration
    return this._cachedApiKey || localStorage.getItem("merecode-api-key") || "";
  }
  async _loadSecureApiKey() {
    try {
      const encrypted = localStorage.getItem("merecode-api-key-enc");
      if (encrypted) {
        const result = await window.merecode.secure.decrypt(encrypted);
        if (result.data) {
          this._cachedApiKey = result.data;
          return;
        }
      }
      // Migration: encrypt existing plaintext key
      const plain = localStorage.getItem("merecode-api-key");
      if (plain) {
        const available = await window.merecode.secure.isAvailable();
        if (available) {
          const enc = await window.merecode.secure.encrypt(plain);
          if (enc.data) {
            localStorage.setItem("merecode-api-key-enc", enc.data);
            localStorage.removeItem("merecode-api-key");
            this._cachedApiKey = plain;
          }
        }
      }
    } catch {
      // safeStorage not available — keep using plaintext
    }
  }
  async _saveApiKeySecure(key) {
    try {
      const available = await window.merecode.secure.isAvailable();
      if (available) {
        const enc = await window.merecode.secure.encrypt(key);
        if (enc.data) {
          localStorage.setItem("merecode-api-key-enc", enc.data);
          localStorage.removeItem("merecode-api-key");
          this._cachedApiKey = key;
          return;
        }
      }
    } catch {}
    // Fallback to plaintext
    localStorage.setItem("merecode-api-key", key);
    this._cachedApiKey = key;
  }
  _getModel() {
    return this.modelSelect?.value || localStorage.getItem("merecode-ai-model") || "mere-nyx";
  }
  _getTemp() {
    return parseFloat(localStorage.getItem("merecode-temperature") || "0.7");
  }
  _getApiEndpoint() {
    return "https://merex.ai/api/v1/chat";
  }
  _getSystemPrompt() {
    const custom = localStorage.getItem("merecode-system-prompt");
    if (custom) return custom;
    const platform = window.merecode.app?.platform || "unknown";
    return `You are Mere X — the most powerful AI coding agent. You are BETTER than GitHub Copilot. You don't just suggest code — you BUILD entire projects directly on disk.

═══ IDENTITY ═══
You are a senior full-stack engineer with 15+ years of experience. You write production-grade, clean, maintainable code. You think architecturally — not just file by file.

═══ CORE BEHAVIOR ═══
When the user asks you to build, create, or scaffold a project:
1. FIRST — Output a short plan (3-5 lines max) as plain text listing what you'll create
2. THEN — Output EVERY file in order: config → types → utilities → components → pages → styles → entry points
3. FINALLY — Output bash blocks for any install/build commands

When the user asks to fix, change, or update existing code:
1. Read the context carefully (current file, project tree, open tabs)
2. Output ONLY the files that need changing — with COMPLETE file content
3. If a change requires updating multiple files (imports, types, etc.), include ALL of them

═══ FILE OUTPUT FORMAT (MANDATORY — NEVER BREAK THESE RULES) ═══
Every code block that creates or edits a file MUST follow this EXACT format:

\`\`\`language
// File: relative/path/from/project/root/filename.ext
(complete file content here)
\`\`\`

File path comment formats by language:
- JS/TS/C/C++/Java/Go/Rust/Dart/Swift: // File: path/file.ext
- Python/Ruby/Shell/YAML/Dockerfile: # File: path/file.ext
- SQL/Lua: -- File: path/file.ext
- HTML/XML/SVG: <!-- File: path/file.html -->
- CSS/SCSS: /* File: path/file.css */

CRITICAL RULES:
• The file path MUST be the VERY FIRST LINE of the code block
• Use forward slashes for paths: src/components/Header.tsx (NOT backslash)
• Always use RELATIVE paths from the project root
• NEVER use absolute paths
• Output the COMPLETE file — never partial/truncated content
• Each file gets its OWN code block
• DO NOT skip files — if 10 files need creating, output all 10
• If the response might be long, prioritize essential files first

═══ TERMINAL COMMANDS ═══
Commands go in bash blocks WITHOUT a file path line:
\`\`\`bash
npm install express cors dotenv
\`\`\`

═══ RESPONSE STYLE ═══
• Code FIRST, explanation LAST (1-2 sentences after all code blocks)
• Never explain what you're "going to do" — just DO it
• Never ask "would you like me to..." — just build it
• Never output just one file when the task needs multiple files
• If you see bugs or missing imports — fix them silently
• Include error handling, proper types, and edge cases
• Write production-quality code — no TODOs, no placeholders, no "add your logic here"

═══ PROJECT BUILDING ═══
When building a new project from scratch:
- Create complete folder structure with all config files
- Include: package.json / requirements.txt / go.mod (with ALL dependencies)
- Include: tsconfig.json, .gitignore, .env.example, README.md
- Include: proper linting config (ESLint, Prettier, etc.)
- Include: all source files with real implementation (not stubs)
- Setup scripts for dev, build, start
- Make it RUNNABLE immediately after npm install / pip install

═══ EDITING EXISTING CODE ═══
When modifying an existing project:
- Read the file tree and current file CAREFULLY before responding
- Match the existing code style (indentation, naming, patterns)
- Update ALL dependent files (if changing a type, update all imports)
- Don't break existing functionality
- Preserve existing code that doesn't need changing

═══ ENVIRONMENT ═══
IDE: Mere Code | OS: ${platform}
Project root: ${this.app.rootPath || "No folder open"}
Auto-apply: Your code blocks are WRITTEN DIRECTLY to disk (user can Undo)
Terminal: Bash blocks are executed automatically
Continuation: If your response is cut off or incomplete, continue generating when asked

After all code blocks, add a brief summary: "✓ Created X files" or "✓ Updated X files" with a 1-line description.`;
  }
  _saveConversationHistory() {
    try {
      const toSave = this.messages.slice(-50).map((m) => ({ role: m.role, content: m.content.substring(0, 5e3) }));
      localStorage.setItem("merecode-chat-history", JSON.stringify(toSave));
    } catch {
    }
  }
  _loadConversationHistory() {
    try {
      const saved = localStorage.getItem("merecode-chat-history");
      if (saved) {
        this.messages = JSON.parse(saved).map((m) => ({ ...m, timestamp: Date.now() }));
        if (this.messages.length > 0) this._renderMessages();
      }
    } catch {
    }
  }
  async _getFileTree(dir, prefix = "", depth = 0) {
    if (depth > 4) return prefix + "...\n";
    try {
      const entries = await window.merecode.fs.readdir(dir);
      if (!Array.isArray(entries)) return "";
      let tree = "";
      const filtered = entries.filter((e) => {
        const skip = [".git", "node_modules", ".next", "__pycache__", ".cache", "dist", "build", ".DS_Store", "package-lock.json"];
        return !skip.includes(e.name);
      });
      for (const entry of filtered.slice(0, 80)) {
        const fullPath = window.merecode.path.join(dir, entry.name);
        if (entry.isDirectory) {
          tree += `${prefix}${entry.name}/
`;
          tree += await this._getFileTree(fullPath, prefix + "  ", depth + 1);
        } else {
          tree += `${prefix}${entry.name}
`;
        }
      }
      return tree;
    } catch {
      return "";
    }
  }
  async _getCachedFileTree() {
    const root = this.app.rootPath;
    if (!root) return "";
    const now = Date.now();
    if (this._fileTreeCache && now - this._fileTreeCacheTime < 3e4) return this._fileTreeCache;
    this._fileTreeCache = await this._getFileTree(root);
    this._fileTreeCacheTime = now;
    return this._fileTreeCache;
  }
  async _resolveFileMentions(text) {
    const mentions = text.match(/@([\w.\/\\-]+)/g);
    if (!mentions || !this.app.rootPath) return "";
    let filesContent = "";
    for (const mention of mentions.slice(0, 5)) {
      const relPath = mention.slice(1);
      const fullPath = window.merecode.path.join(this.app.rootPath, relPath);
      const exists = await window.merecode.fs.exists(fullPath);
      if (exists) {
        const stat = await window.merecode.fs.stat(fullPath);
        if (stat.isFile && stat.size < 1e5) {
          const result = await window.merecode.fs.readFile(fullPath);
          if (result && result.content) {
            const ext = window.merecode.path.extname(relPath);
            const lang = this._extToLang(ext);
            filesContent += `
[File: ${relPath}]:
\`\`\`${lang}
${result.content}
\`\`\`
`;
          }
        }
      }
    }
    return filesContent;
  }
  async _autoDetectRelevantFiles(userText) {
    if (!this.app.rootPath) return "";
    // Extract file names / paths mentioned in the user's text
    const filePatterns = userText.match(/[\w\-./]+\.\w{1,10}/g) || [];
    const uniqueFiles = [...new Set(filePatterns)].slice(0, 5);
    let result = "";
    for (const pattern of uniqueFiles) {
      // Skip @mentions (handled separately)
      if (userText.includes(`@${pattern}`)) continue;
      const fullPath = window.merecode.path.join(this.app.rootPath, pattern);
      try {
        const exists = await window.merecode.fs.exists(fullPath);
        if (exists) {
          const stat = await window.merecode.fs.stat(fullPath);
          if (stat.isFile && stat.size < 50000) {
            const res = await window.merecode.fs.readFile(fullPath);
            if (res?.content) {
              const ext = window.merecode.path.extname(pattern);
              const lang = this._extToLang(ext);
              result += `[Referenced file: ${pattern}]:
\`\`\`${lang}
${res.content}
\`\`\`
`;
            }
          }
        }
      } catch {}
    }
    return result;
  }
  async _getDependencyContext() {
    if (!this.app.rootPath) return "";
    let result = "";
    // Try package.json
    const pkgPath = window.merecode.path.join(this.app.rootPath, "package.json");
    try {
      const exists = await window.merecode.fs.exists(pkgPath);
      if (exists) {
        const res = await window.merecode.fs.readFile(pkgPath);
        if (res?.content && res.content.length < 10000) {
          result += `[package.json]:
\`\`\`json
${res.content}
\`\`\`
`;
        }
      }
    } catch {}
    // Try requirements.txt
    if (!result) {
      const reqPath = window.merecode.path.join(this.app.rootPath, "requirements.txt");
      try {
        const exists = await window.merecode.fs.exists(reqPath);
        if (exists) {
          const res = await window.merecode.fs.readFile(reqPath);
          if (res?.content && res.content.length < 5000) {
            result += `[requirements.txt]:
\`\`\`
${res.content}
\`\`\`
`;
          }
        }
      } catch {}
    }
    return result;
  }
  _extToLang(ext) {
    const map = {
      ".js": "javascript",
      ".jsx": "javascript",
      ".ts": "typescript",
      ".tsx": "typescript",
      ".py": "python",
      ".html": "html",
      ".css": "css",
      ".json": "json",
      ".md": "markdown",
      ".yaml": "yaml",
      ".yml": "yaml",
      ".sh": "bash",
      ".rs": "rust",
      ".go": "go",
      ".java": "java",
      ".c": "c",
      ".cpp": "cpp",
      ".rb": "ruby",
      ".php": "php"
    };
    return map[ext] || "text";
  }
  _validateFilePath(filePath) {
    if (!filePath || !this.app.rootPath) return null;
    let normalized = filePath.replace(/\\/g, "/").trim();
    normalized = normalized.replace(/^\/+/, "");
    if (normalized.includes("..") || normalized.includes("~")) return null;
    if (window.merecode.path.isAbsolute(filePath)) {
      const resolvedRoot2 = window.merecode.path.resolve(this.app.rootPath).replace(/\\/g, "/");
      const resolvedFile2 = window.merecode.path.resolve(filePath).replace(/\\/g, "/");
      if (!resolvedFile2.startsWith(resolvedRoot2 + "/") && resolvedFile2 !== resolvedRoot2) return null;
      return filePath;
    }
    const fullPath = window.merecode.path.join(this.app.rootPath, normalized);
    const resolvedRoot = window.merecode.path.resolve(this.app.rootPath).replace(/\\/g, "/");
    const resolvedFile = window.merecode.path.resolve(fullPath).replace(/\\/g, "/");
    if (!resolvedFile.startsWith(resolvedRoot + "/") && resolvedFile !== resolvedRoot) return null;
    return fullPath;
  }
  async _validateFilePathAsync(filePath) {
    const initial = this._validateFilePath(filePath);
    if (!initial) return null;
    // Resolve symlinks to prevent path traversal via symlink
    try {
      const real = await window.merecode.fs.realpath(initial);
      if (real.error) return initial; // File doesn't exist yet — allow creation
      const resolvedRoot = window.merecode.path.resolve(this.app.rootPath).replace(/\\/g, "/");
      const realResolved = real.path.replace(/\\/g, "/");
      if (!realResolved.startsWith(resolvedRoot + "/") && realResolved !== resolvedRoot) return null;
      return initial;
    } catch {
      return initial;
    }
  }
  stopGeneration() {
    if (this._abortController) {
      this._abortController.abort();
      this._abortController = null;
    }
  }
  async send() {
    const text = this.inputEl?.value.trim();
    if (!text || this.isStreaming) return;
    const apiKey = this._getApiKey();
    if (!apiKey) {
      this.app.showToast("Set your Mere X API key in Settings to use AI chat", "warning");
      this.app.switchPanel("settings");
      setTimeout(() => document.getElementById("setting-api-key")?.focus(), 100);
      return;
    }
    this.inputEl.value = "";
    this.inputEl.style.height = "auto";
    const context = this.app.editor?.getContext();
    let contextBlock = "";
    const fileTree = await this._getCachedFileTree();
    if (fileTree) {
      const rootName = this.app.rootPath ? window.merecode.path.basename(this.app.rootPath) : "project";
      contextBlock += `[Project: ${rootName}]
File tree:
${fileTree}
`;
    }
    // Include content of ALL open tabs (not just current) for full context
    if (this.app.editor?.tabs?.length > 0) {
      const openFiles = this.app.editor.tabs.map((t) => t.name).join(", ");
      contextBlock += `[Open tabs: ${openFiles}]
`;
      // Include content of open tabs that are relevant (up to 5 files, 50KB total)
      let totalSize = 0;
      const MAX_CONTEXT = 50000;
      for (const tab of this.app.editor.tabs) {
        if (totalSize >= MAX_CONTEXT) break;
        if (tab.filePath === this.app.editor.activeTab?.filePath) continue; // skip current (added below)
        try {
          const content = tab.model?.getValue() || "";
          if (content && content.length < 15000) {
            const ext = window.merecode.path.extname(tab.name);
            const lang = this._extToLang(ext);
            const relPath = tab.filePath.replace(this.app.rootPath, "").replace(/^[\\/]/, "").replace(/\\/g, "/");
            contextBlock += `[Open file: ${relPath}]:
\`\`\`${lang}
${content}
\`\`\`
`;
            totalSize += content.length;
          }
        } catch {}
      }
    }
    if (context?.content) {
      contextBlock += `[Current file: ${context.fileName} (${context.language})]:
\`\`\`${context.language}
${context.content}
\`\`\`
`;
    }
    if (context?.selectedText) {
      contextBlock += `[Selected code]:
\`\`\`${context.language}
${context.selectedText}
\`\`\`
`;
    }
    // Auto-detect related files from the user's message (file names / paths mentioned)
    const autoFiles = await this._autoDetectRelevantFiles(text);
    if (autoFiles) contextBlock += autoFiles;
    const mentionedFiles = await this._resolveFileMentions(text);
    if (mentionedFiles) contextBlock += mentionedFiles;
    // Include package.json / requirements.txt for dependency context
    const depContext = await this._getDependencyContext();
    if (depContext) contextBlock += depContext;
    if (this._terminalOutput.trim()) {
      const recentOutput = this._terminalOutput.trim().slice(-3e3);
      contextBlock += `[Recent terminal output]:
\`\`\`
${recentOutput}
\`\`\`
`;
    }
    // Detect project scaffolding intent and add extra instructions
    const scaffoldKeywords = /\b(build|create|scaffold|generate|make|setup|init|start|bootstrap)\b.*\b(project|app|application|website|site|api|server|backend|frontend|full.?stack)\b/i;
    const isScaffold = scaffoldKeywords.test(text);
    let userRequest = text;
    if (isScaffold && (!fileTree || fileTree.trim().split("\n").length < 3)) {
      userRequest = `${text}

[AGENT MODE: PROJECT SCAFFOLD]
The project folder is empty or nearly empty. Build the COMPLETE project from scratch.
Create ALL files needed: config, source, styles, assets, tests.
Include: package.json with all deps, tsconfig, .gitignore, README.md, .env.example
Include install commands in a bash block at the end.
Output EVERY file — do not skip or summarize any file.`;
    }
    const userContent = contextBlock ? `${contextBlock}
User request: ${userRequest}` : userRequest;
    this.messages.push({ role: "user", content: text, timestamp: Date.now() });
    const aiMsg = { role: "model", content: "", timestamp: Date.now() };
    this.messages.push(aiMsg);
    this._renderMessages();
    this.isStreaming = true;
    this._setAIStatus("active");
    const abortController = new AbortController();
    this._abortController = abortController;
    try {
      const model = this._getModel();
      const temp = this._getTemp();
      const endpoint = this._getApiEndpoint();
      const systemPrompt = this._getSystemPrompt();
      const apiMessages = this.messages.slice(0, -1).map((m, i) => ({
        role: m.role,
        parts: [{ text: i === this.messages.length - 2 ? userContent : m.content }]
      }));

      await this._fetchMereXAPI(endpoint, apiKey, model, apiMessages, temp, systemPrompt, aiMsg, abortController);
    } catch (err) {
      if (err.name === "AbortError") {
        aiMsg.content += "\n\n*Generation stopped.*";
      } else {
        aiMsg.content = `**Connection Error**: ${err.message}

Please check your internet connection and Mere X API key in **Settings**.`;
      }
    } finally {
      this._abortController = null;
      this.isStreaming = false;
      this._setAIStatus("ready");
      this._renderMessages();
      this._saveConversationHistory();
      if (aiMsg.content) {
        const blocks = this._collectFileCodeBlocks(aiMsg.content);
        const terminalBlocks = this._collectTerminalBlocks(aiMsg.content);
        if (blocks.length > 0) {
          // Auto-apply like Copilot Agent mode
          await this._autoApplyChanges(blocks, terminalBlocks);
        } else if (terminalBlocks.length > 0) {
          this._showTerminalBar(terminalBlocks);
        }
        // Agent continuation: if response seems truncated, auto-continue
        if (this._isResponseTruncated(aiMsg.content) && !this._continuationCount) {
          this._continuationCount = 0;
        }
        if (this._isResponseTruncated(aiMsg.content) && this._continuationCount < 3) {
          this._continuationCount++;
          await this._agentContinue(aiMsg);
        } else {
          this._continuationCount = 0;
        }
      }
    }
  }
  _isResponseTruncated(content) {
    if (!content || content.length < 200) return false;
    const trimmed = content.trimEnd();
    // Check for unclosed code blocks
    const openBlocks = (trimmed.match(/```\w*/g) || []).length;
    const closeBlocks = (trimmed.match(/\n```\s*$/gm) || []).length + (trimmed.match(/\n```\n/g) || []).length;
    if (openBlocks > closeBlocks) return true;
    // Check if it ends mid-code (no closing statement)
    if (trimmed.match(/[{(,;:]\s*$/) && !trimmed.match(/```\s*$/)) return true;
    // Check for explicit continuation signals
    if (trimmed.match(/\.\.\.\s*$/) || trimmed.match(/continue|remaining|next files?/i)) return true;
    return false;
  }
  async _agentContinue(previousMsg) {
    const apiKey = this._getApiKey();
    if (!apiKey) return;
    // Show continuation indicator
    this.app.showToast("Agent continuing...", "info");
    this.isStreaming = true;
    this._setAIStatus("active");
    const continueMsg = { role: "model", content: "", timestamp: Date.now() };
    // Add a continuation prompt
    this.messages.push({ role: "user", content: "Continue. Output the remaining files. Do not repeat files already created.", timestamp: Date.now() });
    this.messages.push(continueMsg);
    this._renderMessages();
    const abortController = new AbortController();
    this._abortController = abortController;
    try {
      const model = this._getModel();
      const temp = this._getTemp();
      const endpoint = this._getApiEndpoint();
      const systemPrompt = this._getSystemPrompt();
      const apiMessages = this.messages.slice(0, -1).map((m) => ({
        role: m.role,
        parts: [{ text: m.content }]
      }));
      await this._fetchMereXAPI(endpoint, apiKey, model, apiMessages, temp, systemPrompt, continueMsg, abortController);
    } catch {}
    finally {
      this._abortController = null;
      this.isStreaming = false;
      this._setAIStatus("ready");
      this._renderMessages();
      this._saveConversationHistory();
      if (continueMsg.content) {
        const blocks = this._collectFileCodeBlocks(continueMsg.content);
        const terminalBlocks = this._collectTerminalBlocks(continueMsg.content);
        if (blocks.length > 0) {
          await this._autoApplyChanges(blocks, terminalBlocks);
        } else if (terminalBlocks.length > 0) {
          this._showTerminalBar(terminalBlocks);
        }
        // Check for further continuation (up to max 3)
        if (this._isResponseTruncated(continueMsg.content) && this._continuationCount < 3) {
          this._continuationCount++;
          await this._agentContinue(continueMsg);
        } else {
          this._continuationCount = 0;
        }
      }
    }
  }
  // Mere X API streaming call (via IPC to avoid CORS)
  async _fetchMereXAPI(endpoint, apiKey, model, messages, temp, systemPrompt, aiMsg, abortController) {
    // Set up chunk listener
    let chunkCleanup = null;
    const chunkPromise = new Promise((resolve) => {
      chunkCleanup = window.merecode.api.onChatChunk((parsed) => {
        if (parsed.error) {
          aiMsg.content += `\n\n**Error**: ${parsed.error}`;
          this._renderMessages();
          return;
        }
        const chunk = parsed?.text || "";
        if (chunk) {
          aiMsg.content += chunk;
          this._renderMessages();
        }
        if (parsed.type === "code_execution") {
          aiMsg.content += `\n\`\`\`${parsed.language || "python"}\n${parsed.code}\n\`\`\`\n`;
          this._renderMessages();
        }
        if (parsed.type === "code_result") {
          aiMsg.content += `\n**Output:**\n\`\`\`\n${parsed.output}\n\`\`\`\n`;
          this._renderMessages();
        }
      });
    });

    try {
      const body = { model, messages, temperature: temp, systemPrompt };
      // Web search grounding toggle
      if (this._webSearchEnabled) {
        body.tools = [{ googleSearch: {} }];
      }
      const result = await window.merecode.api.chatStream({
        endpoint,
        apiKey,
        body
      });

      // Clean up chunk listener
      if (chunkCleanup) chunkCleanup();

      if (result.error) {
        let errMsg = "";
        try { const parsed = JSON.parse(result.body || "{}"); errMsg = parsed?.error || result.body?.slice(0, 300) || ""; } catch { errMsg = (result.body || "").slice(0, 300); }
        if (result.status === 401 || result.status === 403) {
          aiMsg.content = `**API Key Error**: Invalid or expired Mere X API key.\n\nGo to **Settings** to update your API key.`;
        } else if (result.status === 402) {
          aiMsg.content = `**Insufficient Credits**: Your Mere X API credits are depleted.\n\nVisit [merex.ai](https://merex.ai) to add more credits.`;
        } else if (result.status === 429) {
          aiMsg.content = `**Rate Limited**: Too many requests. Please wait a moment and try again.`;
        } else if (result.status === 0) {
          aiMsg.content = `**Connection Error**: ${errMsg || "Could not reach merex.ai"}\n\nPlease check your internet connection.`;
        } else {
          aiMsg.content = `**Error ${result.status}**: ${errMsg}`;
        }
        this._renderMessages();
      }
    } catch (err) {
      if (chunkCleanup) chunkCleanup();
      throw err;
    }
  }
  _collectFileCodeBlocks(content) {
    const blocks = [];
    const regex = /```(\w*)\n([\s\S]*?)```/g;
    let match;
    let prevIndex = 0;
    while ((match = regex.exec(content)) !== null) {
      // Safety: prevent infinite loop from zero-length matches
      if (regex.lastIndex === prevIndex) { regex.lastIndex++; continue; }
      prevIndex = regex.lastIndex;
      if (blocks.length >= 50) break; // max 50 files per response
      const lang = match[1];
      const code = match[2].trim();
      const isTerminal = ["bash", "shell", "sh", "powershell", "cmd", "zsh", "terminal"].includes(lang.toLowerCase());
      if (!isTerminal) {
        const filePath = this._extractFilePath(code);
        if (filePath) blocks.push({ lang, code, filePath });
      }
    }
    return blocks;
  }
  _collectTerminalBlocks(content) {
    const blocks = [];
    const regex = /```(\w*)\n([\s\S]*?)```/g;
    let match;
    let prevIndex = 0;
    while ((match = regex.exec(content)) !== null) {
      if (regex.lastIndex === prevIndex) { regex.lastIndex++; continue; }
      prevIndex = regex.lastIndex;
      if (blocks.length >= 20) break;
      const lang = match[1];
      const code = match[2].trim();
      const isTerminal = ["bash", "shell", "sh", "powershell", "cmd", "zsh", "terminal"].includes(lang.toLowerCase());
      if (isTerminal && code) blocks.push({ lang, code });
    }
    return blocks;
  }
  // ─── Auto-Apply (Copilot Agent Style) ───
  async _autoApplyChanges(blocks, terminalBlocks = []) {
    // Show agent working indicator with progress
    document.querySelector(".chat-agent-status")?.remove();
    const statusEl = document.createElement("div");
    statusEl.className = "chat-agent-status";
    statusEl.innerHTML = `<div class="agent-spinner"></div><span class="agent-label">Agent applying ${blocks.length} file${blocks.length > 1 ? "s" : ""}...</span><div class="agent-progress-bar"><div class="agent-progress-fill" style="width:0%"></div></div><div class="agent-file-list"></div>`;
    this.messagesEl.appendChild(statusEl);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    const progressFill = statusEl.querySelector(".agent-progress-fill");
    const fileListEl = statusEl.querySelector(".agent-file-list");

    // Save backups for undo
    const backups = [];
    let applied = 0, created = 0, failed = 0;
    const appliedFiles = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      // Update progress
      const pct = Math.round(((i + 1) / blocks.length) * 100);
      if (progressFill) progressFill.style.width = `${pct}%`;
      const fileName = block.filePath.replace(/\\/g, "/").split("/").pop();
      if (fileListEl) fileListEl.textContent = `${i + 1}/${blocks.length}: ${fileName}`;
      statusEl.querySelector(".agent-label").textContent = `Applying ${i + 1}/${blocks.length}...`;
      try {
        const fullPath = await this._validateFilePathAsync(block.filePath);
        if (!fullPath) {
          failed++;
          continue;
        }
        const cleanCode = block.code.replace(/^\/\/\s*File:.*\n?/, "").replace(/^#\s*File:.*\n?/, "").replace(/^--\s*File:.*\n?/, "").replace(/^<!--\s*File:.*-->\n?/, "").replace(/^\/\*\s*File:.*\*\/\n?/, "");
        const exists = await window.merecode.fs.exists(fullPath);
        let oldContent = "";
        if (exists) {
          const res = await window.merecode.fs.readFile(fullPath);
          oldContent = res.content || "";
        }
        backups.push({ filePath: fullPath, oldContent, wasNew: !exists });

        if (!exists) {
          // Create ALL parent directories recursively
          const dir = window.merecode.path.dirname(fullPath);
          await this._mkdirRecursive(dir);
          created++;
        }
        await window.merecode.fs.writeFile(fullPath, cleanCode);
        const tab = this.app.editor.tabs.find((t) => t.filePath === fullPath);
        if (tab) {
          tab.model.setValue(cleanCode);
          tab.isDirty = false;
          this.app.editor._renderTabs();
        }
        appliedFiles.push(fullPath);
        applied++;
      } catch (err) {
        failed++;
        console.error("Auto-apply failed:", block.filePath, err);
      }
    }

    this.app.fileExplorer?.refresh();
    this._fileTreeCache = "";

    // Remove agent working indicator
    statusEl.remove();

    // Open first applied file
    if (appliedFiles.length > 0) this.app.editor.openFile(appliedFiles[0]);

    // Show result bar with Undo option
    document.querySelector(".chat-accept-bar")?.remove();
    const bar = document.createElement("div");
    bar.className = "chat-accept-bar";

    const summary = [];
    if (applied > 0) summary.push(`${applied} file${applied > 1 ? "s" : ""} updated`);
    if (created > 0) summary.push(`${created} new`);
    if (failed > 0) summary.push(`${failed} failed`);

    bar.innerHTML = `
      <div class="chat-accept-info">
        <span class="chat-accept-icon">\u2713</span>
        <span class="chat-accept-text">
          <strong>Applied: ${summary.join(", ")}</strong>
          ${appliedFiles.map(f => `<span class="chat-accept-file">${this._esc(window.merecode.path.basename(f))}</span>`).join(" ")}
        </span>
      </div>
      <div class="chat-accept-actions">
        <button class="btn-rollback">\u27F2 Undo All</button>
        ${terminalBlocks.length > 0 ? `<button class="btn-run-commands">\u25B6 Run Commands (${terminalBlocks.length})</button>` : ""}
        <button class="btn-dismiss-changes">OK</button>
      </div>
    `;
    this.messagesEl.appendChild(bar);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;

    bar.querySelector(".btn-rollback")?.addEventListener("click", async () => {
      await this._rollbackChanges(backups);
      bar.remove();
    });
    bar.querySelector(".btn-run-commands")?.addEventListener("click", async () => {
      for (const tb of terminalBlocks) {
        await this._handleRun(tb.code);
      }
      bar.querySelector(".btn-run-commands").textContent = "\u2713 Commands Sent";
      bar.querySelector(".btn-run-commands").disabled = true;
    });
    bar.querySelector(".btn-dismiss-changes")?.addEventListener("click", () => bar.remove());

    if (applied > 0) {
      this.app.showToast(`\u2713 ${summary.join(", ")}`, failed > 0 ? "warning" : "success");
    }

    // Auto-run terminal commands (Agent mode — like Copilot)
    if (terminalBlocks.length > 0) {
      const runBtn = bar.querySelector(".btn-run-commands");
      if (runBtn) {
        runBtn.textContent = "\u25B6 Running...";
        runBtn.disabled = true;
      }
      for (const tb of terminalBlocks) {
        await this._handleRun(tb.code);
      }
      if (runBtn) {
        runBtn.textContent = "\u2713 Commands Executed";
      }
    }
  }
  async _mkdirRecursive(dirPath) {
    // Create all parent directories from root to target
    try {
      const exists = await window.merecode.fs.exists(dirPath);
      if (exists) return;
      const parent = window.merecode.path.dirname(dirPath);
      if (parent && parent !== dirPath) {
        await this._mkdirRecursive(parent);
      }
      await window.merecode.fs.mkdir(dirPath);
    } catch {}
  }
  _showTerminalBar(terminalBlocks) {
    document.querySelector(".chat-accept-bar")?.remove();
    const bar = document.createElement("div");
    bar.className = "chat-accept-bar";
    const cmdPreview = terminalBlocks.map(b => b.code.split('\n')[0]).join('; ').slice(0, 120);
    bar.innerHTML = `
      <div class="chat-accept-info">
        <span class="chat-accept-icon">\u25B6</span>
        <span class="chat-accept-text"><strong>${terminalBlocks.length} command${terminalBlocks.length > 1 ? "s" : ""}</strong>: <code>${cmdPreview}</code></span>
      </div>
      <div class="chat-accept-actions">
        <button class="btn-run-commands">\u25B6 Run</button>
        <button class="btn-dismiss-changes">Dismiss</button>
      </div>
    `;
    this.messagesEl.appendChild(bar);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    bar.querySelector(".btn-dismiss-changes")?.addEventListener("click", () => bar.remove());
    const runBtn = bar.querySelector(".btn-run-commands");
    if (runBtn) {
      runBtn.addEventListener("click", async () => {
        runBtn.disabled = true;
        runBtn.textContent = "\u25B6 Running...";
        for (const tb of terminalBlocks) {
          await this._handleRun(tb.code);
        }
        runBtn.textContent = "\u2713 Done";
        runBtn.disabled = false;
        setTimeout(() => bar.remove(), 4000);
      });
    }
  }
  _showAcceptAllBar(blocks, terminalBlocks = []) {
    document.querySelector(".chat-accept-bar")?.remove();
    const fileNames = blocks.map((b) => {
      const parts = b.filePath.replace(/\\/g, "/").split("/");
      return parts[parts.length - 1];
    });
    const bar = document.createElement("div");
    bar.className = "chat-accept-bar";
    bar.innerHTML = `
      <div class="chat-accept-info">
        <span class="chat-accept-icon">\u{1F4C1}</span>
        <span class="chat-accept-text">
          <strong>${blocks.length} file${blocks.length > 1 ? "s" : ""} to update:</strong>
          ${fileNames.map((f) => `<span class="chat-accept-file">${this._esc(f)}</span>`).join(" ")}
        </span>
      </div>
      <div class="chat-accept-actions">
        <button class="btn-accept-all">Accept All</button>
        ${terminalBlocks.length > 0 ? `<button class="btn-run-commands">\u25B6 Run Commands</button>` : ""}
        <button class="btn-dismiss-changes">Dismiss</button>
      </div>
    `;
    this.messagesEl.appendChild(bar);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    const previewBtn = bar.querySelector(".btn-accept-all");
    previewBtn.textContent = "Preview & Apply";
    previewBtn.addEventListener("click", async () => {
      previewBtn.textContent = "Loading...";
      previewBtn.disabled = true;
      await this._showMultiFilePreview(blocks, bar, terminalBlocks);
    });
    bar.querySelector(".btn-run-commands")?.addEventListener("click", async () => {
      for (const tb of terminalBlocks) {
        await this._handleRun(tb.code);
      }
      bar.remove();
    });
    bar.querySelector(".btn-dismiss-changes").addEventListener("click", () => bar.remove());
  }
  async _applyAllChanges(blocks) {
    let applied = 0, created = 0, failed = 0;
    const appliedFiles = [];
    for (const block of blocks) {
      try {
        const fullPath = await this._validateFilePathAsync(block.filePath);
        if (!fullPath) {
          this.app.showToast(`Blocked unsafe path: ${block.filePath}`, "error");
          failed++;
          continue;
        }
        const cleanCode = block.code.replace(/^\/\/\s*File:.*\n?/, "").replace(/^#\s*File:.*\n?/, "").replace(/^--\s*File:.*\n?/, "").replace(/^<!--\s*File:.*-->\n?/, "");
        const exists = await window.merecode.fs.exists(fullPath);
        if (!exists) {
          const dir = window.merecode.path.dirname(fullPath);
          await window.merecode.fs.mkdir(dir);
          created++;
        }
        await window.merecode.fs.writeFile(fullPath, cleanCode);
        const tab = this.app.editor.tabs.find((t) => t.filePath === fullPath);
        if (tab) {
          tab.model.setValue(cleanCode);
          tab.isDirty = false;
          this.app.editor._renderTabs();
        }
        appliedFiles.push(fullPath);
        applied++;
      } catch (err) {
        failed++;
        console.error("Apply failed:", block.filePath, err);
      }
    }
    this.app.fileExplorer?.refresh();
    this._fileTreeCache = "";
    const parts = [];
    if (applied > 0) parts.push(`${applied} file${applied > 1 ? "s" : ""} updated`);
    if (created > 0) parts.push(`${created} new`);
    if (failed > 0) parts.push(`${failed} failed`);
    this.app.showToast(parts.join(", "), failed > 0 ? "warning" : "success");
    if (appliedFiles.length > 0) this.app.editor.openFile(appliedFiles[0]);
  }
  async _showMultiFilePreview(blocks, acceptBar, terminalBlocks) {
    const monaco = this.app.editor.monaco;
    const previews = [];
    for (const block of blocks) {
      const fullPath = await this._validateFilePathAsync(block.filePath);
      if (!fullPath) {
        previews.push({ block, fullPath: null, status: "blocked", oldContent: "", newContent: "" });
        continue;
      }
      const cleanCode = block.code.replace(/^\/\/\s*File:.*\n?/, "").replace(/^#\s*File:.*\n?/, "").replace(/^--\s*File:.*\n?/, "").replace(/^<!--\s*File:.*-->\n?/, "");
      const exists = await window.merecode.fs.exists(fullPath);
      let oldContent = "";
      if (exists) {
        const res = await window.merecode.fs.readFile(fullPath);
        oldContent = res.content || "";
      }
      previews.push({ block, fullPath, status: exists ? "modify" : "create", oldContent, newContent: cleanCode, selected: true });
    }
    const modal = document.createElement("div");
    modal.className = "diff-modal-overlay";
    modal.innerHTML = `
      <div class="diff-modal" style="width:90vw;height:90vh;">
        <div class="diff-modal-header" style="flex-wrap:wrap;gap:8px;">
          <span class="diff-modal-title">Preview Changes (${previews.length} file${previews.length > 1 ? "s" : ""})</span>
          <div class="diff-modal-actions">
            <button class="btn-small btn-primary" id="mfp-apply">Apply Selected</button>
            <button class="btn-small" id="mfp-cancel">Cancel</button>
          </div>
        </div>
        <div style="display:flex;height:calc(100% - 48px);overflow:hidden;">
          <div id="mfp-file-list" style="width:200px;min-width:150px;border-right:1px solid var(--border);overflow-y:auto;"></div>
          <div id="mfp-diff-container" style="flex:1;overflow:hidden;"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    const fileListEl = document.getElementById("mfp-file-list");
    const diffContainer = document.getElementById("mfp-diff-container");
    let activeDiffEditor = null;
    let activeModels = [];
    let activeIdx = 0;

    const renderFileList = () => {
      fileListEl.innerHTML = previews.map((p, i) => {
        const name = p.fullPath ? window.merecode.path.basename(p.fullPath) : p.block.filePath;
        const icon = p.status === "create" ? "+" : p.status === "blocked" ? "⚠" : "~";
        const color = p.status === "create" ? "var(--success)" : p.status === "blocked" ? "var(--error)" : "var(--warning)";
        const checked = p.selected ? "checked" : "";
        const active = i === activeIdx ? "background:var(--bg-hover);" : "";
        return `<div class="mfp-file-item" data-idx="${i}" style="padding:6px 8px;cursor:pointer;display:flex;align-items:center;gap:6px;${active}">
          ${p.status !== "blocked" ? `<input type="checkbox" class="mfp-check" data-idx="${i}" ${checked} style="cursor:pointer;">` : ""}
          <span style="color:${color};font-weight:600;width:12px;">${icon}</span>
          <span style="font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${this._esc(p.fullPath || p.block.filePath)}">${this._esc(name)}</span>
        </div>`;
      }).join("");
    };

    const showDiff = (idx) => {
      activeIdx = idx;
      renderFileList();
      if (activeDiffEditor) { activeDiffEditor.dispose(); activeDiffEditor = null; }
      activeModels.forEach(m => m.dispose());
      activeModels = [];
      diffContainer.innerHTML = "";
      const p = previews[idx];
      if (p.status === "blocked") {
        diffContainer.innerHTML = `<div style="padding:20px;color:var(--error);">Blocked: unsafe path ${this._esc(p.block.filePath)}</div>`;
        return;
      }
      const ext = window.merecode.path.extname(p.fullPath || "");
      const lang = this.app.editor._langFromExt(ext);
      const origModel = monaco.editor.createModel(p.oldContent, lang);
      const modModel = monaco.editor.createModel(p.newContent, lang);
      activeModels = [origModel, modModel];
      activeDiffEditor = monaco.editor.createDiffEditor(diffContainer, {
        theme: this.app.editor._currentTheme,
        readOnly: false,
        originalEditable: false,
        renderSideBySide: true,
        fontSize: 13,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        automaticLayout: true
      });
      activeDiffEditor.setModel({ original: origModel, modified: modModel });
    };

    renderFileList();
    if (previews.length > 0) showDiff(0);

    fileListEl.addEventListener("click", (e) => {
      const item = e.target.closest(".mfp-file-item");
      if (!item) return;
      const idx = parseInt(item.dataset.idx);
      if (e.target.classList.contains("mfp-check")) {
        previews[idx].selected = e.target.checked;
        return;
      }
      showDiff(idx);
    });

    const cleanup = () => {
      if (activeDiffEditor) activeDiffEditor.dispose();
      activeModels.forEach(m => m.dispose());
      modal.remove();
    };

    document.getElementById("mfp-apply")?.addEventListener("click", async () => {
      const btn = document.getElementById("mfp-apply");
      btn.textContent = "Applying...";
      btn.disabled = true;
      // Save backups for rollback
      const backups = [];
      const selectedPreviews = previews.filter(p => p.selected && p.status !== "blocked");
      for (const p of selectedPreviews) {
        backups.push({ filePath: p.fullPath, oldContent: p.oldContent, wasNew: p.status === "create" });
      }
      cleanup();
      // Apply using updated newContent from diff editor
      const selectedBlocks = selectedPreviews.map(p => p.block);
      await this._applyAllChanges(selectedBlocks);
      // Store backups for rollback
      this._lastApplyBackup = backups;
      // Replace accept bar with rollback option
      acceptBar.innerHTML = `
        <div class="chat-accept-info">
          <span class="chat-accept-icon">✓</span>
          <span class="chat-accept-text"><strong>${selectedBlocks.length} file${selectedBlocks.length > 1 ? "s" : ""} applied</strong></span>
        </div>
        <div class="chat-accept-actions">
          <button class="btn-rollback">⟲ Undo All</button>
          ${terminalBlocks.length > 0 ? `<button class="btn-run-commands">▶ Run Commands</button>` : ""}
          <button class="btn-dismiss-changes">Dismiss</button>
        </div>
      `;
      acceptBar.querySelector(".btn-rollback")?.addEventListener("click", async () => {
        await this._rollbackChanges(backups);
        acceptBar.remove();
      });
      acceptBar.querySelector(".btn-run-commands")?.addEventListener("click", async () => {
        for (const tb of terminalBlocks) {
          await this._handleRun(tb.code);
        }
        acceptBar.remove();
      });
      acceptBar.querySelector(".btn-dismiss-changes")?.addEventListener("click", () => acceptBar.remove());
    });

    document.getElementById("mfp-cancel")?.addEventListener("click", () => {
      cleanup();
      const previewBtn = acceptBar.querySelector(".btn-accept-all");
      if (previewBtn) {
        previewBtn.textContent = "Preview & Apply";
        previewBtn.disabled = false;
      }
    });

    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        cleanup();
        const previewBtn = acceptBar.querySelector(".btn-accept-all");
        if (previewBtn) {
          previewBtn.textContent = "Preview & Apply";
          previewBtn.disabled = false;
        }
      }
    });
  }
  async _rollbackChanges(backups) {
    let restored = 0, failed = 0;
    for (const b of backups) {
      try {
        if (b.wasNew) {
          await window.merecode.fs.delete(b.filePath);
        } else {
          await window.merecode.fs.writeFile(b.filePath, b.oldContent);
        }
        const tab = this.app.editor.tabs.find(t => t.filePath === b.filePath);
        if (tab) {
          if (b.wasNew) {
            this.app.editor.closeTab(tab.id);
          } else {
            tab.model.setValue(b.oldContent);
            tab.isDirty = false;
            this.app.editor._renderTabs();
          }
        }
        restored++;
      } catch (err) {
        failed++;
        console.error("Rollback failed:", b.filePath, err);
      }
    }
    this.app.fileExplorer?.refresh();
    this._fileTreeCache = "";
    this.app.showToast(`Rollback: ${restored} file${restored > 1 ? "s" : ""} restored${failed > 0 ? `, ${failed} failed` : ""}`, failed > 0 ? "warning" : "success");
  }
  _setAIStatus(state) {
    const el = document.getElementById("status-ai");
    if (!el) return;
    if (state === "active") {
      el.className = "status-item status-ai-active";
      el.innerHTML = `<img src="/assets/logo.png" width="12" height="12" alt="" draggable="false"> Generating...`;
      if (this.sendBtn) { this.sendBtn.textContent = "■ Stop"; this.sendBtn.classList.add("btn-stop"); }
    } else {
      el.className = "status-item status-ai-ready";
      el.innerHTML = `<img src="/assets/logo.png" width="12" height="12" alt="" draggable="false"> AI Ready`;
      if (this.sendBtn) { this.sendBtn.textContent = "Send"; this.sendBtn.classList.remove("btn-stop"); }
    }
  }
  _renderMessages() {
    if (!this.messagesEl || this.messages.length === 0) return;
    // Throttle renders during streaming (max 10fps) to prevent UI jank
    if (this.isStreaming) {
      const now = Date.now();
      if (this._lastRenderTime && now - this._lastRenderTime < 100) {
        if (!this._renderPending) {
          this._renderPending = true;
          setTimeout(() => { this._renderPending = false; this._renderMessages(); }, 100);
        }
        return;
      }
      this._lastRenderTime = now;
    }
    // Limit messages in memory to prevent DOM explosion
    if (this.messages.length > 200) {
      this.messages = this.messages.slice(-200);
    }
    // During streaming, only update the last message content (incremental render)
    if (this.isStreaming) {
      const lastMsg = this.messages[this.messages.length - 1];
      if (lastMsg.role === "model") {
        let lastEl = this.messagesEl.lastElementChild;
        // If the DOM already has all messages, just update the last one
        if (lastEl && this.messagesEl.children.length === this.messages.length) {
          const contentEl = lastEl.querySelector(".chat-message-content");
          if (contentEl) {
            contentEl.innerHTML = this._fmt(lastMsg.content) + '<span class="chat-cursor"></span>';
            this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
            return;
          }
        }
        // Messages count mismatch — need to append new message element
        if (this.messagesEl.children.length === this.messages.length - 1) {
          const msgEl = document.createElement("div");
          msgEl.className = "chat-message assistant";
          msgEl.innerHTML = `
            <div class="chat-message-avatar">${this._butterflyAvatar()}</div>
            <div class="chat-message-content">${this._fmt(lastMsg.content)}<span class="chat-cursor"></span></div>
          `;
          this.messagesEl.appendChild(msgEl);
          this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
          return;
        }
      }
    }
    // Full re-render (non-streaming or when structure changes)
    this.messagesEl.innerHTML = this.messages.map((m, idx) => `
      <div class="chat-message ${m.role === "user" ? "user" : "assistant"}">
        <div class="chat-message-avatar">
          ${m.role === "user" ? "U" : this._butterflyAvatar()}
        </div>
        <div class="chat-message-content">
          ${this._fmt(m.content)}
          ${this.isStreaming && m === this.messages[this.messages.length - 1] && m.role === "model" ? '<span class="chat-cursor"></span>' : ""}
        </div>
        ${!this.isStreaming && m.role === "model" ? `<button class="chat-branch-btn" data-msg-idx="${idx}" title="Branch conversation from here">⑂</button>` : ''}
      </div>
    `).join("");
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    // Bind branch buttons
    this.messagesEl.querySelectorAll('.chat-branch-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.msgIdx);
        this.branchConversation(idx);
      });
    });
  }
  _bindCodeActions() {
    if (!this.messagesEl) return;
    this.messagesEl.addEventListener("click", async (e) => {
      const btn = e.target.closest(".chat-action-apply, .chat-action-insert, .chat-code-copy, .chat-action-run");
      if (!btn) return;
      const codeBlock = btn.closest(".chat-code-wrap") || btn.closest(".chat-message-content");
      const code = codeBlock?.querySelector(".chat-code code")?.textContent;
      if (!code && !btn.classList.contains("chat-code-copy")) return;
      if (btn.classList.contains("chat-action-apply")) {
        await this._handleApply(code);
      } else if (btn.classList.contains("chat-action-insert")) {
        this._handleInsert(code);
      } else if (btn.classList.contains("chat-code-copy")) {
        const copyCode = codeBlock?.querySelector(".chat-code code")?.textContent;
        if (copyCode) {
          navigator.clipboard.writeText(copyCode).then(() => {
            btn.textContent = "Copied!";
            setTimeout(() => btn.textContent = "Copy", 2e3);
          });
        }
      } else if (btn.classList.contains("chat-action-run")) {
        await this._handleRun(code);
      }
    });
  }
  async _handleApply(code) {
    if (!code) return;
    const filePath = this._extractFilePath(code);
    if (filePath && this.app.rootPath) {
      const fullPath = await this._validateFilePathAsync(filePath);
      if (!fullPath) {
        this.app.showToast(`Blocked unsafe file path: ${filePath}`, "error");
        return;
      }
      const exists = await window.merecode.fs.exists(fullPath);
      const cleanCode = code.replace(/^\/\/\s*File:.*\n?/, "").replace(/^#\s*File:.*\n?/, "").replace(/^--\s*File:.*\n?/, "").replace(/^<!--\s*File:.*-->\n?/, "");
      if (exists) {
        this._showDiffModal(fullPath, cleanCode);
      } else {
        const dir = window.merecode.path.dirname(fullPath);
        await window.merecode.fs.mkdir(dir);
        await window.merecode.fs.writeFile(fullPath, cleanCode);
        this.app.showToast(`Created ${window.merecode.path.basename(fullPath)}`, "success");
        this.app.editor.openFile(fullPath);
        this.app.fileExplorer?.refresh();
      }
    } else {
      const tab = this.app.editor.tabs.find((t) => t.id === this.app.editor.activeTabId);
      if (!tab) {
        this.app.showToast("No file open to apply code", "warning");
        return;
      }
      if (tab.filePath) {
        this._showDiffModal(tab.filePath, code);
      } else {
        tab.model.setValue(code);
        this.app.showToast("Code applied to current tab", "success");
      }
    }
  }
  _handleInsert(code) {
    if (!code) return;
    const editor = this.app.editor.editor;
    if (!editor) return;
    const pos = editor.getPosition();
    editor.executeEdits("ai-insert", [{
      range: new this.app.editor.monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
      text: code
    }]);
    this.app.showToast("Code inserted at cursor", "success", 2e3);
  }
  async _handleRun(code) {
    if (!code) return;
    if (!this.app.isTerminalOpen) this.app.toggleTerminal();
    let termId = this.app.terminal.activeTerminalId;
    if (!termId || this.app.terminal.terminals.size === 0) {
      termId = await this.app.terminal.createTerminal();
      if (!termId) {
        this.app.showToast("Failed to create terminal", "error");
        return;
      }
      // Wait for terminal to be ready
      await new Promise(r => setTimeout(r, 300));
    }
    this._terminalOutput = "";
    const lines = code.trim().split("\n");
    for (const line of lines) {
      window.merecode.terminal.write(termId, line + "\r");
      // Small delay between lines to avoid garbling
      if (lines.length > 1) await new Promise(r => setTimeout(r, 100));
    }
    this.app.showToast("Command sent to terminal", "success", 2e3);
  }
  _extractFilePath(code) {
    const match = code.match(/^(?:\/\/|#|--)\s*File:\s*(.+?)(?:\s*$|\n)/m);
    if (!match) {
      const htmlMatch = code.match(/^<!--\s*File:\s*(.+?)\s*-->/m);
      if (htmlMatch) return htmlMatch[1].trim();
      // CSS/SCSS: /* File: path/file.css */
      const cssMatch = code.match(/^\/\*\s*File:\s*(.+?)\s*\*\//m);
      if (cssMatch) return cssMatch[1].trim();
      return null;
    }
    return match[1].trim();
  }
  async _showDiffModal(filePath, newCode) {
    const existing = await window.merecode.fs.readFile(filePath);
    if (existing.error) {
      await window.merecode.fs.writeFile(filePath, newCode);
      this.app.showToast(`Written to ${window.merecode.path.basename(filePath)}`, "success");
      this.app.editor.openFile(filePath);
      return;
    }
    const oldContent = existing.content || "";
    const fileName = window.merecode.path.basename(filePath);
    const modal = document.createElement("div");
    modal.className = "diff-modal-overlay";
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
    const diffContainer = document.getElementById("diff-editor-container");
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
      automaticLayout: true
    });
    diffEditor.setModel({ original: originalModel, modified: modifiedModel });
    const cleanup = () => {
      diffEditor.dispose();
      originalModel.dispose();
      modifiedModel.dispose();
      modal.remove();
    };
    document.getElementById("diff-accept")?.addEventListener("click", async () => {
      const modified = modifiedModel.getValue();
      await window.merecode.fs.writeFile(filePath, modified);
      this.app.showToast(`Applied changes to ${fileName}`, "success");
      const tab = this.app.editor.tabs.find((t) => t.filePath === filePath);
      if (tab) {
        tab.model.setValue(modified);
        tab.isDirty = false;
        this.app.editor._renderTabs();
      } else {
        this.app.editor.openFile(filePath);
      }
      cleanup();
    });
    document.getElementById("diff-replace")?.addEventListener("click", async () => {
      await window.merecode.fs.writeFile(filePath, newCode);
      this.app.showToast(`Replaced ${fileName}`, "success");
      const tab = this.app.editor.tabs.find((t) => t.filePath === filePath);
      if (tab) {
        tab.model.setValue(newCode);
        tab.isDirty = false;
        this.app.editor._renderTabs();
      } else {
        this.app.editor.openFile(filePath);
      }
      cleanup();
    });
    document.getElementById("diff-cancel")?.addEventListener("click", cleanup);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) cleanup();
    });
  }
  _fmt(content) {
    if (!content) return `<span class="chat-thinking"><span class="chat-thinking-dots"><span></span><span></span><span></span></span> Thinking...</span>`;
    return content.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      const langLabel = lang || "code";
      const isTerminal = ["bash", "shell", "sh", "powershell", "cmd", "zsh", "terminal"].includes(langLabel.toLowerCase());
      const isCode = !isTerminal;
      return `<div class="chat-code-wrap">
          <div class="chat-code-header">
            <span>${langLabel}</span>
            <div class="chat-code-actions">
              <span class="chat-code-copy" title="Copy">Copy</span>
              ${isCode ? `<span class="chat-action-apply" title="Apply to file">Apply</span>` : ""}
              ${isCode ? `<span class="chat-action-insert" title="Insert at cursor">Insert</span>` : ""}
              ${isTerminal ? `<span class="chat-action-run" title="Run in terminal">\u25B6 Run</span>` : ""}
            </div>
          </div>
          <pre class="chat-code"><code>${this._esc(code.trim())}</code></pre>
        </div>`;
    }).replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>').replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>").replace(/\n/g, "<br>");
  }
  _esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  dispose() {
    for (const cb of this._cleanupCallbacks) {
      if (typeof cb === "function") cb();
    }
    this._cleanupCallbacks = [];
  }
}
export {
  ChatManager
};
//# sourceMappingURL=chat.js.map
