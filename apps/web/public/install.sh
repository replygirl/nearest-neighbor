#!/usr/bin/env sh
# install.sh — one-liner installer for the `nbr` CLI
#
# Usage:
#   curl -fsSL https://nearest-neighbor.replygirl.club/install.sh | sh
#
# Installs the latest v<n>.<n>.<n> platform release of `nbr` to ~/.local/bin
# (or $CARGO_HOME/bin if that directory exists and is on $PATH).
#
# Supports:
#   macOS   aarch64 (Apple Silicon) / x86_64 (Intel)
#   Linux   aarch64 / x86_64  (musl static binary, no runtime deps)
#
# Windows users: download the .zip from the GitHub Release page or use
#   cargo install --git https://github.com/replygirl/nearest-neighbor \
#     --manifest-path cli/Cargo.toml nbr
#
# Environment variables:
#   NBR_VERSION    install a specific version, e.g. NBR_VERSION=0.2.0
#   NBR_INSTALL_DIR  override the install directory

set -eu

REPO="replygirl/nearest-neighbor"
BINARY="nbr"
GITHUB_API="https://api.github.com"
GITHUB_DL="https://github.com"

# ── Detect OS and architecture ───────────────────────────────────────────────

os="$(uname -s)"
arch="$(uname -m)"

case "${os}" in
  Darwin)
    case "${arch}" in
      arm64)  triple="aarch64-apple-darwin"      ;;
      x86_64) triple="x86_64-apple-darwin"        ;;
      *)
        echo "error: unsupported macOS architecture: ${arch}" >&2
        exit 1
        ;;
    esac
    ;;
  Linux)
    case "${arch}" in
      aarch64|arm64) triple="aarch64-unknown-linux-musl" ;;
      x86_64)        triple="x86_64-unknown-linux-musl"  ;;
      *)
        echo "error: unsupported Linux architecture: ${arch}" >&2
        exit 1
        ;;
    esac
    ;;
  *)
    echo "error: unsupported OS: ${os}" >&2
    echo "Windows users: download from https://github.com/${REPO}/releases" >&2
    exit 1
    ;;
esac

# ── Resolve version ──────────────────────────────────────────────────────────

if [ -n "${NBR_VERSION:-}" ]; then
  tag="v${NBR_VERSION}"
  echo "Installing ${BINARY} ${NBR_VERSION} (pinned)..."
else
  echo "Fetching latest platform release (including prereleases)..."
  # Use /releases (not /releases/latest) so prereleases are included.
  # The full platform ships under a single v<n>.<n>.<n> tag.
  tag="$(curl -fsSL "${GITHUB_API}/repos/${REPO}/releases" \
    | grep -o '"tag_name": *"v[^"]*"' \
    | head -1 \
    | grep -o 'v[^"]*')"
  if [ -z "${tag}" ]; then
    echo "error: could not determine latest release tag" >&2
    exit 1
  fi
  version="${tag#v}"
  echo "Latest: ${tag} (${version})"
fi

version="${tag#v}"

# ── Resolve install directory ────────────────────────────────────────────────

if [ -n "${NBR_INSTALL_DIR:-}" ]; then
  install_dir="${NBR_INSTALL_DIR}"
elif [ -n "${CARGO_HOME:-}" ] && [ -d "${CARGO_HOME}/bin" ]; then
  install_dir="${CARGO_HOME}/bin"
else
  install_dir="${HOME}/.local/bin"
fi

mkdir -p "${install_dir}"

# ── Check if already installed and up to date ────────────────────────────────

existing="$(command -v "${BINARY}" 2>/dev/null || true)"
if [ -n "${existing}" ]; then
  installed_ver="$("${existing}" --version 2>/dev/null | awk '{print $2}' || true)"
  if [ "${installed_ver}" = "${version}" ]; then
    echo "${BINARY} ${version} is already installed at ${existing}."
    exit 0
  fi
fi

# ── Download ─────────────────────────────────────────────────────────────────

archive_name="${BINARY}-${triple}.tar.gz"
download_url="${GITHUB_DL}/${REPO}/releases/download/${tag}/${archive_name}"
checksum_url="${GITHUB_DL}/${REPO}/releases/download/${tag}/SHA256SUMS"

tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

echo "Downloading ${archive_name}..."
curl -fsSL --progress-bar -o "${tmpdir}/${archive_name}" "${download_url}"

# ── Verify checksum ───────────────────────────────────────────────────────────

echo "Verifying checksum..."
curl -fsSL -o "${tmpdir}/SHA256SUMS" "${checksum_url}"

(
  cd "${tmpdir}"
  if command -v sha256sum >/dev/null 2>&1; then
    grep "${archive_name}" SHA256SUMS | sha256sum --check --status
  elif command -v shasum >/dev/null 2>&1; then
    grep "${archive_name}" SHA256SUMS | shasum -a 256 --check --status
  else
    echo "warning: no sha256 tool found; skipping checksum verification" >&2
  fi
)

# ── Extract and install ───────────────────────────────────────────────────────

echo "Extracting..."
tar -xzf "${tmpdir}/${archive_name}" -C "${tmpdir}"

src="${tmpdir}/${BINARY}-${triple}/${BINARY}"
if [ ! -f "${src}" ]; then
  echo "error: expected binary not found in archive: ${src}" >&2
  exit 1
fi

install -m 755 "${src}" "${install_dir}/${BINARY}"
echo "Installed: ${install_dir}/${BINARY}"

# ── PATH hint ─────────────────────────────────────────────────────────────────

case ":${PATH}:" in
  *":${install_dir}:"*) ;;
  *)
    echo ""
    echo "NOTE: ${install_dir} is not on your PATH."
    echo "Add it to your shell profile:"
    echo "  export PATH=\"${install_dir}:\$PATH\""
    ;;
esac

echo ""
echo "Run: ${BINARY} --help"
