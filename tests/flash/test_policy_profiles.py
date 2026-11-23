import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools"))
import flash_dev as fd  # noqa: E402

PARTS = fd.parse_partitions_csv((ROOT / "partitions.csv").read_text())
BYTES = {"4MB": 4 << 20, "8MB": 8 << 20, "16MB": 16 << 20}


def header(size_code, mode=2, freq=0xF, magic=0xE9):
    return bytes([magic, 3, mode, (size_code << 4) | freq])


class BuildTag(unittest.TestCase):
    def test_default_profile_keeps_the_historical_tag(self):
        self.assertEqual(fd.build_tag("fido", "dev", "esp32s3-16mb"), "fido-dev")
        self.assertEqual(fd.build_tag("openpgp", "prod", "esp32s3-16mb", True), "openpgp-prod-hardened")

    def test_other_profiles_get_their_own_directory(self):
        self.assertEqual(fd.build_tag("fido", "dev", "esp32s3-4mb"), "fido-dev-4mb")
        self.assertEqual(fd.build_tag("fido", "dev", "esp32s3-8mb"), "fido-dev-8mb")
        self.assertEqual(fd.build_tag("fido", "prod", "esp32s3-4mb", True), "fido-prod-hardened-4mb")

    def test_unknown_profile_rejected(self):
        with self.assertRaises(ValueError) as cm:
            fd.build_tag("fido", "dev", "esp32s3-2mb")
        self.assertIn("esp32s3-4mb", str(cm.exception))


class FlashFragment(unittest.TestCase):
    def test_exactly_one_size_is_selected_per_profile(self):
        for hw, prof in fd.PROFILES.items():
            text = fd.flash_fragment(hw)
            self.assertTrue(text.endswith("\n"), hw)
            lines = text.splitlines()
            self.assertEqual([x for x in lines if x.startswith("CONFIG_ESPTOOLPY_FLASHSIZE_")],
                             [f"CONFIG_ESPTOOLPY_FLASHSIZE_{prof['flash_size']}=y"], hw)
            self.assertEqual(sum(x.startswith("# CONFIG_ESPTOOLPY_FLASHSIZE_") and x.endswith(" is not set")
                                 for x in lines), 2, hw)
            self.assertIn("CONFIG_ESPTOOLPY_FLASHMODE_QIO=y", lines)

    def test_sdkconfig_defaults_select_the_default_profile(self):
        # Direct idf.py builds (no tools/build.py) must stay on the default profile.
        cfg = fd.parse_sdkconfig((ROOT / "sdkconfig.defaults").read_text())
        prof = fd.profile(fd.DEFAULT_PROFILE)
        self.assertEqual(cfg.get(f"CONFIG_ESPTOOLPY_FLASHSIZE_{prof['flash_size']}"), "y")
        self.assertEqual(cfg.get(f"CONFIG_ESPTOOLPY_FLASHMODE_{prof['config_flash_mode'].upper()}"), "y")


class ImageHeader(unittest.TestCase):
    def test_header_matches_its_own_profile(self):
        for hw, code in (("esp32s3-4mb", 2), ("esp32s3-8mb", 3), ("esp32s3-16mb", 4)):
            self.assertEqual(fd.check_image_header(header(code), fd.profile(hw)), [], hw)

    def test_documented_bytes_for_16mb(self):
        self.assertEqual(fd.check_image_header(bytes.fromhex("e903024f"), fd.profile("esp32s3-16mb")), [])

    def test_wrong_size_names_both_sizes(self):
        problems = fd.check_image_header(bytes.fromhex("e903024f"), fd.profile("esp32s3-4mb"))
        self.assertEqual(problems, ["image header flash size is 16MB, profile esp32s3-4mb needs 4MB"])

    def test_wrong_magic_mode_and_frequency(self):
        prof = fd.profile("esp32s3-16mb")
        self.assertIn("magic", fd.check_image_header(header(4, magic=0x00), prof)[0])
        self.assertIn("flash mode is qio", fd.check_image_header(header(4, mode=0), prof)[0])
        self.assertIn("flash frequency", fd.check_image_header(header(4, freq=0xE), prof)[0])
        self.assertTrue(fd.check_image_header(b"\xe9\x03", prof))
        self.assertTrue(fd.check_image_header(b"", prof))

    def test_unknown_size_code_is_reported(self):
        self.assertIn("code 0x7", fd.check_image_header(header(7), fd.profile("esp32s3-16mb"))[0])


class PolicyInvariants(unittest.TestCase):
    def test_every_partition_fits_every_flash_size(self):
        end = max(p["offset"] + p["size"] for p in PARTS.values())
        self.assertEqual(end, 0x300000)
        for hw, prof in fd.PROFILES.items():
            self.assertLessEqual(end, BYTES[prof["flash_size"]], hw)

    def test_profiles_are_quad_flash_without_psram(self):
        for hw, prof in fd.PROFILES.items():
            self.assertFalse(prof["psram_required"], hw)
            self.assertEqual(prof["flash_interface"], "quad", hw)

    def test_exactly_one_profile_is_hardware_verified(self):
        verified = [h for h, p in fd.PROFILES.items() if p["verification"] == "hardware-verified"]
        self.assertEqual(verified, ["esp32s3-16mb"])
        for hw, prof in fd.PROFILES.items():
            self.assertEqual(bool(prof["verified_hardware"]), hw in verified, hw)

    def test_profile_fields_are_consistent(self):
        self.assertIn(fd.DEFAULT_PROFILE, fd.PROFILES)
        self.assertEqual(len(fd.PROFILES), len(fd.POLICY["profiles"]))
        for hw, prof in fd.PROFILES.items():
            self.assertEqual(hw, "esp32s3-" + prof["flash_size"].lower(), hw)
            self.assertIn(prof["flash_size"], fd.SIZE_CODES)
            self.assertIn(prof["flash_mode"], fd.MODE_CODES)
            self.assertIn(prof["config_flash_mode"], fd.MODE_CODES)
            self.assertIn(prof["flash_freq"], fd.FREQ_CODES)
            self.assertTrue((ROOT / "boards" / f"{prof['board']}.board").is_file(), hw)
            self.assertTrue(prof["release"], hw)

    def test_legacy_builds_map_to_known_profiles(self):
        for build_id, hw in fd.POLICY["legacy_builds"].items():
            self.assertIn(hw, fd.PROFILES, build_id)
            self.assertEqual(fd.PROFILES[hw]["flash_size"], "16MB", build_id)

    def test_supported_sizes_are_ascending(self):
        self.assertEqual(fd.supported_flash_sizes(), ["4MB", "8MB", "16MB"])


if __name__ == "__main__":
    unittest.main()
