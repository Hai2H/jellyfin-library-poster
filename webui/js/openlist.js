let configState = null;
let foldersState = [];
let resultsState = [];
let treeState = [];
let openlistJob = null;
let openlistMode = "";
let openlistPollTimer = null;

pageShell("pages/openlist.html", "OpenList", "通过 OpenList API 浏览文件夹，调用 TMDB 识别名称，并确认后写回重命名。");

document.getElementById("pageRoot").innerHTML = `
  <div class="grid gap-4">
    <section class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div class="grid gap-3 xl:grid-cols-4 xl:items-end">
        ${input("OpenList 地址", "openlistBaseUrl", "", "placeholder='例如 http://127.0.0.1:5244'")}
        ${input("账号", "openlistUsername", "")}
        ${input("密码", "openlistPassword", "", "type='password'")}
        ${input("Token（可选）", "openlistToken", "", "type='password'")}
        ${input("当前路径", "openlistPath", "/")}
        ${button("测试连接", "openlistStatus", "blue")}
        ${button("读取目录", "openlistList", "primary")}
      </div>
      <div class="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
        <span id="openlistStatusDot" class="h-2.5 w-2.5 rounded-full bg-red-500"></span>
        <span id="openlistStatusText">未连接</span>
        <span id="openlistProgress">等待操作</span>
      </div>
    </section>

    <section class="grid min-h-[720px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm xl:grid-cols-[300px_minmax(0,1fr)]">
      <aside class="border-b border-slate-200 bg-slate-50 xl:border-b-0 xl:border-r">
        <div class="border-b border-slate-200 bg-white p-4">
          <h3 class="text-base font-semibold">目录树</h3>
          <p id="openlistFolderCount" class="mt-1 text-sm text-slate-500">0 个文件夹</p>
        </div>
        <div id="openlistTree" class="grid max-h-[660px] gap-1 overflow-auto p-3"></div>
      </aside>
      <div class="grid min-w-0 grid-rows-[auto_auto_auto]">
        <div class="border-b border-slate-200 bg-white p-4">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <h3 class="text-base font-semibold">当前目录</h3>
            <div class="flex items-center gap-3">
              <label class="flex items-center gap-2 text-sm text-slate-700"><input id="openlistSelectAll" type="checkbox" class="accent-teal-600"> 全选</label>
              ${button("识别选中", "openlistPreview", "primary")}
            </div>
          </div>
          <div id="openlistBreadcrumb" class="mt-3 flex flex-wrap items-center gap-1 text-sm text-slate-500"></div>
        </div>
        <div class="overflow-auto border-b border-slate-200 p-4">
          ${table(["选择", "文件夹名", "路径"], "", "openlistFolders")}
        </div>
        <div class="grid min-h-0 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div class="min-w-0 border-b border-slate-200 p-4 xl:border-b-0 xl:border-r">
            <div class="mb-3 flex items-center justify-between">
              <h3 class="text-base font-semibold">识别结果</h3>
              ${button("写回选中", "openlistRename", "primary")}
            </div>
            ${table(["写回", "状态", "原文件夹名", "新文件夹名", "错误"], "", "openlistResults")}
          </div>
          <div class="p-4">
            <h3 class="mb-3 text-base font-semibold">OpenList 日志</h3>
            ${logBox("openlistLogBox")}
          </div>
        </div>
      </div>
    </section>
  </div>
`;

function normalizePath(path) {
  const parts = String(path || "/").replace(/\\/g, "/").split("/").filter(Boolean);
  return "/" + parts.join("/");
}

function ensureTreePath(path) {
  path = normalizePath(path);
  if (!treeState.some((item) => item.path === path)) {
    treeState.push({ path, label: path === "/" ? "根目录" : path.split("/").filter(Boolean).at(-1) });
  }
  treeState.sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"));
}

function setConnection(ok, text) {
  document.getElementById("openlistStatusDot").className = `h-2.5 w-2.5 rounded-full ${ok ? "bg-teal-600" : "bg-red-500"}`;
  document.getElementById("openlistStatusText").textContent = text;
}

function renderTree() {
  const current = normalizePath(document.getElementById("openlistPath").value || "/");
  ensureTreePath("/");
  ensureTreePath(current);
  document.getElementById("openlistTree").innerHTML = treeState.map((item) => {
    const depth = item.path === "/" ? 0 : item.path.split("/").filter(Boolean).length;
    const active = item.path === current;
    return `<button data-tree-path="${escapeAttr(item.path)}" class="grid grid-cols-[18px_minmax(0,1fr)] items-center gap-2 rounded-lg border px-2 py-2 text-left text-sm ${active ? "border-teal-200 bg-teal-50 text-teal-800" : "border-transparent text-slate-600 hover:bg-white hover:shadow-sm"}" style="padding-left:${8 + depth * 12}px"><span>${active ? "▾" : "▸"}</span><span class="truncate">${escapeHtml(item.label)}</span></button>`;
  }).join("");
  document.querySelectorAll("[data-tree-path]").forEach((buttonEl) => {
    buttonEl.addEventListener("click", () => {
      document.getElementById("openlistPath").value = buttonEl.dataset.treePath;
      listFolders().catch((err) => setStatus(err.message));
    });
  });
  renderBreadcrumb(current);
}

