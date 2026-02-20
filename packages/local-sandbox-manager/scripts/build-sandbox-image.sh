#!/usr/bin/env bash
#
# Build the sandbox OCI image.
#
# With --kata flag: also imports into containerd for Kata runtime.
# Without flag:     Docker-only (default).
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
IMAGE_NAME="open-inspect-sandbox:latest"
IMPORT_KATA=false

for arg in "$@"; do
  case "$arg" in
    --kata) IMPORT_KATA=true ;;
  esac
done

echo "=== Building Sandbox Image ==="
echo "  Repo root: $REPO_ROOT"
echo "  Image: $IMAGE_NAME"

# 1. Build with Docker
echo "[1/2] Building Docker image..."
docker build \
  -f "$REPO_ROOT/packages/local-sandbox-manager/Dockerfile.sandbox" \
  -t "$IMAGE_NAME" \
  "$REPO_ROOT"

echo ""
echo "=== Docker image built: $IMAGE_NAME ==="
echo "Verify: docker images | grep sandbox"

# 2. Optionally import into containerd (for Kata runtime)
if [ "$IMPORT_KATA" = true ]; then
  echo ""
  echo "[2/2] Importing into containerd for Kata..."
  TMPFILE=$(mktemp /tmp/sandbox-image-XXXXXX.tar)
  docker save "$IMAGE_NAME" -o "$TMPFILE"
  sudo ctr images import "$TMPFILE"
  rm -f "$TMPFILE"
  echo "Image also available in containerd."
  echo "Verify: sudo ctr images ls | grep sandbox"
fi

echo ""
echo "=== Done ==="
