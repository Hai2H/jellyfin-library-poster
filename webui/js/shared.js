const navItems = [
  ["pages/config.html", "配置"],
  ["pages/library.html", "媒体库策略"],
  ["pages/run.html", "执行与预览"],
  ["pages/tmdb.html", "TMDB 工具"],
  ["pages/openlist.html", "OpenList"],
];

function pageShell(active, title, desc) {
  const nav = navItems.map(([href, label]) => {
    const isActive = href === active;
    return `<a href="/webui/${href}" class="rounded-md px-3 py-2 text-sm font-medium ${isActive ? "bg-teal-600 text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"}">${label}</a>`;
  }).join("");

  document.body.className = "min-h-screen bg-slate-100 text-slate-900";
  document.body.insertAdjacentHTML("afterbegin", `
    <div class="min-h-screen lg:grid lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside class="bg-slate-950 px-4 py-5 text-white lg:min-h-screen">
        <h1 class="text-xl font-semibold tracking-tight">Library Poster WebUI</h1>
        <p class="mt-2 text-sm text-slate-400">配置、执行、识别与网盘写回。</p>
        <nav class="mt-6 grid gap-2">${nav}</nav>
      </aside>
      <main class="p-4 sm:p-6">
        <div class="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 class="text-2xl font-semibold tracking-tight">${escapeHtml(title)}</h2>
            <p class="mt-1 text-sm text-slate-500">${escapeHtml(desc)}</p>
          </div>
          <div id="status" class="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-sm">正在加载...</div>
        </div>
        <div id="pageRoot"></div>
      </main>
    </div>
  `);
}

function setStatus(message) {
  const el = document.getElementById("status");
  if (el) el.textContent = message;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || "请求失败");
  }
  return data;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[char]));
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function readCsv(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function normalizeStyle(config) {
  const first = config.style_config?.[0] || {};
  return {
    style_name: first.style_name || "style1",
    style_ch_font: first.style_ch_font || "ch.ttf",
    style_eng_font: first.style_eng_font || "en.otf",
    style_ch_shadow: !!first.style_ch_shadow,
    style_ch_shadow_offset: first.style_ch_shadow_offset || [2, 2],
    style_eng_shadow: !!first.style_eng_shadow,
    style_eng_shadow_offset: first.style_eng_shadow_offset || [2, 2],
  };
}

function card(title, body, extra = "") {
  return `
    <section class="rounded-xl border border-slate-200 bg-white p-5 shadow-sm ${extra}">
      ${title ? `<h3 class="mb-4 text-base font-semibold text-slate-900">${escapeHtml(title)}</h3>` : ""}
      ${body}
    </section>
  `;
}

function input(label, id, value = "", attrs = "") {
  return `
    <label class="grid gap-1.5 text-sm font-medium text-slate-700">
      <span>${escapeHtml(label)}</span>
      <input id="${id}" value="${escapeAttr(value)}" ${attrs} class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100">
    </label>
  `;
}

function button(label, id, tone = "default", attrs = "") {
  const cls = tone === "primary"
    ? "border-teal-600 bg-teal-600 text-white hover:bg-teal-700"
    : tone === "blue"
      ? "border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
      : tone === "danger"
        ? "border-red-200 bg-white text-red-700 hover:bg-red-50"
        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50";
  return `<button id="${id}" ${attrs} class="rounded-lg border px-3 py-2 text-sm font-medium shadow-sm ${cls}">${escapeHtml(label)}</button>`;
}

function table(headers, body, id = "") {
  return `
    <div class="overflow-auto rounded-xl border border-slate-200">
      <table class="min-w-full divide-y divide-slate-200 text-sm">
        <thead class="bg-slate-50">
          <tr>${headers.map((head) => `<th class="px-3 py-2 text-left font-semibold text-slate-600">${escapeHtml(head)}</th>`).join("")}</tr>
        </thead>
        <tbody id="${id}" class="divide-y divide-slate-100 bg-white">${body || ""}</tbody>
      </table>
    </div>
  `;
}

function logBox(id) {
  return `<pre id="${id}" class="h-72 overflow-auto rounded-xl bg-slate-950 p-4 text-xs leading-5 text-slate-200"></pre>`;
}
