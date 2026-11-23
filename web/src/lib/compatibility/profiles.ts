// Chooses the firmware build for a connected board. A build is never picked by binary size or guessed: only an exact
// flash-size match with a profile of tools/flash_policy.json counts, and only for a chip we can positively identify.
import type { ErrorCode } from "../errors/catalog";
import { type FlashPolicy, type HardwareProfile, policy as defaultPolicy, supportedFlashSizes } from "../firmware/policy";
import type { Build } from "../firmware/types";
import type { ChipInfo } from "../flashing/driver";

export type Support = "hardware-verified" | "expected-compatible" | "build-verified";

export type ProfileFailure = Extract<
  ErrorCode,
  "unsupported-chip" | "unsupported-flash-mode" | "unknown-flash-size" | "wrong-flash-size" | "profile-not-in-release"
>;

export type ProfileResult =
  | { ok: true; build: Build; profile: HardwareProfile; support: Support; verifiedAs: string | null }
  | { ok: false; code: ProfileFailure; detail: string };

export const SUPPORT_LABEL: Record<Support, string> = {
  "hardware-verified": "Hardware verified",
  "expected-compatible": "Expected compatible — not tested on this exact board",
  "build-verified": "Build verified — not hardware tested",
};

export function selectProfile(
  chip: ChipInfo,
  builds: Build[],
  image: "fido" | "openpgp",
  p: FlashPolicy = defaultPolicy,
): ProfileResult {
  if (chip.chipName !== p.chip) return { ok: false, code: "unsupported-chip", detail: `chip is ${chip.chipName}` };
  if (chip.flashType === "octal") return { ok: false, code: "unsupported-flash-mode", detail: "the flash uses eight data lines (octal)" };
  if (chip.flashSize === null) return { ok: false, code: "unknown-flash-size", detail: "the flash size could not be read" };
  const profile = p.profiles.find((x) => x.flash_size === chip.flashSize);
  if (!profile) {
    return { ok: false, code: "wrong-flash-size", detail: `flash is ${chip.flashSize}; supported: ${supportedFlashSizes(p).join(", ")}` };
  }
  const build = builds.find((b) => b.profile_id === profile.id && b.image === image);
  if (!build) return { ok: false, code: "profile-not-in-release", detail: `this release has no ${image} build for ${profile.id}` };

  if (build.verification === "hardware-verified") {
    const verified = profile.verified_hardware.find((v) => chip.features.some((f) => f.startsWith(v.chip_feature)));
    if (verified) return { ok: true, build, profile, support: "hardware-verified", verifiedAs: verified.label };
    return { ok: true, build, profile, support: "expected-compatible", verifiedAs: null };
  }
  return { ok: true, build, profile, support: "build-verified", verifiedAs: null };
}
