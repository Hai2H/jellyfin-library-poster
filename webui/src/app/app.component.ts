import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';

type TabKey = 'config' | 'library' | 'run' | 'tmdb' | 'openlist';

interface ServerConfig {
  server_name: string;
  server_type: string;
  base_url: string;
  user_name: string;
  password: string;
  update_poster: boolean;
}

interface StyleConfig {
  style_name: string;
  style_ch_font: string;
  style_eng_font: string;
  style_ch_shadow: boolean;
  style_ch_shadow_offset: number[];
  style_eng_shadow: boolean;
  style_eng_shadow_offset: number[];
}

interface AppConfig {
  jellyfin: ServerConfig[];
  cron: string;
  init_template_mapping: boolean;
  exclude_update_library: string[];
  style_config: StyleConfig[];
  template_mapping: LibraryTemplate[];
  tmdb: TmdbConfig;
  openlist: OpenListConfig;
}

interface FontItem {
  name: string;
  label?: string;
}

interface LibraryItem {
  Id?: string;
  Name: string;
  CollectionType?: string;
}

interface LibraryTemplate {
  library_name: string;
  library_ch_name: string;
  library_eng_name: string;
  poster_sort: string;
  update_poster?: boolean;
  collection_type?: string;
}

interface TmdbConfig {
  token: string;
  use_bearer_token: boolean;
  language: string;
  include_adult: boolean;
}

interface TmdbResult {
  ok: boolean;
  input?: string;
  formatted?: string;
  media_label?: string;
  media_type?: string;
  region?: string;
  error?: string;
}

interface OpenListConfig {
  base_url: string;
  token: string;
  path: string;
}

interface OpenListFolder {
  name: string;
  path: string;
  parent_path?: string;
}

interface OpenListResult {
  ok: boolean;
  parent_path?: string;
  original_name: string;
  new_name: string;
  changed?: boolean;
  error?: string;
}

interface JobSnapshot {
  status: string;
  logs?: string[];
  outputs?: Array<{ library_name: string; output_url: string }>;
  results?: any[];
  completed?: number;
  total?: number;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.component.html'
})
export class AppComponent implements OnDestroy {
  tabs: Array<{ key: TabKey; label: string; hint: string }> = [
    { key: 'config', label: '配置', hint: '服务器、字体与连接' },
    { key: 'library', label: '媒体库策略', hint: '命名、排序与上传' },
    { key: 'run', label: '执行预览', hint: '生成、上传与日志' },
    { key: 'tmdb', label: 'TMDB', hint: '批量识别标题' },
    { key: 'openlist', label: 'OpenList', hint: '浏览与写回重命名' }
  ];
  active: TabKey = 'config';
  status = '正在加载...';
  busy = false;

  config: AppConfig = this.emptyConfig();
  fonts: FontItem[] = [];
  libraries: LibraryItem[] = [];
  selectedServerIndex = 0;
  selectedRunServerIndex = 0;
  selectedLibraryNames: string[] = [];
  selectAllRunLibraries = false;
  forceUpload = false;
  runJobId = '';
  runLogs = '';
  runOutputs: Array<{ library_name: string; output_url: string }> = [];

  tmdbInput = '';
  tmdbResults: TmdbResult[] = [];
  tmdbLogs = '';
  tmdbProgress = '等待查询';
  tmdbJobId = '';

  openlistFolders: OpenListFolder[] = [];
  openlistResults: OpenListResult[] = [];
  openlistLogs = '';
  openlistProgress = '等待操作';
  openlistConnected = false;
  openlistConnectionText = '未连接';
  openlistSelectAll = false;
  openlistTree: Array<{ path: string; label: string }> = [{ path: '/', label: '根目录' }];
  selectedOpenlistFolders = new Set<string>();
  selectedOpenlistResults = new Set<string>();
  openlistJobId = '';
  openlistMode: 'preview' | 'rename' | '' = '';

  sortOptions = [
    ['DateCreated', '入库创建时间'],
    ['DateLastContentAdded', '最近添加内容时间'],
    ['Random', '随机排序'],
    ['SortName', '名称排序'],
    ['PremiereDate', '首映/发行时间']
  ];

  private timers: number[] = [];

  constructor(private http: HttpClient) {
    void this.loadConfig();
  }

  ngOnDestroy(): void {
    this.clearTimers();
  }

  get pageTitle(): string {
    return this.tabs.find((tab) => tab.key === this.active)?.label || '';
  }

  get style(): StyleConfig {
    if (!this.config.style_config?.length) {
      this.config.style_config = [this.defaultStyle()];
    }
    return this.config.style_config[0];
  }

  get enabledLibraries(): LibraryItem[] {
    const excluded = new Set(this.config.exclude_update_library || []);
    return this.libraries.filter((library) => !excluded.has(library.Name));
  }

