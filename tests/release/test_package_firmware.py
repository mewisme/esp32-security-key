import hashlib
import json
import re
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
CONFIG_ESPTOOLPY_FLASHMODE_QIO=y
CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="partitions.csv"
CONFIG_MULTIKEY_BUTTON_GPIO=0
CONFIG_MULTIKEY_BUTTON_ACTIVE_LOW=y
CONFIG_MULTIKEY_LED_TYPE_NONE=y
CONFIG_MULTIKEY_USB_VID=0x303A
CONFIG_MULTIKEY_USB_PID=0x4002
CONFIG_MULTIKEY_USB_PRODUCT_NAME="MultiKeys Security Key"
CONFIG_MULTIKEY_USB_CUSTOM_NAME_ENABLED=y
CONFIG_MULTIKEY_WEBUSB_LANDING_ENABLED=y
CONFIG_MULTIKEY_WEBUSB_LANDING_URL="https://multikeys.mewis.me"
"""
SIZE_NIBBLE = {"4MB": 2, "8MB": 3, "16MB": 4}
HW = {"4MB": "esp32s3-4mb", "8MB": "esp32s3-8mb", "16MB": "esp32s3-16mb"}


def entry(label, typ, sub, off, size):
    return b"\xaa\x50" + bytes([typ, sub]) + off.to_bytes(4, "little") + size.to_bytes(4, "little") + \
        label.encode().ljust(16, b"\0") + (0).to_bytes(4, "little")


def ptable(part0_off=0x200000):
    t = entry("nvs", 1, 2, 0x11000, 0x6000) + entry("phy_init", 1, 1, 0x17000, 0x1000) + \
        entry("factory", 0, 0, 0x20000, 0x1E0000) + entry("part0", 0x40, 1, part0_off, 0x100000)
    # ESP-IDF's end entry: magic, padding, MD5 of the entries before it
    return (t + b"\xeb\xeb" + b"\xff" * 14 + hashlib.md5(t).digest()).ljust(0xC00, b"\xff")


def image_header(flash_size="16MB", mode=2, freq=0xF):
    """e9, segment count, flash mode (2 = dio), flash size (high nibble) | frequency (low nibble, f = 80m)."""
    return bytes([0xE9, 3, mode, (SIZE_NIBBLE[flash_size] << 4) | freq])


def app_bin(version="0.2.0", project="multikey-fido", flash_size="16MB"):
    desc = (0xABCD5432).to_bytes(4, "little") + b"\0" * 12 + version.encode().ljust(32, b"\0") + \
        project.encode().ljust(32, b"\0") + b"12:00:00".ljust(16, b"\0") + b"Nov 23 2026".ljust(16, b"\0") + \
        b"v5.5.6".ljust(32, b"\0")
    return (image_header(flash_size) + b"\0" * 28 + desc).ljust(0x9000, b"\x5a")


def bootloader_bin(flash_size="16MB"):
    return image_header(flash_size) + b"\x01" * 0x5000


class Base(unittest.TestCase):
    hw = "esp32s3-16mb"

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)
        self.build = self.dir / "build"
        (self.build / "bootloader").mkdir(parents=True)
        (self.build / "partition_table").mkdir()
        (self.build / "partition_table" / "partition-table.bin").write_bytes(ptable())
        self.flasher = {"flash_settings": {"flash_mode": "dio", "flash_size": "16MB", "flash_freq": "80m"},
                        "flash_files": {"0x0": "bootloader/bootloader.bin", "0x20000": "multikey-fido.bin",
                                        "0x8000": "partition_table/partition-table.bin"},
                        "extra_esptool_args": {"chip": "esp32s3"}}
        self.sdk = SDKCONFIG
        self.app = "fido"
        self.use_flash_size("16MB")
        self.boards = self.dir / "boards"
        self.boards.mkdir()
        (self.boards / "esp32s3-boot-button.board").write_text(
            "CONFIG_MULTIKEY_BUTTON_GPIO=0\nCONFIG_MULTIKEY_BUTTON_ACTIVE_LOW=y\n")

    def tearDown(self):
        self.tmp.cleanup()

    def use_flash_size(self, size):
        """Make the fake build (flasher args, sdkconfig, both image headers) a `size` build and select its profile."""
        self.hw = HW[size]
        self.flasher["flash_settings"]["flash_size"] = size
        self.sdk = re.sub(r"CONFIG_ESPTOOLPY_FLASHSIZE_\d+MB=y", f"CONFIG_ESPTOOLPY_FLASHSIZE_{size}=y", self.sdk)
        (self.build / "bootloader" / "bootloader.bin").write_bytes(bootloader_bin(size))
        self.flash_size = size
        (self.build / f"multikey-{self.app}.bin").write_bytes(
            app_bin(project=f"multikey-{self.app}", flash_size=size))

    def use_app(self, app):
        """Make the fake build an `app` build (flasher args and app image name)."""
        self.app = app
        self.flasher["flash_files"]["0x20000"] = f"multikey-{app}.bin"
        (self.build / f"multikey-{app}.bin").write_bytes(app_bin(project=f"multikey-{app}", flash_size=self.flash_size))

    def package(self, version="0.2.0", app=None, out="out", epoch=1700000000):
        app = app or self.app
        (self.build / "flasher_args.json").write_text(json.dumps(self.flasher))
        sdk = self.dir / "sdkconfig"
        sdk.write_text(self.sdk, encoding="utf-8")
        return pf.package(self.build, sdk, app, self.hw, version, COMMIT, self.dir / out, epoch,
                          boards_dir=self.boards)

    def rejects(self, fragment, **kw):
        with self.assertRaises(pf.PackageError) as cm:
            self.package(**kw)
        self.assertIn(fragment, str(cm.exception))

    def entries(self, out="out"):
        return [str(p) for p in sorted((self.dir / out).glob("*.entry.json"))]


class Package(Base):
    def test_happy_path_digests_and_determinism(self):
        dest, e = self.package()
        self.assertEqual(dest.name, "multikey-firmware-v0.2.0-esp32s3-16mb-fido-dev.zip")
        self.assertEqual(pf.ASSET_RE.match(dest.name).groupdict(), {"version": "0.2.0", "hw": "16mb", "image": "fido"})
        root = dest.name.removesuffix(".zip")
        with zipfile.ZipFile(dest) as z:
            self.assertEqual(sorted(z.namelist()), [f"{root}/{m}" for m in pf.member_names("fido")])
            for img in e["images"]:
                self.assertEqual(hashlib.sha256(z.read(f"{root}/{img['file']}")).hexdigest(), img["sha256"])
            fw = json.loads(z.read(f"{root}/firmware.json"))
            readme = z.read(f"{root}/README.txt").decode()
        self.assertEqual(fw, {k: v for k, v in e.items() if k != "package"})
        self.assertIn("0x0 bootloader.bin 0x8000 partition-table.bin 0x20000 multikey-fido.bin", readme)
        self.assertIn("16MB quad-SPI flash", readme)
        self.assertEqual([(i["role"], i["offset"]) for i in e["images"]],
                         [("bootloader", 0), ("partition-table", 0x8000), ("app", 0x20000)])
        self.assertEqual(e["usb"], {"vid": 0x303A, "pid": 0x4002, "webusb_landing_url": "https://multikeys.mewis.me",
                                    "product_name": "MultiKeys Security Key", "custom_name": True})
        self.assertEqual(e["package"]["sha256"], hashlib.sha256(dest.read_bytes()).hexdigest())
        dest2, _ = self.package(out="out2")
        self.assertEqual(dest.read_bytes(), dest2.read_bytes())

    def test_entry_describes_the_profile(self):
        _, e = self.package()
        self.assertEqual(
            {k: e[k] for k in ("id", "profile_id", "board", "chip", "flash_size", "flash_mode", "flash_freq",
                               "flash_interface", "psram_required", "verification", "verified_hardware")},
            {"id": "esp32s3-16mb-fido-dev", "profile_id": "esp32s3-16mb", "board": "esp32s3-boot-button",
             "chip": "ESP32-S3", "flash_size": "16MB", "flash_mode": "dio", "flash_freq": "80m",
             "flash_interface": "quad", "psram_required": False, "verification": "hardware-verified",
             "verified_hardware": ["ESP32-S3 N16R8"]})
        self.assertEqual(e["partition_schema"], e["layout_id"])
        self.use_flash_size("4MB")
        _, e4 = self.package(out="out4")
        self.assertEqual((e4["id"], e4["profile_id"], e4["flash_size"], e4["verification"], e4["verified_hardware"]),
                         ("esp32s3-4mb-fido-dev", "esp32s3-4mb", "4MB", "build-verified", []))
        self.assertEqual(e4["layout_id"], e["layout_id"])  # one partition table for every flash size

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
        self.flasher["flash_settings"]["flash_size"] = "2MB"
        self.rejects("flash size")

    def test_profile_must_match_the_build_flash_size(self):
        self.hw = "esp32s3-4mb"  # a 16 MB build packaged as the 4 MB profile
        self.rejects("flash size")

    def test_flash_mode_and_frequency_must_match_the_profile(self):
        self.flasher["flash_settings"]["flash_freq"] = "40m"
        self.rejects("flash freq")

    def test_sdkconfig_must_select_the_profile_flash_size(self):
        self.use_flash_size("4MB")
        self.sdk = self.sdk.replace("CONFIG_ESPTOOLPY_FLASHSIZE_4MB=y", "CONFIG_ESPTOOLPY_FLASHSIZE_16MB=y")
        self.rejects("CONFIG_ESPTOOLPY_FLASHSIZE_4MB must be y")

    def test_unknown_profile_rejected(self):
        self.hw = "esp32s3-2mb"
        self.rejects("unknown hardware profile")

    def test_image_header_must_match_the_profile(self):
        self.use_flash_size("4MB")
        (self.build / "bootloader" / "bootloader.bin").write_bytes(bootloader_bin("16MB"))
        self.rejects("image header: bootloader: flash size is 16MB, profile esp32s3-4mb needs 4MB")

    def test_app_image_header_is_checked_too(self):
        (self.build / "multikey-fido.bin").write_bytes(app_bin(flash_size="8MB"))
        self.rejects("app: flash size is 8MB, profile esp32s3-16mb needs 16MB")

    def test_bad_image_magic_rejected(self):
        (self.build / "bootloader" / "bootloader.bin").write_bytes(b"\x00" * 0x5000)
        self.rejects("image header: bootloader: magic is 0x00")

    def test_invalid_default_device_name_rejected(self):
        self.sdk = self.sdk.replace('"MultiKeys Security Key"', '"Clé"')
        self.rejects("CONFIG_MULTIKEY_USB_PRODUCT_NAME")

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

    def test_entry_declares_app_only_for_the_real_layout(self):
        _, e = self.package()
        self.assertEqual(e["update"], {"data_preserving_from": pf.DATA_PRESERVING_FROM, "app_only": True})
        self.assertNotIn("update-unverified", e["install_modes"])

    def test_app_only_needs_the_app_inside_factory(self):
        parts = pf.fd.parse_partitions_csv((ROOT / "partitions.csv").read_text())
        factory = parts["factory"]
        self.assertTrue(pf.app_only_supported(parts, 0x20000, factory["size"]))
        self.assertFalse(pf.app_only_supported(parts, 0x20000, factory["size"] + 1))
        self.assertFalse(pf.app_only_supported(parts, 0x30000, 0x1000))
        self.assertFalse(pf.app_only_supported({k: v for k, v in parts.items() if k != "factory"}, 0x20000, 0x1000))

    def test_version_older_than_data_preserving_from_rejected(self):
        (self.build / "multikey-fido.bin").write_bytes(app_bin(version="0.1.0"))
        self.rejects("older than DATA_PRESERVING_FROM", version="0.1.0")


class ManifestAndVerify(Base):
    def make(self):
        dest, _ = self.package()
        man = pf.manifest(self.entries(), "0.2.0", "v0.2.0", COMMIT)
        return dest, man

    def package_all(self, apps=("fido",), sizes=("4MB", "8MB", "16MB")):
        zips = []
        for app in apps:
            self.use_app(app)
            for size in sizes:
                self.use_flash_size(size)
                zips.append(self.package()[0])
        return zips

    def test_verify_ok(self):
        dest, man = self.make()
        self.assertEqual(man["builds"][0]["layout_id"], pf.layout_id(pf.fd.parse_partitions_csv(
            (ROOT / "partitions.csv").read_text())))
        self.assertEqual(len(pf.verify(dest, man)), 8)

    def test_forged_app_only_is_rejected(self):
        dest, man = self.make()
        man["builds"][0]["update"]["app_only"] = False
        with self.assertRaises(pf.PackageError):
            pf.verify(dest, man)

    def test_manifest_is_schema_2_with_profile_ids(self):
        zips = self.package_all(apps=("fido", "openpgp"))
        man = pf.manifest(self.entries(), "0.2.0", "v0.2.0", COMMIT, require_release_profiles=True)
        self.assertEqual(man["schema_version"], 2)
        self.assertEqual([(b["image"], b["profile_id"]) for b in man["builds"]],
                         [(i, p) for p in ("esp32s3-16mb", "esp32s3-4mb", "esp32s3-8mb") for i in ("fido", "openpgp")])
        for z in zips:
            self.assertEqual(len(pf.verify(z, man)), 8)

    def test_openpgp_is_build_verified_even_on_a_hardware_verified_profile(self):
        self.package_all(apps=("fido", "openpgp"), sizes=("16MB",))
        by_image = {b["image"]: b for b in pf.manifest(self.entries(), "0.2.0", "v0.2.0", COMMIT)["builds"]}
        self.assertEqual((by_image["fido"]["verification"], by_image["fido"]["verified_hardware"]),
                         ("hardware-verified", ["ESP32-S3 N16R8"]))
        self.assertEqual((by_image["openpgp"]["verification"], by_image["openpgp"]["verified_hardware"]),
                         ("build-verified", []))
        self.assertIn("Experimental", by_image["openpgp"]["title"])

    def test_release_profiles_are_required_on_request(self):
        self.package()  # only the 16 MB build
        pf.manifest(self.entries(), "0.2.0", "v0.2.0", COMMIT)  # fine for a local/CI dev bundle
        with self.assertRaises(pf.PackageError) as cm:
            pf.manifest(self.entries(), "0.2.0", "v0.2.0", COMMIT, require_release_profiles=True)
        self.assertIn("no fido build for release profile(s) esp32s3-4mb, esp32s3-8mb", str(cm.exception))

    def test_every_image_is_required_for_a_release(self):
        self.package_all(apps=("fido",))
        with self.assertRaises(pf.PackageError) as cm:
            pf.manifest(self.entries(), "0.2.0", "v0.2.0", COMMIT, require_release_profiles=True)
        self.assertIn("no openpgp build for release profile(s) esp32s3-16mb, esp32s3-4mb, esp32s3-8mb",
                      str(cm.exception))

    def test_non_release_profile_is_not_required(self):
        original = pf.fd.PROFILES["esp32s3-4mb"]
        pf.fd.PROFILES["esp32s3-4mb"] = dict(original, release=False)
        self.addCleanup(pf.fd.PROFILES.__setitem__, "esp32s3-4mb", original)
        self.package_all(apps=("fido", "openpgp"), sizes=("8MB", "16MB"))
        pf.manifest(self.entries(), "0.2.0", "v0.2.0", COMMIT, require_release_profiles=True)

    def test_duplicate_image_and_profile_rejected(self):
        self.package()
        paths = self.entries()
        with self.assertRaises(pf.PackageError) as cm:
            pf.manifest(paths + paths, "0.2.0", "v0.2.0", COMMIT)
        self.assertIn("duplicate build ids", str(cm.exception))

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
            pf.manifest(self.entries(), "0.2.1", "v0.2.1", COMMIT)
        self.assertIn("has version '0.2.0'", str(cm.exception))

    def test_manifest_requires_entries_and_matching_tag(self):
        with self.assertRaises(pf.PackageError):
            pf.manifest([], "0.2.0", "v0.2.0", COMMIT)
        self.package()
        with self.assertRaises(pf.PackageError):
            pf.manifest(self.entries(), "0.2.0", "v0.3.0", COMMIT)


if __name__ == "__main__":
    unittest.main()
