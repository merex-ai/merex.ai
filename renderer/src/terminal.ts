// terminal.ts — Integrated terminal with theme sync, split panes, profiles
import type { MereCodeApp } from './app.js';

interface TerminalInstance {
  xterm: any;
  fitAddon: any;
}

export class TerminalManager {
  app: MereCodeApp;
  terminals: Map<number, TerminalInstance> = new Map();
  activeTerminalId: number | null = null;
  private _cleanupCallbacks: (() => void)[] = [];
  private _splitMode = false;
  private _splitTerminalId: number | null = null;
  private _resizeObserver: ResizeObserver;

  constructor(app: MereCodeApp) {
    this.app = app;

    const dataCleanup = window.merecode.terminal.onData((id, data) => {
      this.terminals.get(id)?.xterm.write(data);
    });
    this._cleanupCallbacks.push(dataCleanup);

    const exitCleanup = window.merecode.terminal.onExit((id, code) => {
      const t = this.terminals.get(id);
      if (t) t.xterm.writeln(`\r\n\x1b[90mProcess exited with code ${code}\x1b[0m`);
    });
    this._cleanupCallbacks.push(exitCleanup);

    document.getElementById('btn-new-terminal')?.addEventListener('click', () => this.createTerminal());
    document.getElementById('btn-kill-terminal')?.addEventListener('click', () => { if (this.activeTerminalId) this.closeTerminal(this.activeTerminalId); });
    document.getElementById('btn-toggle-terminal')?.addEventListener('click', () => this.app.toggleTerminal());
    document.getElementById('btn-split-terminal')?.addEventListener('click', () => this.toggleSplit());

    this._resizeObserver = new ResizeObserver(() => this._fitAll());
    const c = document.getElementById('terminal-container');
    if (c) this._resizeObserver.observe(c);
  }

  private _getThemeColors(): any {
    const isDark = document.body.dataset.theme !== 'light';
    if (isDark) {
      return {
        background: '#191918', foreground: '#f5f0e8', cursor: '#c96442', cursorAccent: '#191918',
        selectionBackground: 'rgba(201,100,66,0.3)',
        black: '#191918', red: '#ef4444', green: '#34d399', yellow: '#f59e0b',
        blue: '#60a5fa', magenta: '#c586c0', cyan: '#4ec9b0', white: '#f5f0e8',
        brightBlack: '#5a5550', brightRed: '#f87171', brightGreen: '#6ee7b7', brightYellow: '#fbbf24',
        brightBlue: '#93c5fd', brightMagenta: '#e879f9', brightCyan: '#67e8f9', brightWhite: '#ffffff',
      };
    }
    return {
      background: '#faf8f5', foreground: '#2d2d2c', cursor: '#c96442', cursorAccent: '#faf8f5',
      selectionBackground: 'rgba(201,100,66,0.2)',
      black: '#2d2d2c', red: '#dc2626', green: '#16a34a', yellow: '#ca8a04',
      blue: '#2563eb', magenta: '#9333ea', cyan: '#0891b2', white: '#faf8f5',
      brightBlack: '#8a8279', brightRed: '#ef4444', brightGreen: '#22c55e', brightYellow: '#eab308',
      brightBlue: '#3b82f6', brightMagenta: '#a855f7', brightCyan: '#06b6d4', brightWhite: '#ffffff',
    };
  }

