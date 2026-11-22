#!/bin/sh
# Throw-away PAM test for pam_multikey.so using pamtester.
# Creates /etc/pam.d/multikey-test (ONLY that file), runs one authenticate, removes it.
# Never touches login, sudo, sshd, system-auth or any other service.
# Status: written, NOT run on any machine; the module is not hardware verified.
set -eu

SERVICE=multikey-test
SERVICE_FILE="/etc/pam.d/$SERVICE"
TRUST_STORE=/etc/multikey/trusted.toml
USER_NAME="${SUDO_USER:-$(id -un)}"
ACK=0

usage() {
    echo "usage: sudo $0 --i-understand [--trust-store PATH] [--user NAME]"
    echo "Tests pam_multikey.so through a temporary service '$SERVICE' (pending hardware)."
    echo "Requires: root, pamtester, pam_multikey.so installed, user enrolled (multikey enroll)."
}

while [ $# -gt 0 ]; do
    case "$1" in
        --i-understand) ACK=1 ;;
        --trust-store) shift; TRUST_STORE="${1:?missing path}" ;;
        --user) shift; USER_NAME="${1:?missing name}" ;;
        -h|--help) usage; exit 0 ;;
        *) usage; exit 2 ;;
    esac
    shift
done

if [ "$ACK" != 1 ]; then
    usage
    echo "Refusing to run without --i-understand." >&2
    exit 2
fi
if [ "$(id -u)" != 0 ]; then
    echo "Run as root (writes $SERVICE_FILE)." >&2
    exit 2
fi
command -v pamtester >/dev/null 2>&1 || { echo "pamtester not found" >&2; exit 2; }
if [ -e "$SERVICE_FILE" ]; then
    echo "$SERVICE_FILE already exists; not overwriting." >&2
    exit 2
fi

cleanup() {
    rm -f "$SERVICE_FILE"
}
trap cleanup EXIT INT TERM

cat > "$SERVICE_FILE" <<EOF
auth sufficient pam_multikey.so trust_store=$TRUST_STORE timeout=20 debug
auth required pam_deny.so
EOF

echo "Plug in the key; press its button when it blinks (within 20 s)."
# pamtester exit 0 = authenticated, non-zero = denied (pam_deny reached).
if pamtester "$SERVICE" "$USER_NAME" authenticate; then
    echo "RESULT: authenticated by pam_multikey (pending hardware: first real run)."
else
    echo "RESULT: not authenticated (see syslog/journal for 'pam_multikey' debug lines)."
    exit 1
fi
