import json
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import flash_dev as fd  # noqa: E402

PARTS = fd.parse_partitions_csv((ROOT / "partitions.csv").read_text())


def entry(label, typ, sub, off, size):
    return b"\xaa\x50" + bytes([typ, sub]) + off.to_bytes(4, "little") + size.to_bytes(4, "little") + \
        label.encode().ljust(16, b"\0") + (0).to_bytes(4, "little")


def table(part0=(0x200000, 0x100000), nvs=(0x11000, 0x6000), phy=(0x17000, 0x1000), end=True):
    t = entry("nvs", 1, 2, *nvs) + entry("phy_init", 1, 1, *phy) + entry("factory", 0, 0, 0x20000, 0x1E0000) + \
        entry("part0", 0x40, 1, *part0)
    if end:
        t += b"\xeb\xeb" + b"\xff" * 30
    return t.ljust(fd.PARTITION_TABLE_LEN, b"\xff")


GOOD_IMAGES = [(0x0, "bootloader/bootloader.bin"), (0x20000, "multikey-fido.bin"),
               (0x8000, "partition_table/partition-table.bin")]
GOOD_SIZES = {"bootloader/bootloader.bin": 0x5000, "multikey-fido.bin": 0x980E0,
              "partition_table/partition-table.bin": 0xC00}


class Partitions(unittest.TestCase):
    def test_repo_csv(self):
        self.assertEqual(PARTS["part0"]["offset"], 0x200000)
        self.assertEqual(PARTS["part0"]["size"], 0x100000)
        self.assertEqual(PARTS["nvs"]["offset"], 0x11000)

    def test_sizes(self):
        self.assertEqual(fd.parse_size("1M"), 1048576)
        self.assertEqual(fd.parse_size("0x6000"), 0x6000)
        with self.assertRaises(ValueError):
            fd.parse_size("big")


class FlashArgs(unittest.TestCase):
    def test_parse_real_file(self):
        txt = "--flash_mode dio --flash_freq 80m --flash_size 16MB\n0x0 bootloader/bootloader.bin\n" \
              "0x20000 multikey-fido.bin\n0x8000 partition_table/partition-table.bin\n"
        opts, images = fd.parse_flash_args(txt)
        self.assertEqual(len(images), 3)
        self.assertIn("--flash_size", opts)

    def test_good_layout(self):
        self.assertEqual(fd.check_images(GOOD_IMAGES, GOOD_SIZES, PARTS), [])

    def test_extra_offset_into_part0_rejected(self):
        imgs = GOOD_IMAGES + [(0x200000, "fs.bin")]
        self.assertTrue(fd.check_images(imgs, {**GOOD_SIZES, "fs.bin": 100}, PARTS))

    def test_missing_bootloader_rejected(self):
        imgs = [i for i in GOOD_IMAGES if i[0] != 0]
        self.assertTrue(fd.check_images(imgs, GOOD_SIZES, PARTS))

    def test_oversized_app_overlaps_nothing_but_exceeds_factory(self):
        sizes = {**GOOD_SIZES, "multikey-fido.bin": 0x1F0000}
        self.assertTrue(any("larger than the factory" in p for p in fd.check_images(GOOD_IMAGES, sizes, PARTS)))

    def test_image_overlapping_nvs_rejected(self):
        imgs = [(0x0, "bootloader/bootloader.bin"), (0x8000, "partition_table/partition-table.bin"),
                (0x20000, "multikey-fido.bin")]
        sizes = {**GOOD_SIZES, "bootloader/bootloader.bin": 0x12000}
        self.assertTrue(fd.check_images(imgs, sizes, PARTS))

    def test_bad_line_rejected(self):
        with self.assertRaises(ValueError):
            fd.parse_flash_args("erase everything\n")


