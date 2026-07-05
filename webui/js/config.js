let configState = null;
let fontsState = [];

pageShell("pages/config.html", "配置", "维护 Jellyfin/Emby 服务器、cron、排除列表、字体和 TMDB/OpenList 连接配置。");

document.getElementById("pageRoot").innerHTML = `
  <div class="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(360px,1fr)]">
    ${card("服务器", `
      <div class="mb-4 flex justify-end">${button("添加服务器", "addServer")}</div>
      <div id="servers" class="grid gap-4"></div>
    `)}
    <div class="grid gap-4">
      ${card("全局配置", `
        <div class="grid gap-4">
          ${input("cron 表达式", "cron", "", "placeholder='例如 0 1 * * *，留空表示不定时'")}
          ${input("排除媒体库", "exclude", "", "placeholder='用逗号分隔，例如 Short, Playlists'")}
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="grid gap-1.5 text-sm font-medium text-slate-700"><span>中文字体</span><select id="chFont" class="rounded-lg border border-slate-300 px-3 py-2 text-sm"></select></label>
            <label class="grid gap-1.5 text-sm font-medium text-slate-700"><span>英文字体</span><select id="engFont" class="rounded-lg border border-slate-300 px-3 py-2 text-sm"></select></label>
          </div>
          <div class="flex gap-4">
            <label class="flex items-center gap-2 text-sm text-slate-700"><input id="chShadow" type="checkbox" class="accent-teal-600"> 中文阴影</label>
            <label class="flex items-center gap-2 text-sm text-slate-700"><input id="engShadow" type="checkbox" class="accent-teal-600"> 英文阴影</label>
          </div>
        </div>
      `)}
      ${card("TMDB", `
        <div class="grid gap-4">
          ${input("TMDB Token", "tmdbToken", "", "type='password' placeholder='可留空使用环境变量 TMDB_TOKEN'")}
          ${input("语言", "tmdbLanguage", "zh-CN")}
          <div class="flex gap-4">
            <label class="flex items-center gap-2 text-sm text-slate-700"><input id="tmdbBearer" type="checkbox" class="accent-teal-600"> Bearer Token</label>
            <label class="flex items-center gap-2 text-sm text-slate-700"><input id="tmdbAdult" type="checkbox" class="accent-teal-600"> 包含成人内容</label>
          </div>
        </div>
      `)}
      ${card("OpenList", `
        <div class="grid gap-4">
          ${input("OpenList 地址", "openlistBaseUrl", "", "placeholder='例如 http://127.0.0.1:5244'")}
          ${input("Token", "openlistToken", "", "type='password'")}
          ${input("默认路径", "openlistPath", "/")}
        </div>
      `)}
      <div class="flex justify-end gap-2">
        ${button("重新加载", "reloadConfig")}
        ${button("保存配置", "saveConfig", "primary")}
      </div>
    </div>
  </div>
`;

function fontOptions(currentValue, defaultValue) {
  const value = currentValue || defaultValue;
  const options = [];
  if (!fontsState.some((font) => font.name === value)) {
    options.push(`<option value="${escapeAttr(value)}">${escapeHtml(value)}（当前配置）</option>`);
  }
  for (const font of fontsState) {
    options.push(`<option value="${escapeAttr(font.name)}"${font.name === value ? " selected" : ""}>${escapeHtml(font.label || font.name)}</option>`);
  }
  return options.join("");
}

function renderServers() {
  const root = document.getElementById("servers");
  root.innerHTML = configState.jellyfin.map((server, index) => `
    <div class="rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div class="mb-3 flex items-center justify-between">
        <strong class="text-sm text-slate-800">服务器 ${index + 1}</strong>
        ${button("删除", `removeServer${index}`, "danger", `data-remove-server="${index}"`)}
      </div>
      <div class="grid gap-3 md:grid-cols-2">
        ${input("名称", `serverName${index}`, server.server_name || "", `data-server="${index}" data-key="server_name"`)}
        <label class="grid gap-1.5 text-sm font-medium text-slate-700">
          <span>类型</span>
          <select data-server="${index}" data-key="server_type" class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="jellyfin"${server.server_type === "jellyfin" ? " selected" : ""}>Jellyfin</option>
            <option value="emby"${server.server_type === "emby" ? " selected" : ""}>Emby</option>
          </select>
        </label>
        ${input("服务器地址", `serverUrl${index}`, server.base_url || "", `data-server="${index}" data-key="base_url"`)}
        ${input("用户名", `serverUser${index}`, server.user_name || "", `data-server="${index}" data-key="user_name"`)}
        ${input("密码", `serverPassword${index}`, server.password || "", `type="password" data-server="${index}" data-key="password"`)}
        <label class="flex items-center gap-2 pt-7 text-sm text-slate-700"><input type="checkbox" data-server="${index}" data-key="update_poster" class="accent-teal-600"${server.update_poster ? " checked" : ""}> 默认上传封面</label>
      </div>
    </div>
  `).join("");

  root.querySelectorAll("[data-server]").forEach((inputEl) => {
    inputEl.addEventListener("input", updateServer);
    inputEl.addEventListener("change", updateServer);
  });
  root.querySelectorAll("[data-remove-server]").forEach((buttonEl) => {
    buttonEl.addEventListener("click", () => {
      configState.jellyfin.splice(Number(buttonEl.dataset.removeServer), 1);
      renderServers();
    });
  });
}

