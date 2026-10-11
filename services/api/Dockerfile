# RetailGuard API + worker image. Base pinned by digest (python:3.12-slim, pulled 2026-10-11).
FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1
COPY --from=ghcr.io/astral-sh/uv:0.12.21 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin retailguard \
    && mkdir -p /var/lib/retailguard/media && chown -R 10001:10001 /var/lib/retailguard
USER 10001
ENV PATH=/app/.venv/bin:$PATH MEDIA_DIR=/var/lib/retailguard/media
EXPOSE 8710
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8710/healthz',timeout=3)" || exit 1
CMD ["python", "-m", "retailguard_api", "serve", "--host", "0.0.0.0", "--port", "8710"]
