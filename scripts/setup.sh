#!/usr/bin/env bash
# =============================================================================
# YusafCut — one-shot dev setup script
#
# Run once after cloning, or any time you want to reset your environment:
#
#   npm run setup:all        (calls this script)
#
# After this completes you can run:
#   npm run start            → tauri dev (hot-reload)
#   npm run tauri:build:dmg  → production .dmg
#
# What this script does:
#   1. Guard — Apple Silicon only
#   2. Node dependencies  (npm install)
#   3. Python venv        (sidecars/mlx-llm/.venv)
#   4. FFmpeg / FFprobe   (downloads static builds from evermeet.cx)
#   5. whisper-cli        (check — must be built manually, see below)
#   6. whisperkit-cli     (builds from argmaxinc/WhisperKit via Swift if stub detected)
#   7. MLX sidecar        (checks dev launcher is present)
#   8. Final status table
# =============================================================================
set -euo pipefail

# ── colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

ok()     { echo -e "  ${GREEN}✓${RESET}  $*"; }
warn()   { echo -e "  ${YELLOW}⚠${RESET}  $*"; }
info()   { echo -e "  ${CYAN}→${RESET}  $*"; }
fail()   { echo -e "  ${RED}✗${RESET}  $*"; }
die()    { fail "$*"; exit 1; }
header() { echo -e "\n${BOLD}$*${RESET}"; }

# ── repo root ─────────────────────────────────────────────────────────────────
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BINS="$REPO/src-tauri/binaries"
SIDECAR="$REPO/sidecars/mlx-llm"
ARCH_SUFFIX="aarch64-apple-darwin"

echo -e "\n${BOLD}╔══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║       YusafCut — setup:all             ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════╝${RESET}"

# ── 1. Platform guard ─────────────────────────────────────────────────────────
header "1 / 6  Platform check"
if [[ "$(uname -s)" != "Darwin" ]]; then
  fail "YusafCut targets macOS only. Exiting."
  exit 1
fi
if [[ "$(uname -m)" != "arm64" ]]; then
  warn "Detected Intel Mac. Binaries are compiled for Apple Silicon (aarch64)."
  warn "Transcription and MLX sidecar features will not work."
  warn "Continuing anyway — frontend dev still works."
else
  ok "Apple Silicon detected"
fi

# ── 2. Node / npm ─────────────────────────────────────────────────────────────
header "2 / 6  Node dependencies"
if ! command -v node >/dev/null 2>&1; then
  fail "node not found. Install from https://nodejs.org (v20+) and re-run."
  exit 1
fi
NODE_VER=$(node --version | sed 's/v//')
NODE_MAJOR="${NODE_VER%%.*}"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  warn "Node $NODE_VER found — v20+ recommended."
else
  ok "Node v$NODE_VER"
fi
info "Running npm install…"
npm install --prefix "$REPO" --silent
ok "npm packages installed"

# ── 3. Python environment (Python 3.9.6 — Conda or venv) ──────────────────────
header "3 / 6  Python environment (Python 3.9.6)"
TARGET_PY_VER="3.9.6"
VENV="$REPO/.venv"
ENV_TYPE=""

# Helper to verify if a python command runs target version
is_py396() {
  local cmd="$1"
  if [[ -x "$cmd" ]] || command -v "$cmd" >/dev/null 2>&1; then
    local ver
    ver=$("$cmd" --version 2>&1 | awk '{print $2}')
    if [[ "$ver" == "$TARGET_PY_VER"* ]]; then
      return 0
    fi
  fi
  return 1
}

# Helper to find an existing Python 3.9.6 executable
find_system_py396() {
  local candidates=(
    "python3.9"
    "python3"
    "/usr/bin/python3"
    "/Library/Developer/CommandLineTools/usr/bin/python3"
    "/Applications/Xcode.app/Contents/Developer/usr/bin/python3"
    "/opt/homebrew/bin/python3.9"
    "/opt/homebrew/opt/python@3.9/bin/python3.9"
    "/usr/local/bin/python3.9"
    "$HOME/.pyenv/versions/$TARGET_PY_VER/bin/python"
    "$HOME/.pyenv/shims/python3.9"
  )
  for c in "${candidates[@]}"; do
    if is_py396 "$c"; then
      if command -v "$c" >/dev/null 2>&1; then
        command -v "$c"
      else
        echo "$c"
      fi
      return 0
    fi
  done
  return 1
}

