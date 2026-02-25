#!/usr/bin/env bash
#
# Install Kata Containers and configure containerd to use the Kata runtime.
# Run as root (or with sudo).
#
# Uses the official pre-built kata-static tarball from GitHub releases.
# See: https://github.com/kata-containers/kata-containers/releases
#
set -euo pipefail

KATA_VERSION="${KATA_VERSION:-3.27.0}"

echo "=== Kata Containers Setup (v${KATA_VERSION}) ==="

# 1. Check KVM support (nested virtualization must be enabled on the hypervisor)
if [ ! -e /dev/kvm ]; then
  echo "ERROR: /dev/kvm not found. Enable nested virtualization on the hypervisor first."
  echo "  For QEMU/KVM host: set cpu model to 'host' or enable 'vmx'/'svm' nesting."
  echo "  For WSL2: see https://learn.microsoft.com/en-us/windows/wsl/wsl-config"
  exit 1
fi

echo "[1/5] KVM device found."

# 2. Install Kata Containers from pre-built release tarball
KATA_DIR="/opt/kata"
if [ -x "${KATA_DIR}/bin/kata-runtime" ]; then
  INSTALLED=$("${KATA_DIR}/bin/kata-runtime" --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' || echo "unknown")
  echo "[2/5] Kata Containers already installed (${INSTALLED})."
  if [ "$INSTALLED" != "$KATA_VERSION" ]; then
    echo "  To upgrade, remove ${KATA_DIR} and re-run this script."
  fi
else
  echo "[2/5] Installing Kata Containers v${KATA_VERSION}..."

  ARCH=$(uname -m)
  case "$ARCH" in
    x86_64)  ARCH="amd64" ;;
    aarch64) ARCH="arm64" ;;
    *)
      echo "ERROR: Unsupported architecture: $ARCH"
      exit 1
      ;;
  esac

  TARBALL="kata-static-${KATA_VERSION}-${ARCH}.tar.zst"
  URL="https://github.com/kata-containers/kata-containers/releases/download/${KATA_VERSION}/${TARBALL}"

  echo "  Downloading ${URL}..."

  # Install zstd if not present
  if ! command -v zstd &>/dev/null; then
    echo "  Installing zstd..."
    sudo apt-get update -qq && sudo apt-get install -y -qq zstd
  fi

  TMPDIR=$(mktemp -d)
  trap "rm -rf ${TMPDIR}" EXIT

  curl -fSL -o "${TMPDIR}/${TARBALL}" "$URL"
  echo "  Extracting to /..."
  sudo tar -C / --zstd -xf "${TMPDIR}/${TARBALL}"

  # Symlink to /usr/local/bin so containerd finds the shim
  sudo ln -sf "${KATA_DIR}/bin/containerd-shim-kata-v2" /usr/local/bin/containerd-shim-kata-v2
  sudo ln -sf "${KATA_DIR}/bin/kata-runtime" /usr/local/bin/kata-runtime

  echo "  Installed to ${KATA_DIR}."
fi

# 3. Install and configure containerd (if not present)
echo "[3/5] Configuring containerd..."

if ! command -v containerd &>/dev/null; then
  echo "  Installing containerd..."
  sudo apt-get update -qq && sudo apt-get install -y -qq containerd
fi

CONTAINERD_CONFIG="/etc/containerd/config.toml"

# Check if Kata runtime handler is already configured
if grep -q "io.containerd.kata.v2" "$CONTAINERD_CONFIG" 2>/dev/null; then
  echo "  Kata runtime handler already configured in containerd."
else
  # Backup existing config
  if [ -f "$CONTAINERD_CONFIG" ]; then
    sudo cp "$CONTAINERD_CONFIG" "${CONTAINERD_CONFIG}.backup.$(date +%s)"
  fi

  # Generate default config if it doesn't exist
  if [ ! -f "$CONTAINERD_CONFIG" ]; then
    sudo mkdir -p /etc/containerd
    containerd config default | sudo tee "$CONTAINERD_CONFIG" > /dev/null
  fi

  # Add Kata runtime handler
  sudo tee -a "$CONTAINERD_CONFIG" > /dev/null <<EOF

# Kata Containers runtime handler
[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata]
  runtime_type = "io.containerd.kata.v2"
  [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata.options]
    ConfigPath = "${KATA_DIR}/share/defaults/kata-containers/configuration-qemu.toml"
EOF

  echo "  Added Kata runtime handler to containerd config."
fi

# 4. Restart containerd
echo "[4/5] Restarting containerd..."
sudo systemctl restart containerd
sudo systemctl enable containerd

# 5. Verify
echo "[5/5] Verifying Kata installation..."
echo "  Testing with alpine container..."

# Pull alpine if not present
sudo ctr images pull docker.io/library/alpine:latest 2>/dev/null || true

# Run a quick test
TEST_NAME="kata-verify-$$"
if sudo ctr run --rm --runtime io.containerd.kata.v2 docker.io/library/alpine:latest "$TEST_NAME" uname -r; then
  echo ""
  echo "=== SUCCESS ==="
  echo "Kata Containers v${KATA_VERSION} installed and working."
  echo "Guest kernel should differ from host kernel ($(uname -r))."
else
  echo ""
  echo "=== FAILED ==="
  echo "Kata container test failed. Check containerd logs: journalctl -u containerd -n 50"
  exit 1
fi
