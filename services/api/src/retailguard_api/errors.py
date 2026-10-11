from __future__ import annotations

from typing import Any


class ApiError(Exception):
    """Error with a safe, stable code. Messages never include secrets or SDK internals."""

    def __init__(self, status: int, code: str, message: str | None = None, *, retriable: bool = False,
                 field_errors: dict[str, str] | None = None, current_version: int | None = None,
                 headers: dict[str, str] | None = None):
        super().__init__(code)
        self.status = status
        self.code = code
        self.message = message or code.replace("_", " ").capitalize()
        self.retriable = retriable
        self.field_errors = field_errors
        self.current_version = current_version
        self.headers = headers

    def body(self, request_id: str) -> dict[str, Any]:
        out: dict[str, Any] = {"code": self.code, "message": self.message, "request_id": request_id,
                               "retriable": self.retriable}
        if self.field_errors:
            out["field_errors"] = self.field_errors
        if self.current_version is not None:
            out["current_version"] = self.current_version
        return out


def not_found() -> ApiError:
    return ApiError(404, "not_found", "Not found")


def forbidden() -> ApiError:
    return ApiError(403, "forbidden", "You do not have permission for this action")


def invalid(field: str, code: str = "invalid") -> ApiError:
    return ApiError(422, "validation_failed", "Some fields are invalid", field_errors={field: code})


def conflict(code: str, current_version: int | None = None, message: str | None = None) -> ApiError:
    return ApiError(409, code, message or "The record changed; reload to see the current version",
                    current_version=current_version)


def unavailable(code: str, message: str) -> ApiError:
    return ApiError(503, code, message, retriable=False)


def error_response(err: ApiError):
    from fastapi.responses import JSONResponse
    from .authz import request_id_var
    return JSONResponse(err.body(request_id_var.get()), status_code=err.status, headers=err.headers)
