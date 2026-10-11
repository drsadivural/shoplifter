"""FastAPI application: middleware, error handling, routers, health endpoints."""
from __future__ import annotations

import logging
import uuid

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .authz import request_id_var
from .db import close_pool, transaction
from .errors import ApiError
from .routers import auth, cameras, edge, incidents, ops, org, privacy, profiles
from .settings import get_settings

log = logging.getLogger("retailguard.api")

# Upper bounds per path prefix; the body is also bounded by the reverse proxy.
BODY_LIMITS = (("/v1/edge/events/", 64 * 1024 * 1024), ("/v1/edge/cameras/", 4 * 1024 * 1024),
               ("/v1/profiles/", 9 * 1024 * 1024), ("/v1/search/photo", 9 * 1024 * 1024))
DEFAULT_LIMIT = 1024 * 1024


def create_app() -> FastAPI:
    settings = get_settings()
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def lifespan(_app):
        yield
        close_pool()

    app = FastAPI(lifespan=lifespan, title="Ayonix RetailGuard API", version="1.0.0",
                  docs_url=None if settings.app_env == "production" else "/v1/docs",
                  redoc_url=None, openapi_url="/v1/openapi.json")

    @app.middleware("http")
    async def request_context(request: Request, call_next):
        rid = uuid.uuid4().hex
        token = request_id_var.set(rid)
        try:
            length = request.headers.get("content-length")
            limit = next((n for prefix, n in BODY_LIMITS if request.url.path.startswith(prefix)), DEFAULT_LIMIT)
            if length is not None:
                try:
                    too_big = int(length) > limit
                except ValueError:
                    too_big = True
                if too_big:
                    err = ApiError(413, "payload_too_large", "Request body too large")
                    response = JSONResponse(err.body(rid), status_code=413)
                else:
                    response = await call_next(request)
            elif request.method in ("POST", "PUT", "PATCH") and request.headers.get("transfer-encoding"):
                err = ApiError(411, "length_required", "Content-Length required")
                response = JSONResponse(err.body(rid), status_code=411)
            else:
                response = await call_next(request)
        finally:
            request_id_var.reset(token)
        response.headers["X-Request-ID"] = rid
        response.headers.setdefault("Cache-Control", "no-store")
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Frame-Options"] = "DENY"
        return response

    @app.exception_handler(ApiError)
    async def api_error(request: Request, exc: ApiError):
        return JSONResponse(exc.body(request_id_var.get()), status_code=exc.status, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request: Request, exc: RequestValidationError):
        fields = {}
        for e in exc.errors():
            loc = [str(p) for p in e.get("loc", []) if p not in ("body", "query", "path")]
            fields[".".join(loc) or "body"] = e.get("type", "invalid")
        err = ApiError(422, "validation_failed", "Some fields are invalid", field_errors=fields)
        return JSONResponse(err.body(request_id_var.get()), status_code=422)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(request: Request, exc: StarletteHTTPException):
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "http_error")
        err = ApiError(exc.status_code, code, "Not found" if exc.status_code == 404 else str(exc.detail))
        return JSONResponse(err.body(request_id_var.get()), status_code=exc.status_code)

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):
        log.exception("unhandled error request_id=%s path=%s", request_id_var.get(), request.url.path)
        err = ApiError(500, "internal_error", "Something went wrong. Quote the request ID to support.", retriable=True)
        return JSONResponse(err.body(request_id_var.get()), status_code=500)

    for r in (auth.router, org.router, edge.router, cameras.router, profiles.router, incidents.router, ops.router, privacy.router):
        app.include_router(r)

    @app.get("/healthz", include_in_schema=False)
    def healthz() -> dict:
        return {"status": "ok"}

    @app.get("/readyz", include_in_schema=False)
    def readyz():
        try:
            with transaction() as tx:
                tx.scalar("SELECT 1")
        except Exception:
            return JSONResponse({"status": "unavailable", "database": "unreachable"}, status_code=503)
        s = get_settings()
        return {"status": "ok", "database": "ok",
                "dependencies": {"face_sdk": "available" if s.face_sdk_configured else "unconfigured",
                                 "apns": "available" if s.apns_configured else "unconfigured",
                                 "oidc": "available" if s.oidc_enabled else "unconfigured"}}

    return app


app = None


def get_app() -> FastAPI:
    global app
    if app is None:
        app = create_app()
    return app
