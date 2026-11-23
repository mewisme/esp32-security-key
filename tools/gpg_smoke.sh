#!/bin/sh
# OpenPGP-card smoke test for the MultiKeys `openpgp` firmware image (docs/ADR-0002-separate-images.md, docs/OPENPGP.md).
#
#   tools/gpg_smoke.sh                       read-only: gpg --card-status, parsed and checked. Changes nothing.
#   tools/gpg_smoke.sh --destructive --i-understand-this-resets-the-card [--no-replug] [--disable-ccid]
#                                            factory-resets the card, generates RSA-2048 keys ON the card, signs/verifies,
#                                            encrypts/decrypts, provokes one wrong-PIN try, then asks you to replug and
#                                            checks that the keys survived.
#   tools/gpg_smoke.sh --parse-only FILE     checks the text of a saved `gpg --card-status` (no card, no gpg needed).
#
# Safety:
#  * Everything runs in a throw-away GNUPGHOME (mktemp -d, mode 700); your own keyring and gpg-agent are never touched.
#  * Destructive mode needs BOTH flags. A card reset erases every OpenPGP and PIV object on the key; use a test key.
#  * Destructive mode answers pinentry with the public FACTORY PINs (user 123456, admin 12345678) through
#    tools/fake_pinentry.py, only after the reset. It never prints a PIN or key material, only fingerprints.
#  * The script never writes firmware, fuses or partitions; it only talks OpenPGP card APDUs through gpg.
#
# Status: Implemented. NOT hardware verified: no run against a real board exists (docs/TESTING.md, docs/hw-reports/).
set -u

here=$(CDPATH="" cd -- "$(dirname -- "$0")" && pwd)
destructive=0
confirmed=0
replug=1
disable_ccid=0
parse_only=""

usage() { sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; }

while [ $# -gt 0 ]; do
    case "$1" in
        -h|--help) usage; exit 0 ;;
        --destructive) destructive=1 ;;
        --i-understand-this-resets-the-card) confirmed=1 ;;
        --no-replug) replug=0 ;;
        --disable-ccid) disable_ccid=1 ;;
        --parse-only) shift; parse_only="${1:-}"; [ -n "$parse_only" ] || { echo "--parse-only needs a file" >&2; exit 2; } ;;
        *) echo "unknown option: $1" >&2; usage >&2; exit 2 ;;
    esac
    shift
done
if [ "$destructive" -eq 1 ] && [ "$confirmed" -ne 1 ]; then
    echo "--destructive erases the card; add --i-understand-this-resets-the-card to proceed." >&2
    exit 2
fi
if [ "$confirmed" -eq 1 ] && [ "$destructive" -ne 1 ]; then
    echo "--i-understand-this-resets-the-card only has a meaning together with --destructive." >&2
    exit 2
fi

fail=0
pass() { echo "[PASS] $1"; }
bad()  { echo "[FAIL] $1"; fail=1; }
skip() { echo "[SKIP] $1"; }

# field LABEL: value of "LABEL ......: value" in $status
field() { printf '%s\n' "$status" | sed -n "s/^$1[ .]*: *//p" | head -n 1; }

check_status() {
    aid=$(field "Application ID" | tr -d ' ')
    case "$aid" in
        D27600012401*) pass "Application ID is an OpenPGP card ($aid)" ;;
        "") bad "no Application ID in the card status" ;;
        *) bad "Application ID $aid is not an OpenPGP card (D27600012401...)" ;;
    esac
    [ -n "$(field "Manufacturer")" ] && pass "manufacturer: $(field "Manufacturer")" || bad "no manufacturer"
    [ -n "$(field "Version")" ] && pass "card version: $(field "Version")" || bad "no card version"
    [ -n "$(field "Serial number")" ] && pass "serial number present" || bad "no serial number"
    counters=$(field "PIN retry counter")
    if printf '%s' "$counters" | grep -Eq '^[0-9]+ [0-9]+ [0-9]+$'; then
        pass "PIN retry counters (user reset admin): $counters"
        # The middle counter is the reset code; cards without one print 0 there, so only user and admin can be "blocked".
        set -- $counters
        if [ "$1" -eq 0 ] || [ "$3" -eq 0 ]; then bad "the user or admin PIN is blocked (counter 0): $counters"; fi
    else
        bad "PIN retry counter line missing or malformed: '$counters'"
    fi
    for k in "Signature key" "Encryption key" "Authentication key"; do
        v=$(field "$k")
        case "$v" in
            "") bad "no '$k' line" ;;
            "[none]") echo "[INFO] $k: none on the card" ;;
            *) pass "$k present" ;;
        esac
    done
}

if [ -n "$parse_only" ]; then
    [ -f "$parse_only" ] || { echo "no such file: $parse_only" >&2; exit 2; }
    status=$(cat "$parse_only")
    check_status
    exit $fail
fi

command -v gpg >/dev/null 2>&1 || { echo "gpg not found" >&2; exit 2; }

home=$(mktemp -d) || exit 2
chmod 700 "$home"
export GNUPGHOME="$home"
cleanup() {
    gpgconf --kill all >/dev/null 2>&1
    rm -rf "$home"
}
trap cleanup EXIT INT TERM

