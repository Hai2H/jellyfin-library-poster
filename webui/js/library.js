let configState = null;
let librariesState = [];

pageShell("pages/library.html", "媒体库策略", "连接服务器获取媒体库，并设置中文名、英文名、排序、生成与上传策略。");

document.getElementById("pageRoot").innerHTML = card("", `
  <div class="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
    <label class="grid gap-1.5 text-sm font-medium text-slate-700">
      <span>服务器</span>
      <select id="serverSelect" class="min-w-64 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"></select>
    </label>
    <div class="flex gap-2">
      ${button("获取媒体库", "fetchLibraries", "blue")}
      ${button("保存策略", "saveLibraries", "primary")}
    </div>
  </div>
  ${table(["生成", "上传", "媒体库", "类型", "中文名", "英文名", "排序策略"], "", "libraryRows")}
`);

const sortOptions = [
  ["DateCreated", "入库创建时间"],
  ["DateLastContentAdded", "最近添加内容时间"],
  ["Random", "随机排序"],
  ["SortName", "名称排序"],
  ["PremiereDate", "首映/发行时间"],
];

function templateFor(name) {
  let item = configState.template_mapping.find((entry) => entry.library_name === name);
  if (!item) {
    item = { library_name: name, library_ch_name: name, library_eng_name: /^[\x00-\x7F]*$/.test(name) ? name.toUpperCase() : "", poster_sort: "DateCreated" };
    configState.template_mapping.push(item);
  }
  return item;
}

function renderServers() {
  document.getElementById("serverSelect").innerHTML = configState.jellyfin.map((server, index) => {
    const name = server.server_name || server.base_url || `服务器 ${index + 1}`;
    return `<option value="${index}">${escapeHtml(name)}</option>`;
  }).join("");
}

function renderLibraries() {
  const excluded = new Set(configState.exclude_update_library || []);
  document.getElementById("libraryRows").innerHTML = librariesState.map((library) => {
    const tpl = templateFor(library.Name);
    return `
      <tr class="hover:bg-slate-50">
        <td class="px-3 py-2"><input class="accent-teal-600" type="checkbox" data-lib="${escapeAttr(library.Name)}" data-field="enabled"${excluded.has(library.Name) ? "" : " checked"}></td>
        <td class="px-3 py-2"><input class="accent-teal-600" type="checkbox" data-lib="${escapeAttr(library.Name)}" data-field="update_poster"${tpl.update_poster ? " checked" : ""}></td>
        <td class="px-3 py-2 font-medium">${escapeHtml(library.Name)}<div class="text-xs text-slate-400">${escapeHtml(library.Id || "")}</div></td>
        <td class="px-3 py-2 text-slate-500">${escapeHtml(library.CollectionType || "-")}</td>
        <td class="px-3 py-2"><input class="rounded-md border border-slate-300 px-2 py-1 text-sm" data-lib="${escapeAttr(library.Name)}" data-field="library_ch_name" value="${escapeAttr(tpl.library_ch_name || "")}"></td>
        <td class="px-3 py-2"><input class="rounded-md border border-slate-300 px-2 py-1 text-sm" data-lib="${escapeAttr(library.Name)}" data-field="library_eng_name" value="${escapeAttr(tpl.library_eng_name || "")}"></td>
        <td class="px-3 py-2"><select class="rounded-md border border-slate-300 px-2 py-1 text-sm" data-lib="${escapeAttr(library.Name)}" data-field="poster_sort">${sortOptions.map(([value, label]) => `<option value="${value}"${tpl.poster_sort === value ? " selected" : ""}>${label} - ${value}</option>`).join("")}</select></td>
      </tr>
    `;
  }).join("") || `<tr><td colspan="7" class="px-3 py-8 text-center text-slate-500">请先获取媒体库</td></tr>`;

  document.querySelectorAll("[data-lib]").forEach((el) => {
    el.addEventListener("input", updateLibrary);
    el.addEventListener("change", updateLibrary);
  });
}

function updateLibrary(event) {
  const el = event.target;
  const name = el.dataset.lib;
  const field = el.dataset.field;
  if (field === "enabled") {
    const excluded = new Set(configState.exclude_update_library || []);
    if (el.checked) excluded.delete(name);
    else excluded.add(name);
    configState.exclude_update_library = [...excluded];
    return;
  }
  const tpl = templateFor(name);
  tpl[field] = el.type === "checkbox" ? el.checked : el.value;
  const library = librariesState.find((item) => item.Name === name);
  if (library?.CollectionType) tpl.collection_type = library.CollectionType;
}

async function loadPage() {
  configState = await api("/api/config");
  renderServers();
  renderLibraries();
  setStatus("配置已加载");
}

async function fetchLibraries() {
  const serverIndex = Number(document.getElementById("serverSelect").value || 0);
  setStatus("正在获取媒体库...");
  const data = await api("/api/libraries", { method: "POST", body: JSON.stringify({ server_index: serverIndex, sync: true }) });
  librariesState = data.libraries || [];
  configState = data.config;
  renderServers();
  renderLibraries();
  setStatus(`已获取 ${librariesState.length} 个媒体库`);
}

async function saveLibraries() {
  const data = await api("/api/config", { method: "POST", body: JSON.stringify(configState) });
  configState = data.config;
  setStatus("策略已保存");
}

document.getElementById("fetchLibraries").addEventListener("click", () => fetchLibraries().catch((err) => setStatus(err.message)));
document.getElementById("saveLibraries").addEventListener("click", () => saveLibraries().catch((err) => setStatus(err.message)));

loadPage().catch((err) => setStatus(err.message));
