# Project Visualization

这份文档把 `jellyfin-library-poster` 的代码结构、运行流程和数据流画出来，方便快速理解项目。

## 1. 项目地图

```mermaid
flowchart TB
    root["jellyfin-library-poster"]

    root --> app["Python runtime"]
    app --> main["main.py<br/>入口、定时调度、媒体库循环"]
    app --> config["config.py<br/>读取 config/config.json、全局配置、认证状态"]
    app --> auth["auth.py<br/>Jellyfin/Emby 登录认证"]
    app --> getLibrary["get_library.py<br/>获取媒体库列表"]
    app --> getPoster["get_poster.py<br/>获取媒体项并下载封面"]
    app --> genPoster["gen_poster.py<br/>生成媒体库封面图"]
    app --> updatePoster["update_poster.py<br/>上传生成后的封面"]
    app --> logger["logger.py<br/>控制台和文件日志"]

    root --> cfgDir["config/config.json<br/>服务器、cron、样式、媒体库映射"]
    root --> fonts["font/<br/>默认中英文字体"]
    root --> screenshots["screenshot/<br/>效果截图"]
    root --> docker["Dockerfile / build.* / start.sh<br/>容器构建与启动"]
    root --> req["requirements.txt<br/>requests, bs4, Pillow, croniter"]

    runtime["运行时生成目录"] --> posterDir["poster/<library>/<br/>下载的 1.jpg - 9.jpg"]
    runtime --> outputDir["output/<library>.png<br/>合成后的媒体库封面"]
    runtime --> logsDir["logs/YYYY-MM-DD.log<br/>日志文件"]
```

## 2. 主执行流程

```mermaid
flowchart TD
    start["启动 python main.py"] --> loadConfig["config.py 读取 config/config.json"]
    loadConfig --> initCheck{"init_template_mapping?"}

    initCheck -- yes --> initMap["initialize_template_mapping()"]
    initMap --> eachServerInit["遍历 JELLYFIN_CONFIGS"]
    eachServerInit --> getLibForMap["get_libraries() 拉取媒体库"]
    getLibForMap --> syncMap["sync_template_mapping() 写回 config.json"]
    syncMap --> disableInit["disable_init_template_mapping()"]
    disableInit --> cronCheck

    initCheck -- no --> cronCheck{"cron 是否配置?"}
    cronCheck -- no --> process["process_libraries() 立即执行一次"]
    cronCheck -- yes --> firstRun["首次启动立即执行一次"]
    firstRun --> process
    firstRun --> loop["croniter 计算下次运行时间<br/>循环等待并定时执行"]
    loop --> process

    process --> serverLoop["遍历每个 Jellyfin/Emby 服务器配置"]
    serverLoop --> getLibraries["1. get_libraries()<br/>获取媒体库列表"]
    getLibraries --> libraryLoop["遍历每个媒体库"]
    libraryLoop --> download["2. download_posters_workflow()<br/>下载 9 张媒体封面"]
    download --> generate["3. gen_poster_workflow()<br/>生成 1920x1080 封面"]
    generate --> updateCheck{"UPDATE_POSTER<br/>且不在排除列表?"}
    updateCheck -- yes --> upload["4. upload_poster_workflow()<br/>上传封面到服务器"]
    updateCheck -- no --> skip["跳过上传，只保留本地输出"]
    upload --> doneLib["当前媒体库完成"]
    skip --> doneLib
    doneLib --> libraryLoop
```

## 3. 模块依赖图

```mermaid
flowchart LR
    main["main.py"] --> config["config.py"]
    main --> getLibrary["get_library.py"]
    main --> getPoster["get_poster.py"]
    main --> genPoster["gen_poster.py"]
    main --> updatePoster["update_poster.py"]
    main --> logger["logger.py"]
    main --> croniter["croniter"]

    config --> auth["auth.py"]
    config --> logger

    auth --> requests["requests"]
    auth --> logger

    getLibrary --> config
    getLibrary --> requests
    getLibrary --> logger

    getPoster --> config
    getPoster --> requests
    getPoster --> logger

    genPoster --> config
    genPoster --> pillow["Pillow"]
    genPoster --> logger

    updatePoster --> config
    updatePoster --> requests
    updatePoster --> pillow
    updatePoster --> logger

    logger --> logging["logging"]
```

## 4. 数据流