function renderBreadcrumb(path) {
  const parts = normalizePath(path).split("/").filter(Boolean);
  const crumbs = [{ label: "根目录", path: "/" }];
  let current = "";
  for (const part of parts) {
    current += "/" + part;
    crumbs.push({ label: part, path: current });
  }
  document.getElementById("openlistBreadcrumb").innerHTML = crumbs.map((crumb, index) => `${index ? "<span>/</span>" : ""}<button data-crumb-path="${escapeAttr(crumb.path)}" class="rounded-md px-2 py-1 hover:bg-slate-100">${escapeHtml(crumb.label)}</button>`).join("");
  document.querySelectorAll("[data-crumb-path]").forEach((buttonEl) => {
    buttonEl.addEventListener("click", () => {
      document.getElementById("openlistPath").value = buttonEl.dataset.crumbPath;
      listFolders().catch((err) => setStatus(err.message));
    });
  });
}

function renderFolders() {
  document.getElementById("openlistFolderCount").textContent = `${foldersState.length} 个文件夹`;
  document.getElementById("openlistFolders").innerHTML = foldersState.map((folder) => `
    <tr class="hover:bg-slate-50">
      <td class="px-3 py-2"><input type="checkbox" class="accent-teal-600" data-folder="${escapeAttr(folder.name)}" checked></td>
      <td class="px-3 py-2"><button class="font-medium text-blue-700 hover:underline" data-folder-open="${escapeAttr(folder.path)}">▣ ${escapeHtml(folder.name)}</button></td>
      <td class="px-3 py-2 text-slate-500">${escapeHtml(folder.path || "")}</td>
    </tr>
  `).join("") || `<tr><td colspan="3" class="px-3 py-8 text-center text-slate-500">当前目录没有文件夹</td></tr>`;
  document.querySelectorAll("[data-folder-open]").forEach((buttonEl) => {
    buttonEl.addEventListener("click", () => {
      document.getElementById("openlistPath").value = buttonEl.dataset.folderOpen;
      listFolders().catch((err) => setStatus(err.message));
    });
  });
}

function renderResults() {
  document.getElementById("openlistResults").innerHTML = resultsState.map((item) => `
    <tr class="hover:bg-slate-50">
      <td class="px-3 py-2"><input type="checkbox" class="accent-teal-600" data-result="${escapeAttr(item.original_name)}"${item.ok && item.changed !== false ? " checked" : ""}${item.ok ? "" : " disabled"}></td>
      <td class="px-3 py-2 font-semibold ${item.ok ? "text-teal-700" : "text-red-700"}">${item.ok ? "成功" : "失败"}</td>
      <td class="px-3 py-2">${escapeHtml(item.original_name || "")}</td>
      <td class="px-3 py-2"><input data-new-name="${escapeAttr(item.original_name)}" class="w-full rounded-md border border-slate-300 px-2 py-1 text-sm" value="${escapeAttr(item.new_name || "")}"></td>
      <td class="px-3 py-2 text-red-600">${escapeHtml(item.error || "")}</td>
    </tr>
  `).join("") || `<tr><td colspan="5" class="px-3 py-8 text-center text-slate-500">识别结果会显示在这里</td></tr>`;
  document.querySelectorAll("[data-new-name]").forEach((inputEl) => {
    inputEl.addEventListener("input", () => {
      const item = resultsState.find((row) => row.original_name === inputEl.dataset.newName);
      if (item) {
        item.new_name = inputEl.value;
        item.changed = item.new_name !== item.original_name;
      }
    });
  });
}

function selectedFolders() {
  const selected = new Set([...document.querySelectorAll("#openlistFolders input[data-folder]:checked")].map((inputEl) => inputEl.dataset.folder));
  return foldersState.filter((folder) => selected.has(folder.name));
}

function selectedResults() {
  const selected = new Set([...document.querySelectorAll("#openlistResults input[data-result]:checked")].map((inputEl) => inputEl.dataset.result));
  return resultsState.filter((item) => selected.has(item.original_name));
}

function readOpenlistConfig() {
  configState.openlist = {
    ...(configState.openlist || {}),
    base_url: document.getElementById("openlistBaseUrl").value.trim(),
    username: document.getElementById("openlistUsername").value.trim(),
    password: document.getElementById("openlistPassword").value,
    token: document.getElementById("openlistToken").value.trim(),
    path: document.getElementById("openlistPath").value.trim() || "/",
  };
}

