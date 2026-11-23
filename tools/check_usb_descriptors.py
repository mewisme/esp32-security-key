#!/usr/bin/env python3
"""Check the WebUSB landing page / BOS descriptors of the MultiKey firmware.

  python tools/check_usb_descriptors.py [--sdkconfig sdkconfig.fido-dev.generated]   # static, no hardware
  python tools/check_usb_descriptors.py --live [--vid 303A] [--pid 4002]              # read-only USB requests

Static mode validates the configured landing URL with the same rules as components/multikey_platform/CMakeLists.txt and
prints the BOS layout and the WebUSB URL descriptor the firmware is expected to produce.

--live opens the running device with pyusb (pip install pyusb libusb-package) and issues only standard/vendor *read*
requests: GET_DESCRIPTOR(BOS), WebUSB GET_URL and the Microsoft OS 2.0 descriptor-set request. It never writes, never
sends CTAP/MKAUTH and needs no button press. Exit 0 = every check passed, 1 = a check failed, 2 = cannot run.
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# tinyusb (managed_components/espressif__tinyusb/src/device/usbd.h)
BOS_HEADER_LEN = 5
BOS_WEBUSB_LEN = 24
BOS_MS_OS_20_LEN = 28
MS_OS_20_SET_LEN = 0xB2  # no NCM/LWIP on this firmware
WEBUSB_UUID = bytes.fromhex("38b60834a909a0478bfda0768815b665")  # 3408b638-09a9-47a0-8bfd-a0768815b665, wire order
MS_OS_20_UUID = bytes.fromhex("df60ddd88945c74c9cd2659d9e648a9f")  # D8DD60DF-4589-4CC7-9CD2-659D9E648A9F, wire order
VENDOR_REQUEST_WEBUSB = 1
VENDOR_REQUEST_MICROSOFT = 2
URL_MAX = 200
SCHEME = "https://"


class DescriptorError(ValueError):
    pass


def validate_url(url: str) -> str:
    """Return the part after https:// or raise DescriptorError (mirrors the CMake rules)."""
    if not url.startswith(SCHEME):
        raise DescriptorError("landing URL must start with https://")
    tail = url[len(SCHEME):]
    if not tail:
        raise DescriptorError("landing URL has no host")
    if not re.fullmatch(r"[!-~]+", tail):
        raise DescriptorError("landing URL must be printable ASCII without spaces (percent-encode the rest)")
    if len(tail) > URL_MAX:
        raise DescriptorError(f"landing URL too long ({len(tail)} > {URL_MAX} characters after https://)")
    return tail


def expected_url_descriptor(url: str) -> bytes:
    tail = validate_url(url)
    return bytes([3 + len(tail), 0x03, 0x01]) + tail.encode("ascii")


def expected_bos(webusb: bool) -> dict:
    total = BOS_HEADER_LEN + (BOS_WEBUSB_LEN if webusb else 0) + BOS_MS_OS_20_LEN
    return {"total_length": total, "caps": 2 if webusb else 1}


def parse_sdkconfig(text: str) -> dict:
    cfg = {}
    for line in text.splitlines():
        m = re.match(r'^(CONFIG_[A-Z0-9_]+)=(.*)$', line.strip())
        if m:
            v = m.group(2)
            cfg[m.group(1)] = v[1:-1] if v.startswith('"') and v.endswith('"') else v
    return cfg


def config_from_sdkconfig(cfg: dict) -> dict:
    enabled = cfg.get("CONFIG_MULTIKEY_WEBUSB_LANDING_ENABLED") == "y"
    out = {"enabled": enabled, "bos": expected_bos(enabled)}
    if enabled:
        url = cfg.get("CONFIG_MULTIKEY_WEBUSB_LANDING_URL")
        if url is None:
            raise DescriptorError("CONFIG_MULTIKEY_WEBUSB_LANDING_URL missing while the landing page is enabled")
        out["url"] = url
        out["url_descriptor"] = expected_url_descriptor(url)
    return out


def parse_bos(data: bytes) -> dict:
    """Parse a BOS descriptor into header fields and platform capabilities."""
    if len(data) < BOS_HEADER_LEN or data[0] != 5 or data[1] != 0x0F:
        raise DescriptorError("not a BOS descriptor")
    total = data[2] | (data[3] << 8)
    caps = []
    pos = BOS_HEADER_LEN
    while pos + 3 <= len(data):
        ln = data[pos]
        if ln < 3 or pos + ln > len(data):
            raise DescriptorError("malformed capability descriptor")
        cap = data[pos:pos + ln]
        if cap[1] == 0x10 and cap[2] == 0x05 and ln >= 20:
            caps.append({"uuid": bytes(cap[4:20]), "data": bytes(cap[20:])})
        else:
            caps.append({"uuid": None, "data": bytes(cap)})
        pos += ln
    return {"total_length": total, "declared_caps": data[4], "returned_len": len(data), "caps": caps}


