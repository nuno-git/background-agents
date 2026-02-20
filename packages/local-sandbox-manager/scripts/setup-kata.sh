#!/usr/bin/env bash
#
# Install Kata Containers and configure containerd to use the Kata runtime.
# Run as root (or with sudo).
#
set -euo pipefail

echo "=== Kata Containers Setup ==="

# 1. Check KVM support (nested virtualization must be enabled on the hypervisor)
if [ ! -e /dev/kvm ]; then
  echo "ERROR: /dev/kvm not found. Enable nested virtualization on the hypervisor first."
  echo "  For QEMU/KVM host: set cpu model to 'host' or enable 'vmx'/'svm' nesting."
  exit 1
fi

echo "[1/5] KVM device found."

# 2. Install Kata Containers from the official repo
if ! command -v kata-runtime &>/dev/null; then
  echo "[2/5] Installing Kata Containers..."

  # Add Kata repo key and source
  ARCH=$(uname -m)
  if [ "$ARCH" = "x86_64" ]; then
    ARCH="amd64"
  fi

  # Install from official Kata packages
  sudo mkdir -p /etc/apt/keyrings
  curl -fsSL https://download.opensuse.org/repositories/home:/katacontainers:/releases:/${ARCH}:/master/xUbuntu_22.04/Release.key \
    | gpg --dearmor | sudo tee /etc/apt/keyrings/kata-containers.gpg > /dev/null

  echo "deb [signed-by=/etc/apt/keyrings/kata-containers.gpg] https://download.opensuse.org/repositories/home:/katacontainers:/releases:/${ARCH}:/master/xUbuntu_22.04/ /" \
    | sudo tee /etc/apt/sources.list.d/kata-containers.list

  sudo apt-get update
  sudo apt-get install -y kata-containers
else
  echo "[2/5] Kata Containers already installed."
fi

# 3. Configure containerd with Kata runtime handler
echo "[3/5] Configuring containerd..."

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
  # Append to the end of the config (containerd merges plugin configs)
  sudo tee -a "$CONTAINERD_CONFIG" > /dev/null <<'EOF'

# Kata Containers runtime handler
[plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata]
  runtime_type = "io.containerd.kata.v2"
  [plugins."io.containerd.grpc.v1.cri".containerd.runtimes.kata.options]
    ConfigPath = "/opt/kata/share/defaults/kata-containers/configuration-qemu.toml"
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
  echo "Kata Containers installed and working."
  echo "Guest kernel should differ from host kernel ($(uname -r))."
else
  echo ""
  echo "=== FAILED ==="
  echo "Kata container test failed. Check containerd logs: journalctl -u containerd -n 50"
  exit 1
fi
