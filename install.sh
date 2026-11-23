#!/bin/sh
#
# MultiKeys host tool installer for Linux x86_64.
#
#   curl -fsSL https://get.mewis.me/esp32-security-key.sh | sh
#   curl -fsSL https://get.mewis.me/esp32-security-key.sh | sh -s -- --pam
#   curl -fsSL https://get.mewis.me/esp32-security-key.sh | sh -s -- --uninstall
#
# `sh -s -- --help` lists the options and environment variables. Everything below is a function and main runs on the
# last line, so a download that is cut short runs nothing.
set -eu

repo="mewisme/esp32-security-key"
binary="multikey"
pam_module="pam_multikey.so"
# Where distributions keep PAM modules; the right one is the directory that already holds pam_unix.so.
pam_dirs="/lib/x86_64-linux-gnu/security /usr/lib/x86_64-linux-gnu/security /lib64/security /usr/lib64/security /lib/security /usr/lib/security"

fail() {
  printf 'MultiKeys installer: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: install.sh [--version VERSION] [--pam] [--uninstall]

Installs the MultiKeys host tool (multikey) from a GitHub release after checking
its SHA-256 against the release's SHA256SUMS. It does not touch the key and does
not edit /etc/pam.d.

Options:
  --version VERSION  install this release (v0.2.0 or 0.2.0) instead of the latest
  --pam              also install the PAM module pam_multikey.so (needs root)
  --uninstall        remove multikey; with --pam also the PAM module, which is
                     refused while a file in /etc/pam.d still uses it
  --help             show this help

Environment:
  MULTIKEY_VERSION       same as --version
  MULTIKEY_INSTALL_DIR   directory for multikey (default ~/.local/bin, /usr/local/bin as root)
  MULTIKEY_SHARE_DIR     directory for LICENSE and THIRD_PARTY_LICENSES.txt
                         (default ~/.local/share/multikey, /usr/local/share/multikey as root)
  MULTIKEY_PAM_DIR       PAM module directory (default: the one that holds pam_unix.so)
  MULTIKEY_PAM_CONF_DIR  PAM service files checked before the module is removed
                         (default /etc/pam.d)
  MULTIKEY_BASE_URL      release download base (default
                         https://github.com/mewisme/esp32-security-key/releases/download)
EOF
}

is_root() {
  [ "$(id -u)" -eq 0 ]
}

needs_sudo() {
  ! is_root && [ ! -w "$1" ]
}

# Runs a command that writes into directory $1: directly when that is allowed, through sudo otherwise.
write_in() {
  target_dir="$1"
  shift
  if ! needs_sudo "$target_dir"; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    fail "writing to $target_dir needs root: run this installer as root or install sudo"
  fi
}

set_default_dirs() {
  install_dir="${MULTIKEY_INSTALL_DIR:-}"
  share_dir="${MULTIKEY_SHARE_DIR:-}"
  if [ -n "$install_dir" ] && [ -n "$share_dir" ]; then
    return 0
  fi
  if is_root; then
    : "${install_dir:=/usr/local/bin}" "${share_dir:=/usr/local/share/multikey}"
  else
    [ -n "${HOME:-}" ] || fail "HOME is not set; set MULTIKEY_INSTALL_DIR and MULTIKEY_SHARE_DIR"
    : "${install_dir:=$HOME/.local/bin}" "${share_dir:=${XDG_DATA_HOME:-$HOME/.local/share}/multikey}"
  fi
}

check_platform() {
  os="$(uname -s)"
  case "$os" in
    Linux) ;;
    MINGW*|MSYS*|CYGWIN*|Windows_NT) fail "this is the Linux installer; on Windows run in PowerShell: irm https://get.mewis.me/esp32-security-key.ps1 | iex" ;;
    *) fail "unsupported operating system: $os (releases carry Windows and Linux x86_64 builds; to build from source run: cd host && cargo build --release)" ;;
  esac
  machine="$(uname -m)"
  case "$machine" in
    x86_64|amd64) arch="x86_64" ;;
    *) fail "unsupported architecture: $machine (releases carry x86_64 builds only; to build from source run: cd host && cargo build --release)" ;;
  esac
}

resolve_tag() {
  if [ -n "$version" ]; then
    case "$version" in
      v*) tag="$version" ;;
      *) tag="v$version" ;;
    esac
  else
    latest_url="$(curl -fsSL -o /dev/null -w '%{url_effective}' "https://github.com/$repo/releases/latest")" ||
      fail "could not look up the latest release; set MULTIKEY_VERSION (for example v0.2.0) to skip the lookup"
    tag="${latest_url##*/}"
  fi
  # The tag becomes part of URLs and file names.
  case "$tag" in
    v[0-9]*.[0-9]*.[0-9]*) ;;
    *) fail "invalid release tag: $tag (expected for example v0.2.0)" ;;
  esac
  case "$tag" in
    *[!0-9A-Za-z.-]*) fail "invalid release tag: $tag (expected for example v0.2.0)" ;;
  esac
}

