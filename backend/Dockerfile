# Production image for the mapencroach API.
# Build from the backend/ directory:  docker build -t mapencroach-api .
FROM python:3.12-slim

WORKDIR /app

# Install the package first so source-only edits reuse the dependency layer.
COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir .

# Hosted platforms (Render, Railway) inject PORT; default to 8000 locally.
ENV PORT=8000
EXPOSE 8000

# Run as an unprivileged user - the image never needs root at runtime.
RUN groupadd --system mapencroach \
    && useradd --system --gid mapencroach --home /app --no-create-home mapencroach \
    && chown -R mapencroach:mapencroach /app
USER mapencroach

# GET /health is unauthenticated by design, so the probe needs no token.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:' + os.environ.get('PORT', '8000') + '/health', timeout=3)" || exit 1

CMD uvicorn "mapencroach.api.app:create_app" --factory --host 0.0.0.0 --port "$PORT"
