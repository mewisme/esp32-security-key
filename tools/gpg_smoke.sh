#!/bin/sh
# OpenPGP-card smoke test. Applies to the `openpgp` firmware image only (see docs/ADR-0002-separate-images.md).
# Status: Implemented; NOT run against hardware (pending hardware).
# This script never types, passes or stores a PIN. gpg/pinentry will prompt you. OpenPGP card defaults are
# user PIN 123456 and admin PIN 12345678: change them (gpg --card-edit, admin, passwd) before real use.
set -u
fail=0
pass() { echo "[PASS] $1"; }
bad()  { echo "[FAIL] $1"; fail=1; }
skip() { echo "[SKIP] $1"; }

command -v gpg >/dev/null 2>&1 || { echo "gpg not found"; exit 1; }

echo "--- gpg --card-status"
if out=$(gpg --card-status 2>&1); then
    echo "$out"
    pass "gpg --card-status"
else
    echo "$out"
    bad "gpg --card-status (is pcscd running and the openpgp image flashed? scdaemon may need 'disable-ccid' if it competes with pcscd)"
    exit 1
fi

cat <<'EOF'

--- Generating keys on the card is NOT done by this script. To do it yourself:
  gpg --card-edit
  gpg/card> admin
  gpg/card> key-attr        # choose ECC (nist P-256 / ed25519) or RSA <= 3072
  gpg/card> generate        # asks for the admin PIN and backup choice; touch the button when it blinks
Default PINs are 123456 (user) / 12345678 (admin); change them first (passwd).
EOF

# Is there a signature key on the card?
sigkey=$(echo "$out" | sed -n 's/^Signature key[ .]*: *\([0-9A-Fa-f ]\{20,\}\)$/\1/p' | tr -d ' ')
if [ -z "$sigkey" ]; then
    skip "sign/verify: no signature key on the card yet"
else
    tmp=$(mktemp -d) || exit 1
    trap 'rm -rf "$tmp"' EXIT INT TERM
    echo "multikey gpg smoke" > "$tmp/msg.txt"
    echo "--- sign with the card (pinentry will ask for your PIN; touch the button if asked)"
    if gpg --local-user "$sigkey" --detach-sign -o "$tmp/msg.sig" "$tmp/msg.txt" && gpg --verify "$tmp/msg.sig" "$tmp/msg.txt"; then
        pass "gpg sign + verify"
    else
        bad "gpg sign + verify (public key may not be imported: gpg --card-edit, fetch)"
    fi
fi

echo "--- gpg-agent SSH path"
if command -v gpg-connect-agent >/dev/null 2>&1; then
    gpg-connect-agent /bye >/dev/null 2>&1 && pass "gpg-agent reachable" || bad "gpg-agent not reachable"
    sock=$(gpgconf --list-dirs agent-ssh-socket 2>/dev/null)
    echo "gpg-agent ssh socket: ${sock:-unknown} (needs 'enable-ssh-support' in gpg-agent.conf)"
    if [ -n "${sock:-}" ] && command -v ssh-add >/dev/null 2>&1; then
        if SSH_AUTH_SOCK="$sock" ssh-add -L; then pass "ssh-add -L via gpg-agent lists a key"; else skip "ssh-add -L: no key exposed (authentication subkey missing or ssh support disabled)"; fi
    fi
else
    skip "gpg-connect-agent not installed"
fi
echo "All results are pending hardware until recorded in docs/hw-reports/."
exit $fail
