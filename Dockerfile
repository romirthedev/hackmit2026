FROM node:22-bookworm-slim AS dashboard
RUN corepack enable && corepack prepare pnpm@11.19.0 --activate
WORKDIR /src/web
COPY web/package.json web/pnpm-lock.yaml web/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY web/ ./
RUN pnpm build

FROM python:3.12-slim-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY pyproject.toml ./
COPY server ./server
ARG REWIND_PYTHON_EXTRAS=audio,video
RUN pip install --no-cache-dir ".[${REWIND_PYTHON_EXTRAS}]"
COPY scripts ./scripts
COPY --from=dashboard /src/web/dist/client ./web/dist/client
RUN useradd --uid 10001 --create-home rewind && mkdir -p /app/data /home/rewind/.cache && chown rewind:rewind /app/data /home/rewind/.cache
USER rewind
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "rewind.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
