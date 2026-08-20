#!/usr/bin/env bash
# Build an unsigned macOS DMG of the desktop app.
#
# Signing a runtime this size costs minutes and needs credentials, so this
# build passes `-c.mac.identity=null` and produces an installer for local
# distribution and testing. Release builds go through `pnpm run dist:mac`,
# which keeps electron-builder's signing auto-discovery.
#
# Usage:
#   apps/desktop/scripts/build-mac.sh [--skip-build] [--skip-runtime]
#
#   --skip-build     reuse the current repository artifacts (skip `pnpm run build`)
#   --skip-runtime   reuse the current runtime-build/ deployment
set -euo pipefail

desktop_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
repo_dir=$(cd "$desktop_dir/../.." && pwd)

skip_build=0
skip_runtime=0
for arg in "$@"; do
  case "$arg" in
    --skip-build) skip_build=1 ;;
    --skip-runtime) skip_runtime=1 ;;
    -h|--help) sed -n '2,13p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "build-mac: unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [[ $(uname -s) != Darwin ]]; then
  echo "build-mac: a macOS DMG can only be built on macOS (found $(uname -s))." >&2
  exit 1
fi

# The Electron binary arrives through a postinstall download that a blocked or
# mirrored registry can silently skip; electron-builder would then fail deep in
# packaging with a less obvious message.
electron_dist="$repo_dir/node_modules/.pnpm/node_modules/electron/dist"
if [[ ! -d $desktop_dir/node_modules/electron/dist && ! -d $electron_dist ]]; then
  cat >&2 <<'MSG'
build-mac: the Electron binary is not downloaded.

  cd node_modules/.pnpm/electron@*/node_modules/electron
  ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" node install.js

Re-run this script afterwards.
MSG
  exit 1
fi

cd "$repo_dir"

if [[ $skip_build -eq 0 ]]; then
  echo "build-mac: building repository artifacts"
  pnpm run build
else
  echo "build-mac: reusing repository artifacts"
fi

cd "$desktop_dir"

echo "build-mac: building the desktop main process"
pnpm run build

if [[ $skip_runtime -eq 0 ]]; then
  echo "build-mac: deploying the harness runtime"
  pnpm run prepare:runtime
else
  echo "build-mac: reusing runtime-build/"
fi

if [[ ! -d runtime-build/node_modules/@deepseek-ai/dsh-uniclaw-shell ]]; then
  echo "build-mac: runtime-build/ carries no UniClaw plugins; re-run without --skip-runtime." >&2
  exit 1
fi

echo "build-mac: packaging the DMG (unsigned)"
pnpm exec electron-builder --mac dmg -c.mac.identity=null

echo
echo "build-mac: done"
find dist/installers -maxdepth 1 -name '*.dmg' -exec ls -lh {} \; | awk '{print "  " $NF " (" $5 ")"}'
