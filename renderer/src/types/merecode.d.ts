// merecode.d.ts — Type declarations for window.merecode bridge API

export {};

declare global {
  // xterm globals bundled via vendor/xterm.bundle.js
  const XtermBundle: typeof import('@xterm/xterm') & {
    FitAddon: typeof import('@xterm/addon-fit').FitAddon;
    WebLinksAddon: typeof import('@xterm/addon-web-links').WebLinksAddon;
  };

  interface Window {
    merecode: MereCodeAPI;
  }

  interface DirEntry {
    name: string;
    path: string;
    isDirectory: boolean;
  }

  interface SearchResult {
    file: string;
    relativePath: string;
    line: number;
    text: string;
  }

  interface SearchOptions {
    regex?: boolean;
    caseSensitive?: boolean;
    maxResults?: number;
  }

  interface ReplaceOptions {
    regex?: boolean;
    caseSensitive?: boolean;
  }

  interface GitStatus {
    error?: string;
    branch?: string;
    ahead?: number;
    behind?: number;
    files?: GitFile[];
  }

  interface GitFile {
    path: string;
    index: string;
    working_dir: string;
  }

  interface GitCommit {
    hash: string;
    fullHash?: string;
    message: string;
    author: string;
    date?: string;
  }

  interface GitDiff {
    error?: string;
    diff?: string;
  }

  interface GitBranches {
    error?: string;
    all: string[];
    current: string;
  }

  interface GitConflicts {
    error?: string;
    files?: string[];
  }

  interface GitOpResult {
    error?: string;
    [key: string]: unknown;
  }

  interface FsResult {
    error?: string;
    content?: string;
  }

  interface TerminalCreateResult {
    error?: string;
    id: number;
  }

  interface TaskListResult {
    scripts?: Record<string, string>;
    name?: string;
  }

  interface TaskRunResult {
    id: number;
  }

  interface WorkspaceSettings {
    theme?: string;
    fontSize?: number;
    tabSize?: number;
    wordWrap?: string;
    [key: string]: unknown;
  }

  interface WorkspaceLoadResult {
    settings?: WorkspaceSettings;
  }

  interface MereCodeAPI {
    fs: {
      readdir(path: string): Promise<DirEntry[] | { error: string }>;
      readFile(path: string): Promise<FsResult>;
      writeFile(path: string, content: string): Promise<{ error?: string }>;
      mkdir(path: string): Promise<{ error?: string }>;
      delete(path: string): Promise<{ error?: string }>;
      rename(oldPath: string, newPath: string): Promise<{ error?: string }>;
      stat(path: string): Promise<{ error?: string; size?: number; mtime?: number }>;
      exists(path: string): Promise<boolean>;
      search(root: string, query: string, options?: SearchOptions): Promise<SearchResult[]>;
      replaceInFile(path: string, search: string, replace: string, options?: ReplaceOptions): Promise<{ error?: string; replaced?: number }>;
      listAllFiles(root: string, max?: number): Promise<string[]>;
      readFileBase64(path: string): Promise<{ error?: string; data?: string }>;
      watchDir(path: string): Promise<void>;
      unwatchDir(): Promise<void>;
      onFileChanged(cb: (data: unknown) => void): () => void;
    };

    terminal: {
      create(opts: { cwd?: string; cols?: number; rows?: number }): Promise<TerminalCreateResult>;
      write(id: number, data: string): void;
      resize(id: number, cols: number, rows: number): void;
      destroy(id: number): void;
      onData(cb: (id: number, data: string) => void): () => void;
      onExit(cb: (id: number, code: number) => void): () => void;
    };

    dialog: {
      openFolder(): Promise<string | null>;
      openFile(): Promise<string | null>;
      saveFile(defaultPath?: string): Promise<string | null>;
    };

    git: {
      status(rootPath: string): Promise<GitStatus>;
      log(rootPath: string): Promise<GitCommit[]>;
      diff(rootPath: string, filePath: string): Promise<GitDiff>;
      diffStaged(rootPath: string, filePath: string): Promise<GitDiff>;
      add(rootPath: string, files: string[]): Promise<GitOpResult>;
      unstage(rootPath: string, files: string[]): Promise<GitOpResult>;
      commit(rootPath: string, message: string): Promise<GitOpResult>;
      push(rootPath: string, remote?: string, branch?: string): Promise<GitOpResult>;
      pull(rootPath: string, remote?: string, branch?: string): Promise<GitOpResult>;
      fetch(rootPath: string): Promise<GitOpResult>;
      branches(rootPath: string): Promise<GitBranches | { error: string }>;
      checkout(rootPath: string, branch: string): Promise<GitOpResult>;
      createBranch(rootPath: string, name: string): Promise<GitOpResult>;
      stash(rootPath: string): Promise<GitOpResult>;
      stashPop(rootPath: string): Promise<GitOpResult>;
      discardFile(rootPath: string, filePath: string): Promise<GitOpResult>;
      blame(rootPath: string, filePath: string): Promise<{ error?: string; blame?: string }>;
      graph(rootPath: string): Promise<{ error?: string; graph?: string }>;
      fileLog(rootPath: string, filePath: string): Promise<GitCommit[] & { error?: string }>;
      getConflicts(rootPath: string): Promise<GitConflicts>;
      resolveConflict(rootPath: string, filePath: string, content: string): Promise<GitOpResult>;
    };

    task: {
      list(rootPath: string): Promise<TaskListResult>;
      run(rootPath: string, name: string, cmd: string): TaskRunResult;
      kill(id: number): void;
      onOutput(cb: (id: number, data: string) => void): () => void;
      onDone(cb: (id: number, code: number) => void): () => void;
    };

    workspace: {
      load(rootPath: string): Promise<WorkspaceLoadResult>;
      save(rootPath: string, settings: WorkspaceSettings): Promise<{ error?: string }>;
    };

    window: {
      minimize(): void;
      maximize(): void;
      close(): void;
      isMaximized(): Promise<boolean>;
      onStateChange(cb: (maximized: boolean) => void): () => void;
    };

    path: {
      join(...args: string[]): string;
      dirname(p: string): string;
      basename(p: string, ext?: string): string;
      extname(p: string): string;
      sep: string;
      isAbsolute(p: string): boolean;
      resolve(...args: string[]): string;
      normalize(p: string): string;
    };

    app: {
      getVersion(): Promise<string>;
      getAppPath(): Promise<string>;
      getPlatform(): Promise<string>;
      openExternal(url: string): void;
      getCrashLog(): Promise<string>;
      platform: string;
    };
  }
}
