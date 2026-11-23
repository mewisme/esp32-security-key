#!/usr/bin/env bash
# Hardware-free FIDO2 UV tests against pico-fido's ENABLE_EMULATION build (native Linux binary,
# CTAP HID over TCP 127.0.0.1:35962). Run inside WSL/Linux:
#   tools/run_emulation_tests.sh [pytest args...]
#   EMU_UPSTREAM=1 tools/run_emulation_tests.sh    # also run upstream test_000/test_010 as baseline
# Installs nothing outside a venv under $EMU_WORK (default /tmp/multikey-emu). No sudo, no docker.
# Never touches a physical board.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="${EMU_WORK:-/tmp/multikey-emu}"
SRC="$WORK/src/pico-fido"
BUILD="$WORK/build"
VENV="$WORK/venv"
RUNDIR="$WORK/run"
AAGUID_HEX="0a63b9948ba65e749e5a0f894cc35c4d"
PORT=35962

log() { printf '[emu] %s\n' "$*"; }

for tool in rsync cmake ninja gcc python3; do
    command -v "$tool" >/dev/null || { echo "missing required tool: $tool" >&2; exit 2; }
done
[ -f /usr/include/openssl/ssl.h ] || { echo "missing libssl-dev (openssl headers)" >&2; exit 2; }

mkdir -p "$WORK/src"

# 1. Throw-away copy of the (already patched) submodule working trees; the SDK must sit at pico-fido/pico-keys-sdk.
#    rsync keeps mtimes, so unchanged files do not trigger a rebuild.
log "syncing sources to $SRC"
rsync -a --delete --exclude '.git' --exclude 'pico-keys-sdk' --exclude 'build*' "$ROOT/pico-fido/" "$SRC/"
rsync -a --delete --exclude '.git' "$ROOT/pico-keys-sdk/" "$SRC/pico-keys-sdk/"

# 2. Build with the same compile definitions the ESP build gets from Kconfig.
# The SDK derives PICO_BUILD_NUMBER from `git rev-list --count HEAD`; the copy has no history.
if [ ! -d "$SRC/.git" ]; then
    git -C "$SRC" init -q
    git -C "$SRC" -c user.name=emu -c user.email=emu@localhost commit -q --allow-empty -m emu
fi
# Upstream's Linux emulation build hard-requires libtss2-dev (TPM-backed otp_key_2) which needs sudo to install.
# If it is absent, build the copy with otp_emulation.c instead: the exact fallback otp_linux.c uses when no TPM
# is reachable (otp_key_1 = 0xAC*32, otp_key_2 = 0xBE*32). FIDO behaviour under test is unaffected.
if [ ! -f /usr/include/tss2/tss2_esys.h ]; then
    log "libtss2-dev not installed: using otp_emulation.c (software OTP keys) in the throw-away copy"
    sed -i -e 's#src/otp/otp_linux\.c#src/otp/otp_emulation.c#' \
           -e '/add_compile_definitions(OTP_LINUX_USE_TSS=1)/d' \
           "$SRC/pico-keys-sdk/picokeys_sdk_import.cmake"
fi
log "building emulator"
start=$(date +%s)
cmake -S "$SRC" -B "$BUILD" -G Ninja -DENABLE_EMULATION=1 -DENABLE_EDDSA=1 \
    "-DCMAKE_C_FLAGS=-DCONFIG_MULTIKEY_FIDO_MAKECRED_UV_NOT_REQUIRED=1 -DCONFIG_MULTIKEY_AAGUID=\\\"${AAGUID_HEX}\\\"" \
    >"$WORK/cmake.log" 2>&1 || { tail -40 "$WORK/cmake.log"; exit 1; }
ninja -C "$BUILD" >"$WORK/ninja.log" 2>&1 || { tail -60 "$WORK/ninja.log"; exit 1; }
log "build done in $(( $(date +%s) - start )) s"
EMU_BIN="$BUILD/pico_fido"
[ -x "$EMU_BIN" ] || { echo "emulator binary not found: $EMU_BIN" >&2; exit 1; }

# 3. Python venv with the upstream test dependencies + upstream emulation HID transport.
if [ ! -x "$VENV/bin/python" ]; then
    log "creating venv"
    python3 -m venv "$VENV"
    "$VENV/bin/pip" install -q --disable-pip-version-check pytest cryptography inputimeout fido2==2.2.1
fi
FIDO_HID="$("$VENV/bin/python" -c 'import fido2.hid, os; print(os.path.dirname(fido2.hid.__file__))')"
# Same as pico-fido/tests/start-up-and-test.sh: overlay fido2/hid with tests/docker/fido2/*.
cp -R "$SRC/tests/docker/fido2/." "$FIDO_HID/"

# 4. Tests. The multikey suite (tests/emulation/conftest.py) owns the emulator process itself so that it can
#    start a factory-fresh device per test and power-cycle it (flash image = memory.flash in EMU_RUNDIR).
export PICOKEYS_EMULATION_DISABLE_CCID=1
status=0
cd "$ROOT"
if [ -n "${EMU_UPSTREAM:-}" ]; then
    log "upstream baseline (test_000_getinfo, test_010_pin)"
    # upstream tests/utils.py imports pyscard (needs swig + libpcsclite-dev to build); only CCID tests use it.
    STUBS="$WORK/stubs/smartcard"; mkdir -p "$STUBS"
    : >"$STUBS/__init__.py"
    printf 'class AnyCardType: pass\n' >"$STUBS/CardType.py"
    printf 'class CardRequest: pass\n' >"$STUBS/CardRequest.py"
    printf 'class CardRequestTimeoutException(Exception): pass\nclass CardConnectionException(Exception): pass\n' >"$STUBS/Exceptions.py"
    BASE="$WORK/run-upstream"; rm -rf "$BASE"; mkdir -p "$BASE"
    ( cd "$BASE" && exec "$EMU_BIN" >"$WORK/emulator-upstream.log" 2>&1 ) &
    BASE_PID=$!
    sleep 2
    ( cd "$SRC" && PYTHONPATH="$WORK/stubs" "$VENV/bin/python" -m pytest -p no:cacheprovider -q \
        tests/pico-fido/test_000_getinfo.py tests/pico-fido/test_010_pin.py ) || true
    kill "$BASE_PID" 2>/dev/null || true; wait "$BASE_PID" 2>/dev/null || true
fi

log "multikey UV suite"
export EMU_BIN EMU_RUNDIR="$WORK/run"
rm -rf "$EMU_RUNDIR"; mkdir -p "$EMU_RUNDIR"
"$VENV/bin/python" -m pytest -p no:cacheprovider -v tests/emulation "$@" || status=$?
exit $status
