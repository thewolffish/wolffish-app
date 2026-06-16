#!/bin/sh
set -eu

RELEASES_BASE="https://releases.wolffi.sh"
TEMP_DIR=""

# Colors
if [ -t 1 ]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  BLUE='\033[0;34m'
  CYAN='\033[0;36m'
  BOLD='\033[1m'
  RESET='\033[0m'
else
  RED='' GREEN='' YELLOW='' BLUE='' CYAN='' BOLD='' RESET=''
fi

cleanup() {
  if [ -n "$TEMP_DIR" ] && [ -d "$TEMP_DIR" ]; then
    rm -rf "$TEMP_DIR"
  fi
}
trap cleanup EXIT INT TERM

info()  { printf "${BLUE}[i]${RESET} %s\n" "$1"; }
ok()    { printf "${GREEN}[+]${RESET} %s\n" "$1"; }
warn()  { printf "${YELLOW}[!]${RESET} %s\n" "$1"; }
err()   { printf "${RED}[x]${RESET} %s\n" "$1" >&2; }
die()   { err "$1"; exit 1; }

banner() {
  printf "${CYAN}"
  cat << 'EOF'

  ╦ ╦╔═╗╦  ╔═╗╔═╗╦╔═╗╦ ╦
  ║║║║ ║║  ╠╣ ╠╣ ║╚═╗╠═╣
  ╚╩╝╚═╝╩═╝╚  ╚  ╩╚═╝╩ ╩

EOF
  printf "${RESET}"
  printf "  ${BOLD}Wolffish Installer${RESET}\n\n"
}

usage() {
  banner
  printf "Usage: install.sh [OPTIONS]\n\n"
  printf "Options:\n"
  printf "  --help       Show this help message\n"
  printf "  --version    Print the latest available version and exit\n"
  printf "\nInstalls Wolffish on macOS (.dmg), Linux (.deb/.rpm/.AppImage), or Windows (.exe).\n"
  exit 0
}

detect_os() {
  case "$(uname -s)" in
    Darwin)          echo "macos" ;;
    Linux)           echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *)               die "Unsupported operating system: $(uname -s)" ;;
  esac
}

fetch_manifest() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" || die "Failed to download manifest from $url"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$url" || die "Failed to download manifest from $url"
  else
    die "Neither curl nor wget found. Cannot download files."
  fi
}

download_file() {
  local url="$1" dest="$2"
  info "Downloading from $url ..."
  if command -v curl >/dev/null 2>&1; then
    curl -fSL --progress-bar -o "$dest" "$url" \
      --retry 5 --retry-delay 3 --retry-connrefused -C - \
      || die "Download failed: $url"
  elif command -v wget >/dev/null 2>&1; then
    wget --show-progress -qO "$dest" "$url" \
      --tries=5 --wait=3 -c \
      || die "Download failed: $url"
  fi
}

parse_version() {
  local manifest="$1"
  echo "$manifest" | grep '^version:' | sed 's/^version: *//'
}

parse_url() {
  local manifest="$1" extension="$2"
  echo "$manifest" | grep "url:" | grep "\.${extension}" | head -1 | sed 's/.*url: *//'
}

parse_sha512() {
  local manifest="$1" filename="$2"
  local in_entry=0
  echo "$manifest" | while IFS= read -r line; do
    if echo "$line" | grep -q "url:.*${filename}"; then
      in_entry=1
    elif [ "$in_entry" = "1" ] && echo "$line" | grep -q "sha512:"; then
      echo "$line" | sed 's/.*sha512: *//'
      break
    elif [ "$in_entry" = "1" ] && echo "$line" | grep -q "^  - "; then
      break
    fi
  done
}

verify_checksum() {
  local file="$1" expected_b64="$2" os="$3"

  info "Verifying checksum..."

  if [ "$os" = "macos" ]; then
    actual_hex=$(shasum -a 512 "$file" | awk '{print $1}')
  elif command -v sha512sum >/dev/null 2>&1; then
    actual_hex=$(sha512sum "$file" | awk '{print $1}')
  elif command -v shasum >/dev/null 2>&1; then
    actual_hex=$(shasum -a 512 "$file" | awk '{print $1}')
  else
    warn "No sha512 tool found - skipping checksum verification"
    return 0
  fi

  expected_hex=$(echo "$expected_b64" | base64 -d 2>/dev/null | od -An -tx1 | tr -d ' \n' || \
                 echo "$expected_b64" | base64 --decode 2>/dev/null | od -An -tx1 | tr -d ' \n')

  if [ -z "$expected_hex" ]; then
    die "Failed to decode base64 checksum from manifest"
  fi

  if [ "$actual_hex" != "$expected_hex" ]; then
    err "Checksum mismatch!"
    err "  Expected: $expected_hex"
    err "  Got:      $actual_hex"
    die "The downloaded file may be corrupted. Aborting."
  fi

  ok "Checksum verified"
}

