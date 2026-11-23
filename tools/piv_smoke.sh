#!/bin/sh
# PIV smoke test for the MultiKeys `openpgp` firmware image (it serves the PIV applet next to OpenPGP over CCID).
#
#   tools/piv_smoke.sh                       read-only: yubico-piv-tool status, parsed and checked. Changes nothing.
#   tools/piv_smoke.sh --destructive --i-understand-this-changes-the-card [--reader REGEX]
#                                            generates an ECCP256 key in slot 9c (replacing any key there), makes and
#                                            imports a self-signed certificate, signs and verifies with the card,
#                                            changes the PIN and changes it back, provokes one wrong-PIN try.
#   tools/piv_smoke.sh --parse-only FILE     checks the text of a saved `yubico-piv-tool -a status` (no card needed).
#
# Safety: destructive mode uses the FACTORY credentials of a fresh card (PIN 123456, default management key) on the
# command line, which other local users can see in the process list for the moment each command runs. Run it only on a
# test key, on a machine you control. Slot 9c's old key and certificate are overwritten. Nothing else on the card or the
# board (firmware, fuses, FIDO data) is touched. It does NOT change the PUK or the management key.
#
# Status: Implemented. NOT hardware verified: no run against a real board exists (docs/TESTING.md, docs/hw-reports/).
set -u

destructive=0
confirmed=0
reader=""
parse_only=""
USER_PIN=123456
TMP_PIN=654321
WRONG_PIN=000000

usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
    case "$1" in
        -h|--help) usage; exit 0 ;;
        --destructive) destructive=1 ;;
        --i-understand-this-changes-the-card) confirmed=1 ;;
        --reader) shift; reader="${1:-}"; [ -n "$reader" ] || { echo "--reader needs a value" >&2; exit 2; } ;;
        --parse-only) shift; parse_only="${1:-}"; [ -n "$parse_only" ] || { echo "--parse-only needs a file" >&2; exit 2; } ;;
        *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
    shift
done
if [ "$destructive" -eq 1 ] && [ "$confirmed" -ne 1 ]; then
    echo "--destructive changes the card; add --i-understand-this-changes-the-card to proceed." >&2
    exit 2
fi
if [ "$confirmed" -eq 1 ] && [ "$destructive" -ne 1 ]; then
    echo "--i-understand-this-changes-the-card only has a meaning together with --destructive." >&2
    exit 2
fi

fail=0
pass() { echo "[PASS] $1"; }
bad()  { echo "[FAIL] $1"; fail=1; }

check_status() {
    printf '%s\n' "$status" | grep -Eq '^(CHUID|Card Holder Unique Identifier)' && pass "CHUID object present" || bad "no CHUID in the status"
    printf '%s\n' "$status" | grep -Eq '^(CCC|Card Capability Container)' && pass "CCC object present" || bad "no CCC in the status"
    tries=$(printf '%s\n' "$status" | sed -n 's/^PIN tries left:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n 1)
    if [ -z "$tries" ]; then
        echo "[INFO] this yubico-piv-tool version does not print the PIN tries"
    elif [ "$tries" -eq 0 ]; then
        bad "the PIN is blocked (0 tries left)"
    else
        pass "PIN tries left: $tries"
    fi
}

if [ -n "$parse_only" ]; then
    [ -f "$parse_only" ] || { echo "no such file: $parse_only" >&2; exit 2; }
    status=$(cat "$parse_only")
    check_status
    exit $fail
fi

command -v yubico-piv-tool >/dev/null 2>&1 || { echo "yubico-piv-tool not found (apt install yubico-piv-tool / winget install Yubico.YubicoPIVTool)" >&2; exit 2; }

piv() { if [ -n "$reader" ]; then yubico-piv-tool -r "$reader" "$@"; else yubico-piv-tool "$@"; fi; }
get_status() {
    if ! status=$(piv -a status 2>&1); then
        printf '%s\n' "$status"
        bad "yubico-piv-tool -a status failed (is pcscd running and the openpgp image flashed and replugged?)"
        return 1
    fi
}

echo "--- yubico-piv-tool -a status"
get_status || exit 1
printf '%s\n' "$status"
check_status

if [ "$destructive" -ne 1 ]; then
    echo "Read-only run finished. Key operations: rerun with --destructive --i-understand-this-changes-the-card (test key only)."
    echo "Results are not hardware verified until recorded in docs/hw-reports/."
    exit $fail
fi

command -v openssl >/dev/null 2>&1 || { echo "openssl is needed to build the self-signed certificate check" >&2; exit 2; }
work=$(mktemp -d) || exit 2
trap 'rm -rf "$work"' EXIT INT TERM

echo "--- generate ECCP256 in slot 9c"
if piv -a generate -s 9c -A ECCP256 -o "$work/pub.pem" >/dev/null 2>&1 && grep -q 'BEGIN PUBLIC KEY' "$work/pub.pem"; then
    pass "key generated in slot 9c"
else
    bad "key generation in slot 9c"; exit 1
fi

echo "--- self-signed certificate, import"
if piv -a verify-pin -a selfsign-certificate -s 9c -S "/CN=multikeys-smoke/" -i "$work/pub.pem" -o "$work/cert.pem" -P "$USER_PIN" >/dev/null 2>&1 \
    && piv -a import-certificate -s 9c -i "$work/cert.pem" >/dev/null 2>&1; then
    pass "certificate made and imported"
else
    bad "certificate creation or import"; exit 1
fi
openssl x509 -in "$work/cert.pem" -noout -subject 2>/dev/null | grep -q multikeys-smoke && pass "certificate parses with openssl" || bad "openssl cannot read the certificate"

echo "--- sign with the card and verify"
if piv -a verify-pin -a test-signature -s 9c -i "$work/cert.pem" -P "$USER_PIN" >/dev/null 2>&1; then
    pass "test-signature (card signs, host verifies)"
else
    bad "test-signature"
fi

echo "--- change the PIN and change it back"
if piv -a change-pin -P "$USER_PIN" -N "$TMP_PIN" >/dev/null 2>&1; then
    pass "PIN changed"
    piv -a change-pin -P "$TMP_PIN" -N "$USER_PIN" >/dev/null 2>&1 && pass "PIN restored" || bad "PIN could not be restored: it is now $TMP_PIN"
else
    bad "PIN change"
fi

echo "--- one wrong PIN"
get_status || exit 1
before=$(printf '%s\n' "$status" | sed -n 's/^PIN tries left:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n 1)
if piv -a verify-pin -P "$WRONG_PIN" >/dev/null 2>&1; then
    bad "a wrong PIN was accepted"
else
    pass "wrong PIN refused"
fi
get_status || exit 1
after=$(printf '%s\n' "$status" | sed -n 's/^PIN tries left:[[:space:]]*\([0-9][0-9]*\).*/\1/p' | head -n 1)
if [ -n "$before" ] && [ -n "$after" ]; then
    [ "$after" -eq $((before - 1)) ] && pass "PIN tries $before -> $after" || bad "PIN tries $before -> $after (expected one less)"
else
    echo "[INFO] PIN tries not printed by this yubico-piv-tool; counter check skipped"
fi
piv -a verify-pin -P "$USER_PIN" >/dev/null 2>&1 && pass "correct PIN accepted (counter reset)" || bad "correct PIN refused"

echo "Results are not hardware verified until recorded in docs/hw-reports/."
exit $fail
