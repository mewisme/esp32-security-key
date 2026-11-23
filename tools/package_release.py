#!/usr/bin/env python3
"""Build a deterministic release archive for the host tools (stdlib only).

  python tools/package_release.py --kind cli --os windows --arch x86_64 --version 0.1.0 \
      --binary host/target/release/multikey.exe --out dist --source-date-epoch 1700000000

Assets (names are part of the release contract, docs/RELEASES.md):
  multikey-v<ver>-windows-x86_64.zip        kind=cli os=windows
  multikey-v<ver>-linux-x86_64.tar.gz       kind=cli os=linux
  multikey-pam-v<ver>-linux-x86_64.tar.gz   kind=pam os=linux (libpam_multikey.so is shipped as pam_multikey.so)

Each archive has one root directory with exactly: the binary, LICENSE, THIRD_PARTY_LICENSES.txt and README.txt. Entries
are sorted, mtimes are SOURCE_DATE_EPOCH, owners are 0, so the same inputs give the same bytes. No firmware, keys, logs
or configuration is ever added: the member list is asserted against the expected set.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import re
import sys
import tarfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

FORBIDDEN = re.compile(r"\.(pem|key|log|bin|elf|toml)$|^sdkconfig", re.I)


class PackageError(Exception):
    pass


def asset_name(kind: str, version: str, os_name: str, arch: str) -> str:
    if kind == "cli":
        base = f"multikey-v{version}-{os_name}-{arch}"
    elif kind == "pam":
        base = f"multikey-pam-v{version}-{os_name}-{arch}"
    else:
        raise PackageError(f"unknown kind {kind!r}")
    if os_name == "windows":
        if kind != "cli":
            raise PackageError("the PAM module is Linux only")
        return base + ".zip"
    if os_name == "linux":
        return base + ".tar.gz"
    raise PackageError(f"unsupported os {os_name!r}")


def members_for(kind: str, os_name: str) -> dict:
    """archive-relative name -> (mode, role)"""
    if kind == "cli":
        exe = "multikey.exe" if os_name == "windows" else "multikey"
        mode = 0o755
    else:
        exe, mode = "pam_multikey.so", 0o644
    return {exe: (mode, "binary"), "LICENSE": (0o644, "license"),
            "THIRD_PARTY_LICENSES.txt": (0o644, "notices"), "README.txt": (0o644, "readme")}


def build_archive(out_dir: Path, kind: str, version: str, os_name: str, arch: str, files: dict, epoch: int) -> Path:
    """files: role -> source path (binary, license, notices, readme)."""
    if not re.fullmatch(r"\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?", version):
        raise PackageError(f"bad version {version!r}")
    name = asset_name(kind, version, os_name, arch)
    root = name.removesuffix(".zip").removesuffix(".tar.gz")
    layout = members_for(kind, os_name)
    for member in layout:
        if FORBIDDEN.search(member):
            raise PackageError(f"forbidden file name {member}")
    data = {}
    for member, (mode, role) in layout.items():
        src = Path(files[role])
        if not src.is_file():
            raise PackageError(f"missing {role}: {src}")
        data[member] = (mode, src.read_bytes())
    out_dir.mkdir(parents=True, exist_ok=True)
    dest = out_dir / name
    if os_name == "windows":
        # ZIP cannot represent dates before 1980.
        ts = max(epoch, 315532800)
        import time
        dt = time.gmtime(ts)[:6]
        with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
            for member in sorted(data):
                mode, blob = data[member]
                zi = zipfile.ZipInfo(f"{root}/{member}", date_time=dt)
                zi.compress_type = zipfile.ZIP_DEFLATED
                zi.external_attr = (0o100000 | mode) << 16
                zi.create_system = 3
                z.writestr(zi, blob, compresslevel=9)
    else:
        raw = io.BytesIO()
        with tarfile.open(fileobj=raw, mode="w", format=tarfile.PAX_FORMAT) as t:
            d = tarfile.TarInfo(root + "/")
            d.type, d.mode, d.mtime, d.uid, d.gid, d.uname, d.gname = tarfile.DIRTYPE, 0o755, epoch, 0, 0, "", ""
            t.addfile(d)
            for member in sorted(data):
                mode, blob = data[member]
                ti = tarfile.TarInfo(f"{root}/{member}")
                ti.size, ti.mode, ti.mtime, ti.uid, ti.gid, ti.uname, ti.gname = len(blob), mode, epoch, 0, 0, "", ""
                t.addfile(ti, io.BytesIO(blob))
        with open(dest, "wb") as f:
            with gzip.GzipFile(filename="", mode="wb", fileobj=f, mtime=epoch, compresslevel=9) as gz:
                gz.write(raw.getvalue())
    verify_archive(dest, kind, os_name, root)
    return dest


def verify_archive(path: Path, kind: str, os_name: str, root: str) -> list:
    """Assert the member list equals the expected set exactly; returns the names."""
    expected = {f"{root}/{m}" for m in members_for(kind, os_name)}
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as z:
            names = set(z.namelist())
    else:
        with tarfile.open(path, "r:gz") as t:
            names = {m.name for m in t.getmembers() if not m.isdir()}
    if names != expected:
        raise PackageError(f"unexpected members: extra {sorted(names - expected)}, missing {sorted(expected - names)}")
    for n in names:
        if FORBIDDEN.search(Path(n).name):
            raise PackageError(f"forbidden file in archive: {n}")
    return sorted(names)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--kind", choices=["cli", "pam"], required=True)
    ap.add_argument("--version", required=True)
    ap.add_argument("--os", dest="os_name", choices=["windows", "linux"], required=True)
    ap.add_argument("--arch", default="x86_64")
    ap.add_argument("--binary", required=True, help="multikey(.exe) or libpam_multikey.so")
    ap.add_argument("--out", default="dist")
    ap.add_argument("--source-date-epoch", type=int, default=0)
    ap.add_argument("--license", default=str(ROOT / "LICENSE"))
    ap.add_argument("--notices", default=str(ROOT / "THIRD_PARTY_LICENSES.txt"))
    ap.add_argument("--readme")
    a = ap.parse_args()
    readme = a.readme or str(ROOT / "packaging" / ("README-pam.txt" if a.kind == "pam" else
                                                    f"README-{a.os_name}.txt"))
    try:
        dest = build_archive(Path(a.out), a.kind, a.version, a.os_name, a.arch,
                             {"binary": a.binary, "license": a.license, "notices": a.notices, "readme": readme},
                             a.source_date_epoch)
    except PackageError as e:
        print(f"error: {e}", file=sys.stderr)
        return 1
    print(f"{dest}  sha256={sha256(dest)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