  get excludeText(): string {
    return (this.config.exclude_update_library || []).join(', ');
  }

  set excludeText(value: string) {
    this.config.exclude_update_library = this.readCsv(value);
  }

  get openlistPathParts(): Array<{ label: string; path: string }> {
    const parts = this.normalizePath(this.config.openlist.path).split('/').filter(Boolean);
    const crumbs = [{ label: '根目录', path: '/' }];
    let current = '';
    for (const part of parts) {
      current += '/' + part;
      crumbs.push({ label: part, path: current });
    }
    return crumbs;
  }

  async switchTab(tab: TabKey): Promise<void> {
    this.active = tab;
    if (tab === 'library' && !this.libraries.length) {
      this.setStatus('可选择服务器后获取媒体库');
    }
  }

  addServer(): void {
    this.config.jellyfin.push({
      server_name: '',
      server_type: 'jellyfin',
      base_url: '',
      user_name: '',
      password: '',
      update_poster: false
    });
  }

  removeServer(index: number): void {
    this.config.jellyfin.splice(index, 1);
  }

  async loadConfig(): Promise<void> {
    await this.withBusy(async () => {
      this.config = await this.api<AppConfig>('/api/config');
      const fontData = await this.api<{ fonts: FontItem[] }>('/api/fonts');
      this.fonts = fontData.fonts || [];
      this.ensureOpenlistTree(this.config.openlist.path || '/');
      this.setStatus('配置已加载');
    });
  }

  async saveConfig(): Promise<void> {
    await this.withBusy(async () => {
      this.config.exclude_update_library = this.readCsv(this.config.exclude_update_library.join(', '));
      const data = await this.api<{ config: AppConfig }>('/api/config', {
        method: 'POST',
        body: this.config
      });
      this.config = data.config;
      this.setStatus('配置已保存');
    });
  }

  async fetchLibraries(target: 'library' | 'run' = 'library'): Promise<void> {
    await this.withBusy(async () => {
      const serverIndex = target === 'run' ? this.selectedRunServerIndex : this.selectedServerIndex;
      this.setStatus('正在获取媒体库...');
      const data = await this.api<{ libraries: LibraryItem[]; config: AppConfig }>('/api/libraries', {
        method: 'POST',
        body: { server_index: serverIndex, sync: true }
      });
      this.libraries = data.libraries || [];
      this.config = data.config;
      if (this.selectAllRunLibraries) {
        this.selectedLibraryNames = this.enabledLibraries.map((library) => library.Name);
      }
      this.setStatus(`已获取 ${this.libraries.length} 个媒体库`);
    });
  }

  templateFor(name: string): LibraryTemplate {
    let item = this.config.template_mapping.find((entry) => entry.library_name === name);
    if (!item) {
      item = {
        library_name: name,
        library_ch_name: name,
        library_eng_name: /^[\x00-\x7F]*$/.test(name) ? name.toUpperCase() : '',
        poster_sort: 'DateCreated'
      };
      this.config.template_mapping.push(item);
    }
    return item;
  }

  isLibraryEnabled(name: string): boolean {
    return !(this.config.exclude_update_library || []).includes(name);
  }

  toggleLibraryEnabled(name: string, checked: boolean): void {
    const excluded = new Set(this.config.exclude_update_library || []);
    if (checked) {
      excluded.delete(name);
    } else {
      excluded.add(name);
    }
    this.config.exclude_update_library = [...excluded];
  }

  updateTemplateCollection(library: LibraryItem): void {
    const item = this.templateFor(library.Name);
    item.collection_type = library.CollectionType || item.collection_type;
  }

  updateRunSelection(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.selectedLibraryNames = Array.from(select.selectedOptions).map((option) => option.value);
  }

  toggleAllRunLibraries(): void {
    this.selectedLibraryNames = this.selectAllRunLibraries ? this.enabledLibraries.map((library) => library.Name) : [];
  }

  async startRunJob(): Promise<void> {
    const selected = this.selectAllRunLibraries
      ? this.enabledLibraries
      : this.enabledLibraries.filter((library) => this.selectedLibraryNames.includes(library.Name));
    if (!selected.length) {
      this.setStatus('请先选择媒体库');
      return;
    }
    await this.withBusy(async () => {
      this.runLogs = '';
      this.runOutputs = [];
      const data = await this.api<{ job_id: string }>('/api/jobs', {
        method: 'POST',
        body: {
          server_index: this.selectedRunServerIndex,
          library_names: selected.map((library) => library.Name),
          libraries: selected,
          upload: this.forceUpload ? true : null
        }
      });
      this.runJobId = data.job_id;
      this.pollJob(data.job_id, 'run');
    });
  }