function updateServer(event) {
  const el = event.target;
  const server = configState.jellyfin[Number(el.dataset.server)];
  server[el.dataset.key] = el.type === "checkbox" ? el.checked : el.value;
}

function renderForm() {
  renderServers();
  const style = normalizeStyle(configState);
  const tmdb = configState.tmdb || {};
  const openlist = configState.openlist || {};
  document.getElementById("cron").value = configState.cron || "";
  document.getElementById("exclude").value = (configState.exclude_update_library || []).join(", ");
  document.getElementById("chFont").innerHTML = fontOptions(style.style_ch_font, "ch.ttf");
  document.getElementById("engFont").innerHTML = fontOptions(style.style_eng_font, "en.otf");
  document.getElementById("chFont").value = style.style_ch_font || "ch.ttf";
  document.getElementById("engFont").value = style.style_eng_font || "en.otf";
  document.getElementById("chShadow").checked = style.style_ch_shadow;
  document.getElementById("engShadow").checked = style.style_eng_shadow;
  document.getElementById("tmdbToken").value = tmdb.token || "";
  document.getElementById("tmdbLanguage").value = tmdb.language || "zh-CN";
  document.getElementById("tmdbBearer").checked = tmdb.use_bearer_token !== false;
  document.getElementById("tmdbAdult").checked = tmdb.include_adult !== false;
  document.getElementById("openlistBaseUrl").value = openlist.base_url || "";
  document.getElementById("openlistToken").value = openlist.token || "";
  document.getElementById("openlistPath").value = openlist.path || "/";
}

function readForm() {
  const style = normalizeStyle(configState);
  style.style_ch_font = document.getElementById("chFont").value || "ch.ttf";
  style.style_eng_font = document.getElementById("engFont").value || "en.otf";
  style.style_ch_shadow = document.getElementById("chShadow").checked;
  style.style_eng_shadow = document.getElementById("engShadow").checked;
  configState.cron = document.getElementById("cron").value.trim();
  configState.exclude_update_library = readCsv(document.getElementById("exclude").value);
  configState.style_config = [style];
  configState.tmdb = {
    ...(configState.tmdb || {}),
    token: document.getElementById("tmdbToken").value.trim(),
    language: document.getElementById("tmdbLanguage").value.trim() || "zh-CN",
    use_bearer_token: document.getElementById("tmdbBearer").checked,
    include_adult: document.getElementById("tmdbAdult").checked,
  };
  configState.openlist = {
    ...(configState.openlist || {}),
    base_url: document.getElementById("openlistBaseUrl").value.trim(),
    token: document.getElementById("openlistToken").value.trim(),
    path: document.getElementById("openlistPath").value.trim() || "/",
  };
}

async function loadPage() {
  configState = await api("/api/config");
  const fontData = await api("/api/fonts");
  fontsState = fontData.fonts || [];
  renderForm();
  setStatus("配置已加载");
}

async function savePage() {
  readForm();
  const data = await api("/api/config", { method: "POST", body: JSON.stringify(configState) });
  configState = data.config;
  renderForm();
  setStatus("配置已保存");
}

document.getElementById("addServer").addEventListener("click", () => {
  configState.jellyfin.push({ server_name: "", server_type: "jellyfin", base_url: "", user_name: "", password: "", update_poster: false });
  renderServers();
});
document.getElementById("reloadConfig").addEventListener("click", () => loadPage().catch((err) => setStatus(err.message)));
document.getElementById("saveConfig").addEventListener("click", () => savePage().catch((err) => setStatus(err.message)));

loadPage().catch((err) => setStatus(err.message));
