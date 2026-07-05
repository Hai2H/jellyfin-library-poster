let configState = null;
let librariesState = [];
let currentJob = null;
let pollTimer = null;

pageShell("pages/run.html", "执行与预览", "选择服务器和媒体库，执行下载、生成和上传流程，并查看日志与输出。");

document.getElementById("pageRoot").innerHTML = `
  <div class="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
    ${card("执行", `
      <div class="grid gap-4">
        <label class="grid gap-1.5 text-sm font-medium text-slate-700"><span>服务器</span><select id="serverSelect" class="rounded-lg border border-slate-300 px-3 py-2 text-sm"></select></label>
        <label class="grid gap-1.5 text-sm font-medium text-slate-700"><span>媒体库</span><select id="librarySelect" multiple size="12" class="rounded-lg border border-slate-300 px-3 py-2 text-sm"></select></label>
        <div class="flex gap-4">
          <label class="flex items-center gap-2 text-sm"><input id="forceUpload" type="checkbox" class="accent-teal-600"> 本次执行上传</label>
          <label class="flex items-center gap-2 text-sm"><input id="selectAll" type="checkbox" class="accent-teal-600"> 全选媒体库</label>
        </div>
        <div class="flex gap-2">${button("刷新列表", "refreshLibraries", "blue")}${button("开始执行", "startJob", "primary")}</div>
      </div>
    `)}
    ${card("日志", logBox("logBox"))}
    <div class="xl:col-span-2">${card("预览", `<div id="previews" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3"></div>`)}</div>
  </div>
`;

function renderServers() {
  document.getElementById("serverSelect").innerHTML = configState.jellyfin.map((server, index) => `<option value="${index}">${escapeHtml(server.server_name || server.base_url || `服务器 ${index + 1}`)}</option>`).join("");
}

function renderLibraries() {
  const excluded = new Set(configState.exclude_update_library || []);
  const all = document.getElementById("selectAll").checked;
  document.getElementById("librarySelect").innerHTML = librariesState.filter((library) => !excluded.has(library.Name)).map((library) => `<option value="${escapeAttr(library.Name)}"${all ? " selected" : ""}>${escapeHtml(library.Name)}</option>`).join("");
}

async function loadPage() {
  configState = await api("/api/config");
  renderServers();
  renderLibraries();
  setStatus("配置已加载");
}

async function refreshLibraries() {
  const serverIndex = Number(document.getElementById("serverSelect").value || 0);
  const data = await api("/api/libraries", { method: "POST", body: JSON.stringify({ server_index: serverIndex, sync: true }) });
  librariesState = data.libraries || [];
  configState = data.config;
  renderServers();
  renderLibraries();
  setStatus(`已获取 ${librariesState.length} 个媒体库`);
}

async function startJob() {
  const selected = [...document.getElementById("librarySelect").selectedOptions].map((option) => option.value);
  const allSelected = document.getElementById("selectAll").checked;
  const libraries = allSelected ? librariesState : librariesState.filter((library) => selected.includes(library.Name));
  if (!libraries.length) throw new Error("请先选择媒体库");
  document.getElementById("logBox").textContent = "";
  document.getElementById("previews").innerHTML = "";
  const data = await api("/api/jobs", {
    method: "POST",
    body: JSON.stringify({
      server_index: Number(document.getElementById("serverSelect").value || 0),
      library_names: libraries.map((library) => library.Name),
      libraries,
      upload: document.getElementById("forceUpload").checked ? true : null,
    }),
  });
  currentJob = data.job_id;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(pollJob, 1200);
  pollJob();
}

async function pollJob() {
  if (!currentJob) return;
  const job = await api(`/api/jobs/${currentJob}`);
  document.getElementById("logBox").textContent = (job.logs || []).join("\n");
  document.getElementById("logBox").scrollTop = document.getElementById("logBox").scrollHeight;
  document.getElementById("previews").innerHTML = (job.outputs || []).map((item) => `
    <div class="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <h4 class="border-b border-slate-200 px-3 py-2 text-sm font-semibold">${escapeHtml(item.library_name)}</h4>
      <img class="aspect-video w-full object-cover" src="${item.output_url}?t=${Date.now()}" alt="${escapeAttr(item.library_name)}">
    </div>
  `).join("");
  setStatus(`任务状态：${job.status}`);
  if (job.status === "done" || job.status === "failed") {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

document.getElementById("refreshLibraries").addEventListener("click", () => refreshLibraries().catch((err) => setStatus(err.message)));
document.getElementById("startJob").addEventListener("click", () => startJob().catch((err) => setStatus(err.message)));
document.getElementById("selectAll").addEventListener("change", renderLibraries);

loadPage().catch((err) => setStatus(err.message));
