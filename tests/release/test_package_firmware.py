import hashlib
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import package_firmware as pf  # noqa: E402

COMMIT = "a" * 40
SDKCONFIG = """CONFIG_IDF_TARGET="esp32s3"
CONFIG_IDF_INIT_VERSION="5.5.6"
CONFIG_ESPTOOLPY_FLASHSIZE_16MB=y
CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="partitions.csv"
CONFIG_MULTIKEY_BUTTON_GPIO=0
CONFIG_MULTIKEY_BUTTON_ACTIVE_LOW=y
CONFIG_MULTIKEY_LED_TYPE_NONE=y
CONFIG_MULTIKEY_USB_VID=0x303A
CONFIG_MULTIKEY_USB_PID=0x4002
CONFIG_MULTIKEY_WEBUSB_LANDING_ENABLED=y
CONFIG_MULTIKEY_WEBUSB_LANDING_URL="https://multikeys.mewis.me"
"""


def entry(label, typ, sub, off, size):
    return b"\xaa\x50" + bytes([typ, sub]) + off.to_bytes(4, "little") + size.to_bytes(4, "little") + \
        label.encode().ljust(16, b"\0") + (0).to_bytes(4, "little")


def ptable(part0_off=0x200000):
    t = entry("nvs", 1, 2, 0x11000, 0x6000) + entry("phy_init", 1, 1, 0x17000, 0x1000) + \
        entry("factory", 0, 0, 0x20000, 0x1E0000) + entry("part0", 0x40, 1, part0_off, 0x100000)
    return (t + b"\xeb\xeb" + b"\xff" * 30).ljust(0xC00, b"\xff")


def app_bin(version="0.2.0", project="multikey-fido"):
    desc = (0xABCD5432).to_bytes(4, "little") + b"\0" * 12 + version.encode().ljust(32, b"\0") + \
        project.encode().ljust(32, b"\0") + b"12:00:00".ljust(16, b"\0") + b"Nov 23 2026".ljust(16, b"\0") + \
        b"v5.5.6".ljust(32, b"\0")
    return (b"\xe9" + b"\0" * 31 + desc).ljust(0x9000, b"\x5a")


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.build = self.dir / "build"
        (self.build / "bootloader").mkdir(parents=True)
        (self.build / "partition_table").mkdir()
        (self.build / "bootloader" / "bootloader.bin").write_bytes(b"\xe9" + b"\x01" * 0x5000)
        (self.build / "partition_table" / "partition-table.bin").write_bytes(ptable())
        (self.build / "multikey-fido.bin").write_bytes(app_bin())
        self.flasher = {"flash_settings": {"flash_mode": "dio", "flash_size": "16MB", "flash_freq": "80m"},
                        "flash_files": {"0x0": "bootloader/bootloader.bin", "0x20000": "multikey-fido.bin",
                                        "0x8000": "partition_table/partition-table.bin"},
                        "extra_esptool_args": {"chip": "esp32s3"}}
        self.sdk = SDKCONFIG
        self.boards = self.dir / "boards"
        self.boards.mkdir()
        (self.boards / "esp32s3-n16r8-boot-button.board").write_text(
            "CONFIG_MULTIKEY_BUTTON_GPIO=0\nCONFIG_MULTIKEY_BUTTON_ACTIVE_LOW=y\n")

    def tearDown(self):
        self.tmp.cleanup()

    def package(self, version="0.2.0", app="fido", out="out", epoch=1700000000):
        (self.build / "flasher_args.json").write_text(json.dumps(self.flasher))
        sdk = self.dir / "sdkconfig"
        sdk.write_text(self.sdk)
        return pf.package(self.build, sdk, app, "esp32s3-n16r8-boot-button", version, COMMIT, self.dir / out, epoch,
                          boards_dir=self.boards)

    def rejects(self, fragment, **kw):
        with self.assertRaises(pf.PackageError) as cm:
            self.package(**kw)
        self.assertIn(fragment, str(cm.exception))


