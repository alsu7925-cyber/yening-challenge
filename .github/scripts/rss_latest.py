# -*- coding: utf-8 -*-
"""예브 챌린지 — RSS 스냅샷(rss_latest.json) 생성기
================================================================
네이버 블로그 RSS(rss.blog.naver.com/{id}.xml)는 CORS 헤더가 없어서
브라우저가 직접 못 읽는다. 그래서 서버(여기·GitHub Actions)가 6곳을 긁어
JSON 으로 만들어 두고, 화면은 같은 출처의 그 파일을 읽는다(프록시·한도 없음).

출력 형식 (작게 유지하려고 items 는 [제목, 주소, KST시각] 배열)
{
  "generated_at": "2026-11-21T16:45:00+09:00",
  "generated_ts": 1763700300000,        // 브라우저가 나이(신선도)를 재는 값
  "blogs": { "ye_zib": {"name": "예지브러리", "items": [["제목","https://…","2026-11-21 15:55"], …]}, … },
  "failed": {"handle": "이유"}
}

사용:
  python3 rss_latest.py                              # state/rss_latest.json 로 저장
  python3 rss_latest.py --out docs/data/rss_latest.json
  python3 rss_latest.py --keep 30 --quiet
  python3 rss_latest.py --no-merge                   # 기존 파일과 합치지 않고 새로 쓴다

· 실패한 블로그가 있어도 기존 파일에 있던 그 블로그 항목은 그대로 남긴다(--merge 기본값).
  → Actions 가 잠깐 막혀도 화면이 빈 목록을 받지 않는다.
"""
import argparse
import email.utils
import json
import os
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone

KST = timezone(timedelta(hours=9))
HERE = os.path.dirname(os.path.abspath(__file__))

# 블로그를 새로 만들면 이 목록과 src/assets/app.js 의 상태(state.blogs)를 함께 손본다.
BLOGS = [
    ("ye_zib", "예지브러리"),
    ("pick_moa", "픽모아"),
    ("savedesk", "세이브데스크"),
    ("worddesk", "워드데스크"),
    ("mybodydesk", "내몸데스크"),
    ("spobriefing", "스포브리핑"),
]

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")


def url_key(u):
    """app.js 의 urlKey() 와 같은 규칙 — 쿼리·모바일 도메인 제거, https 통일"""
    s = str(u or "").strip().split("#")[0].split("?")[0]
    s = s.rstrip("/")
    if s.lower().startswith("http://"):
        s = "https://" + s[7:]
    low = s.lower()
    if low.startswith("https://m.blog.naver.com/"):
        s = "https://blog.naver.com/" + s[len("https://m.blog.naver.com/"):]
    return s


def kst_at(txt):
    """pubDate → 'YYYY-MM-DD HH:MM' (KST)"""
    try:
        dt = email.utils.parsedate_to_datetime(str(txt or "").strip())
    except Exception:
        return None
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=KST)
    return dt.astimezone(KST).strftime("%Y-%m-%d %H:%M")


def fetch_feed(handle, timeout=20, keep=30):
    url = "https://rss.blog.naver.com/%s.xml" % handle
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/xml,*/*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
    root = ET.fromstring(raw)
    ch = root.find("channel")
    if ch is None:
        raise ValueError("channel 없음")
    items = []
    for it in ch.findall("item"):
        title = " ".join((it.findtext("title") or "").split())
        link = it.findtext("guid") or it.findtext("link") or ""
        at = kst_at(it.findtext("pubDate") or it.findtext("{http://purl.org/dc/elements/1.1/}date"))
        u = url_key(link)
        if title and u and at:
            items.append([title, u, at])
    items.sort(key=lambda x: x[2])          # 오래된 것 → 최신
    return items[-keep:] if keep else items


def build(keep=30, merge_path=None, timeout=20, quiet=False):
    out = {"generated_at": datetime.now(KST).isoformat(timespec="seconds"),
           "generated_ts": int(time.time() * 1000),
           "blogs": {}, "failed": {}}

    old = {}
    if merge_path and os.path.exists(merge_path):
        try:
            with open(merge_path, encoding="utf-8") as f:
                prev = json.load(f)
            old = (prev or {}).get("blogs") or {}
        except Exception:
            old = {}

    for handle, name in BLOGS:
        try:
            items = fetch_feed(handle, timeout=timeout, keep=keep)
            if not items:
                raise ValueError("항목 0개")
            out["blogs"][handle] = {"name": name, "items": items}
            if not quiet:
                print("  %-12s %2d편  최신 %s" % (handle, len(items), items[-1][2]))
        except Exception as e:
            reason = "%s: %s" % (type(e).__name__, str(e)[:70])
            out["failed"][handle] = reason
            if not quiet:
                print("  %-12s 실패 — %s" % (handle, reason))
            prev = old.get(handle)
            if prev and prev.get("items"):
                out["blogs"][handle] = prev          # 지난 성공분 유지
                out.setdefault("kept_from_previous", []).append(handle)
    return out


def write_snapshot(dest, keep=30, timeout=15, quiet=True, merge_path=None):
    """build.py · deploy_static.py 가 부르는 함수 — 실패해도 예외를 올리지 않는다."""
    snap = build(keep=keep, timeout=timeout, quiet=quiet,
                 merge_path=merge_path if merge_path is not None else dest)
    os.makedirs(os.path.dirname(dest) or ".", exist_ok=True)
    tmp = dest + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, dest)
    if not quiet:
        total = sum(len(b.get("items") or []) for b in snap["blogs"].values())
        print("· rss_latest.json — %d곳 %d편 (실패 %d곳) → %s"
              % (len(snap["blogs"]), total, len(snap["failed"]), dest))
    return snap


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(HERE, "state", "rss_latest.json"))
    ap.add_argument("--keep", type=int, default=30)
    ap.add_argument("--timeout", type=int, default=20)
    ap.add_argument("--no-merge", action="store_true")
    ap.add_argument("--quiet", action="store_true")
    a = ap.parse_args()
    dest = a.out if os.path.isabs(a.out) else os.path.join(HERE, a.out)
    snap = write_snapshot(dest, keep=a.keep, timeout=a.timeout, quiet=a.quiet,
                          merge_path=None if a.no_merge else dest)
    total = sum(len(b.get("items") or []) for b in snap["blogs"].values())
    print("rss_latest.json — %d곳 %d편, 실패 %d곳 → %s"
          % (len(snap["blogs"]), total, len(snap["failed"]), dest))
    return 0 if len(snap["blogs"]) == len(BLOGS) else 1


if __name__ == "__main__":
    sys.exit(main())