# Detect conda executable
find_conda() {
  local conda_paths=(
    "conda"
    "/opt/homebrew/Caskroom/miniconda/base/bin/conda"
    "$HOME/miniconda3/bin/conda"
    "$HOME/miniconda/bin/conda"
    "$HOME/anaconda3/bin/conda"
    "/opt/homebrew/bin/conda"
    "/usr/local/bin/conda"
  )
  for cp in "${conda_paths[@]}"; do
    if command -v "$cp" >/dev/null 2>&1 || [[ -x "$cp" ]]; then
      if command -v "$cp" >/dev/null 2>&1; then
        command -v "$cp"
      else
        echo "$cp"
      fi
      return 0
    fi
  done
  return 1
}

CONDA_CMD="$(find_conda || true)"

if [[ -n "$CONDA_CMD" ]]; then
  info "Conda detected: $CONDA_CMD"
  # Setup conda hook for bash so 'conda activate' works in subshell
  eval "$("$CONDA_CMD" shell.bash hook 2>/dev/null)" || true

  # Check if existing .venv already has Python 3.9.6
  RECREATE=true
  if [[ -x "$VENV/bin/python" ]] && is_py396 "$VENV/bin/python"; then
    RECREATE=false
    ok "Conda environment at $VENV already has Python $TARGET_PY_VER"
  fi

  if [[ "$RECREATE" == "true" ]]; then
    if [[ -d "$VENV" ]]; then
      info "Existing .venv does not match Python $TARGET_PY_VER — recreating with conda…"
      rm -rf "$VENV"
    else
      info "Creating conda environment at $VENV with python=$TARGET_PY_VER…"
    fi
    "$CONDA_CMD" create -y -p "$VENV" python="$TARGET_PY_VER"
  fi

  # Activate conda environment
  conda activate "$VENV"
  ACT_VER=$("$VENV/bin/python" --version 2>&1 | awk '{print $2}')
  ok "Conda environment activated (Python $ACT_VER)"
  ENV_TYPE="conda"

else
  info "Conda not found — using Python venv flow"
  SYS_PY396="$(find_system_py396 || true)"

  if [[ -z "$SYS_PY396" ]]; then
    info "Python $TARGET_PY_VER not found on system — attempting installation…"
    if command -v pyenv >/dev/null 2>&1; then
      info "Installing Python $TARGET_PY_VER via pyenv…"
      pyenv install -s "$TARGET_PY_VER"
      SYS_PY396="$HOME/.pyenv/versions/$TARGET_PY_VER/bin/python"
    elif command -v brew >/dev/null 2>&1; then
      info "Installing python@3.9 via Homebrew…"
      brew install python@3.9 || true
      SYS_PY396="$(find_system_py396 || true)"
    fi
  fi

  if [[ -z "$SYS_PY396" ]] || ! is_py396 "$SYS_PY396"; then
    fail "Python $TARGET_PY_VER could not be found or installed automatically."
    echo "  Please install Python $TARGET_PY_VER (e.g. brew install python@3.9 or conda) and re-run."
    exit 1
  fi

  ok "Found Python $TARGET_PY_VER at $SYS_PY396"

  RECREATE=true
  if [[ -x "$VENV/bin/python" ]] && is_py396 "$VENV/bin/python"; then
    RECREATE=false
    ok "Virtualenv at $VENV already has Python $TARGET_PY_VER"
  fi

  if [[ "$RECREATE" == "true" ]]; then
    if [[ -d "$VENV" ]]; then
      info "Existing .venv does not match Python $TARGET_PY_VER — recreating venv…"
      rm -rf "$VENV"
    else
      info "Creating venv at $VENV with $SYS_PY396…"
    fi
    "$SYS_PY396" -m venv "$VENV"
  fi

  # Activate virtual environment
  source "$VENV/bin/activate"
  ACT_VER=$(python --version 2>&1 | awk '{print $2}')
  ok "Python venv activated (Python $ACT_VER)"
  ENV_TYPE="venv"
