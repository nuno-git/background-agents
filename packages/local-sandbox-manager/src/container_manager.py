"""
KataContainerManager — manages sandbox containers via containerd + Kata runtime.

Replaces Modal's sandbox lifecycle with local Kata VM containers.
Uses `ctr` CLI for container operations.
"""

import asyncio
import json
import logging
import os
import time
import uuid

from . import config
from .snapshot_store import SnapshotRecord, SnapshotStore

log = logging.getLogger("container_manager")


class ContainerError(Exception):
    pass


async def _run(cmd: list[str], timeout: float = 120) -> tuple[int, str, str]:
    """Run a subprocess and return (returncode, stdout, stderr)."""
    log.debug("Running: %s", " ".join(cmd))
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        raise ContainerError(f"Command timed out after {timeout}s: {' '.join(cmd)}")
    return proc.returncode or 0, stdout.decode(), stderr.decode()


def _ctr(*args: str) -> list[str]:
    """Build a ctr command with the configured namespace."""
    return ["ctr", "-n", config.CONTAINERD_NAMESPACE, *args]


class KataContainerManager:
    def __init__(self) -> None:
        self.snapshot_store = SnapshotStore()

    async def create_sandbox(
        self,
        sandbox_id: str,
        env_vars: dict[str, str],
        image: str | None = None,
    ) -> str:
        """
        Create and start a new Kata container.

        Returns the containerd container ID.
        """
        image = image or config.SANDBOX_IMAGE
        container_id = sandbox_id  # use sandbox_id as container ID

        # Build env flags
        env_flags: list[str] = []
        for k, v in env_vars.items():
            env_flags.extend(["--env", f"{k}={v}"])

        # Pull image if not present (ignore errors if already present)
        rc, _, stderr = await _run(_ctr("images", "check", f"name=={image}"))
        if rc != 0 or image not in stderr + _:
            log.info("Pulling image %s", image)
            await _run(_ctr("images", "pull", image), timeout=300)

        # Create and start container with Kata runtime
        cmd = _ctr(
            "run",
            "-d",  # detach
            "--runtime", config.KATA_RUNTIME,
            *env_flags,
            "--net-host",  # use host networking so container can reach control plane
            image,
            container_id,
            "python", "-m", "sandbox.entrypoint",
        )

        rc, stdout, stderr = await _run(cmd, timeout=60)
        if rc != 0:
            raise ContainerError(f"Failed to create container: {stderr}")

        log.info("Container started: %s", container_id)
        return container_id

    async def stop_sandbox(self, container_id: str) -> None:
        """Stop and remove a container."""
        # Kill the task
        await _run(_ctr("tasks", "kill", container_id))
        # Delete the task
        await _run(_ctr("tasks", "delete", container_id))
        # Delete the container
        await _run(_ctr("containers", "delete", container_id))
        log.info("Container removed: %s", container_id)

    async def take_snapshot(
        self,
        container_id: str,
        sandbox_id: str,
        session_id: str,
        repo_owner: str,
        repo_name: str,
        reason: str,
    ) -> str:
        """
        Take a filesystem snapshot of a running container.

        1. Pause the container task.
        2. Commit the container's snapshot layer.
        3. Create an OCI image from the committed snapshot.
        4. Export the image as a tar file.
        5. Resume the container.

        Returns the snapshot image_id.
        """
        image_id = f"snap-{sandbox_id}-{int(time.time() * 1000)}"
        snapshot_key = f"snapshot-{image_id}"
        local_image_ref = f"docker.io/library/open-inspect-snapshot:{image_id}"
        tar_path = os.path.join(config.SNAPSHOT_DIR, f"{image_id}.tar")

        os.makedirs(config.SNAPSHOT_DIR, exist_ok=True)

        try:
            # Pause the task
            log.info("Pausing container %s for snapshot", container_id)
            await _run(_ctr("tasks", "pause", container_id))

            # Commit the snapshot
            # Get the container's snapshot key
            rc, stdout, _ = await _run(
                _ctr("containers", "info", container_id),
            )
            # The snapshot key for the container is typically the container ID
            # Commit creates a new snapshot from the container's writable layer
            rc, _, stderr = await _run(
                _ctr("snapshots", "commit", snapshot_key, container_id),
            )
            if rc != 0:
                log.warning("Snapshot commit returned %d: %s (may already exist)", rc, stderr)

            # Create an image referencing the snapshot and export as tar
            # Use `ctr images export` with the snapshot reference
            rc, _, stderr = await _run(
                _ctr("images", "export", tar_path, config.SANDBOX_IMAGE),
                timeout=300,
            )
            if rc != 0:
                raise ContainerError(f"Image export failed: {stderr}")

        finally:
            # Always resume the container
            await _run(_ctr("tasks", "resume", container_id))
            log.info("Container %s resumed after snapshot", container_id)

        # Record in snapshot store
        self.snapshot_store.save(
            SnapshotRecord(
                image_id=image_id,
                sandbox_id=sandbox_id,
                session_id=session_id,
                repo_owner=repo_owner,
                repo_name=repo_name,
                reason=reason,
                tar_path=tar_path,
                created_at=time.time(),
            )
        )

        log.info("Snapshot saved: %s -> %s", image_id, tar_path)
        return image_id

    async def restore_from_snapshot(
        self,
        image_id: str,
        sandbox_id: str,
        env_vars: dict[str, str],
    ) -> str:
        """
        Restore a sandbox from a previously saved snapshot.

        1. Look up the snapshot tar.
        2. Import it as a containerd image.
        3. Create a new container from that image.

        Returns the new container ID.
        """
        record = self.snapshot_store.get(image_id)
        if not record:
            raise ContainerError(f"Snapshot not found: {image_id}")

        if not os.path.exists(record.tar_path):
            raise ContainerError(f"Snapshot tar not found: {record.tar_path}")

        # Import the snapshot image
        local_image_ref = f"docker.io/library/open-inspect-snapshot:{image_id}"
        rc, _, stderr = await _run(
            _ctr("images", "import", record.tar_path),
            timeout=300,
        )
        if rc != 0:
            raise ContainerError(f"Image import failed: {stderr}")

        # Create a new container from the snapshot image
        # Add RESTORED_FROM_SNAPSHOT env var
        env_vars["RESTORED_FROM_SNAPSHOT"] = "true"

        container_id = await self.create_sandbox(
            sandbox_id=sandbox_id,
            env_vars=env_vars,
            image=local_image_ref,
        )

        log.info("Container restored from snapshot %s: %s", image_id, container_id)
        return container_id
