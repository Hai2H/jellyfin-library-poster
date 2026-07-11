import base64
import json
import logging
import mimetypes
import os
import posixpath
import sys
import threading
import time
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

import requests

import config
from auth import authenticate
from gen_poster import gen_poster_workflow
from get_poster import download_posters_workflow
from tmdb import TMDBMatcher, TMDBSettings, format_lines
from update_poster import upload_poster_workflow


ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
WEBUI_DIR = os.path.join(ROOT_DIR, "webui")
WEBUI_DIST_DIR = os.path.join(WEBUI_DIR, "dist", "app", "browser")
CONFIG_PATH = os.path.join(ROOT_DIR, "config", "config.json")
TMDB_CONFIG_PATH = os.path.join(ROOT_DIR, "tmdb", "config.json")
OPENLIST_CONFIG_PATH = os.path.join(ROOT_DIR, "openlist", "config.json")
POSTER_DIR = os.path.join(ROOT_DIR, "poster")
OUTPUT_DIR = os.path.join(ROOT_DIR, "output")
FONT_DIR = os.path.join(ROOT_DIR, "font")
MYFONT_DIR = os.path.join(ROOT_DIR, "myfont")

JOBS = {}
JOBS_LOCK = threading.Lock()
CONFIG_LOCK = threading.Lock()

webui_logger = logging.getLogger("jellyfin-library-poster.webui")
if not webui_logger.handlers:
    log_formatter = logging.Formatter(
        "%(asctime)s - WEBUI - %(levelname)s - %(message)s",
        "%Y-%m-%d %H:%M:%S",
    )
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(log_formatter)
    webui_logger.addHandler(console_handler)

    logs_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs")
    os.makedirs(logs_dir, exist_ok=True)
    today = time.strftime("%Y-%m-%d")
    file_handler = logging.FileHandler(
        os.path.join(logs_dir, f"webui-{today}.log"),
        encoding="utf-8",
    )
    file_handler.setFormatter(log_formatter)
    webui_logger.addHandler(file_handler)
webui_logger.setLevel(logging.INFO)
webui_logger.propagate = False

DEFAULT_TMDB_CONFIG = {
    "token": "",
    "use_bearer_token": True,
    "language": "zh-CN",
    "include_adult": True,
}

DEFAULT_OPENLIST_CONFIG = {
    "base_url": "",
    "username": "",
    "password": "",
    "token": "",
    "path": "/",
}


def load_config_file():
    with CONFIG_LOCK:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        data["tmdb"] = load_tmdb_config_file_unlocked(data)
        data["openlist"] = load_openlist_config_file_unlocked(data)
        return data


def normalize_tmdb_config(data):
    tmdb_config = data.get("tmdb") if isinstance(data, dict) and "tmdb" in data else data
    tmdb_config = dict(tmdb_config or {})
    normalized = dict(DEFAULT_TMDB_CONFIG)
    normalized.update({
        key: value
        for key, value in tmdb_config.items()
        if key in {"token", "api_key", "use_bearer_token", "language", "include_adult", "timeout"}
    })
    return normalized


def load_tmdb_config_file_unlocked(fallback_data=None):
    if os.path.exists(TMDB_CONFIG_PATH):
        with open(TMDB_CONFIG_PATH, "r", encoding="utf-8") as f:
            return normalize_tmdb_config(json.load(f))

    fallback_tmdb = (fallback_data or {}).get("tmdb") if isinstance(fallback_data, dict) else {}
    return normalize_tmdb_config(fallback_tmdb or DEFAULT_TMDB_CONFIG)