download() {
  curl -fsSL --retry 3 --retry-delay 1 -o "$2" "$1" || fail "download failed: $1"
}

# Checks file $1 against its line for asset name $2 in the release's SHA256SUMS.
verify() {
  expected="$(awk -v file="$2" '{ name = $2; sub(/^\*/, "", name); if (name == file) { print $1; exit } }' "$tmp_dir/SHA256SUMS")"
  [ -n "$expected" ] || fail "SHA256SUMS has no entry for $2"
  if command -v sha256sum >/dev/null 2>&1; then
    actual="$(sha256sum "$1" | awk '{ print $1 }')"
  elif command -v shasum >/dev/null 2>&1; then
    actual="$(shasum -a 256 "$1" | awk '{ print $1 }')"
  else
    fail "sha256sum or shasum is required to verify the download"
  fi
  [ "$actual" = "$expected" ] || fail "checksum verification failed for $2"
}

# Downloads, verifies and unpacks release asset $1; archive_root is the directory it unpacked to.
fetch_archive() {
  asset="$1"
  download "$base_url/$tag/$asset" "$tmp_dir/$asset"
  verify "$tmp_dir/$asset" "$asset"
  tar -xzf "$tmp_dir/$asset" -C "$tmp_dir" || fail "could not extract $asset"
  archive_root="$tmp_dir/${asset%.tar.gz}"
}

install_cli() {
  fetch_archive "multikey-$tag-linux-$arch.tar.gz"
  [ -f "$archive_root/$binary" ] || fail "unexpected archive layout: $binary is missing"
  mkdir -p "$install_dir" "$share_dir" || fail "could not create $install_dir and $share_dir"
  install -m 0755 "$archive_root/$binary" "$install_dir/$binary" || fail "could not write $install_dir/$binary"
  for notice in LICENSE THIRD_PARTY_LICENSES.txt; do
    install -m 0644 "$archive_root/$notice" "$share_dir/$notice" || fail "could not write $share_dir/$notice"
  done
  if ! version_line="$("$install_dir/$binary" --version 2>&1)"; then
    fail "$install_dir/$binary was installed but does not run: $version_line (it needs libpcsclite1 and libudev1, for example: sudo apt install libpcsclite1 libudev1 pcscd, and glibc 2.35 or newer)"
  fi
  printf 'Installed %s to %s\n' "$version_line" "$install_dir/$binary"
  case ":${PATH:-}:" in
    *":$install_dir:"*) ;;
    *) printf 'Add %s to PATH to run %s from any shell.\n' "$install_dir" "$binary" ;;
  esac
}

find_pam_dir() {
  if [ -n "${MULTIKEY_PAM_DIR:-}" ]; then
    pam_dir="$MULTIKEY_PAM_DIR"
    [ -d "$pam_dir" ] || fail "PAM module directory does not exist: $pam_dir"
    return 0
  fi
  # shellcheck disable=SC2086 # the default directories have no spaces
  set -- $pam_dirs
  for candidate in "$@"; do
    if [ -e "$candidate/pam_unix.so" ]; then
      pam_dir="$candidate"
      return 0
    fi
  done
  fail "could not find the PAM module directory (no pam_unix.so in the usual places); set MULTIKEY_PAM_DIR"
}

# Decides where the PAM module goes and, if that needs root, asks for it now, before anything is installed.
prepare_pam() {
  find_pam_dir
  if needs_sudo "$pam_dir"; then
    command -v sudo >/dev/null 2>&1 ||
      fail "installing $pam_module into $pam_dir needs root: run this installer as root or install sudo"
    printf 'Installing %s into %s needs root; sudo may ask for your password.\n' "$pam_module" "$pam_dir"
    sudo -v || fail "could not get root privileges with sudo"
  fi
}

