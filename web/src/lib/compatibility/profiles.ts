// Chooses the firmware build for a connected board. A build is never picked by binary size or guessed: only an exact
// flash-size match with a profile of tools/flash_policy.json counts, and only for a chip we can positively identify.
import type { ErrorCode } from "../errors/catalog";
import { type FlashPolicy, type HardwareProfile, policy as defaultPolicy, supportedFlashSizes } from "../firmware/policy";
import type { Build } from "../firmware/types";
import type { ChipInfo } from "../flashing/driver";

/**
 * How well a connected board is known to work. The words for each level are in src/i18n/messages (`support`).
 * `reference-config` means the board reports the configuration of the hardware-tested reference (flash size and PSRAM);
 * it is not proof that this board is that unit. Nothing in a connected board identifies it as the tested unit.
 */
export type Support = "reference-config" | "expected-compatible" | "build-verified";

/** No read-only value ties a connected board to the tested unit, so every board needs the untested-hardware acknowledgement. */
export const BOARD_IDENTITY_VERIFIED = false;

export type ProfileFailure = Extract<
  ErrorCode,
  | "unsupported-chip"
  | "unsupported-flash-mode"
  | "unknown-flash-mode"
  | "unknown-flash-size"
  | "wrong-flash-size"
  | "profile-not-in-release"
>;

export type ProfileResult =
  | { ok: true; build: Build; profile: HardwareProfile; support: Support }
  | { ok: false; code: ProfileFailure; detail: string };

export function selectProfile(
  chip: ChipInfo,
  builds: Build[],
  image: "fido" | "openpgp",
  p: FlashPolicy = defaultPolicy,
): ProfileResult {
  if (chip.chipName !== p.chip) return { ok: false, code: "unsupported-chip", detail: `chip is ${chip.chipName}` };
  if (chip.flashType === "octal") return { ok: false, code: "unsupported-flash-mode", detail: "the flash uses eight data lines (octal)" };
  if (chip.flashType === null) return { ok: false, code: "unknown-flash-mode", detail: "the flash interface type could not be read" };
  if (chip.flashSize === null) return { ok: false, code: "unknown-flash-size", detail: "the flash size could not be read" };
  const profile = p.profiles.find((x) => x.flash_size === chip.flashSize);
  if (!profile) {
    return { ok: false, code: "wrong-flash-size", detail: `flash is ${chip.flashSize}; supported: ${supportedFlashSizes(p).join(", ")}` };
  }
  const build = builds.find((b) => b.profile_id === profile.id && b.image === image);
  if (!build) return { ok: false, code: "profile-not-in-release", detail: `this release has no ${image} build for ${profile.id}` };

  if (build.verification === "hardware-verified") {
    // The tested unit is a physical N16R8; a connected board that only reports the same flash size and PSRAM has the
    // same configuration, not the same identity. It is never labelled verified.
    const reference = profile.verified_hardware.some((v) => chip.features.some((f) => f.startsWith(v.chip_feature)));
    return { ok: true, build, profile, support: reference ? "reference-config" : "expected-compatible" };
  }
  return { ok: true, build, profile, support: "build-verified" };
}
