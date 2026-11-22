#!/bin/sh
# SSH security-key smoke test for the MultiKey FIDO2 image.
# Status: Implemented; NOT run against hardware (pending hardware). Needs a plugged-in key, button presses,
# and (for verify-required) the device PIN typed by you at ssh-keygen's prompt. Does not modify any git/ssh config.
# Usage: tools/ssh_smoke.sh --yes
set -u

if [ "${1:-}" != "--yes" ]; then
    echo "This creates RESIDENT credentials (application ssh:multikey-test) on the connected key and needs button presses."
    echo "Re-run with --yes to proceed. Nothing was touched."
    exit 64
fi

fail=0
pass() { echo "[PASS] $1"; }
bad()  { echo "[FAIL] $1"; fail=1; }
skip() { echo "[SKIP] $1"; }

ver=$(ssh -V 2>&1 | sed -n 's/^OpenSSH_\([0-9][0-9]*\)\.\([0-9][0-9]*\).*/\1 \2/p')
[ -n "$ver" ] || { echo "cannot parse 'ssh -V'"; exit 1; }
maj=${ver% *}; min=${ver#* }
if [ "$maj" -lt 8 ] || { [ "$maj" -eq 8 ] && [ "$min" -lt 3 ]; }; then
    echo "OpenSSH $maj.$min < 8.3: not supported by this script (sk keys appeared in 8.2; verify-required in 8.4)."
    exit 1
fi
vr="-O verify-required"
if [ "$maj" -eq 8 ] && [ "$min" -lt 4 ]; then
    echo "note: OpenSSH $maj.$min < 8.4: omitting -O verify-required."
    vr=""
fi

# EdDSA advertised by GetInfo? (needs python + fido2 from tools/requirements.txt)
eddsa=unknown
if command -v python3 >/dev/null 2>&1; then
    eddsa=$(python3 - <<'PY' 2>/dev/null || echo unknown
from fido2.hid import CtapHidDevice
from fido2.ctap2 import Ctap2
d = next(iter(CtapHidDevice.list_devices()), None)
print("unknown" if d is None else ("yes" if -8 in [a.get("alg") for a in Ctap2(d).get_info().algorithms] else "no"))
PY
)
fi

tmp=$(mktemp -d) || exit 1
trap 'rm -rf "$tmp"' EXIT INT TERM
cd "$tmp" || exit 1
echo "working in $tmp (removed on exit). Resident credentials on the device are NOT removed; delete them with ctap_smoke-style credential management or 'ykman'-like tools."

echo "--- ecdsa-sk (touch the key when it blinks)"
# shellcheck disable=SC2086
if ssh-keygen -t ecdsa-sk -O resident $vr -O application=ssh:multikey-test -f "$tmp/id" -N '' -C multikey-smoke; then
    pass "ssh-keygen -t ecdsa-sk (resident)"
else
    bad "ssh-keygen -t ecdsa-sk"
fi

echo "--- ed25519-sk"
if [ "$eddsa" = yes ]; then
    # shellcheck disable=SC2086
    if ssh-keygen -t ed25519-sk -O resident $vr -O application=ssh:multikey-test -f "$tmp/id_ed" -N '' -C multikey-smoke-ed; then
        pass "ssh-keygen -t ed25519-sk (resident)"
    else
        bad "ssh-keygen -t ed25519-sk"
    fi
else
    skip "ed25519-sk: GetInfo EdDSA support is '$eddsa' (needs python3 + fido2 and a device advertising alg -8)"
fi

echo "--- download resident keys (ssh-keygen -K) into the temp dir"
mkdir dl && (cd dl && ssh-keygen -K) && ls dl | grep -q . && pass "ssh-keygen -K" || bad "ssh-keygen -K"

echo "--- commit-style signing with the sk key (touch required)"
if [ -f "$tmp/id.pub" ]; then
    echo "multikey smoke message" > msg.txt
    if ssh-keygen -Y sign -f "$tmp/id.pub" -n git msg.txt && [ -f msg.txt.sig ]; then
        pass "ssh-keygen -Y sign"
        if ssh-keygen -Y check-novalidate -n git -s msg.txt.sig < msg.txt; then
            pass "ssh-keygen -Y check-novalidate"
        else
            bad "ssh-keygen -Y check-novalidate"
        fi
    else
        bad "ssh-keygen -Y sign"
    fi
else
    skip "sign: no id.pub (key generation failed)"
fi

cat <<'EOF'

--- To use the key for Git commit signing (this script changes NO git config; run these yourself):
  git config --global gpg.format ssh
  git config --global user.signingkey /path/to/id_ecdsa_sk.pub     # or: "key::sk-ecdsa-sha2-nistp256@openssh.com AAAA..."
  git config --global commit.gpgsign true
  # verification needs an allowed-signers file:
  git config --global gpg.ssh.allowedSignersFile ~/.config/git/allowed_signers
All results above are pending hardware until a human records them in docs/hw-reports/.
EOF
exit $fail
