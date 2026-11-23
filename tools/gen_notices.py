#!/usr/bin/env python3
"""Write THIRD_PARTY_LICENSES.txt for the host tools from `cargo metadata --locked` (stdlib only).

  python tools/gen_notices.py [--manifest-path host/Cargo.toml] [--out THIRD_PARTY_LICENSES.txt]

Lists every non-workspace crate in the resolved dependency graph (all platforms) with version, SPDX license
expression and repository, sorted, plus the project's own AGPL notice. The text of each license is the one published by
the crate; this file is an inventory, not a replacement for those texts.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

HEADER = """multikey host tools - third-party notices

multikey is free software licensed under the GNU Affero General Public License, version 3 or (at your
option) any later version (see LICENSE). Source: https://github.com/mewisme/esp32-security-key
If you distribute these binaries, provide the corresponding source.

The binaries statically include the Rust crates below (name, version, license, repository). Each crate's own license
text is published with the crate on crates.io.

"""


def render_notices(metadata: dict) -> str:
    members = set(metadata.get("workspace_members", []))
    rows = []
    for p in metadata["packages"]:
        if p["id"] in members:
            continue
        lic = p.get("license") or (f"see {p['license_file']}" if p.get("license_file") else "UNKNOWN")
        rows.append((p["name"], p["version"], lic, p.get("repository") or p.get("homepage") or "-"))
    rows.sort(key=lambda r: (r[0].lower(), r[1]))
    lines = [f"{n} {v}\n    license: {lic}\n    source: {repo}" for n, v, lic, repo in rows]
    return HEADER + "\n".join(lines) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest-path", default=str(ROOT / "host" / "Cargo.toml"))
    ap.add_argument("--out", default=str(ROOT / "THIRD_PARTY_LICENSES.txt"))
    a = ap.parse_args()
    r = subprocess.run(["cargo", "metadata", "--locked", "--format-version", "1", "--manifest-path", a.manifest_path],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stderr, file=sys.stderr)
        return 1
    Path(a.out).write_text(render_notices(json.loads(r.stdout)), encoding="utf-8", newline="\n")
    print(f"wrote {a.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