install_macos() {
  local dmg_path="$1"

  info "Mounting disk image..."
  local mount_point
  mount_point=$(hdiutil attach -nobrowse -readonly "$dmg_path" 2>/dev/null | grep '/Volumes/' | sed 's/.*\(\/Volumes\/.*\)/\1/')

  if [ -z "$mount_point" ]; then
    die "Failed to mount .dmg"
  fi

  local app_path
  app_path=$(find "$mount_point" -maxdepth 1 -name "*.app" | head -1)

  if [ -z "$app_path" ]; then
    hdiutil detach "$mount_point" -quiet 2>/dev/null || true
    die "No .app found in disk image"
  fi

  local app_name
  app_name=$(basename "$app_path")

  info "Installing $app_name to /Applications..."
  if [ -d "/Applications/$app_name" ]; then
    rm -rf "/Applications/$app_name"
  fi
  cp -R "$app_path" "/Applications/"

  info "Unmounting disk image..."
  hdiutil detach "$mount_point" -quiet 2>/dev/null || true

  ok "Wolffish installed to /Applications/$app_name"
  info "You can launch it from Spotlight or run: open /Applications/$app_name"
}

# True if we can run a command as root (already root, or sudo is available).
can_root() {
  [ "$(id -u)" -eq 0 ] && return 0
  command -v sudo >/dev/null 2>&1
}

# Run a command as root — directly when already root, otherwise via sudo.
as_root() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

# Native package format for this distro, chosen by available package manager.
# deb covers Debian/Ubuntu/Mint/Pop!_OS/etc.; rpm covers Fedora/RHEL/openSUSE/etc.;
# anything else (e.g. Arch) gets the portable AppImage.
detect_linux_format() {
  if command -v apt-get >/dev/null 2>&1 || command -v dpkg >/dev/null 2>&1; then
    echo deb
  elif command -v dnf >/dev/null 2>&1 || command -v zypper >/dev/null 2>&1 \
    || command -v yum >/dev/null 2>&1 || command -v rpm >/dev/null 2>&1; then
    echo rpm
  else
    echo AppImage
  fi
}

# Pick the best artifact to install: the native .deb/.rpm when we can actually
# install it (supported package manager AND root AND the release ships it),
# otherwise the portable AppImage, which installs under $HOME with no root.
choose_linux_extension() {
  local manifest="$1" fmt
  fmt=$(detect_linux_format)
  if [ "$fmt" != "AppImage" ]; then
    if ! can_root; then
      fmt="AppImage"
    elif [ -z "$(parse_url "$manifest" "$fmt")" ]; then
      fmt="AppImage"
    fi
  fi
  echo "$fmt"
}

# Install a .deb via apt (resolves dependencies); fall back to dpkg + apt -f.
install_deb() {
  info "Installing the Debian package (you may be prompted for your password)..."
  if command -v apt-get >/dev/null 2>&1; then
    if ! as_root apt-get install -y "$1"; then
      as_root dpkg -i "$1" || true
      as_root apt-get install -f -y || return 1
    fi
  else
    as_root dpkg -i "$1" || return 1
  fi
  ok "Wolffish installed — find it in your application menu or run: wolffish"
}

# Install a .rpm via the system package manager (resolves dependencies).
install_rpm() {
  info "Installing the RPM package (you may be prompted for your password)..."
  if command -v dnf >/dev/null 2>&1; then
    as_root dnf install -y "$1" || return 1
  elif command -v zypper >/dev/null 2>&1; then
    as_root zypper --non-interactive install --allow-unsigned-rpm "$1" || return 1
  elif command -v yum >/dev/null 2>&1; then
    as_root yum install -y "$1" || return 1
  else
    as_root rpm -i "$1" || return 1
  fi
  ok "Wolffish installed — find it in your application menu or run: wolffish"
}