  async formatTmdb(): Promise<void> {
    const lines = this.tmdbInput.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) {
      this.setStatus('请输入至少一个媒体标题');
      return;
    }
    await this.withBusy(async () => {
      this.tmdbResults = [];
      this.tmdbLogs = '';
      this.tmdbProgress = `准备查询 ${lines.length} 条`;
      const data = await this.api<{ job_id: string }>('/api/tmdb/jobs', {
        method: 'POST',
        body: { lines, tmdb: this.config.tmdb }
      });
      this.tmdbJobId = data.job_id;
      this.pollJob(data.job_id, 'tmdb');
    });
  }

  clearTmdb(): void {
    this.tmdbInput = '';
    this.tmdbResults = [];
    this.tmdbLogs = '';
    this.tmdbProgress = '等待查询';
  }

  async copyTmdbResults(): Promise<void> {
    const text = this.tmdbResults.map((item) => item.formatted || '').filter(Boolean).join('\n');
    if (!text) {
      this.setStatus('没有可复制的结果');
      return;
    }
    await navigator.clipboard.writeText(text);
    this.setStatus('已复制格式化结果');
  }

  async testOpenlist(): Promise<void> {
    await this.withBusy(async () => {
      const data = await this.api<{ path: string; folder_count: number; openlist: OpenListConfig }>('/api/openlist/status', {
        method: 'POST',
        body: { path: this.config.openlist.path, openlist: this.config.openlist }
      });
      this.config.openlist = data.openlist;
      this.config.openlist.path = data.path || this.config.openlist.path || '/';
      this.openlistConnected = true;
      this.openlistConnectionText = `已连接：${this.config.openlist.base_url}`;
      this.openlistProgress = `当前目录 ${data.folder_count || 0} 个文件夹`;
      this.ensureOpenlistTree(this.config.openlist.path);
      this.setStatus('OpenList 连接正常');
    }, () => {
      this.openlistConnected = false;
      this.openlistConnectionText = '连接失败';
    });
  }

  async listOpenlist(path?: string): Promise<void> {
    if (path) {
      this.config.openlist.path = path;
    }
    await this.withBusy(async () => {
      const data = await this.api<{ path: string; folders: OpenListFolder[]; openlist: OpenListConfig }>('/api/openlist/list', {
        method: 'POST',
        body: { path: this.config.openlist.path, openlist: this.config.openlist }
      });
      this.config.openlist = data.openlist;
      this.config.openlist.path = data.path || this.config.openlist.path || '/';
      this.openlistFolders = data.folders || [];
      this.openlistResults = [];
      this.openlistSelectAll = false;
      this.selectedOpenlistFolders = new Set<string>();
      this.selectedOpenlistResults.clear();
      this.openlistConnected = true;
      this.openlistConnectionText = `已连接：${this.config.openlist.base_url}`;
      this.openlistProgress = `已读取 ${this.openlistFolders.length} 个文件夹`;
      this.ensureOpenlistTree(this.config.openlist.path);
      this.openlistFolders.forEach((folder) => this.ensureOpenlistTree(folder.path));
      this.setStatus(`OpenList 已读取 ${this.openlistFolders.length} 个文件夹`);
    });
  }

  toggleOpenlistFolder(name: string, checked: boolean): void {
    if (checked) {
      this.selectedOpenlistFolders.add(name);
    } else {
      this.selectedOpenlistFolders.delete(name);
    }
    this.openlistSelectAll = this.openlistFolders.length > 0 && this.selectedOpenlistFolders.size === this.openlistFolders.length;
  }

  toggleAllOpenlistFolders(): void {
    this.selectedOpenlistFolders = this.openlistSelectAll
      ? new Set(this.openlistFolders.map((folder) => folder.name))
      : new Set<string>();
  }

  toggleOpenlistResult(name: string, checked: boolean): void {
    if (checked) {
      this.selectedOpenlistResults.add(name);
    } else {
      this.selectedOpenlistResults.delete(name);
    }
  }

  treeDepth(path: string): number {
    return path === '/' ? 0 : path.split('/').filter((part) => !!part).length;
  }

  async previewOpenlist(): Promise<void> {
    const items = this.openlistFolders.filter((folder) => this.selectedOpenlistFolders.has(folder.name));
    if (!items.length) {
      this.setStatus('请先选择要识别的文件夹');
      return;
    }
    await this.withBusy(async () => {
      this.openlistResults = [];
      this.openlistLogs = '';
      const data = await this.api<{ job_id: string }>('/api/openlist/preview/jobs', {
        method: 'POST',
        body: { path: this.config.openlist.path, items, tmdb: this.config.tmdb }
      });
      this.openlistJobId = data.job_id;
      this.openlistMode = 'preview';
      this.pollJob(data.job_id, 'openlist');
    });
  }

  async renameOpenlist(): Promise<void> {
    const items = this.openlistResults.filter((item) => this.selectedOpenlistResults.has(item.original_name));
    if (!items.length) {
      this.setStatus('请先选择要写回的识别结果');
      return;
    }
    await this.withBusy(async () => {
      const data = await this.api<{ job_id: string }>('/api/openlist/rename/jobs', {
        method: 'POST',
        body: { path: this.config.openlist.path, items, openlist: this.config.openlist }
      });
      this.openlistJobId = data.job_id;
      this.openlistMode = 'rename';
      this.pollJob(data.job_id, 'openlist');
    });
  }

  updateOpenlistResultName(item: OpenListResult): void {
    item.changed = item.new_name !== item.original_name;
  }

  private pollJob(jobId: string, type: 'run' | 'tmdb' | 'openlist'): void {
    const tick = async () => {
      try {
        const job = await this.api<JobSnapshot>(`/api/jobs/${jobId}`);
        if (type === 'run') {
          this.runLogs = (job.logs || []).join('\n');
          this.runOutputs = job.outputs || [];
          this.setStatus(`任务状态：${job.status}`);
        }
        if (type === 'tmdb') {
          this.tmdbResults = job.results || [];
          this.tmdbLogs = (job.logs || []).join('\n');
          const okCount = this.tmdbResults.filter((item) => item.ok).length;
          this.tmdbProgress = `进度：${job.completed || 0}/${job.total || 0}，成功 ${okCount} 条，状态 ${job.status}`;
          this.setStatus(`TMDB 任务状态：${job.status}`);
        }
        if (type === 'openlist') {
          this.openlistLogs = (job.logs || []).join('\n');
          this.openlistResults = job.results || this.openlistResults;
          this.selectedOpenlistResults = new Set(
            this.openlistResults.filter((item) => item.ok && item.changed !== false).map((item) => item.original_name)
          );
          const okCount = (job.results || []).filter((item: OpenListResult) => item.ok).length;
          this.openlistProgress = `进度：${job.completed || 0}/${job.total || 0}，成功 ${okCount}，状态 ${job.status}`;
          this.setStatus(`OpenList 任务状态：${job.status}`);
        }
        if (job.status === 'done' || job.status === 'failed') {
          this.clearTimers();
        }
      } catch (err) {
        this.setStatus(this.errorMessage(err));
        this.clearTimers();
      }
    };
    void tick();
    const timer = window.setInterval(tick, 1000);
    this.timers.push(timer);
  }

  private clearTimers(): void {
    this.timers.forEach((timer) => window.clearInterval(timer));
    this.timers = [];
  }

  private async api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
    const request$ = options.method === 'POST'
      ? this.http.post<T>(path, options.body || {})
      : this.http.get<T>(path);
    const data: any = await firstValueFrom(request$);
    if (data?.ok === false) {
      throw new Error(data.error || '请求失败');
    }
    return data as T;
  }

  private async withBusy(work: () => Promise<void>, onError?: () => void): Promise<void> {
    this.busy = true;
    try {
      await work();
    } catch (err) {
      onError?.();
      this.setStatus(this.errorMessage(err));
    } finally {
      this.busy = false;
    }
  }

  private setStatus(message: string): void {
    this.status = message;
  }

  private readCsv(value: string): string[] {
    return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
  }

  private normalizePath(path: string): string {
    const parts = String(path || '/').replace(/\\/g, '/').split('/').filter(Boolean);
    return '/' + parts.join('/');
  }

  private ensureOpenlistTree(path: string): void {
    const normalized = this.normalizePath(path);
    if (!this.openlistTree.some((item) => item.path === normalized)) {
      this.openlistTree.push({
        path: normalized,
        label: normalized === '/' ? '根目录' : normalized.split('/').filter(Boolean).at(-1) || normalized
      });
    }
    this.openlistTree.sort((a, b) => a.path.localeCompare(b.path, 'zh-Hans-CN'));
  }

  private errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err || '请求失败');
  }

  private emptyConfig(): AppConfig {
    return {
      jellyfin: [],
      cron: '',
      init_template_mapping: false,
      exclude_update_library: [],
      style_config: [this.defaultStyle()],
      template_mapping: [],
      tmdb: { token: '', use_bearer_token: true, language: 'zh-CN', include_adult: true },
      openlist: { base_url: '', token: '', path: '/' }
    };
  }

  private defaultStyle(): StyleConfig {
    return {
      style_name: 'style1',
      style_ch_font: 'ch.ttf',
      style_eng_font: 'en.otf',
      style_ch_shadow: false,
      style_ch_shadow_offset: [2, 2],
      style_eng_shadow: false,
      style_eng_shadow_offset: [2, 2]
    };
  }
}
