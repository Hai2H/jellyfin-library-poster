import os
import re
from dataclasses import dataclass

import requests


NOISE = [
    "1080P", "2160P", "720P", "4K", "8K", "HDR", "HDR10", "HDR10+", "DV",
    "DoVi", "REMUX", "WEB-DL", "WEBRip", "BluRay", "BDRip", "HDTV",
    "HEVC", "H265", "H.265", "x265", "x264", "AAC", "DTS", "DDP", "Atmos",
    "蓝光", "原盘", "高码", "中字", "国语", "粤语", "内封", "简繁",
]

TRAILING_NOISE_PATTERNS = [
    r"(?:全\s*)?\d+\s*集",
    r"\d+\s*季",
    r"\d+\s*期",
    r"\d+\s*话",
    r"\d+\s*回",
    r"S\d{1,2}",
    r"Season\s*\d+",
]


@dataclass
class TMDBSettings:
    token: str = ""
    use_bearer_token: bool = True
    language: str = "zh-CN"
    include_adult: bool = True
    timeout: int = 15

    @classmethod
    def from_config(cls, data):
        tmdb_config = (data or {}).get("tmdb") or {}
        token = (
            os.getenv("TMDB_TOKEN")
            or tmdb_config.get("token")
            or tmdb_config.get("api_key")
            or ""
        )
        return cls(
            token=token,
            use_bearer_token=bool(tmdb_config.get("use_bearer_token", True)),
            language=tmdb_config.get("language") or "zh-CN",
            include_adult=bool(tmdb_config.get("include_adult", True)),
            timeout=int(tmdb_config.get("timeout", 15)),
        )


