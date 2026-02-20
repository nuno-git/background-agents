# Dockerfile for the local sandbox manager (Python + Docker CLI).
# Needs Docker CLI to shell out to the host Docker daemon via mounted socket.

FROM python:3.12-slim-bookworm

# Install Docker CLI (sandbox-manager shells out to `docker` binary)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl gnupg \
    && install -m 0755 -d /etc/apt/keyrings \
    && curl -fsSL https://download.docker.com/linux/debian/gpg \
       | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
       https://download.docker.com/linux/debian bookworm stable" \
       > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends docker-ce-cli \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies (extract from pyproject.toml to avoid hatchling build)
RUN pip install --no-cache-dir \
    "fastapi>=0.115.0" \
    "uvicorn[standard]>=0.34.0" \
    "httpx>=0.27.0" \
    "pydantic>=2.0" \
    "PyJWT[crypto]>=2.8.0" \
    "python-dotenv>=1.0.0"

# Copy source
COPY packages/local-sandbox-manager/src/ ./src/

# Snapshot data directory (mount as volume)
RUN mkdir -p /data/snapshots

ENV SNAPSHOT_DIR=/data/snapshots

EXPOSE 8000

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