```mermaid
flowchart LR
    cfg["config/config.json"] --> config["config.py"]
    config --> serverCfg["JELLYFIN_CONFIGS / JELLYFIN_CONFIG"]
    serverCfg --> auth["auth.authenticate()"]
    auth --> token["ACCESS_TOKEN / USER_ID"]

    token --> libApi["GET /Library/MediaFolders"]
    libApi --> libraries["媒体库列表"]

    libraries --> itemApi["GET /Users/{UserId}/Items"]
    itemApi --> items["媒体项列表"]
    items --> imageApi["GET /Items/{ItemId}/Images/Primary"]
    imageApi --> posterFiles["poster/<library>/1.jpg ... 9.jpg"]

    posterFiles --> generator["gen_poster_workflow()"]
    cfg --> style["template_mapping / style_config"]
    style --> generator
    generator --> output["output/<library>.png"]

    output --> uploadCheck{"update_poster enabled?"}
    uploadCheck -- yes --> uploadApi["POST /Items/{LibraryId}/Images/Primary"]
    uploadCheck -- no --> localOnly["仅本地保存"]
```

## 5. 封面生成内部流程

```mermaid
flowchart TD
    input["poster/<library>/1.jpg ... 9.jpg"] --> primaryColor["get_poster_primary_color()<br/>提取最多 10 个主色"]
    primaryColor --> bg["create_gradient_background()<br/>筛选适合背景的 HSL 颜色<br/>或随机生成颜色"]
    bg --> canvas["创建 1920x1080 渐变画布"]

    input --> sort["按 custom_order = 315426987 排序"]
    sort --> group["按 3 张一组分成 3 列"]
    group --> resize["缩放到 410x610"]
    resize --> corner["圆角蒙版"]
    corner --> shadow["add_shadow() 添加海报阴影"]
    shadow --> column["合成单列图片"]
    column --> rotate["整体旋转 -15.8 度"]
    rotate --> paste["粘贴到背景画布指定坐标"]

    canvas --> paste
    paste --> textCfg["读取 template_mapping 和 style_config"]
    textCfg --> text["绘制中文名、英文名、文字阴影、色块"]
    text --> save["保存 output/<library>.png"]
```

## 6. 配置影响范围

```mermaid
flowchart TB
    configJson["config/config.json"]

    configJson --> jellyfin["jellyfin[]<br/>服务器地址、账号、密码、是否上传"]
    jellyfin --> authFlow["认证、拉库、下载、上传"]

    configJson --> cron["cron"]
    cron --> scheduler["main.py 定时循环"]

    configJson --> initMapping["init_template_mapping"]
    initMapping --> mappingInit["启动时自动补全 template_mapping"]

    configJson --> exclude["exclude_update_library"]
    exclude --> libFilter["get_libraries() 排除媒体库"]
    exclude --> uploadFilter["process_libraries() 跳过上传"]

    configJson --> styleConfig["style_config"]
    styleConfig --> fontAndShadow["字体、文字阴影"]

    configJson --> templateMapping["template_mapping"]
    templateMapping --> names["封面中英文标题"]
    templateMapping --> sortRule["poster_sort 媒体项排序规则"]
```

## 7. 核心职责速览

| 文件 | 职责 | 关键函数 |
| --- | --- | --- |
| `main.py` | 程序入口、cron 调度、多服务器和多媒体库循环 | `main`, `process_libraries`, `initialize_template_mapping` |
| `config.py` | 加载 JSON 配置、维护当前服务器认证状态、同步媒体库映射 | `get_auth_info`, `sync_template_mapping`, `get_template_config` |
| `auth.py` | 调用 Jellyfin/Emby 认证接口，获取 `User.Id` 和 `AccessToken` | `authenticate` |
| `get_library.py` | 拉取媒体库列表，并按排除配置过滤 | `get_libraries` |
| `get_poster.py` | 拉取媒体项、筛选有封面的项目、下载封面图 | `download_posters_workflow`, `get_items`, `download_all_posters` |
| `gen_poster.py` | 使用 Pillow 生成最终封面图 | `gen_poster_workflow`, `create_gradient_background`, `get_poster_primary_color` |
| `update_poster.py` | 读取输出图片并上传回 Jellyfin/Emby | `upload_poster_workflow`, `upload_image` |
| `logger.py` | 彩色控制台日志和按日期写入文件日志 | `get_logger`, `get_module_logger` |

## 8. 外部交互边界

```mermaid
flowchart LR
    app["本项目"] --> jellyfin["Jellyfin / Emby API"]
    app --> fs["本地文件系统"]

    jellyfin --> authApi["POST /Users/AuthenticateByName"]
    jellyfin --> libraryApi["GET /Library/MediaFolders"]
    jellyfin --> itemsApi["GET /Users/{UserId}/Items"]
    jellyfin --> imageGetApi["GET /Items/{ItemId}/Images/Primary"]
    jellyfin --> imagePostApi["POST /Items/{LibraryId}/Images/Primary"]

    fs --> readConfig["读取 config/config.json"]
    fs --> writeConfig["可写回 init_template_mapping 和 template_mapping"]
    fs --> writePoster["写入 poster/<library>/*.jpg"]
    fs --> writeOutput["写入 output/<library>.png"]
    fs --> writeLog["写入 logs/*.log"]
```