# Portable AppImage: install to ~/.local/bin (no root needed). Universal fallback.
install_appimage() {
  local install_dir="$HOME/.local/bin"

  mkdir -p "$install_dir"

  info "Installing to $install_dir/wolffish..."
  cp "$1" "$install_dir/wolffish"
  chmod +x "$install_dir/wolffish"

  ok "Wolffish installed to $install_dir/wolffish"

  if ! echo "$PATH" | grep -q "$install_dir"; then
    warn "$install_dir is not in your PATH"
    info "Add it with: export PATH=\"\$HOME/.local/bin:\$PATH\""
  fi

  info "Launch with: wolffish"
}

# Dispatch to the right installer for the chosen artifact. If a native package
# install fails, best-effort fall back to the portable AppImage.
install_linux() {
  local path="$1" ext="$2" manifest="$3" os="$4" ai_url ai_file ai_sha

  case "$ext" in
    deb) install_deb "$path" && return 0 ;;
    rpm) install_rpm "$path" && return 0 ;;
    *)   install_appimage "$path"; return $? ;;
  esac

  warn "Native package install failed; falling back to the portable AppImage..."
  ai_url=$(parse_url "$manifest" "AppImage")
  [ -n "$ai_url" ] || die "No AppImage available to fall back to"
  ai_file="$TEMP_DIR/$(basename "$ai_url")"
  download_file "$RELEASES_BASE/$ai_url" "$ai_file"
  ai_sha=$(parse_sha512 "$manifest" "$(basename "$ai_url")")
  [ -n "$ai_sha" ] && verify_checksum "$ai_file" "$ai_sha" "$os"
  install_appimage "$ai_file"
}

install_windows() {
  local exe_path="$1"

  info "Running installer silently..."
  "$exe_path" /S
  ok "Wolffish installed"
  info "You can launch Wolffish from the Start Menu."
}

main() {
  for arg in "$@"; do
    case "$arg" in
      --help|-h) usage ;;
      --version|-v)
        os=$(detect_os)
        case "$os" in
          macos)   manifest=$(fetch_manifest "$RELEASES_BASE/latest-mac.yml") ;;
          linux)   manifest=$(fetch_manifest "$RELEASES_BASE/latest-linux.yml") ;;
          windows) manifest=$(fetch_manifest "$RELEASES_BASE/latest.yml") ;;
        esac
        version=$(parse_version "$manifest")
        printf "%s\n" "$version"
        exit 0
        ;;
      *) die "Unknown option: $arg. Use --help for usage." ;;
    esac
  done

  banner

  os=$(detect_os)
  info "Detected OS: $os"

  case "$os" in
    macos)
      manifest=$(fetch_manifest "$RELEASES_BASE/latest-mac.yml")
      extension="dmg"
      ;;
    linux)
      manifest=$(fetch_manifest "$RELEASES_BASE/latest-linux.yml")
      extension=$(choose_linux_extension "$manifest")
      info "Selected Linux package: .$extension"
      ;;
    windows)
      manifest=$(fetch_manifest "$RELEASES_BASE/latest.yml")
      extension="exe"
      ;;
  esac

  version=$(parse_version "$manifest")
  if [ -z "$version" ]; then
    die "Could not determine latest version from manifest"
  fi
  ok "Latest version: $version"

  rel_url=$(parse_url "$manifest" "$extension")
  if [ -z "$rel_url" ]; then
    die "Could not find .$extension download URL in manifest"
  fi

  filename=$(basename "$rel_url")
  sha512_b64=$(parse_sha512 "$manifest" "$filename")
  if [ -z "$sha512_b64" ]; then
    warn "No checksum found in manifest - skipping verification"
  fi

  download_url="$RELEASES_BASE/$rel_url"

  TEMP_DIR=$(mktemp -d)
  local dest="$TEMP_DIR/$filename"

  download_file "$download_url" "$dest"
  ok "Download complete"

  if [ -n "$sha512_b64" ]; then
    verify_checksum "$dest" "$sha512_b64" "$os"
  fi

  case "$os" in
    macos)   install_macos "$dest" ;;
    linux)   install_linux "$dest" "$extension" "$manifest" "$os" ;;
    windows) install_windows "$dest" ;;
  esac

  printf "\n  ${GREEN}${BOLD}Wolffish v%s installed successfully!${RESET}\n\n" "$version"
}

main "$@"
