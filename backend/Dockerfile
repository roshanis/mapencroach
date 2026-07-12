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

CMD uvicorn "mapencroach.api.app:create_app" --factory --host 0.0.0.0 --port "$PORT"