install_pam() {
  fetch_archive "multikey-pam-$tag-linux-$arch.tar.gz"
  [ -f "$archive_root/$pam_module" ] || fail "unexpected archive layout: $pam_module is missing"
  # Staged in the target directory, then renamed: a module that is already in use is replaced in one step and the file
  # keeps the directory's security context.
  staged="$pam_dir/.$pam_module.$$"
  write_in "$pam_dir" install -m 0644 "$archive_root/$pam_module" "$staged" || fail "could not write into $pam_dir"
  write_in "$pam_dir" mv -f "$staged" "$pam_dir/$pam_module" || {
    write_in "$pam_dir" rm -f "$staged" || true
    fail "could not replace $pam_dir/$pam_module"
  }
  printf 'Installed %s to %s\n' "$pam_module" "$pam_dir"
  printf 'It is not enabled: nothing in /etc/pam.d was changed. Enroll a key (multikey mkauth enroll --user NAME), test it\n'
  printf 'with a throw-away PAM service and keep a root shell open while you do. Rollout and recovery:\n'
  printf 'https://github.com/%s/blob/main/docs/LINUX_PAM.md\n' "$repo"
}

do_install() {
  check_platform
  set_default_dirs
  for tool in curl tar install awk mktemp; do
    command -v "$tool" >/dev/null 2>&1 || fail "$tool is required"
  done
  if [ "$with_pam" -eq 1 ]; then
    prepare_pam
  fi
  resolve_tag

  tmp_dir="$(mktemp -d 2>/dev/null || mktemp -d -t multikey)"
  trap 'rm -rf "$tmp_dir"' EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM

  printf 'Installing MultiKeys %s (linux/%s)\n' "$tag" "$arch"
  download "$base_url/$tag/SHA256SUMS" "$tmp_dir/SHA256SUMS"
  install_cli
  if [ "$with_pam" -eq 1 ]; then
    install_pam
  else
    printf 'To also install the PAM module for Linux login keys, run this installer again with --pam.\n'
  fi
}

# Lists the PAM service files that use the module.
pam_users() {
  [ -d "$pam_conf_dir" ] || return 0
  for service_file in "$pam_conf_dir"/*; do
    [ -f "$service_file" ] || continue
    if grep -v '^[[:space:]]*#' "$service_file" 2>/dev/null | grep -q 'pam_multikey'; then
      printf '  %s\n' "$service_file"
    fi
  done
}

do_uninstall() {
  set_default_dirs
  # Check first, so a refusal leaves everything as it was: a PAM line whose module is gone can break logins.
  if [ "$with_pam" -eq 1 ]; then
    users="$(pam_users)"
    if [ -n "$users" ]; then
      fail "$pam_module is still used by:
$users
Remove those lines first, then run the uninstall again."
    fi
  fi

  removed=0
  if [ -e "$install_dir/$binary" ]; then
    rm -f "$install_dir/$binary" || fail "could not remove $install_dir/$binary"
    printf 'Removed %s\n' "$install_dir/$binary"
    removed=1
  fi
  for notice in LICENSE THIRD_PARTY_LICENSES.txt; do
    rm -f "$share_dir/$notice"
  done
  rmdir "$share_dir" 2>/dev/null || true

  if [ -n "${MULTIKEY_PAM_DIR:-}" ]; then
    set -- "$MULTIKEY_PAM_DIR"
  else
    # shellcheck disable=SC2086 # the default directories have no spaces
    set -- $pam_dirs
  fi
  for candidate in "$@"; do
    [ -e "$candidate/$pam_module" ] || continue
    if [ "$with_pam" -eq 1 ]; then
      write_in "$candidate" rm -f "$candidate/$pam_module" || fail "could not remove $candidate/$pam_module"
      printf 'Removed %s\n' "$candidate/$pam_module"
      removed=1
    else
      printf '%s is still installed in %s; run the uninstall with --pam to remove it.\n' "$pam_module" "$candidate"
      break
    fi
  done

  if [ "$removed" -eq 0 ]; then
    printf 'MultiKeys is not installed in %s\n' "$install_dir"
  fi
  if [ -e /etc/multikey/trusted.toml ]; then
    printf 'Left /etc/multikey/trusted.toml (the enrolled login keys) in place; delete it yourself if you do not need it.\n'
  fi
}

main() {
  mode="install"
  with_pam=0
  version="${MULTIKEY_VERSION:-}"
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --uninstall) mode="uninstall" ;;
      --pam) with_pam=1 ;;
      --version)
        [ "$#" -ge 2 ] || fail "--version needs a value"
        version="$2"
        shift
        ;;
      --version=*) version="${1#--version=}" ;;
      -h|--help)
        usage
        return 0
        ;;
      *) fail "unknown option: $1 (try --help)" ;;
    esac
    shift
  done

  base_url="${MULTIKEY_BASE_URL:-https://github.com/$repo/releases/download}"
  pam_conf_dir="${MULTIKEY_PAM_CONF_DIR:-/etc/pam.d}"

  if [ "$mode" = "uninstall" ]; then
    do_uninstall
  else
    do_install
  fi
}

main "$@"
