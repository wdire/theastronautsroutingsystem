"""Provenance for every dataset Areo uses.

add_source() writes one file per dataset to tools/sources.d/<id>.json, so tools
that run side by side never fight over one file.

    python tools/sources.py --merge

builds public/data/sources.json from every file in tools/sources.d, sorted by id.

    python tools/sources.py --merge --docs

also writes docs/data-sources.md from it.
"""

from __future__ import annotations

import datetime
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SOURCES_D = ROOT / "tools" / "sources.d"
MERGED = ROOT / "public" / "data" / "sources.json"

FIELDS = ("id", "name", "mission", "product", "url", "licence", "notes", "retrieved")


def today() -> str:
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d")


def add_source(
    id: str,
    name: str,
    mission: str,
    product: str,
    url: str,
    licence: str,
    notes: str,
    retrieved: str | None = None,
) -> dict:
    """Record a dataset. Returns the entry written to tools/sources.d/<id>.json."""
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", id):
        raise ValueError(f"source id must be lower-case letters, digits and dashes: {id!r}")
    entry = {
        "id": id,
        "name": name,
        "mission": mission,
        "product": product,
        "url": url,
        "licence": licence,
        "notes": notes,
        "retrieved": retrieved or today(),
    }
    SOURCES_D.mkdir(parents=True, exist_ok=True)
    path = SOURCES_D / f"{id}.json"
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(entry, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)
    return entry


def merge() -> list[dict]:
    """Build public/data/sources.json from tools/sources.d/*.json, sorted by id."""
    entries = []
    for path in sorted(SOURCES_D.glob("*.json")):
        entry = json.loads(path.read_text(encoding="utf-8"))
        missing = [f for f in FIELDS if not str(entry.get(f, "")).strip()]
        if missing:
            raise ValueError(f"{path.name}: missing {', '.join(missing)}")
        if entry["id"] != path.stem:
            raise ValueError(f"{path.name}: id {entry['id']!r} does not match the file name")
        entries.append({f: entry[f] for f in FIELDS})
    entries.sort(key=lambda e: e["id"])
    MERGED.parent.mkdir(parents=True, exist_ok=True)
    MERGED.write_text(json.dumps(entries, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return entries


DOCS = ROOT / "docs" / "data-sources.md"


def write_docs(entries: list[dict]) -> None:
    """docs/data-sources.md: a table of every dataset, then its notes, ordered by name."""
    rows = sorted(entries, key=lambda e: e["name"].lower())
    cell = lambda v: str(v).replace("|", "\\|").replace("\n", " ")
    lines = [
        "# Data sources",
        "",
        "Every dataset in the app, where it came from and under what terms. This file is generated from",
        "`public/data/sources.json`, which the tools under `tools/` write as they fetch each product",
        "(`python tools/sources.py --merge --docs`).",
        "",
        "| Dataset | Mission | Product | Licence | Retrieved |",
        "|---|---|---|---|---|",
    ]
    lines += [f"| [{cell(e['name'])}]({e['url']}) | {cell(e['mission'])} | {cell(e['product'])} | {cell(e['licence'])} | {e['retrieved']} |" for e in rows]
    lines += ["", "## Notes", ""]
    lines += [f"- **{e['name']}.** {e['notes']}" for e in rows]
    DOCS.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    if "--merge" in sys.argv[1:]:
        merged = merge()
        print(f"wrote {MERGED.relative_to(ROOT)}: {len(merged)} sources")
        for e in merged:
            print(f"  {e['id']}: {e['name']}")
        if "--docs" in sys.argv[1:]:
            write_docs(merged)
            print(f"wrote {DOCS.relative_to(ROOT)}")
    else:
        print(__doc__)