async function loadPage() {
  configState = await api("/api/config");
  const openlist = configState.openlist || {};
  document.getElementById("openlistBaseUrl").value = openlist.base_url || "";
  document.getElementById("openlistUsername").value = openlist.username || "";
  document.getElementById("openlistPassword").value = openlist.password || "";
  document.getElementById("openlistToken").value = openlist.token || "";
  document.getElementById("openlistPath").value = openlist.path || "/";
  renderTree();
  renderFolders();
  renderResults();
  setStatus("配置已加载");
}

async function testStatus() {
  readOpenlistConfig();
  const data = await api("/api/openlist/status", { method: "POST", body: JSON.stringify({ path: configState.openlist.path, openlist: configState.openlist }) });
  configState.openlist = data.openlist;
  document.getElementById("openlistPath").value = data.path || configState.openlist.path || "/";
  document.getElementById("openlistProgress").textContent = `当前目录 ${data.folder_count || 0} 个文件夹`;
  setConnection(true, `已连接：${configState.openlist.base_url}`);
  ensureTreePath(data.path || "/");
  renderTree();
  setStatus("OpenList 连接正常");
}

async function listFolders() {
  readOpenlistConfig();
  const data = await api("/api/openlist/list", { method: "POST", body: JSON.stringify({ path: configState.openlist.path, openlist: configState.openlist }) });
  configState.openlist = data.openlist;
  foldersState = data.folders || [];
  resultsState = [];
  document.getElementById("openlistPath").value = data.path || configState.openlist.path || "/";
  document.getElementById("openlistProgress").textContent = `已读取 ${foldersState.length} 个文件夹`;
  setConnection(true, `已连接：${configState.openlist.base_url}`);
  ensureTreePath(data.path || "/");
  foldersState.forEach((folder) => ensureTreePath(folder.path));
  renderTree();
  renderFolders();
  renderResults();
  setStatus(`OpenList 已读取 ${foldersState.length} 个文件夹`);
}

async function previewFolders() {
  readOpenlistConfig();
  const items = selectedFolders();
  if (!items.length) throw new Error("请先选择要识别的文件夹");
  resultsState = [];
  renderResults();
  document.getElementById("openlistLogBox").textContent = "";
  const data = await api("/api/openlist/preview/jobs", { method: "POST", body: JSON.stringify({ path: configState.openlist.path, items, tmdb: configState.tmdb }) });
  openlistJob = data.job_id;
  openlistMode = "preview";
  if (openlistPollTimer) clearInterval(openlistPollTimer);
  openlistPollTimer = setInterval(pollOpenlistJob, 1000);
  pollOpenlistJob();
}

async function renameFolders() {
  readOpenlistConfig();
  const items = selectedResults();
  if (!items.length) throw new Error("请先选择要写回的识别结果");
  const data = await api("/api/openlist/rename/jobs", { method: "POST", body: JSON.stringify({ path: configState.openlist.path, items, openlist: configState.openlist }) });
  openlistJob = data.job_id;
  openlistMode = "rename";
  if (openlistPollTimer) clearInterval(openlistPollTimer);
  openlistPollTimer = setInterval(pollOpenlistJob, 1000);
  pollOpenlistJob();
}

async function pollOpenlistJob() {
  if (!openlistJob) return;
  const job = await api(`/api/jobs/${openlistJob}`);
  document.getElementById("openlistLogBox").textContent = (job.logs || []).join("\n");
  document.getElementById("openlistLogBox").scrollTop = document.getElementById("openlistLogBox").scrollHeight;
  if (openlistMode === "preview" || openlistMode === "rename") {
    resultsState = job.results || resultsState;
    renderResults();
  }
  const okCount = (job.results || []).filter((item) => item.ok).length;
  document.getElementById("openlistProgress").textContent = `进度：${job.completed || 0}/${job.total || 0}，成功 ${okCount}，状态 ${job.status}`;
  setStatus(`OpenList 任务状态：${job.status}`);
  if (job.status === "done" || job.status === "failed") {
    clearInterval(openlistPollTimer);
    openlistPollTimer = null;
  }
}

document.getElementById("openlistStatus").addEventListener("click", () => testStatus().catch((err) => {
  setConnection(false, "连接失败");
  setStatus(err.message);
}));
document.getElementById("openlistList").addEventListener("click", () => listFolders().catch((err) => setStatus(err.message)));
document.getElementById("openlistPreview").addEventListener("click", () => previewFolders().catch((err) => setStatus(err.message)));
document.getElementById("openlistRename").addEventListener("click", () => renameFolders().catch((err) => setStatus(err.message)));
document.getElementById("openlistSelectAll").addEventListener("change", (event) => {
  document.querySelectorAll("#openlistFolders input[data-folder]").forEach((inputEl) => {
    inputEl.checked = event.target.checked;
  });
});

loadPage().catch((err) => setStatus(err.message));