fi

# Ensure sidecars/mlx-llm/.venv points to $REPO/.venv
if [[ "$SIDECAR/.venv" != "$VENV" ]]; then
  rm -rf "$SIDECAR/.venv"
  ln -sfn "../../.venv" "$SIDECAR/.venv"
  ok "Linked $SIDECAR/.venv -> $VENV"
fi

# Install dependencies in the activated environment
info "Upgrading pip in activated environment…"
"$VENV/bin/pip" install -q --upgrade pip

info "Installing mlx_llm + dependencies (pydantic, mlx-lm)…"
"$VENV/bin/pip" install -q -e "$SIDECAR"
"$VENV/bin/pip" install -q pytest
ok "Python environment ready and packages installed"

# ── 4. FFmpeg / FFprobe ───────────────────────────────────────────────────────
header "4 / 6  FFmpeg / FFprobe"
FFMPEG="$BINS/ffmpeg-$ARCH_SUFFIX"
FFPROBE="$BINS/ffprobe-$ARCH_SUFFIX"

download_ffmpeg() {
  local name="$1" url="$2" dest="$3" zipname="$4"
  if [[ -f "$dest" ]]; then
    ok "$name already present"
    return
  fi
  info "Downloading $name from evermeet.cx…"
  curl -fsSL -o "/tmp/$zipname" "$url"
  unzip -oq "/tmp/$zipname" -d "/tmp"
  mv "/tmp/${name}" "$dest"
  chmod +x "$dest"
  rm -f "/tmp/$zipname"
  ok "$name downloaded"
}

download_ffmpeg "ffmpeg"  "https://evermeet.cx/ffmpeg/ffmpeg-7.1.zip"  "$FFMPEG"  "ffmpeg.zip"
download_ffmpeg "ffprobe" "https://evermeet.cx/ffmpeg/ffprobe-7.1.zip" "$FFPROBE" "ffprobe.zip"

# ── 5. whisper-cli ────────────────────────────────────────────────────────────
header "5 / 7  whisper-cli"
WHISPER="$BINS/whisper-cli-$ARCH_SUFFIX"
_ws_is_stub()      { [[ -f "$WHISPER" ]] && head -1 "$WHISPER" 2>/dev/null | grep -q "^#!"; }
_ws_has_rpath()    { [[ -f "$WHISPER" ]] && otool -L "$WHISPER" 2>/dev/null | grep -q "@rpath/libwhisper"; }

if [[ -f "$WHISPER" ]] && [[ -x "$WHISPER" ]] && ! _ws_is_stub && ! _ws_has_rpath; then
  WSIZE=$(du -sh "$WHISPER" 2>/dev/null | awk '{print $1}')
  ok "whisper-cli present — static (${WSIZE})"
else
  if _ws_is_stub; then
    info "whisper-cli is a dev stub — replacing with real binary…"
  elif _ws_has_rpath; then
    info "whisper-cli is dynamically linked — rebuilding as static binary…"
  else
    info "whisper-cli not found — building from source…"
  fi

  if ! command -v cmake >/dev/null 2>&1; then
    warn "cmake not found — install via: brew install cmake"
    warn "Skipping whisper-cli build. Transcription will not work."
  else
    WHISPER_TMP="/tmp/whisper.cpp.setup.$$"
    mkdir -p "$WHISPER_TMP"

    info "Cloning whisper.cpp v1.7.5…"
    git clone --depth 1 --branch v1.7.5 https://github.com/ggerganov/whisper.cpp "$WHISPER_TMP" 2>/dev/null \
      || die "Failed to clone whisper.cpp"

    info "Configuring with CMake (static libs, Core ML + Metal)…"
    cmake -S "$WHISPER_TMP" -B "$WHISPER_TMP/build" \
      -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_SHARED_LIBS=OFF \
      -DGGML_STATIC=ON \
      -DWHISPER_METAL=ON \
      -DWHISPER_COREML=ON \
      -DWHISPER_BUILD_TESTS=OFF 2>/dev/null \
      || die "Failed to configure whisper.cpp"

    info "Building whisper-cli (static binary — no dynamic libs)…"
    cmake --build "$WHISPER_TMP/build" --target whisper-cli -j$(sysctl -n hw.logicalcpu) 2>/dev/null \
      || die "Failed to build whisper-cli"

    BUILT=$(find "$WHISPER_TMP/build/bin" -name "whisper-cli" -perm +111 -type f 2>/dev/null | head -1)
    [[ -n "$BUILT" ]] || die "whisper-cli binary not found after build — check cmake output"

    cp "$BUILT" "$WHISPER"
    chmod +x "$WHISPER"
    rm -rf "$WHISPER_TMP"

    WSIZE=$(du -sh "$WHISPER" | awk '{print $1}')
    ok "whisper-cli built and installed — static (${WSIZE})"
  fi