def check_bos(bos: dict, want_webusb: bool, want_url: str | None = None) -> tuple[list, dict]:
    """Return (failures, facts) comparing a parsed BOS with the expectation."""
    fails = []
    facts = {}
    exp = expected_bos(want_webusb)
    if bos["total_length"] != bos["returned_len"]:
        fails.append(f"wTotalLength {bos['total_length']} != bytes returned {bos['returned_len']}")
    if bos["total_length"] != exp["total_length"]:
        fails.append(f"BOS length {bos['total_length']} != expected {exp['total_length']}")
    if bos["declared_caps"] != exp["caps"] or len(bos["caps"]) != exp["caps"]:
        fails.append(f"BOS caps declared {bos['declared_caps']} / found {len(bos['caps'])} != expected {exp['caps']}")
    by_uuid = {c["uuid"]: c["data"] for c in bos["caps"] if c["uuid"]}
    web = by_uuid.get(WEBUSB_UUID)
    if want_webusb:
        if web is None or len(web) != 4:
            fails.append("WebUSB capability missing")
        else:
            facts["webusb_vendor_code"] = web[2]
            facts["webusb_landing_page"] = web[3]
            if web[2] != VENDOR_REQUEST_WEBUSB or web[3] != 1:
                fails.append(f"WebUSB capability vendor code/iLandingPage = {web[2]}/{web[3]}, expected 1/1")
    elif web is not None:
        fails.append("WebUSB capability present but the landing page is disabled")
    ms = by_uuid.get(MS_OS_20_UUID)
    if ms is None or len(ms) != 8:
        fails.append("Microsoft OS 2.0 capability missing")
    else:
        set_len = ms[4] | (ms[5] << 8)
        facts["ms_os_20_length"] = set_len
        facts["ms_os_20_vendor_code"] = ms[6]
        if set_len != MS_OS_20_SET_LEN or ms[6] != VENDOR_REQUEST_MICROSOFT:
            fails.append(f"MS OS 2.0 capability length/vendor code = {set_len:#x}/{ms[6]}, expected {MS_OS_20_SET_LEN:#x}/2")
    return fails, facts


def static_mode(sdkconfig: Path) -> int:
    if not sdkconfig.is_file():
        print(f"{sdkconfig} not found (build first: python tools/build.py dev --app fido)", file=sys.stderr)
        return 2
    try:
        res = config_from_sdkconfig(parse_sdkconfig(sdkconfig.read_text(encoding="utf-8")))
    except DescriptorError as e:
        print(f"FAIL: {e}")
        return 1
    bos = res["bos"]
    if res["enabled"]:
        d = res["url_descriptor"]
        print(f"BOS total length {bos['total_length']}, caps {bos['caps']}, URL {res['url']} (descriptor length {d[0]})")
        print("expected WebUSB URL descriptor:", d.hex())
    else:
        print(f"BOS total length {bos['total_length']}, caps {bos['caps']} (WebUSB landing page disabled)")
    return 0


def live_mode(vid: int, pid: int) -> int:
    try:
        import usb.core
        import usb.util
        try:
            import libusb_package
            backend = libusb_package.get_libusb1_backend()
        except ImportError:
            backend = None
    except ImportError:
        print("pyusb missing: pip install pyusb libusb-package", file=sys.stderr)
        return 2
    dev = usb.core.find(idVendor=vid, idProduct=pid, backend=backend)
    if dev is None:
        print(f"device {vid:04X}:{pid:04X} not found (or libusb cannot open it)", file=sys.stderr)
        return 2
    fails = []
    try:
        raw = bytes(dev.ctrl_transfer(0x80, 6, 0x0F00, 0, 256, timeout=2000))
    except Exception as e:  # noqa: BLE001
        print(f"BLOCKED: GET_DESCRIPTOR(BOS) failed: {e}", file=sys.stderr)
        return 2
    bos = parse_bos(raw)
    # whether WebUSB is expected follows what the device itself advertises: caps must be self-consistent
    want_webusb = any(c["uuid"] == WEBUSB_UUID for c in bos["caps"])
    f, facts = check_bos(bos, want_webusb)
    fails += f
    print(f"BOS: {raw.hex()}")
    print(f"BOS total length {bos['total_length']}, caps {bos['declared_caps']}, facts {facts}")
    if want_webusb:
        try:
            url = bytes(dev.ctrl_transfer(0xC0, facts.get("webusb_vendor_code", 1), 1, 2, 255, timeout=2000))
        except Exception as e:  # noqa: BLE001
            fails.append(f"WebUSB GET_URL failed: {e}")
        else:
            print(f"WebUSB URL descriptor: {url.hex()}")
            if len(url) < 4 or url[0] != len(url) or url[1] != 3 or url[2] != 1:
                fails.append("WebUSB URL descriptor malformed")
            else:
                print("landing URL: https://" + url[3:].decode("ascii", "replace"))
            try:
                dev.ctrl_transfer(0xC0, facts.get("webusb_vendor_code", 1), 2, 2, 255, timeout=2000)
                fails.append("GET_URL with a wrong iLandingPage did not stall")
            except Exception:  # noqa: BLE001 - a stall is the required behavior
                pass
    try:
        ms = bytes(dev.ctrl_transfer(0xC0, facts.get("ms_os_20_vendor_code", 2), 0, 7, 512, timeout=2000))
        print(f"MS OS 2.0 set: {len(ms)} bytes")
        if len(ms) != MS_OS_20_SET_LEN:
            fails.append(f"MS OS 2.0 descriptor set is {len(ms)} bytes, expected {MS_OS_20_SET_LEN}")
    except Exception as e:  # noqa: BLE001
        fails.append(f"MS OS 2.0 request failed: {e}")
    for f in fails:
        print("FAIL:", f)
    print("PASS" if not fails else "FAIL")
    return 1 if fails else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sdkconfig", default=str(ROOT / "sdkconfig.fido-dev.generated"))
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--vid", default="303A")
    ap.add_argument("--pid", default="4002")
    a = ap.parse_args()
    if a.live:
        return live_mode(int(a.vid, 16), int(a.pid, 16))
    return static_mode(Path(a.sdkconfig))


if __name__ == "__main__":
    sys.exit(main())
