# jellyfin-library-poster

![GitHub Repo stars](https://img.shields.io/github/stars/HappyQuQu/jellyfin-library-poster?style=for-the-badge)
![GitHub forks](https://img.shields.io/github/forks/HappyQuQu/jellyfin-library-poster?style=for-the-badge)
![GitHub contributors](https://img.shields.io/github/contributors/HappyQuQu/jellyfin-library-poster?style=for-the-badge)
![GitHub repo size](https://img.shields.io/github/repo-size/HappyQuQu/jellyfin-library-poster?style=for-the-badge)
![GitHub issues](https://img.shields.io/github/issues/HappyQuQu/jellyfin-library-poster?style=for-the-badge)
![Docker Pulls](https://img.shields.io/docker/pulls/evanqu/jellyfin-library-poster?style=for-the-badge)

jellyfin/Emby 根据媒体库里面的海报(默认最新的 9 张,没有时间就随机),定时生成媒体库封面并且上传更新

不会 python 随便写的

## 📌 重点提醒

- 背景图基于媒体库第一张海报提取主题色,提取最多 10 个常见颜色
- 通过 HSL 颜色空间判断颜色是否适合做背景
- 如果颜色过暗或过亮，会被跳过并尝试下一个颜色
- 如果所有提取的颜色都不合适，系统会随机生成一个 HSL 颜色
- 随机颜色会控制在合适的色相、饱和度和明度范围内
- 创建从左到右的渐变遮罩，左侧深色到右侧浅色的渐变，为前置的电影海报提供良好的衬托

## 最近更新

### 📅 更新日期

- 2025-04-29

### ✨ 新增功能

- 增加文字阴影功能，可分别为中文和英文文本设置阴影效果
- 文字阴影支持自定义偏移和透明度设置

### 🐞 问题修复

- 修复`Emby`随机排序方式无效

## 使用说明

[Docker Hub](https://hub.docker.com/r/evanqu/jellyfin-library-poster)

### docker 运行

```bash
docker run \
  --name jellyfin-library-poster \
  -v "./config:/app/config" \
  -v "./poster:/app/poster" \
  -v "./output:/app/output" \
  -v "./output:/app/logs" \
  -v "./myfont:/app/myfont"
  evanqu/jellyfin-library-poster:latest
```

`/app/config` 存放 `config.json`,新建一个 `config.json` 文件,然后复制参考示例得内容,然后修改成自己的配置保存到这个 `config.json` 中

`/app/poster` 存放下载得海报(可选)

`/app/output` 存放生成的媒体库封面(可选)

`/app/logs` 存放日志(可选)

`/app/myfont` 存放自定义字体文件(可选,须调整配置文件)

### docker-compose 运行

`docker-compose.yml`文件

```yaml
services:
  jellyfin-library-poster:
    image: evanqu/jellyfin-library-poster:latest
    container_name: jellyfin-library-poster
    volumes:
      - ./config:/app/config
      - ./poster:/app/poster
      - ./output:/app/output
      - ./logs:/app/logs
      - ./myfont:/app/myfont
```

```
docker-compose down && docker-compose pull && docker-compose up -d
```

### 源码运行

python 版本: `3.13.3`

```
pip install -r requirements.txt
python main.py

```

## config 配置说明

`config.json` 是项目的配置文件，用于设置 Jellyfin 服务器连接信息和媒体库海报生成的规则。

### 注意事项

1. 请确保 `base_url`、`user_name` 和 `password` 配置正确
2. `exclude_update_library` 中列出的媒体库将不会被自动更新海报
3. json 对文件有格式约束,如果出现没有加载到自己改的 json 配置,可以把自己得 json 内容复制到[JSON 在线解析格式化验证](https://www.json.cn)网站上看下是否有格式错误

### 完整配置参考

```json
{
  "jellyfin": [
    {
      "server_name": "MyJellyfin",
      "server_type": "jellyfin",
      "base_url": "http://192.168.2.211:8089",
      "user_name": "user",
      "password": "pass",
      "update_poster": false
    },
    {
      "base_url": "http://192.168.2.232:8089",
      "user_name": "user",
      "password": "pass",
      "update_poster": false
    }
  ],
  "cron": "0 1 * * *",
  "init_template_mapping": true,
  "exclude_update_library": ["Short", "Playlists", "合集"],
  "style_config": [
    {
      "style_name": "style1",
      "style_ch_font": "字体名带后缀",
      "style_eng_font": "字体名带后缀",
      "style_ch_shadow": true,
      "style_ch_shadow_offset": [2, 2],
      "style_eng_shadow": true,
      "style_eng_shadow_offset": [2, 2]
    }
  ],
  "template_mapping": [
    {
      "library_name": "Anime",
      "library_ch_name": "动漫",
      "library_eng_name": "ANIME",
      "poster_sort": "DateLastContentAdded"
    },
    {
      "library_name": "Classic TV",
      "library_ch_name": "电视剧",
      "library_eng_name": "TV",
      "poster_sort": "Random"
    },
    {
      "library_name": "Movie",
      "library_ch_name": "电影",
      "library_eng_name": "MOVIE",
      "poster_sort": "DateCreated"
    },
    {
      "library_name": "Documentary",
      "library_ch_name": "纪录片",
      "library_eng_name": "DOC"
    },
    {
      "library_name": "合集",
      "library_ch_name": "合集",
      "library_eng_name": "COLLECTIONS"
    },
    {
      "library_name": "Hot Movie",
      "library_ch_name": "正在热映",
      "library_eng_name": "HOT MOVIE"
    },
    {
      "library_name": "Hot TV",
      "library_ch_name": "正在热播",
      "library_eng_name": "HOT TV",
      "poster_sort": "DateLastContentAdded"
    },
    {
      "library_name": "Short",
      "library_ch_name": "短剧",
      "library_eng_name": "SHORT"
    },
    {
      "library_name": "TEST TV",
      "library_ch_name": "测试电视",
      "library_eng_name": "TEST TV"
    }
  ]
}
```

### `jellyfin`节点 Jellyfin/Emby 服务器配置

```json
"jellyfin": [
    {
      "server_name": "MyJellyfin",
      "server_type": "jellyfin",
      "base_url": "http://192.168.2.210:8096",
      "user_name": "user_name",
      "password": "password",
      "update_poster": false
    },
    {
      "server_name": "MyEmby",
      "server_type": "emby",
      "base_url": "http://192.168.2.211:8097",
      "user_name": "user_name",
      "password": "password",
      "update_poster": false
    }
  ],
```

- 支持多服务器配置
- "jellyfin"的节点不要改,就算你是`emby`的也是`jellyfin`

| 字段名        | 说明                                                                                                                     | 必填 | 默认值 |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ | ---- | ------ |
| server_name   | Jellyfin/Emby 服务器名称                                                                                                 | 是   | -      |
| server_type   | Jellyfin/Emby 服务器类型(`jellyfin`/`emby`)                                                                              | 是   | -      |
| base_url      | Jellyfin/Emby 服务器地址                                                                                                 | 是   | -      |
| user_name     | Jellyfin/Emby 用户名                                                                                                     | 是   | -      |
| password      | Jellyfin/Emby 用户密码                                                                                                   | 是   | -      |
| update_poster | 是否自动上传更新媒体库海报到服务器(会覆盖服务器上原有的媒体库海报,建议先 false,看实际生成效果满意改成 true,重新运行一遍) | 否   | false  |

### `cron`节点 定时任务

```json
"cron": "0 1 * * *",
```

`cron` 字段用于设置自动更新海报的定时任务时间。其格式遵循标准的 Cron 表达式规则：

- `0 1 * * *` 表示每天凌晨 1 点执行任务。
- Cron 表达式的格式为：`分钟 小时 日 月 星期`。

如果需要修改定时任务时间，请根据需求调整 Cron 表达式。例如：

- 每天中午 12 点：`0 12 * * *`
- 每周一凌晨 2 点：`0 2 * * 1`

更多 Cron 表达式的用法可以参考相关文档。

### `init_template_mapping`节点 是否初始化媒体库映射

```json
"init_template_mapping": true
```

`init_template_mapping` 用于控制启动后是否根据 Jellyfin/Emby 返回的媒体库列表自动补全 `template_mapping`。已有的媒体库配置不会被覆盖，只会追加缺失的媒体库。执行一次后会自动改为 `false`。

| 值    | 说明                                      |
| ----- | ----------------------------------------- |
| true  | 获取媒体库列表并补全 `template_mapping`   |
| false | 不自动修改 `template_mapping`             |

### `exclude_update_library`节点 排除更新的媒体库

```json
"exclude_Update_library": ["Short", "Playlists", "合集"]
```

此数组列出不需要自动更新海报的媒体库名称。

### `style_config`节点 海报样式配置

```json
"style_config": [
  {
    "style_name": "style1",
    "style_ch_font": "字体名带后缀",
    "style_eng_font": "字体名带后缀",
    "style_ch_shadow": true,
    "style_ch_shadow_offset": [2, 2],
    "style_eng_shadow": true,
    "style_eng_shadow_offset": [2, 2]
  }
],
```

目前只有一种海报风格所以`style_name`为`style1`

| 字段名                 | 说明                                         | 必填 | 默认值    |
| ---------------------- | -------------------------------------------- | ---- | --------- |
| style_name             | 海报样式名称,固定值`style1`                  | 是   | style1    |
| style_ch_font          | 海报中文字体名称,名称带后缀如 微软雅黑.ttf   | 是   | -         |
| style_eng_font         | 海报英文字体名称,名称带后缀如 微软雅黑.ttf   | 是   | -         |
| style_ch_shadow        | 是否启用中文文字阴影                         | 否   | false     |
| style_ch_shadow_offset | 中文文字阴影偏移量，格式为 [x, y]            | 否   | [2, 2]    |
| style_eng_shadow       | 是否启用英文文字阴影                         | 否   | false     |
| style_eng_shadow_offset| 英文文字阴影偏移量，格式为 [x, y]            | 否   | [2, 2]    |

### `template_mapping` 媒体库模板映射

```json
"template_mapping": [
  {
    "library_name": "Movie",             // Jellyfin 中的媒体库名称
    "library_ch_name": "电影",            // 海报的中文名称（用于海报显示）
    "library_eng_name": "MOVIE",
    "poster_sort": "DateLastContentAdded"

  },
  // 更多媒体库配置...
]
```

| 字段名           | 说明                           | 必填 | 默认值 |
| ---------------- | ------------------------------ | ---- | ------ |
| library_name     | Jellyfin 中的媒体库名称        | 是   | -      |
| library_ch_name  | 海报的中文名称（用于海报显示） | 是   | -      |
| library_eng_name | 海报的英文名称（用于海报显示） | 是   | -      |
| poster_sort      | 海报的排序方式                 | 否   | -      |
| collection_type  | 媒体库类型，初始化时自动写入；`livetv` 会按直播频道/节目获取封面 | 否   | -      |

`poster_sort`参数列表
非必填,默认`DateCreated`,这里只列出部分,其他参数可以再媒体库点击媒体库的排序方式,然后查看 url 里面 `sortBy=xxx` 参数

| 参数代码             | 参数说明           |
| -------------------- | ------------------ |
| DateCreated          | 按创建时间排序     |
| DateLastContentAdded | 按最后添加内容排序 |
| Random               | 随机排序           |
| SortName             | 按名称排序         |
| SeriesDatePlayed     | 按系列播放日期排序 |
| PremiereDate         | 按首映日期排序     |

`template_mapping` 可以只配置需要自定义显示名或排序方式的媒体库。未配置的媒体库会直接使用 Jellyfin/Emby 返回的媒体库名称生成海报：中文名使用媒体库名称，英文媒体库名会自动转为大写，中文媒体库名默认不显示英文名。

## 效果图

### 运行日志

![](https://github.com/HappyQuQu/jellyfin-library-poster/raw/main/screenshot/1.png)

### 海报示例

![](https://github.com/HappyQuQu/jellyfin-library-poster/raw/main/screenshot/Anime.png)
![](https://github.com/HappyQuQu/jellyfin-library-poster/raw/main/screenshot/ClassicTV.png)
![](https://github.com/HappyQuQu/jellyfin-library-poster/raw/main/screenshot/Documentary.png)
![](https://github.com/HappyQuQu/jellyfin-library-poster/raw/main/screenshot/HotMovie.png)
![](https://github.com/HappyQuQu/jellyfin-library-poster/raw/main/screenshot/HotTV.png)
![](https://github.com/HappyQuQu/jellyfin-library-poster/raw/main/screenshot/Movie.png)

## 历史更新

### 📅 更新日期

- 2025-04-29
  - 增加文字阴影功能，可分别为中文和英文文本设置阴影效果
  - 文字阴影支持自定义偏移和透明度设置

- 2025-04-27
  - 支持媒体海报根据不同规则排序,详情查看`template_mapping 节点媒体库模板映射`
  - 支持自定义字体,详情查看`style_config 节点字体映射`
  - 优化媒体库海报背景图，提升整体明亮度,调整背景图生成逻辑,详见`重点提醒`
