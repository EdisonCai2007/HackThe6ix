"""Download Rebrickable's colors.csv into data/colors.csv.

Falls back to an embedded subset of common LEGO colors when offline, so the
pipeline never hard-depends on the network. Stdlib only.

Usage: python scripts/download_colors.py [dest_path]
"""
from __future__ import annotations

import gzip
import sys
import urllib.request
from pathlib import Path

CDN_URL = "https://cdn.rebrickable.com/media/downloads/colors.csv.gz"

# id,name,rgb,is_trans — subset of Rebrickable colors covering common bricks.
FALLBACK_CSV = """\
id,name,rgb,is_trans
0,Black,05131D,f
1,Blue,0055BF,f
2,Green,237841,f
3,Dark Turquoise,008F9B,f
4,Red,C91A09,f
5,Dark Pink,C870A0,f
6,Brown,583927,f
7,Light Gray,9BA19D,f
8,Dark Gray,6D6E5C,f
9,Light Blue,B4D2E3,f
14,Yellow,F2CD37,f
15,White,FFFFFF,f
19,Tan,E4CD9E,f
25,Orange,FE8A18,f
26,Magenta,923978,f
27,Lime,BBE90B,f
28,Dark Tan,958A73,f
29,Bright Pink,E4ADC8,f
70,Reddish Brown,582A12,f
71,Light Bluish Gray,A0A5A9,f
72,Dark Bluish Gray,6C6E68,f
84,Medium Nougat,AA7D55,f
272,Dark Blue,0A3463,f
288,Dark Green,184632,f
308,Dark Brown,352100,f
320,Dark Red,720E0F,f
321,Dark Azure,078BC9,f
322,Medium Azure,36AEBF,f
323,Light Aqua,ADC3C0,f
326,Yellowish Green,DFEEA5,f
378,Sand Green,A0BCAC,f
484,Dark Orange,A95500,f
"""


def download_colors(dest: Path) -> str:
    """Fetch colors.csv from Rebrickable's CDN; on any failure write the
    embedded fallback. Returns "cdn" or "fallback"."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        req = urllib.request.Request(CDN_URL, headers={"User-Agent": "lego-cv/0.1"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
        text = gzip.decompress(raw).decode("utf-8")
        if not text.startswith("id,"):
            raise ValueError(f"unexpected CSV header: {text[:40]!r}")
        dest.write_text(text)
        return "cdn"
    except Exception as exc:  # noqa: BLE001 — any failure means use fallback
        print(f"CDN download failed ({exc}); writing embedded fallback", file=sys.stderr)
        dest.write_text(FALLBACK_CSV)
        return "fallback"


if __name__ == "__main__":
    dest = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data/colors.csv")
    source = download_colors(dest)
    lines = dest.read_text().count("\n")
    print(f"wrote {dest} ({lines} rows, source: {source})")