class DeviceTable(unittest.TestCase):
    def test_blank(self):
        self.assertEqual(fd.parse_device_table(b"\xff" * 0xC00, PARTS)[0], "blank")

    def test_match(self):
        self.assertEqual(fd.parse_device_table(table(), PARTS)[0], "match")

    def test_moved_part0(self):
        st, detail = fd.parse_device_table(table(part0=(0x300000, 0x100000)), PARTS)
        self.assertEqual(st, "mismatch")
        self.assertIn("part0", detail)

    def test_resized_nvs(self):
        self.assertEqual(fd.parse_device_table(table(nvs=(0x11000, 0x8000)), PARTS)[0], "mismatch")

    def test_garbage(self):
        self.assertEqual(fd.parse_device_table(bytes(range(256)) * 12, PARTS)[0], "garbage")

    def test_unterminated(self):
        self.assertEqual(fd.parse_device_table(table(end=False)[:128], PARTS)[0], "garbage")

    def test_empty_read(self):
        self.assertEqual(fd.parse_device_table(b"", PARTS)[0], "garbage")

    def test_only_blank_and_match_allow_flash(self):
        for blob, ok in ((b"\xff" * 0xC00, True), (table(), True), (table(part0=(0x300000, 0x100000)), False),
                         (bytes(range(256)) * 12, False)):
            self.assertEqual(fd.parse_device_table(blob, PARTS)[0] in ("blank", "match"), ok)


class Ports(unittest.TestCase):
    NATIVE = {"com": "COM6", "vid": 0x303A, "pid": 0x1001, "name": "USB Serial Device (COM6)"}
    CH340 = {"com": "COM3", "vid": 0x1A86, "pid": 0x7523, "name": "USB-SERIAL CH340 (COM3)"}
    BT = {"com": "COM9", "vid": 0x0000, "pid": 0x0000, "name": "Standard Serial over Bluetooth link (COM9)"}

    def test_classification(self):
        self.assertEqual(fd.classify_port(0x303A, 0x1001), "native-download")
        self.assertEqual(fd.classify_port(0x1A86, 0x7523), "uart-bridge")
        self.assertEqual(fd.classify_port(0x0000, 0x0000), "ignore")
        self.assertEqual(fd.classify_port(0x303A, 0x4002), "ignore")

    def test_auto_picks_single_native(self):
        self.assertEqual(fd.select_port([self.BT, self.NATIVE, self.CH340], None, False)[:2], ("COM6", 0))

    def test_auto_never_picks_uart_bridge(self):
        port, code, _ = fd.select_port([self.CH340], None, False)
        self.assertIsNone(port)
        self.assertEqual(code, fd.EXIT_DEVICE)

    def test_two_native_ports_ambiguous(self):
        other = {**self.NATIVE, "com": "COM7"}
        port, code, msg = fd.select_port([self.NATIVE, other], None, False)
        self.assertIsNone(port)
        self.assertIn("-Port", msg)

    def test_running_firmware_gives_download_instructions(self):
        _, code, msg = fd.select_port([], None, True)
        self.assertEqual(code, fd.EXIT_DEVICE)
        self.assertIn("BOOT", msg)

    def test_explicit_port_must_exist(self):
        port, code, msg = fd.select_port([self.NATIVE], "COM99", False)
        self.assertIsNone(port)
        self.assertIn("COM6", msg)

    def test_explicit_uart_port_allowed(self):
        self.assertEqual(fd.select_port([self.CH340], "com3", False)[:2], ("COM3", 0))


GOOD_CFG = {"CONFIG_IDF_TARGET": "esp32s3", "CONFIG_MULTIKEY_BUTTON_GPIO": "0"}


class SdkConfig(unittest.TestCase):
    def test_ok(self):
        self.assertEqual(fd.check_sdkconfig(GOOD_CFG), [])

    def test_rejects_ci_pins(self):
        self.assertTrue(fd.check_sdkconfig({**GOOD_CFG, "CONFIG_MULTIKEY_ALLOW_UNSET_PINS_FOR_CI": "y"}))

    def test_rejects_unset_gpio(self):
        self.assertTrue(fd.check_sdkconfig({"CONFIG_IDF_TARGET": "esp32s3"}))
        self.assertTrue(fd.check_sdkconfig({**GOOD_CFG, "CONFIG_MULTIKEY_BUTTON_GPIO": "-1"}))

    def test_rejects_secure_boot_and_flash_encryption_and_efuse(self):
        for k in ("CONFIG_SECURE_BOOT", "CONFIG_SECURE_FLASH_ENC_ENABLED", "CONFIG_MULTIKEY_ALLOW_EFUSE_PROVISIONING"):
            self.assertTrue(fd.check_sdkconfig({**GOOD_CFG, k: "y"}), k)

    def test_rejects_wrong_target(self):
        self.assertTrue(fd.check_sdkconfig({**GOOD_CFG, "CONFIG_IDF_TARGET": "esp32"}))

    def test_parse(self):
        cfg = fd.parse_sdkconfig('CONFIG_A=y\n# CONFIG_B is not set\nCONFIG_C="x y"\n')
        self.assertEqual(cfg, {"CONFIG_A": "y", "CONFIG_C": "x y"})