fi

# ── 6. whisperkit-cli ─────────────────────────────────────────────────────────
header "6 / 7  whisperkit-cli (WhisperKit ANE)"
WHISPERKIT="$BINS/whisperkit-cli-$ARCH_SUFFIX"
_wk_is_stub() {
  [[ -f "$WHISPERKIT" ]] && head -1 "$WHISPERKIT" 2>/dev/null | grep -q "^#!"
}
if [[ -f "$WHISPERKIT" ]] && [[ -x "$WHISPERKIT" ]] && ! _wk_is_stub; then
  WKSIZE=$(du -sh "$WHISPERKIT" 2>/dev/null | awk '{print $1}')
  ok "whisperkit-cli present (${WKSIZE})"
elif _wk_is_stub; then
  warn "whisperkit-cli is a stub — building from source now…"
  info "This requires Xcode and takes 5–15 minutes on first run."
  if command -v swift >/dev/null 2>&1; then
    bash "$REPO/scripts/build-whisperkit-cli.sh"
  else
    warn "Swift not found — skipping build. Install Xcode and run:"
    warn "  bash scripts/build-whisperkit-cli.sh"
  fi
else
  warn "whisperkit-cli not found — WhisperKit ANE transcription will not work."
  info "Build it by running: bash scripts/build-whisperkit-cli.sh"
fi

# ── 7. MLX sidecar binary ─────────────────────────────────────────────────────
header "7 / 7  MLX sidecar binary"
MLX_BIN="$BINS/mlx-sidecar-$ARCH_SUFFIX"
if [[ -f "$MLX_BIN" ]] && [[ -x "$MLX_BIN" ]]; then
  # If it's the dev shell-script launcher (not a PyInstaller binary), that's fine.
  if head -1 "$MLX_BIN" | grep -q "^#!/"; then
    ok "mlx-sidecar dev launcher present"
  else
    ok "mlx-sidecar binary present"
  fi
else
  warn "mlx-sidecar not found — AI features will fail at runtime."
  warn "Run: python sidecars/mlx-llm/build.py"
fi

# ── Summary ─────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║           Setup complete!            ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════╝${RESET}"
echo ""
echo "  Next steps:"
echo ""

if [[ -f "$WHISPER" ]] && [[ -x "$WHISPER" ]]; then
  echo -e "  ${GREEN}npm run start${RESET}              Start dev server (hot-reload)"
  echo -e "  ${GREEN}npm run tauri:build:dmg${RESET}    Build production .dmg"
else
  echo -e "  ${YELLOW}npm run start${RESET}              Start dev server"
  echo -e "                             ⚠  Build whisper-cli first for transcription"
  echo -e "  ${YELLOW}npm run tauri:build:dmg${RESET}    Build production .dmg"
  echo -e "                             ⚠  Build whisper-cli first"
fi

if [[ "$ENV_TYPE" == "conda" ]]; then
  echo -e "  ${CYAN}conda activate $VENV${RESET}      Activate Python 3.9.6 conda environment"
elif [[ "$ENV_TYPE" == "venv" ]]; then
  echo -e "  ${CYAN}source .venv/bin/activate${RESET}          Activate Python 3.9.6 virtual environment"
fi
echo ""