def save_tmdb_config_file_unlocked(data):
    os.makedirs(os.path.dirname(TMDB_CONFIG_PATH), exist_ok=True)
    with open(TMDB_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(normalize_tmdb_config(data), f, ensure_ascii=False, indent=2)
        f.write("\n")


def normalize_openlist_config(data):
    openlist_config = data.get("openlist") if isinstance(data, dict) and "openlist" in data else data
    openlist_config = dict(openlist_config or {})
    normalized = dict(DEFAULT_OPENLIST_CONFIG)
    normalized.update({
        key: value
        for key, value in openlist_config.items()
        if key in {"base_url", "username", "password", "token", "path"}
    })
    normalized["base_url"] = str(normalized.get("base_url") or "").rstrip("/")
    normalized["path"] = normalize_openlist_path(normalized.get("path") or "/")
    return normalized


def load_openlist_config_file_unlocked(fallback_data=None):
    if os.path.exists(OPENLIST_CONFIG_PATH):
        with open(OPENLIST_CONFIG_PATH, "r", encoding="utf-8") as f:
            return normalize_openlist_config(json.load(f))

    fallback_openlist = (fallback_data or {}).get("openlist") if isinstance(fallback_data, dict) else {}
    return normalize_openlist_config(fallback_openlist or DEFAULT_OPENLIST_CONFIG)


def save_openlist_config_file_unlocked(data):
    os.makedirs(os.path.dirname(OPENLIST_CONFIG_PATH), exist_ok=True)
    with open(OPENLIST_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(normalize_openlist_config(data), f, ensure_ascii=False, indent=2)
        f.write("\n")


def save_config_file(data):
    with CONFIG_LOCK:
        tmdb_config = data.get("tmdb", {})
        openlist_config = data.get("openlist", {})
        main_config = dict(data)
        main_config.pop("tmdb", None)
        main_config.pop("openlist", None)
        with open(CONFIG_PATH, "w", encoding="utf-8") as f:
            json.dump(main_config, f, ensure_ascii=False, indent=2)
            f.write("\n")
        save_tmdb_config_file_unlocked(tmdb_config)
        save_openlist_config_file_unlocked(openlist_config)
    apply_runtime_config(data)


def normalize_server(server):
    base_url = (server.get("base_url") or "").rstrip("/")
    return {
        "server_name": server.get("server_name") or base_url or "未命名服务器",
        "server_type": server.get("server_type") or "jellyfin",
        "base_url": base_url,
        "user_name": server.get("user_name") or "",
        "password": server.get("password") or "",
        "update_poster": bool(server.get("update_poster", False)),
    }


def normalize_openlist_path(path):
    path = "/" + str(path or "/").replace("\\", "/").strip("/")
    return posixpath.normpath(path).replace("\\", "/")


def openlist_join(parent_path, name):
    parent_path = normalize_openlist_path(parent_path)
    name = str(name or "").strip("/")
    return normalize_openlist_path(posixpath.join(parent_path, name))


def normalize_config(data):
    data = dict(data or {})
    jellyfin = data.get("jellyfin") or []
    if isinstance(jellyfin, dict):
        jellyfin = [jellyfin]
    data["jellyfin"] = [normalize_server(server) for server in jellyfin]
    data.setdefault("cron", "")
    data.setdefault("init_template_mapping", False)
    data.setdefault("exclude_update_library", [])
    data["tmdb"] = normalize_tmdb_config(data.get("tmdb", DEFAULT_TMDB_CONFIG))
    data["openlist"] = normalize_openlist_config(data.get("openlist", DEFAULT_OPENLIST_CONFIG))
    data.setdefault("style_config", [{
        "style_name": "style1",
        "style_ch_font": "ch.ttf",
        "style_eng_font": "en.otf",
        "style_ch_shadow": False,
        "style_ch_shadow_offset": [2, 2],
        "style_eng_shadow": False,
        "style_eng_shadow_offset": [2, 2],
    }])
    data.setdefault("template_mapping", [])
    return data


def merge_tmdb_config(existing_data, incoming_data):
    existing_tmdb = normalize_config(existing_data).get("tmdb", {})
    incoming_tmdb = normalize_config(incoming_data).get("tmdb", {})
    merged_tmdb = {
        "token": existing_tmdb.get("token", ""),
        "use_bearer_token": existing_tmdb.get("use_bearer_token", True),
        "language": existing_tmdb.get("language", "zh-CN"),
        "include_adult": existing_tmdb.get("include_adult", True),
    }
    merged_tmdb.update({
        key: value
        for key, value in incoming_tmdb.items()
        if key != "token"
    })

    incoming_token = str(incoming_tmdb.get("token", "")).strip()
    if incoming_token:
        merged_tmdb["token"] = incoming_token

    return merged_tmdb


def merge_config_for_save(incoming_data):
    try:
        existing_data = load_config_file()
    except Exception:
        existing_data = {}

    data = normalize_config(incoming_data)
    data["tmdb"] = merge_tmdb_config(existing_data, incoming_data)
    data["openlist"] = normalize_openlist_config(incoming_data.get("openlist") or existing_data.get("openlist"))
    return data


def apply_runtime_config(data):
    data = normalize_config(data)
    config.JSON_CONFIG = data
    config.JELLYFIN_CONFIGS = [
        {
            "SERVER_NAME": item.get("server_name") or item.get("base_url"),
            "SERVER_TYPE": item.get("server_type", ""),
            "BASE_URL": item.get("base_url", "").rstrip("/"),
            "USER_NAME": item.get("user_name", ""),
            "PASSWORD": item.get("password", ""),
            "AUTHORIZATION": 'MediaBrowser Client="other", Device="client", DeviceId="123", Version="0.0.0"',
            "ACCESS_TOKEN": "",
            "USER_ID": "",
            "IMAGE_TYPE": "Primary",
            "IMAGE_PATH": "poster.png",
            "UPDATE_POSTER": bool(item.get("update_poster", False)),
        }
        for item in data.get("jellyfin", [])
    ]
    config.CRON = data.get("cron", "")
    config.INIT_TEMPLATE_MAPPING = bool(data.get("init_template_mapping", False))
    config.EXCLUDE_LIBRARY = data.get("exclude_update_library", [])
    config.TEMPLATE_MAPPING = data.get("template_mapping", [])
    config.STYLE_CONFIGS = data.get("style_config", [])


def get_server(data, index):
    servers = normalize_config(data).get("jellyfin", [])
    if index < 0 or index >= len(servers):
        raise ValueError("服务器索引无效")
    return servers[index]


def auth_headers(token):
    return {"Authorization": f'MediaBrowser Token="{token}"'}


class OpenListClient:
    def __init__(self, settings):
        self.settings = normalize_openlist_config(settings)
        if not self.settings["base_url"]:
            raise RuntimeError("未配置 OpenList 地址")
        self._token = str(self.settings.get("token") or "").strip()
        self._logged_in = False

    def login(self):
        if self._logged_in:
            return self._token
        username = str(self.settings.get("username") or "").strip()
        password = str(self.settings.get("password") or "")
        if not username and not password and self._token:
            return self._token
        if not username or not password:
            raise RuntimeError("OpenList 账号和密码必须同时填写，或改用 Token")
        url = f"{self.settings['base_url']}/api/auth/login"
        response = requests.post(
            url,
            headers={"Content-Type": "application/json"},
            json={"username": username, "password": password},
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
        if data.get("code") not in (0, 200, None):
            raise RuntimeError(data.get("message") or data.get("msg") or "OpenList 登录失败")
        result = data.get("data") or {}
        self._token = str(result.get("token") or "").strip()
        if not self._token:
            raise RuntimeError("OpenList 登录成功，但响应中没有 Token")
        self._logged_in = True
        return self._token

    def headers(self):
        headers = {"Content-Type": "application/json"}
        token = self.login()
        if token:
            headers["Authorization"] = token
        return headers

    def post(self, path, payload):
        url = f"{self.settings['base_url']}{path}"
        response = requests.post(url, headers=self.headers(), json=payload, timeout=30)
        response.raise_for_status()
        data = response.json()
        if data.get("code") not in (0, 200, None):
            raise RuntimeError(data.get("message") or data.get("msg") or "OpenList 请求失败")
        return data.get("data") if "data" in data else data

    def list_dir(self, path):
        path = normalize_openlist_path(path)
        data = self.post("/api/fs/list", {
            "path": path,
            "password": "",
            "page": 1,
            "per_page": 0,
            "refresh": False,
        }) or {}
        content = data.get("content") or []
        folders = []
        for item in content:
            if not item.get("is_dir"):
                continue
            name = item.get("name") or ""
            if not name:
                continue
            folders.append({
                "name": name,
                "path": openlist_join(path, name),
                "parent_path": path,
                "modified": item.get("modified") or "",
                "size": item.get("size", 0),
            })
        return folders

    def rename(self, parent_path, old_name, new_name):
        parent_path = normalize_openlist_path(parent_path)
        old_name = str(old_name or "").strip()
        new_name = str(new_name or "").strip()
        if not old_name or not new_name:
            raise ValueError("原名称和新名称不能为空")
        if "/" in new_name or "\\" in new_name:
            raise ValueError("新名称不能包含路径分隔符")
        old_path = openlist_join(parent_path, old_name)
        self.post("/api/fs/rename", {
            "path": old_path,
            "name": new_name,
        })
        return {
            "old_path": old_path,
            "new_path": openlist_join(parent_path, new_name),
            "old_name": old_name,
            "new_name": new_name,
        }


def list_fonts():
    font_exts = (".ttf", ".otf", ".ttc", ".woff", ".woff2")
    by_name = {}

    for source, folder in (("内置", FONT_DIR), ("自定义", MYFONT_DIR)):
        if not os.path.isdir(folder):
            continue
        for filename in sorted(os.listdir(folder), key=str.lower):
            if not filename.lower().endswith(font_exts):
                continue
            by_name[filename.lower()] = {
                "name": filename,
                "source": source,
                "label": f"{filename}（{source}）",
            }

    return {
        "fonts": sorted(by_name.values(), key=lambda item: item["name"].lower()),
        "ch_default": "ch.ttf",
        "eng_default": "en.otf",
    }


def resolve_font_file(filename):
    filename = os.path.basename(unquote(filename))
    if not filename:
        raise ValueError("字体文件名为空")
    for folder in (MYFONT_DIR, FONT_DIR):
        path = os.path.abspath(os.path.join(folder, filename))
        folder_abs = os.path.abspath(folder)
        if path != folder_abs and path.startswith(folder_abs + os.sep) and os.path.isfile(path):
            return path
    raise FileNotFoundError(f"字体文件不存在: {filename}")


def fetch_libraries(server):
    server = normalize_server(server)
    server_name = server.get("server_name") or server.get("base_url")
    webui_logger.info("[%s] 开始认证，地址: %s，用户: %s", server_name, server["base_url"], server["user_name"])
    auth_info = authenticate(server["base_url"], server["user_name"], server["password"])
    if not auth_info:
        webui_logger.error("[%s] 认证失败，请检查服务器地址、用户名、密码，或查看上方 auth 日志里的 HTTP 状态码", server_name)
        raise RuntimeError("认证失败，请检查服务器地址、用户名和密码")

    url = f"{server['base_url']}/Library/MediaFolders"
    webui_logger.info("[%s] 认证成功，开始获取媒体库: %s", server_name, url)
    response = requests.get(url, headers=auth_headers(auth_info["access_token"]), timeout=30)
    webui_logger.info("[%s] 获取媒体库接口返回状态码: %s", server_name, response.status_code)
    response.raise_for_status()
    items = response.json().get("Items", [])
    webui_logger.info("[%s] 成功获取媒体库数量: %s", server_name, len(items))
    return [
        {
            "Id": item.get("Id", ""),
            "Name": item.get("Name", ""),
            "CollectionType": item.get("CollectionType", ""),
        }
        for item in items
        if item.get("Id") and item.get("Name")
    ]


def merge_template_mapping(data, libraries):
    data = normalize_config(data)
    existing_mapping = data.get("template_mapping", [])
    by_name = {
        item.get("library_name"): item
        for item in existing_mapping
        if item.get("library_name")
    }
    mapping = []
    for library in libraries:
        name = library.get("Name")
        if not name:
            continue
        item = dict(by_name.get(name) or {
            "library_name": name,
            "library_ch_name": name,
            "library_eng_name": name.upper() if name.isascii() else "",
            "poster_sort": "DateCreated",
        })
        item["library_name"] = name
        item.setdefault("library_ch_name", name)
        item.setdefault("library_eng_name", name.upper() if name.isascii() else "")
        item.setdefault("poster_sort", "DateCreated")
        item["update_poster"] = bool(item.get("update_poster", False))
        if item.get("library_ch_name") is None:
            item["library_ch_name"] = name
        if item.get("library_eng_name") is None:
            item["library_eng_name"] = name.upper() if name.isascii() else ""
        if not item.get("poster_sort"):
            item["poster_sort"] = "DateCreated"
        if library.get("CollectionType"):
            item["collection_type"] = library["CollectionType"]
        else:
            item.pop("collection_type", None)
        mapping.append(item)
    data["template_mapping"] = mapping
    return data


class JobLogHandler(logging.Handler):
    def __init__(self, job):
        super().__init__()
        self.job = job
        self.setFormatter(logging.Formatter("%(asctime)s - %(levelname)s - %(message)s", "%H:%M:%S"))

    def emit(self, record):
        self.job.log(self.format(record))


class Job:
    def __init__(self, payload):
        self.id = uuid.uuid4().hex[:12]
        self.payload = payload
        self.status = "queued"
        self.logs = []
        self.outputs = []
        self.results = []
        self.total = 0
        self.completed = 0
        self.job_type = payload.get("job_type", "poster")
        self.started_at = None
        self.finished_at = None
        self.error = None

    def log(self, message):
        webui_logger.info("[%s][%s] %s", self.job_type, self.id, message)
        with JOBS_LOCK:
            self.logs.append(message)
            self.logs = self.logs[-500:]

    def add_result(self, result):
        with JOBS_LOCK:
            self.results.append(result)
            self.completed = len(self.results)

    def snapshot(self):
        with JOBS_LOCK:
            return {
                "id": self.id,
                "type": self.job_type,
                "status": self.status,
                "logs": list(self.logs),
                "outputs": list(self.outputs),
                "results": list(self.results),
                "total": self.total,
                "completed": self.completed,
                "started_at": self.started_at,
                "finished_at": self.finished_at,
                "error": self.error,
            }


def set_current_server(server, auth_info=None):
    runtime_server = {
        "SERVER_NAME": server.get("server_name") or server.get("base_url"),
        "SERVER_TYPE": server.get("server_type", ""),
        "BASE_URL": server.get("base_url", "").rstrip("/"),
        "USER_NAME": server.get("user_name", ""),
        "PASSWORD": server.get("password", ""),
        "AUTHORIZATION": 'MediaBrowser Client="other", Device="client", DeviceId="123", Version="0.0.0"',
        "ACCESS_TOKEN": "",
        "USER_ID": "",
        "IMAGE_TYPE": "Primary",
        "IMAGE_PATH": "poster.png",
        "UPDATE_POSTER": bool(server.get("update_poster", False)),
    }
    if auth_info:
        runtime_server["ACCESS_TOKEN"] = auth_info.get("access_token", "")
        runtime_server["USER_ID"] = auth_info.get("user_id", "")
    config.JELLYFIN_CONFIG.update(runtime_server)


def run_job(job):
    job.status = "running"
    job.started_at = time.strftime("%Y-%m-%d %H:%M:%S")
    handler = JobLogHandler(job)
    loggers = [
        logging.getLogger("jellyfin-library-poster"),
        logging.getLogger("jellyfin-library-poster.config"),
        logging.getLogger("jellyfin-library-poster.auth"),
        logging.getLogger("jellyfin-library-poster.get_library"),
        logging.getLogger("jellyfin-library-poster.get_poster"),
        logging.getLogger("jellyfin-library-poster.gen_poster"),
        logging.getLogger("jellyfin-library-poster.update_poster"),
    ]
    for logger in loggers:
        logger.addHandler(handler)

    try:
        data = load_config_file()
        apply_runtime_config(data)
        server_index = int(job.payload.get("server_index", 0))
        selected_names = set(job.payload.get("library_names") or [])
        force_upload = job.payload.get("upload")
        server = get_server(data, server_index)
        job.log(f"开始执行服务器: {server.get('server_name') or server.get('base_url')}")

        libraries = job.payload.get("libraries")
        if not libraries:
            job.log("正在获取媒体库列表...")
            libraries = fetch_libraries(server)

        if selected_names:
            libraries = [item for item in libraries if item.get("Name") in selected_names]
        if not libraries:
            raise RuntimeError("没有可执行的媒体库")

        auth_info = authenticate(server["base_url"], server["user_name"], server["password"])
        if not auth_info:
            raise RuntimeError("认证失败，无法执行")
        set_current_server(server, auth_info)
        if force_upload is True:
            config.JELLYFIN_CONFIG["UPDATE_POSTER"] = bool(force_upload)

        for library in libraries:
            name = library["Name"]
            if name in config.EXCLUDE_LIBRARY:
                job.log(f"[{name}] 已在排除列表中，跳过")
                continue

            job.log(f"[{name}] 开始下载素材")
            success, count = download_posters_workflow(library["Id"], name, library)
            if not success:
                job.log(f"[{name}] 下载失败，跳过生成")
                continue

            job.log(f"[{name}] 开始生成封面")
            if not gen_poster_workflow(name):
                job.log(f"[{name}] 生成失败")
                continue

            output_file = os.path.join(OUTPUT_DIR, f"{name}.png")
            if os.path.exists(output_file):
                job.outputs.append({
                    "library_name": name,
                    "output_url": f"/output/{quote_path(name)}.png",
                    "poster_urls": poster_urls(name),
                })

            library_config = config.get_template_config(name)
            should_upload = bool(library_config.get("update_poster", config.JELLYFIN_CONFIG["UPDATE_POSTER"]))
            if force_upload is True:
                should_upload = True
            if should_upload:
                job.log(f"[{name}] 开始上传封面")
                upload_poster_workflow(library["Id"], name)
            else:
                job.log(f"[{name}] 已生成，按配置跳过上传")

        job.status = "done"
        job.log("任务完成")
    except Exception as exc:
        job.status = "failed"
        job.error = str(exc)
        job.log(f"任务失败: {exc}")
        job.log(traceback.format_exc())
    finally:
        job.finished_at = time.strftime("%Y-%m-%d %H:%M:%S")
        for logger in loggers:
            logger.removeHandler(handler)


def build_tmdb_config(base_data, body):
    data = normalize_config(base_data)
    override = body.get("tmdb") or {}
    tmdb_config = dict(data.get("tmdb") or {})
    for key in ("token", "use_bearer_token", "language", "include_adult", "timeout"):
        if key in override:
            tmdb_config[key] = override[key]
    data["tmdb"] = tmdb_config
    return data


def build_openlist_config(base_data, body):
    data = normalize_config(base_data)
    override = body.get("openlist") or {}
    openlist_config = dict(data.get("openlist") or {})
    for key in ("base_url", "username", "password", "token", "path"):
        if key in override:
            openlist_config[key] = override[key]
    data["openlist"] = normalize_openlist_config(openlist_config)
    return data


def get_tmdb_lines(body):
    lines = body.get("lines")
    if lines is None:
        text = body.get("text") or ""
        lines = text.splitlines()
    if not isinstance(lines, list):
        raise ValueError("lines 必须是数组")
    return [str(line).strip() for line in lines if str(line).strip()]


def get_openlist_items(body):
    items = body.get("items") or []
    if not isinstance(items, list):
        raise ValueError("items 必须是数组")
    return [item for item in items if item.get("name") or item.get("original_name")]


def run_tmdb_job(job):
    job.status = "running"
    job.started_at = time.strftime("%Y-%m-%d %H:%M:%S")

    try:
        lines = get_tmdb_lines(job.payload)
        job.total = len(lines)
        if not lines:
            raise RuntimeError("没有可查询的媒体标题")

        data = build_tmdb_config(load_config_file(), job.payload)
        settings = TMDBSettings.from_config(data)
        matcher = TMDBMatcher(settings)
        job.log(f"TMDB 查询任务开始，共 {job.total} 条")

        if not settings.token:
            job.log("未配置 TMDB Token，任务将失败")

        for index, raw_line in enumerate(lines, 1):
            job.log(f"[{index}/{job.total}] 开始处理：{raw_line}")
            try:
                result = matcher.format_item(raw_line)
                job.add_result(result)
                if result.get("ok"):
                    job.log(f"[{index}/{job.total}] 匹配成功：{result.get('formatted')}")
                else:
                    job.log(f"[{index}/{job.total}] 未匹配：{result.get('formatted')}；{result.get('error', '')}")
            except Exception as exc:
                title, year, _, year_label, extra_info = matcher.clean_title(raw_line)
                display_year = year_label or year
                fallback = f"{title}（{display_year}）" if display_year else title
                if extra_info:
                    fallback = f"{fallback} {extra_info}"
                result = {
                    "ok": False,
                    "input": raw_line,
                    "clean_title": title,
                    "year": display_year or "",
                    "extra_info": extra_info,
                    "formatted": fallback,
                    "error": str(exc),
                }
                job.add_result(result)
                job.log(f"[{index}/{job.total}] 查询失败：{raw_line}；{exc}")

        ok_count = len([item for item in job.results if item.get("ok")])
        job.status = "done"
        job.log(f"TMDB 查询任务完成，成功 {ok_count}/{job.total} 条")
    except Exception as exc:
        job.status = "failed"
        job.error = str(exc)
        job.log(f"TMDB 查询任务失败：{exc}")
        job.log(traceback.format_exc())
    finally:
        job.finished_at = time.strftime("%Y-%m-%d %H:%M:%S")


def run_openlist_preview_job(job):
    job.status = "running"
    job.started_at = time.strftime("%Y-%m-%d %H:%M:%S")

    try:
        items = get_openlist_items(job.payload)
        job.total = len(items)
        if not items:
            raise RuntimeError("没有可识别的 OpenList 文件夹")

        data = build_tmdb_config(load_config_file(), job.payload)
        matcher = TMDBMatcher(TMDBSettings.from_config(data))
        job.log(f"OpenList 识别预览开始，共 {job.total} 个文件夹")

        for index, item in enumerate(items, 1):
            original_name = item.get("name") or item.get("original_name") or ""
            parent_path = normalize_openlist_path(item.get("parent_path") or job.payload.get("path") or "/")
            job.log(f"[{index}/{job.total}] 开始识别：{original_name}")
            try:
                result = matcher.format_item(original_name)
                proposed_name = result.get("formatted") or original_name
                row = {
                    "ok": bool(result.get("ok")),
                    "parent_path": parent_path,
                    "original_name": original_name,
                    "new_name": proposed_name,
                    "changed": proposed_name != original_name,
                    "tmdb": result,
                    "error": result.get("error", ""),
                }
                job.add_result(row)
                if row["ok"]:
                    job.log(f"[{index}/{job.total}] 识别成功：{original_name} -> {proposed_name}")
                else:
                    job.log(f"[{index}/{job.total}] 识别失败：{original_name}；{row['error']}")
            except Exception as exc:
                job.add_result({
                    "ok": False,
                    "parent_path": parent_path,
                    "original_name": original_name,
                    "new_name": original_name,
                    "changed": False,
                    "error": str(exc),
                })
                job.log(f"[{index}/{job.total}] 识别异常：{original_name}；{exc}")

        ok_count = len([item for item in job.results if item.get("ok")])
        job.status = "done"
        job.log(f"OpenList 识别预览完成，成功 {ok_count}/{job.total} 个")
    except Exception as exc:
        job.status = "failed"
        job.error = str(exc)
        job.log(f"OpenList 识别预览失败：{exc}")
        job.log(traceback.format_exc())
    finally:
        job.finished_at = time.strftime("%Y-%m-%d %H:%M:%S")


def run_openlist_rename_job(job):
    job.status = "running"
    job.started_at = time.strftime("%Y-%m-%d %H:%M:%S")

    try:
        items = get_openlist_items(job.payload)
        job.total = len(items)
        if not items:
            raise RuntimeError("没有可写回的 OpenList 文件夹")

        data = build_openlist_config(load_config_file(), job.payload)
        client = OpenListClient(data["openlist"])
        job.log(f"OpenList 写回任务开始，共 {job.total} 个文件夹")

        for index, item in enumerate(items, 1):
            parent_path = normalize_openlist_path(item.get("parent_path") or job.payload.get("path") or "/")
            old_name = item.get("original_name") or item.get("name") or ""
            new_name = item.get("new_name") or ""
            job.log(f"[{index}/{job.total}] 准备重命名：{old_name} -> {new_name}")
            try:
                if old_name == new_name:
                    result = {
                        "ok": True,
                        "skipped": True,
                        "parent_path": parent_path,
                        "original_name": old_name,
                        "new_name": new_name,
                        "message": "名称未变化，已跳过",
                    }
                else:
                    rename_result = client.rename(parent_path, old_name, new_name)
                    result = {
                        "ok": True,
                        "skipped": False,
                        "parent_path": parent_path,
                        "original_name": old_name,
                        "new_name": new_name,
                        **rename_result,
                    }
                job.add_result(result)
                job.log(f"[{index}/{job.total}] 写回成功：{old_name} -> {new_name}")
            except Exception as exc:
                job.add_result({
                    "ok": False,
                    "parent_path": parent_path,
                    "original_name": old_name,
                    "new_name": new_name,
                    "error": str(exc),
                })
                job.log(f"[{index}/{job.total}] 写回失败：{old_name}；{exc}")

        ok_count = len([item for item in job.results if item.get("ok")])
        job.status = "done"
        job.log(f"OpenList 写回任务完成，成功 {ok_count}/{job.total} 个")
    except Exception as exc:
        job.status = "failed"
        job.error = str(exc)
        job.log(f"OpenList 写回任务失败：{exc}")
        job.log(traceback.format_exc())
    finally:
        job.finished_at = time.strftime("%Y-%m-%d %H:%M:%S")


def quote_path(value):
    from urllib.parse import quote
    return quote(value, safe="")


def poster_urls(library_name):
    folder = os.path.join(POSTER_DIR, library_name)
    if not os.path.isdir(folder):
        return []
    urls = []
    for filename in sorted(os.listdir(folder)):
        if filename.lower().endswith((".jpg", ".jpeg", ".png", ".webp")):
            urls.append(f"/poster/{quote_path(library_name)}/{quote_path(filename)}")
    return urls


def safe_join(base, rel_path):
    rel_path = posixpath.normpath(unquote(rel_path)).lstrip("/")
    full_path = os.path.abspath(os.path.join(base, *rel_path.split("/")))
    base_abs = os.path.abspath(base)
    if full_path != base_abs and not full_path.startswith(base_abs + os.sep):
        raise ValueError("非法路径")
    return full_path


def angular_index_file():
    index_path = os.path.join(WEBUI_DIST_DIR, "index.html")
    if os.path.exists(index_path):
        return index_path
    return os.path.join(WEBUI_DIR, "pages", "config.html")


class WebUIHandler(BaseHTTPRequestHandler):
    server_version = "JellyfinPosterWebUI/1.0"

    def log_message(self, fmt, *args):
        return

    def do_GET(self):
        try:
            parsed = urlparse(self.path)
            path = parsed.path
            if path == "/api/config":
                return self.send_json(normalize_config(load_config_file()))
            if path == "/api/fonts":
                return self.send_json(list_fonts())
            if path.startswith("/font-file/"):
                return self.send_file(resolve_font_file(path[len("/font-file/"):]))
            if path.startswith("/api/jobs/"):
                job_id = path.rsplit("/", 1)[-1]
                job = JOBS.get(job_id)
                if not job:
                    return self.send_error_json(404, "任务不存在")
                return self.send_json(job.snapshot())
            if path.startswith("/output/"):
                return self.send_file(safe_join(OUTPUT_DIR, path[len("/output/"):]))
            if path.startswith("/poster/"):
                return self.send_file(safe_join(POSTER_DIR, path[len("/poster/"):]))
            if os.path.isdir(WEBUI_DIST_DIR):
                if path in ("/", "/webui", "/webui/"):
                    return self.send_file(angular_index_file())
                if path.startswith("/webui/"):
                    dist_path = safe_join(WEBUI_DIST_DIR, path[len("/webui/"):])
                    if os.path.exists(dist_path) and os.path.isfile(dist_path):
                        return self.send_file(dist_path)
                    return self.send_file(angular_index_file())
                dist_asset = safe_join(WEBUI_DIST_DIR, path.lstrip("/"))
                if os.path.exists(dist_asset) and os.path.isfile(dist_asset):
                    return self.send_file(dist_asset)
                return self.send_file(angular_index_file())
            if path in ("/", "/webui", "/webui/"):
                return self.send_file(os.path.join(WEBUI_DIR, "pages", "config.html"))
            if path.startswith("/webui/") and path.endswith(".html") and not path.startswith("/webui/pages/"):
                filename = os.path.basename(path)
                return self.send_file(safe_join(os.path.join(WEBUI_DIR, "pages"), filename))
            if path.startswith("/webui/"):
                return self.send_file(safe_join(WEBUI_DIR, path[len("/webui/"):]))
            return self.send_file(os.path.join(WEBUI_DIR, "pages", "config.html"))
        except Exception as exc:
            webui_logger.error("GET %s 失败: %s", self.path, exc, exc_info=True)
            self.send_error_json(500, str(exc))

    def do_POST(self):
        try:
            parsed = urlparse(self.path)
            body = self.read_json()
            if parsed.path == "/api/config":
                data = merge_config_for_save(body)
                save_config_file(data)
                return self.send_json({"ok": True, "config": data})
            if parsed.path == "/api/libraries":
                data = load_config_file()
                server_index = int(body.get("server_index", 0))
                webui_logger.info("收到获取媒体库请求，server_index=%s", server_index)
                server = get_server(data, server_index)
                libraries = fetch_libraries(server)
                if body.get("sync", True):
                    data = merge_template_mapping(data, libraries)
                    save_config_file(data)
                    webui_logger.info("已同步 %s 个媒体库到 template_mapping", len(libraries))
                return self.send_json({"ok": True, "libraries": libraries, "config": normalize_config(load_config_file())})
            if parsed.path == "/api/openlist/config":
                data = load_config_file()
                data["openlist"] = normalize_openlist_config(body.get("openlist") or body)
                save_config_file(data)
                return self.send_json({"ok": True, "openlist": data["openlist"]})
            if parsed.path == "/api/openlist/list":
                data = build_openlist_config(load_config_file(), body)
                client = OpenListClient(data["openlist"])
                path = normalize_openlist_path(body.get("path") or data["openlist"].get("path") or "/")
                folders = client.list_dir(path)
                data["openlist"]["path"] = path
                save_config_file(data)
                return self.send_json({"ok": True, "path": path, "folders": folders, "openlist": data["openlist"]})
            if parsed.path == "/api/openlist/status":
                data = build_openlist_config(load_config_file(), body)
                client = OpenListClient(data["openlist"])
                path = normalize_openlist_path(body.get("path") or data["openlist"].get("path") or "/")
                folders = client.list_dir(path)
                return self.send_json({
                    "ok": True,
                    "connected": True,
                    "path": path,
                    "folder_count": len(folders),
                    "openlist": data["openlist"],
                })
            if parsed.path == "/api/openlist/preview/jobs":
                payload = dict(body)
                payload["job_type"] = "openlist-preview"
                job = Job(payload)
                with JOBS_LOCK:
                    JOBS[job.id] = job
                job.log("OpenList 识别预览任务已提交")
                thread = threading.Thread(target=run_openlist_preview_job, args=(job,), daemon=True)
                thread.start()
                return self.send_json({"ok": True, "job_id": job.id})
            if parsed.path == "/api/openlist/rename/jobs":
                payload = dict(body)
                payload["job_type"] = "openlist-rename"
                job = Job(payload)
                with JOBS_LOCK:
                    JOBS[job.id] = job
                job.log("OpenList 写回任务已提交")
                thread = threading.Thread(target=run_openlist_rename_job, args=(job,), daemon=True)
                thread.start()
                return self.send_json({"ok": True, "job_id": job.id})
            if parsed.path == "/api/jobs":
                job = Job(body)
                with JOBS_LOCK:
                    JOBS[job.id] = job
                thread = threading.Thread(target=run_job, args=(job,), daemon=True)
                thread.start()
                return self.send_json({"ok": True, "job_id": job.id})
            if parsed.path == "/api/tmdb/jobs":
                payload = dict(body)
                payload["job_type"] = "tmdb"
                job = Job(payload)
                with JOBS_LOCK:
                    JOBS[job.id] = job
                job.log("TMDB 查询任务已提交")
                thread = threading.Thread(target=run_tmdb_job, args=(job,), daemon=True)
                thread.start()
                return self.send_json({"ok": True, "job_id": job.id})
            if parsed.path == "/api/tmdb/format":
                lines = get_tmdb_lines(body)
                webui_logger.info("收到同步 TMDB 查询请求，共 %s 条", len(lines))
                data = build_tmdb_config(load_config_file(), body)
                results = format_lines(lines, TMDBSettings.from_config(data))
                webui_logger.info("同步 TMDB 查询完成，共 %s 条", len(results))
                return self.send_json({"ok": True, "results": results})
            return self.send_error_json(404, "接口不存在")
        except Exception as exc:
            webui_logger.error("POST %s 失败: %s", self.path, exc, exc_info=True)
            self.send_error_json(500, str(exc))

    def read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw or "{}")

    def send_json(self, data, status=200):
        raw = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def send_error_json(self, status, message):
        self.send_json({"ok": False, "error": message}, status)

    def send_file(self, path):
        if not os.path.exists(path) or not os.path.isfile(path):
            return self.send_error_json(404, "文件不存在")
        content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"
        with open(path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def run(host="0.0.0.0", port=8765):
    apply_runtime_config(load_config_file())
    httpd = ThreadingHTTPServer((host, port), WebUIHandler)
    print(f"WebUI running at http://{host}:{port}/", flush=True)
    httpd.serve_forever()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    run(port=port)
