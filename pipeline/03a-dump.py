"""Step 3a: fetch the wikitext of our articles from the Wikipedia dump.

The Wikipedia API rate-limits shared IPs, so instead we use the official
multistream dump: its index maps every title to the byte offset of a small
bz2 stream (~100 pages), so we range-request only the streams we need
(~1 GB instead of 27 GB). Redirects come from the redirect table dump.

Output: pipeline/out/dump/articles.jsonl.gz  ({"title", "wikitext"} per line)
        pipeline/out/dump/redirects.json      ({target title: [redirect titles]})
"""

import bz2
import gzip
import html
import json
import os
import re
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache", "dump")
OUT = os.path.join(HERE, "out", "dump")
BASE = "https://dumps.wikimedia.org/enwiki/latest/"
UA = "history-effects-pipeline/0.1 (https://github.com/cktang88/history-effects)"
INDEX = "enwiki-latest-pages-articles-multistream-index.txt.bz2"
DUMP = "enwiki-latest-pages-articles-multistream.xml.bz2"
REDIRECTS = "enwiki-latest-redirect.sql.gz"


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def request(url, start=None, end=None, attempts=8):
    for attempt in range(attempts):
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        if start is not None:
            req.add_header("Range", f"bytes={start}-{end}")
        try:
            with urllib.request.urlopen(req, timeout=120) as res:
                return res.read()
        except Exception as e:  # network hiccups and 503s: back off and retry
            log(f"retry {attempt + 1} {url[-60:]} {e}")
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"failed {url}")


def download(name):
    path = os.path.join(CACHE, name)
    if os.path.exists(path):
        return path
    os.makedirs(CACHE, exist_ok=True)
    log(f"downloading {name}")
    tmp = path + ".part"
    req = urllib.request.Request(BASE + name, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=300) as res, open(tmp, "wb") as f:
        while True:
            block = res.read(1 << 20)
            if not block:
                break
            f.write(block)
    os.rename(tmp, path)
    return path


def key(title):
    return title.replace("_", " ")


def wanted_titles():
    with open(os.path.join(HERE, "out", "entities.raw.json")) as f:
        return {e["article"] for e in json.load(f) if e.get("article")}


ROW = re.compile(r"\((\d+),0,'((?:[^'\\]|\\.)*)',")


def redirect_sources(targets):
    """page id of each redirect (namespace 0) that points at one of our titles."""
    by_id = {}
    with gzip.open(download(REDIRECTS), "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            # Rows may share the INSERT line or follow it one per line.
            for m in ROW.finditer(line):
                raw = m.group(2).replace("\\'", "'").replace('\\"', '"').replace("\\\\", "\\")
                target = key(raw)
                if target in targets:
                    by_id[int(m.group(1))] = target
    return by_id


def scan_index(titles, redirect_ids):
    """title → stream offset for our titles, redirect id → title, and all offsets."""
    offset_of, redirect_title, offsets = {}, {}, set()
    with bz2.open(download(INDEX), "rt", encoding="utf-8") as f:
        for line in f:
            off, pid, title = line.rstrip("\n").split(":", 2)
            off = int(off)
            offsets.add(off)
            if title in titles:
                offset_of[title] = off
            pid = int(pid)
            if pid in redirect_ids:
                redirect_title[pid] = title
    return offset_of, redirect_title, sorted(offsets)


PAGE = re.compile(r"<page>.*?<title>(.*?)</title>.*?<text[^>]*>(.*?)</text>", re.S)


def main():
    os.makedirs(OUT, exist_ok=True)
    titles = wanted_titles()
    log(f"{len(titles)} articles wanted")

    redirect_ids = redirect_sources(titles)
    log(f"{len(redirect_ids)} redirects point at them")
    offset_of, redirect_title, offsets = scan_index(titles, redirect_ids)
    log(f"{len(offset_of)} found in index, {len(offsets)} streams in dump")

    redirects = {}
    for pid, target in redirect_ids.items():
        if pid in redirect_title:
            redirects.setdefault(target, []).append(redirect_title[pid])
    with open(os.path.join(OUT, "redirects.json"), "w") as f:
        json.dump(redirects, f)

    import bisect

    out_path = os.path.join(OUT, "articles.jsonl.gz")
    done = set()
    if os.path.exists(out_path):
        try:
            with gzip.open(out_path, "rt") as f:
                done = {json.loads(l)["title"] for l in f}
        except (EOFError, OSError):
            done = set()
    streams = sorted({off for t, off in offset_of.items() if t not in done})
    log(f"{len(done)} already fetched, {len(streams)} streams to fetch")

    lock = threading.Lock()
    out = gzip.open(out_path, "at")
    count = [0, 0]

    def fetch(start):
        i = bisect.bisect_right(offsets, start)
        end = offsets[i] - 1 if i < len(offsets) else ""
        raw = request(BASE + DUMP, start, end)
        xml = bz2.decompress(raw).decode("utf-8", errors="replace")
        rows = []
        for m in PAGE.finditer(xml):
            title = html.unescape(m.group(1))
            if title in titles and title not in done:
                rows.append(json.dumps({"title": title, "wikitext": html.unescape(m.group(2))}))
        with lock:
            for r in rows:
                out.write(r + "\n")
            count[0] += 1
            count[1] += len(raw)
            if count[0] % 200 == 0:
                log(f"streams {count[0]}/{len(streams)} ({count[1] >> 20} MB)")

    with ThreadPoolExecutor(max_workers=3) as pool:
        list(pool.map(fetch, streams))
    out.close()
    log("dump extraction done")


if __name__ == "__main__":
    main()
