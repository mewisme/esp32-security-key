import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tools"))
import check_usb_descriptors as cud  # noqa: E402


def bos_bytes(webusb: bool, vendor=1, page=1, ms_len=0xB2, ms_vendor=2) -> bytes:
    caps = b""
    if webusb:
        caps += bytes([24, 0x10, 0x05, 0]) + cud.WEBUSB_UUID + bytes([0x00, 0x01, vendor, page])
    caps += bytes([28, 0x10, 0x05, 0]) + cud.MS_OS_20_UUID + bytes([0, 0, 3, 6, ms_len & 255, ms_len >> 8, ms_vendor, 0])
    n = 2 if webusb else 1
    total = 5 + len(caps)
    return bytes([5, 0x0F, total & 255, total >> 8, n]) + caps


class UrlRules(unittest.TestCase):
    def test_valid(self):
        d = cud.expected_url_descriptor("https://multikeys.mewis.me")
        self.assertEqual(d[0], 21)
        self.assertEqual(d[1:3], b"\x03\x01")
        self.assertEqual(d[3:], b"multikeys.mewis.me")

    def test_http_rejected(self):
        with self.assertRaises(cud.DescriptorError):
            cud.validate_url("http://example.com")

    def test_space_rejected(self):
        with self.assertRaises(cud.DescriptorError):
            cud.validate_url("https://example.com/a b")

    def test_empty_host_rejected(self):
        with self.assertRaises(cud.DescriptorError):
            cud.validate_url("https://")

    def test_non_ascii_rejected(self):
        with self.assertRaises(cud.DescriptorError):
            cud.validate_url("https://example.com/\u00e9")

    def test_length_limit(self):
        cud.validate_url("https://" + "a" * 200)
        with self.assertRaises(cud.DescriptorError):
            cud.validate_url("https://" + "a" * 201)
        self.assertEqual(cud.expected_url_descriptor("https://" + "a" * 200)[0], 203)


class Layout(unittest.TestCase):
    def test_enabled_disabled_lengths(self):
        self.assertEqual(cud.expected_bos(True), {"total_length": 57, "caps": 2})
        self.assertEqual(cud.expected_bos(False), {"total_length": 33, "caps": 1})

    def test_sdkconfig_disabled(self):
        r = cud.config_from_sdkconfig(cud.parse_sdkconfig("# CONFIG_MULTIKEY_WEBUSB_LANDING_ENABLED is not set\n"))
        self.assertFalse(r["enabled"])
        self.assertEqual(r["bos"]["caps"], 1)

    def test_sdkconfig_enabled(self):
        cfg = 'CONFIG_MULTIKEY_WEBUSB_LANDING_ENABLED=y\nCONFIG_MULTIKEY_WEBUSB_LANDING_URL="https://a.example"\n'
        r = cud.config_from_sdkconfig(cud.parse_sdkconfig(cfg))
        self.assertEqual(r["url_descriptor"], bytes([3 + 9, 3, 1]) + b"a.example")

    def test_sdkconfig_bad_url(self):
        cfg = 'CONFIG_MULTIKEY_WEBUSB_LANDING_ENABLED=y\nCONFIG_MULTIKEY_WEBUSB_LANDING_URL="http://a.example"\n'
        with self.assertRaises(cud.DescriptorError):
            cud.config_from_sdkconfig(cud.parse_sdkconfig(cfg))


class BosParsing(unittest.TestCase):
    def test_enabled_ok(self):
        raw = bos_bytes(True)
        self.assertEqual(len(raw), 57)
        fails, facts = cud.check_bos(cud.parse_bos(raw), True)
        self.assertEqual(fails, [])
        self.assertEqual(facts["webusb_landing_page"], 1)

    def test_disabled_ok(self):
        raw = bos_bytes(False)
        self.assertEqual(len(raw), 33)
        self.assertEqual(cud.check_bos(cud.parse_bos(raw), False)[0], [])

    def test_webusb_present_when_disabled_is_failure(self):
        self.assertTrue(cud.check_bos(cud.parse_bos(bos_bytes(True)), False)[0])

    def test_wrong_ms_length_is_failure(self):
        self.assertTrue(cud.check_bos(cud.parse_bos(bos_bytes(True, ms_len=0xCE)), True)[0])

    def test_truncated_total_length_is_failure(self):
        raw = bytearray(bos_bytes(True))
        raw[2] = 50
        self.assertTrue(cud.check_bos(cud.parse_bos(bytes(raw)), True)[0])


if __name__ == "__main__":
    unittest.main()