  async createTerminal(cwd?: string): Promise<number | undefined> {
    if (!(window as any).XtermBundle) { console.warn('xterm not loaded'); return; }
    const { Terminal, FitAddon, WebLinksAddon } = (window as any).XtermBundle;

    const xterm = new Terminal({
      theme: this._getThemeColors(),
      fontFamily: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    if (WebLinksAddon) xterm.loadAddon(new WebLinksAddon());

    const result = await window.merecode.terminal.create({
      cwd: cwd || this.app.rootPath || undefined,
      cols: 80, rows: 24,
    });
    if (result.error) { console.error('terminal create error:', result.error); return; }

    const id = result.id;
    this.terminals.set(id, { xterm, fitAddon });
    this._renderTabs();
    this.activateTerminal(id);

    xterm.onData((data: string) => window.merecode.terminal.write(id, data));
    xterm.onResize(({ cols, rows }: { cols: number; rows: number }) => window.merecode.terminal.resize(id, cols, rows));

    if (!this.app.isTerminalOpen) this.app.toggleTerminal();
    return id;
  }

  activateTerminal(id: number): void {
    this.activeTerminalId = id;
    this._mountTerminals();
    this._renderTabs();
  }

  toggleSplit(): void {
    if (this._splitMode) {
      this._closeSplit();
    } else {
      this._openSplit();
    }
  }

  private async _openSplit(): Promise<void> {
    if (this.terminals.size === 0) return;
    this._splitMode = true;
    this._mountTerminals();
    const id = await this.createTerminal(this.app.rootPath || undefined);
    this._splitTerminalId = id ?? null;
    const btn = document.getElementById('btn-split-terminal');
    if (btn) btn.classList.add('active');
  }

  private _closeSplit(): void {
    this._splitMode = false;
    if (this._splitTerminalId) {
      this.closeTerminal(this._splitTerminalId);
      this._splitTerminalId = null;
    }
    this._mountTerminals();
    const btn = document.getElementById('btn-split-terminal');
    if (btn) btn.classList.remove('active');
  }

  private _mountTerminals(): void {
    const container = document.getElementById('terminal-container')!;
    while (container.firstChild) container.removeChild(container.firstChild);

    if (this._splitMode && this.terminals.size >= 2) {
      container.classList.add('split');
      const ids = Array.from(this.terminals.keys());
      const mainId = this.activeTerminalId || ids[0];
      const splitId = this._splitTerminalId || ids[ids.length - 1];
      const pairIds = mainId === splitId ? [mainId] : [mainId, splitId];

      for (const tid of pairIds) {
        const t = this.terminals.get(tid);
        if (!t) continue;
        const pane = document.createElement('div');
        pane.className = `terminal-pane${tid === this.activeTerminalId ? ' active' : ''}`;
        pane.dataset.id = String(tid);
        container.appendChild(pane);
        t.xterm.open(pane);
        pane.addEventListener('click', () => { this.activeTerminalId = tid; this._renderTabs(); });
        setTimeout(() => {
          try { t.fitAddon.fit(); window.merecode.terminal.resize(tid, t.xterm.cols, t.xterm.rows); } catch { /* ignore */ }
        }, 50);
      }
    } else {
      container.classList.remove('split');
      const t = this.terminals.get(this.activeTerminalId!);
      if (!t) return;
      t.xterm.open(container);
      setTimeout(() => {
        try {
          t.fitAddon.fit();
          window.merecode.terminal.resize(this.activeTerminalId!, t.xterm.cols, t.xterm.rows);
        } catch { /* ignore */ }
      }, 50);
      t.xterm.focus();
    }
    this._renderTabs();
  }

  closeTerminal(id: number): void {
    const t = this.terminals.get(id);
    if (t) { t.xterm.dispose(); window.merecode.terminal.destroy(id); this.terminals.delete(id); }

    if (id === this._splitTerminalId) this._splitTerminalId = null;

    if (this.activeTerminalId === id) {
      const remaining = Array.from(this.terminals.keys());
      if (remaining.length > 0) {
        this.activeTerminalId = remaining[remaining.length - 1];
        this._mountTerminals();
      } else {
        this.activeTerminalId = null;
        this._splitMode = false;
        this.app.toggleTerminal();
      }
    } else {
      this._mountTerminals();
    }
    this._renderTabs();
  }

  updateTheme(): void {
    const theme = this._getThemeColors();
    for (const [, t] of this.terminals) {
      t.xterm.options.theme = theme;
    }
  }

  private _fitAll(): void {
    for (const [id, t] of this.terminals) {
      try { t.fitAddon.fit(); window.merecode.terminal.resize(id, t.xterm.cols, t.xterm.rows); } catch { /* ignore */ }
    }
  }

  private _renderTabs(): void {
    const container = document.getElementById('terminal-tabs');
    if (!container) return;
    container.innerHTML = '';
    let idx = 1;
    for (const [id] of this.terminals) {
      const isSplit = id === this._splitTerminalId;
      const tab = document.createElement('div');
      tab.className = `terminal-tab${id === this.activeTerminalId ? ' active' : ''}`;
      tab.innerHTML = `<span>${isSplit ? '⊟ ' : ''}Terminal ${idx}</span><button class="terminal-tab-close" data-id="${id}">×</button>`;
      tab.addEventListener('click', e => { if (!(e.target as Element).classList.contains('terminal-tab-close')) this.activateTerminal(id); });
      tab.querySelector('.terminal-tab-close')?.addEventListener('click', e => { e.stopPropagation(); this.closeTerminal(id); });
      container.appendChild(tab);
      idx++;
    }
  }

  dispose(): void {
    this._resizeObserver?.disconnect();
    for (const cb of this._cleanupCallbacks) {
      if (typeof cb === 'function') cb();
    }
    for (const [id, t] of this.terminals) {
      t.xterm.dispose();
      window.merecode.terminal.destroy(id);
    }
    this.terminals.clear();
  }
}