class Commands(unittest.TestCase):
    def test_write_command_matches_proven_one(self):
        argv = fd.build_flash_cmd("python", "COM6")
        self.assertEqual(argv, ["python", "-m", "esptool", "--chip", "esp32s3", "-p", "COM6", "-b", "460800",
                                "--before", "default_reset", "--after", "watchdog_reset", "write_flash", "@flash_args"])

    def test_no_forbidden_tokens_in_any_built_command(self):
        for argv in (fd.build_flash_cmd("python", "COM6"),
                     fd.esptool_readonly("python", "COM6", "flash_id"),
                     fd.esptool_readonly("python", "COM6", "read_flash", "0x8000", "0xc00", "x.bin")):
            for tok in argv:
                self.assertNotIn(tok, fd.FORBIDDEN_TOKENS)
                self.assertFalse(tok.startswith("--erase"))

    def test_guard_rejects_dangerous_argv(self):
        for bad in (["python", "-m", "esptool", "erase_flash"], ["x", "--erase-all"], ["espefuse.py", "burn_efuse"],
                    ["python", "-m", "esptool", "erase_region", "0", "1"], ["espsecure", "sign"]):
            with self.assertRaises(fd.Stop) as cm:
                fd.assert_safe_argv(bad)
            self.assertEqual(cm.exception.code, fd.EXIT_STORAGE)

    def test_readonly_commands_do_not_reset_out_of_download_mode(self):
        argv = fd.esptool_readonly("python", "COM6", "flash_id")
        self.assertEqual(argv[argv.index("--after") + 1], "no_reset")


class FlashId(unittest.TestCase):
    OK = "Chip type:          ESP32-S3 (QFN56) (revision v0.2)\nMAC: 80:b5:4e:c8:22:78\nDetected flash size: 16MB\n"

    def test_ok(self):
        problems, mac = fd.check_flash_id(self.OK)
        self.assertEqual(problems, [])
        self.assertEqual(mac, "80:b5:4e:c8:22:78")

    def test_wrong_chip_or_size(self):
        self.assertTrue(fd.check_flash_id(self.OK.replace("ESP32-S3", "ESP32")) [0])
        self.assertTrue(fd.check_flash_id(self.OK.replace("16MB", "8MB"))[0])
        self.assertTrue(fd.check_flash_id("garbage")[0])


class UsbIdentity(unittest.TestCase):
    REPORT = {"product_string": "MultiKeys Security Key", "interfaces": {
        "00": {"class": "HIDClass"}, "01": {"class": "HIDClass"}, "02": {"class": "SmartCardReader"},
        "03": {"class": "USBDevice"}}}

    def test_pass(self):
        self.assertEqual(fd.judge_usb_identity(self.REPORT, "MultiKeys Security Key"), ([], []))

    def test_custom_name_is_a_note_not_a_failure(self):
        fails, notes = fd.judge_usb_identity({**self.REPORT, "product_string": "Alice"}, "MultiKeys Security Key")
        self.assertEqual(fails, [])
        self.assertTrue(notes)

    def test_missing_pieces_fail(self):
        for drop in ("00", "02", "03"):
            r = json.loads(json.dumps(self.REPORT))
            del r["interfaces"][drop]
            if drop == "00":
                r["interfaces"]["01"]["class"] = "HIDClass"
            self.assertTrue(fd.judge_usb_identity(r, None)[0], drop)


if __name__ == "__main__":
    unittest.main()
