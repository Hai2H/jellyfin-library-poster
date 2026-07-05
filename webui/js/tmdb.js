let configState = null;
let tmdbResults = [];
let tmdbJob = null;
let tmdbPollTimer = null;

pageShell("pages/tmdb.html", "TMDB 工具", "输入媒体标题，查询 TMDB 并回显标准化名称、年份、ID 和地区。");

document.getElementById("pageRoot").innerHTML = `
  <div class="grid gap-4 xl:grid-cols-[420px_minmax(0,1fr)]">
    ${card("输入", `
      <div class="grid gap-4">
        ${input("TMDB Token", "tmdbToken", "", "type='password' placeholder='可留空使用环境变量 TMDB_TOKEN'")}
        <div class="grid gap-4 sm:grid-cols-2">
          ${input("语言", "tmdbLanguage", "zh-CN")}
          <div class="grid content-end gap-2">
            <label class="flex items-center gap-2 text-sm"><input id="tmdbBearer" type="checkbox" class="accent-teal-600"> Bearer Token</label>
            <label class="flex items-center gap-2 text-sm"><input id="tmdbAdult" type="checkbox" class="accent-teal-600"> 包含成人内容</label>
          </div>
        </div>
        <label class="grid gap-1.5 text-sm font-medium text-slate-700"><span>媒体标题</span><textarea id="tmdbInput" class="h-72 rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="每行一个标题"></textarea></label>
        <div class="flex gap-2">${button("查询并格式化", "tmdbFormat", "primary")}${button("清空", "tmdbClear")}</div>
      </div>
    `)}
    ${card("结果", `
      <div class="mb-3 flex items-center justify-between">
        <span id="tmdbProgress" class="text-sm text-slate-500">等待查询</span>
        ${button("复制格式化结果", "tmdbCopy")}
      </div>
      ${table(["状态", "原始输入", "格式化结果", "类型", "地区", "错误"], "", "tmdbRows")}
    `)}
    <div class="xl:col-span-2">${card("日志", logBox("tmdbLogBox"))}</div>
  </div>
`;

async function loadPage() {
  configState = await api("/api/config");
  const tmdb = configState.tmdb || {};
  document.getElementById("tmdbToken").value = tmdb.token || "";
  document.getElementById("tmdbLanguage").value = tmdb.language || "zh-CN";
  document.getElementById("tmdbBearer").checked = tmdb.use_bearer_token !== false;
  document.getElementById("tmdbAdult").checked = tmdb.include_adult !== false;
  renderResults();
  setStatus("配置已加载");
}

function readTmdbConfig() {
  configState.tmdb = {
    ...(configState.tmdb || {}),
    token: document.getElementById("tmdbToken").value.trim(),
    language: document.getElementById("tmdbLanguage").value.trim() || "zh-CN",
    use_bearer_token: document.getElementById("tmdbBearer").checked,
    include_adult: document.getElementById("tmdbAdult").checked,
  };
}

function renderResults() {
  document.getElementById("tmdbRows").innerHTML = tmdbResults.map((item) => `
    <tr class="hover:bg-slate-50">
      <td class="px-3 py-2 font-semibold ${item.ok ? "text-teal-700" : "text-red-700"}">${item.ok ? "成功" : "失败"}</td>
      <td class="px-3 py-2">${escapeHtml(item.input || "")}</td>
      <td class="px-3 py-2 font-medium">${escapeHtml(item.formatted || "")}</td>
      <td class="px-3 py-2">${escapeHtml(item.media_label || item.media_type || "-")}</td>
      <td class="px-3 py-2">${escapeHtml(item.region || "-")}</td>
      <td class="px-3 py-2 text-red-600">${escapeHtml(item.error || "")}</td>
    </tr>
  `).join("") || `<tr><td colspan="6" class="px-3 py-8 text-center text-slate-500">暂无结果</td></tr>`;
}

async function formatTmdb() {
  readTmdbConfig();
  const lines = document.getElementById("tmdbInput").value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error("请输入至少一个媒体标题");
  tmdbResults = [];
  renderResults();
  document.getElementById("tmdbLogBox").textContent = "";
  document.getElementById("tmdbProgress").textContent = `准备查询 ${lines.length} 条`;
  const data = await api("/api/tmdb/jobs", { method: "POST", body: JSON.stringify({ lines, tmdb: configState.tmdb }) });
  tmdbJob = data.job_id;
  if (tmdbPollTimer) clearInterval(tmdbPollTimer);
  tmdbPollTimer = setInterval(pollTmdbJob, 1000);
  pollTmdbJob();
}

async function pollTmdbJob() {
  if (!tmdbJob) return;
  const job = await api(`/api/jobs/${tmdbJob}`);
  tmdbResults = job.results || [];
  renderResults();
  document.getElementById("tmdbLogBox").textContent = (job.logs || []).join("\n");
  document.getElementById("tmdbLogBox").scrollTop = document.getElementById("tmdbLogBox").scrollHeight;
  const okCount = tmdbResults.filter((item) => item.ok).length;
  document.getElementById("tmdbProgress").textContent = `进度：${job.completed || 0}/${job.total || 0}，成功 ${okCount} 条，状态 ${job.status}`;
  setStatus(`TMDB 任务状态：${job.status}`);
  if (job.status === "done" || job.status === "failed") {
    clearInterval(tmdbPollTimer);
    tmdbPollTimer = null;
  }
}

async function copyResults() {
  const text = tmdbResults.map((item) => item.formatted || "").filter(Boolean).join("\n");
  if (!text) throw new Error("没有可复制的结果");
  await navigator.clipboard.writeText(text);
  setStatus("已复制格式化结果");
}

document.getElementById("tmdbFormat").addEventListener("click", () => formatTmdb().catch((err) => setStatus(err.message)));
document.getElementById("tmdbClear").addEventListener("click", () => {
  document.getElementById("tmdbInput").value = "";
  tmdbResults = [];
  renderResults();
  document.getElementById("tmdbLogBox").textContent = "";
  document.getElementById("tmdbProgress").textContent = "等待查询";
});
document.getElementById("tmdbCopy").addEventListener("click", () => copyResults().catch((err) => setStatus(err.message)));

loadPage().catch((err) => setStatus(err.message));