class TMDBMatcher:
    def __init__(self, settings):
        self.settings = settings

    def request(self, url, params=None):
        if not self.settings.token:
            raise RuntimeError("未配置 TMDB Token")

        params = dict(params or {})
        headers = {"Accept": "application/json"}
        token = self.settings.token.strip()

        if self.settings.use_bearer_token:
            headers["Authorization"] = "Bearer " + token
        else:
            params["api_key"] = token

        response = requests.get(
            url,
            headers=headers,
            params=params,
            timeout=self.settings.timeout,
        )
        response.raise_for_status()
        return response.json()

    def clean_title(self, line):
        raw = line.strip()

        tmdbid = None
        id_match = re.search(r"\[tmdbid=(\d+)\]", raw, flags=re.I)
        if id_match:
            tmdbid = id_match.group(1)
            raw = re.sub(r"\[tmdbid=\d+\]", "", raw, flags=re.I)

        marker_matches = []
        for match in re.finditer(r"[\(（]\s*系列\s*[\)）]", raw):
            marker_matches.append(("series", match))
        for match in re.finditer(r"[\(（](\d{4})[\)）]", raw):
            marker_matches.append(("year", match))
        marker_matches.sort(key=lambda item: item[1].start())

        year = None
        year_label = None
        extra_info = ""
        for marker_type, match in marker_matches:
            if marker_type == "series":
                year_label = "系列"
            elif year is None:
                year = match.group(1)

        if marker_matches:
            first_marker = marker_matches[0][1]
            extra_info = raw[first_marker.end():].strip()
            raw = raw[:first_marker.start()]

        for pattern in TRAILING_NOISE_PATTERNS:
            raw = re.sub(pattern, "", raw, flags=re.I)

        for noise in NOISE:
            raw = re.sub(rf"\b{re.escape(noise)}\b", "", raw, flags=re.I)
            raw = re.sub(re.escape(noise), "", raw, flags=re.I)

        raw = re.sub(r"[-_./]+", " ", raw)
        raw = re.sub(r"\s+", " ", raw).strip()
        return raw, year, tmdbid, year_label, extra_info

    def search(self, title, year=None, media_type="tv"):
        url = f"https://api.themoviedb.org/3/search/{media_type}"
        params = {
            "query": title,
            "language": self.settings.language,
            "include_adult": str(self.settings.include_adult).lower(),
        }

        if year:
            if media_type == "tv":
                params["first_air_date_year"] = year
            else:
                params["year"] = year

        return self.request(url, params).get("results", [])

    def get_detail(self, tmdbid, media_type):
        url = f"https://api.themoviedb.org/3/{media_type}/{tmdbid}"
        return self.request(url, {"language": self.settings.language})

    def is_animation(self, detail):
        for genre in detail.get("genres") or []:
            genre_id = genre.get("id")
            genre_name = str(genre.get("name") or "").strip().lower()
            if genre_id == 16 or genre_name in {"animation", "动画", "动漫"}:
                return True
        return False

    def classify_region(self, detail, media_type):
        if media_type == "tv":
            if self.is_animation(detail):
                return "动漫"

            countries = detail.get("origin_country") or []
            if "CN" in countries:
                return "国产"
            if "HK" in countries or "TW" in countries:
                return "港台"
            if "JP" in countries or "KR" in countries:
                return "日韩"
            if "US" in countries or "GB" in countries or "CA" in countries:
                return "欧美"
            return "其他"

        countries = [
            item.get("iso_3166_1")
            for item in detail.get("production_countries", [])
            if item.get("iso_3166_1")
        ]
        if "CN" in countries or "HK" in countries or "TW" in countries:
            return "华语"
        if "JP" in countries or "KR" in countries:
            return "日韩"
        if "US" in countries or "GB" in countries or "CA" in countries:
            return "欧美"
        return "欧美"

    def get_name_and_year(self, detail, media_type, fallback_year=None):
        if media_type == "tv":
            name = detail.get("name") or detail.get("original_name")
            date = detail.get("first_air_date")
        else:
            name = detail.get("title") or detail.get("original_title")
            date = detail.get("release_date")

        year = date[:4] if date else fallback_year or ""
        return name, year

    def pick_best(self, results, year, media_type):
        if not results:
            return None

        if year:
            date_key = "first_air_date" if media_type == "tv" else "release_date"
            for item in results:
                date = item.get(date_key)
                if date and date.startswith(year):
                    return item

        return results[0]

    def verify_existing_tmdbid(self, tmdbid, year=None):
        for media_type in ["tv", "movie"]:
            try:
                detail = self.get_detail(tmdbid, media_type)
                name, out_year = self.get_name_and_year(detail, media_type, year)
                if year and out_year and out_year != year:
                    continue

                region = self.classify_region(detail, media_type)
                return self.build_result(name, out_year, tmdbid, region, media_type)
            except Exception:
                continue

        return None

    def build_result(self, name, year, tmdbid, region, media_type, extra_info=""):
        media_label = "剧集" if media_type == "tv" else "电影"
        formatted = self.format_output(name, year, tmdbid, region, extra_info)
        return {
            "ok": True,
            "formatted": formatted,
            "name": name,
            "year": year,
            "tmdbid": str(tmdbid),
            "region": region,
            "media_type": media_type,
            "media_label": media_label,
            "extra_info": extra_info,
        }

    def format_item(self, raw_line):
        title, year, tmdbid, year_label, extra_info = self.clean_title(raw_line)
        if not title and not tmdbid:
            return {"ok": False, "input": raw_line, "formatted": "", "error": "标题为空"}

        if tmdbid:
            verified = self.verify_existing_tmdbid(tmdbid, year)
            if verified:
                if year_label:
                    verified["year"] = year_label
                    verified["formatted"] = self.format_output(
                        verified["name"],
                        year_label,
                        verified["tmdbid"],
                        verified["region"],
                        extra_info,
                    )
                elif extra_info:
                    verified["formatted"] = self.format_output(
                        verified["name"],
                        verified["year"],
                        verified["tmdbid"],
                        verified["region"],
                        extra_info,
                    )
                verified["extra_info"] = extra_info
                verified["input"] = raw_line
                verified["clean_title"] = title
                return verified

        candidates = []
        for media_type in ["tv", "movie"]:
            results = self.search(title, year, media_type)
            best = self.pick_best(results, year, media_type)
            if best:
                candidates.append((media_type, best))

        if not candidates:
            display_year = year_label or year
            fallback = f"{title}（{display_year}）" if display_year else title
            if extra_info:
                fallback = f"{fallback} {extra_info}"
            return {
                "ok": False,
                "input": raw_line,
                "clean_title": title,
                "year": display_year or "",
                "extra_info": extra_info,
                "formatted": fallback,
                "error": "未匹配到 TMDB 结果",
            }

        media_type, best = candidates[0]
        detail = self.get_detail(best["id"], media_type)
        name, out_year = self.get_name_and_year(detail, media_type, year)
        if year_label:
            out_year = year_label
        region = self.classify_region(detail, media_type)
        result = self.build_result(name, out_year, best["id"], region, media_type, extra_info)
        result["input"] = raw_line
        result["clean_title"] = title
        return result

    def format_output(self, name, year, tmdbid, region, extra_info=""):
        formatted = f"{name}（{year}）[tmdbid={tmdbid}]"
        if extra_info:
            formatted = f"{formatted} {extra_info}"
        return f"{formatted} - {{{region}}}"


def format_lines(lines, settings):
    matcher = TMDBMatcher(settings)
    results = []
    for line in lines:
        raw_line = line.strip()
        if not raw_line:
            continue
        try:
            results.append(matcher.format_item(raw_line))
        except Exception as exc:
            title, year, _, year_label, extra_info = matcher.clean_title(raw_line)
            display_year = year_label or year
            fallback = f"{title}（{display_year}）" if display_year else title
            if extra_info:
                fallback = f"{fallback} {extra_info}"
            results.append({
                "ok": False,
                "input": raw_line,
                "clean_title": title,
                "year": display_year or "",
                "extra_info": extra_info,
                "formatted": fallback,
                "error": str(exc),
            })
    return results