[ "$disable_ccid" -eq 1 ] && echo "disable-ccid" > "$home/scdaemon.conf"
if [ "$destructive" -eq 1 ]; then
    command -v python3 >/dev/null 2>&1 || { echo "python3 is needed for tools/fake_pinentry.py" >&2; exit 2; }
    printf '#!/bin/sh\nexec python3 "%s/fake_pinentry.py"\n' "$here" > "$home/pinentry-fake"
    chmod 700 "$home/pinentry-fake"
    printf 'pinentry-program %s/pinentry-fake\nallow-loopback-pinentry\n' "$home" > "$home/gpg-agent.conf"
fi

card_status() {
    if ! status=$(gpg --card-status 2>&1); then
        printf '%s\n' "$status"
        bad "gpg --card-status failed (is pcscd running, is the openpgp image flashed and replugged? with a second reader stack try --disable-ccid)"
        return 1
    fi
    return 0
}

echo "--- gpg --card-status"
card_status || exit 1
printf '%s\n' "$status"
check_status

if [ "$destructive" -ne 1 ]; then
    echo "Read-only run finished. Key operations: rerun with --destructive --i-understand-this-resets-the-card (test key only)."
    echo "Results are not hardware verified until recorded in docs/hw-reports/."
    exit $fail
fi

card_edit() { printf '%s\n' "$@" | gpg --command-fd 0 --status-fd 2 --card-edit >"$home/last.log" 2>&1; }
retry_user() { field "PIN retry counter" | cut -d' ' -f1; }

echo "--- factory reset (erases every OpenPGP object on the card)"
if card_edit admin factory-reset y yes quit; then pass "factory-reset"; else cat "$home/last.log"; bad "factory-reset"; exit 1; fi
card_status || exit 1
counters_now=$(field "PIN retry counter")
set -- $counters_now
if [ "${1:-0}" = 3 ] && [ "${3:-0}" = 3 ]; then pass "user and admin counters back to 3"; else bad "counters after reset: $*"; fi

echo "--- generate RSA-2048 keys on the card (can take about a minute)"
if card_edit admin generate n 0 y "MultiKeys Smoke" "smoke@invalid.example" "" O quit; then
    pass "on-card key generation"
else
    cat "$home/last.log"; bad "on-card key generation"; exit 1
fi
card_status || exit 1
for k in "Signature key" "Encryption key" "Authentication key"; do
    [ "$(field "$k")" != "[none]" ] && [ -n "$(field "$k")" ] && pass "$k on the card" || bad "$k missing after generate"
done
fpr=$(gpg --with-colons --list-keys smoke@invalid.example 2>/dev/null | sed -n 's/^fpr:::::::::\([0-9A-F]*\):$/\1/p' | head -n 1)
if [ -z "$fpr" ]; then bad "no public key for the generated card key"; exit 1; fi
echo "key fingerprint: $fpr"

work="$home/work"; mkdir "$work"
echo "multikey gpg smoke" > "$work/msg.txt"
cycle() { # $1 label
    if gpg --batch --yes --local-user "$fpr" --detach-sign -o "$work/msg.sig" "$work/msg.txt" && gpg --batch --verify "$work/msg.sig" "$work/msg.txt" 2>/dev/null; then
        pass "$1: sign + verify"
    else
        bad "$1: sign + verify"
    fi
    if gpg --batch --yes --trust-model always --recipient "$fpr" -o "$work/msg.gpg" --encrypt "$work/msg.txt" \
        && gpg --batch --yes -o "$work/msg.out" --decrypt "$work/msg.gpg" 2>/dev/null && cmp -s "$work/msg.txt" "$work/msg.out"; then
        pass "$1: encrypt + decrypt"
    else
        bad "$1: encrypt + decrypt"
    fi
    rm -f "$work/msg.sig" "$work/msg.gpg" "$work/msg.out"
}
cycle "after generate"

echo "--- one wrong user PIN (counter must drop by one, then recover)"
card_status || exit 1
before=$(retry_user)
gpgconf --kill gpg-agent >/dev/null 2>&1
# gpg-agent starts its pinentry with the agent's own environment, so the mode must be set before the agent starts.
MULTIKEY_SMOKE_PIN_MODE=wrong; export MULTIKEY_SMOKE_PIN_MODE
if card_edit verify quit; then bad "a wrong PIN was accepted"; else echo "(the wrong PIN was refused, as expected)"; fi
unset MULTIKEY_SMOKE_PIN_MODE
gpgconf --kill gpg-agent >/dev/null 2>&1
card_status || exit 1
after=$(retry_user)
[ "$after" -eq $((before - 1)) ] 2>/dev/null && pass "retry counter $before -> $after" || bad "retry counter $before -> $after (expected one less)"
card_edit verify quit && pass "correct PIN accepted" || bad "correct PIN refused"
card_status || exit 1
[ "$(retry_user)" = "$before" ] && pass "retry counter restored to $before" || bad "retry counter is $(retry_user), expected $before"

if [ "$replug" -eq 1 ]; then
    echo "--- persistence"
    printf 'REPLUG NOW: unplug the board and plug it back in, then press Enter... '
    if [ -r /dev/tty ]; then read -r _ </dev/tty; else echo; skip "no terminal to wait on; use --no-replug in automation"; fi
    gpgconf --kill scdaemon >/dev/null 2>&1
    sleep 2
    card_status || exit 1
    [ "$(field "Signature key")" != "[none]" ] && pass "keys survived the replug" || bad "keys are gone after the replug"
    cycle "after replug"
else
    skip "replug persistence (--no-replug)"
fi

echo "Results are not hardware verified until recorded in docs/hw-reports/."
exit $fail