class Package(Base):
    def test_happy_path_digests_and_determinism(self):
        dest, e = self.package()
        self.assertEqual(dest.name, "multikey-firmware-v0.2.0-esp32s3-n16r8-fido-dev.zip")
        root = dest.name.removesuffix(".zip")
        with zipfile.ZipFile(dest) as z:
            self.assertEqual(sorted(z.namelist()), [f"{root}/{m}" for m in pf.member_names("fido")])
            for img in e["images"]:
                self.assertEqual(hashlib.sha256(z.read(f"{root}/{img['file']}")).hexdigest(), img["sha256"])
            fw = json.loads(z.read(f"{root}/firmware.json"))
            readme = z.read(f"{root}/README.txt").decode()
        self.assertEqual(fw, {k: v for k, v in e.items() if k != "package"})
        self.assertIn("0x0 bootloader.bin 0x8000 partition-table.bin 0x20000 multikey-fido.bin", readme)
        self.assertEqual([(i["role"], i["offset"]) for i in e["images"]],
                         [("bootloader", 0), ("partition-table", 0x8000), ("app", 0x20000)])
        self.assertEqual(e["usb"], {"vid": 0x303A, "pid": 0x4002, "webusb_landing_url": "https://multikeys.mewis.me"})
        self.assertEqual(e["package"]["sha256"], hashlib.sha256(dest.read_bytes()).hexdigest())
        dest2, _ = self.package(out="out2")
        self.assertEqual(dest.read_bytes(), dest2.read_bytes())

    def test_ci_pins_rejected(self):
        self.sdk += "CONFIG_MULTIKEY_ALLOW_UNSET_PINS_FOR_CI=y\n"
        self.rejects("CI-only image (--ci-pins) cannot be packaged")

    def test_unset_gpio_rejected(self):
        self.sdk = self.sdk.replace("CONFIG_MULTIKEY_BUTTON_GPIO=0", "CONFIG_MULTIKEY_BUTTON_GPIO=-1")
        self.rejects("CONFIG_MULTIKEY_BUTTON_GPIO")

    def test_wrong_target_rejected(self):
        self.flasher["extra_esptool_args"]["chip"] = "esp32"
        self.rejects("not esp32s3")

    def test_flash_size_rejected(self):
        self.flasher["flash_settings"]["flash_size"] = "8MB"
        self.rejects("flash size")

    def test_protected_overlap_rejected(self):
        self.flasher["flash_files"]["0x200000"] = "multikey-fido.bin"
        self.rejects("overlaps protected partition part0")

    def test_app_version_mismatch_rejected(self):
        self.rejects("app version is '0.2.0'", version="0.2.1")

    def test_wrong_project_rejected(self):
        (self.build / "multikey-fido.bin").write_bytes(app_bin(project="multikey-openpgp"))
        self.rejects("app project is 'multikey-openpgp'")

    def test_secure_boot_rejected(self):
        self.sdk += "CONFIG_SECURE_BOOT=y\n"
        self.rejects("Secure Boot")

    def test_old_landing_url_rejected(self):
        self.sdk = self.sdk.replace("https://multikeys.mewis.me", "https://github.com/mewisme/esp32-security-key")
        self.rejects("CONFIG_MULTIKEY_WEBUSB_LANDING_URL")

    def test_moved_part0_in_built_table_rejected(self):
        (self.build / "partition_table" / "partition-table.bin").write_bytes(ptable(part0_off=0x300000))
        self.rejects("does not match partitions.csv")


class ManifestAndVerify(Base):
    def make(self):
        dest, _ = self.package()
        man = pf.manifest([str(p) for p in (self.dir / "out").glob("*.entry.json")], "0.2.0", "v0.2.0", COMMIT)
        return dest, man

    def test_verify_ok(self):
        dest, man = self.make()
        self.assertEqual(man["builds"][0]["layout_id"], pf.layout_id(pf.fd.parse_partitions_csv(
            (ROOT / "partitions.csv").read_text())))
        self.assertEqual(len(pf.verify(dest, man)), 8)

    def test_flipped_byte_rejected(self):
        dest, man = self.make()
        b = bytearray(dest.read_bytes())
        b[len(b) // 2] ^= 1
        dest.write_bytes(bytes(b))
        with self.assertRaises(pf.PackageError):
            pf.verify(dest, man)

    def test_manifest_version_mismatch_rejected(self):
        self.package()
        with self.assertRaises(pf.PackageError) as cm:
            pf.manifest([str(p) for p in (self.dir / "out").glob("*.entry.json")], "0.2.1", "v0.2.1", COMMIT)
        self.assertIn("has version '0.2.0'", str(cm.exception))

    def test_manifest_requires_entries_and_matching_tag(self):
        with self.assertRaises(pf.PackageError):
            pf.manifest([], "0.2.0", "v0.2.0", COMMIT)
        self.package()
        with self.assertRaises(pf.PackageError):
            pf.manifest([str(p) for p in (self.dir / "out").glob("*.entry.json")], "0.2.0", "v0.3.0", COMMIT)


if __name__ == "__main__":
    unittest.main()
