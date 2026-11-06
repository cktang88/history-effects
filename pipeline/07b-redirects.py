"""Step 7b helper: resolve proposed Wikipedia titles that are redirects.

Reads pipeline/out/coverage/titles.json (a list of titles) and writes
pipeline/out/coverage/redirects.json ({title: canonical title}) for those
that are redirects, using the dump index (title -> page id) and the
redirect table (page id -> target) already downloaded by 03a-dump.py.
"""

import bz2
import gzip
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, ".cache", "dump")
OUT = os.path.join(HERE, "out", "coverage")
ROW = re.compile(r"\((\d+),0,'((?:[^'\\]|\\.)*)',")


def main():
    with open(os.path.join(OUT, "titles.json")) as f:
        wanted = set(json.load(f))
    ids = {}
    with bz2.open(os.path.join(CACHE, "enwiki-latest-pages-articles-multistream-index.txt.bz2"), "rt", encoding="utf-8") as f:
        for line in f:
            _, pid, title = line.rstrip("\n").split(":", 2)
            if title in wanted:
                ids[int(pid)] = title
    targets = {}
    with gzip.open(os.path.join(CACHE, "enwiki-latest-redirect.sql.gz"), "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            for m in ROW.finditer(line):
                pid = int(m.group(1))
                if pid in ids:
                    raw = m.group(2).replace("\\'", "'").replace('\\"', '"').replace("\\\\", "\\")
                    targets[ids[pid]] = raw.replace("_", " ")
    with open(os.path.join(OUT, "redirects.json"), "w") as f:
        json.dump(targets, f)
    print(f"{len(ids)} of {len(wanted)} titles exist; {len(targets)} are redirects")


if __name__ == "__main__":
    main()
