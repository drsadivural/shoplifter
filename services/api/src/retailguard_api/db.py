"""PostgreSQL access. Every request runs in one transaction with tenant context set via
SET LOCAL so row level security applies (defense in depth behind API authorization)."""
from __future__ import annotations

import contextlib
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from psycopg_pool import ConnectionPool

from .settings import get_settings

_pools: dict[str, ConnectionPool] = {}


def pool(url: str | None = None) -> ConnectionPool:
    url = url or get_settings().database_url
    if url not in _pools:
        _pools[url] = ConnectionPool(url, min_size=1, max_size=10,
                                     kwargs={"row_factory": dict_row, "autocommit": False}, open=True)
    return _pools[url]


def close_pool() -> None:
    for p in list(_pools.values()):
        p.close()
    _pools.clear()


class Tx:
    """Thin wrapper over a connection inside a transaction."""

    def __init__(self, conn: psycopg.Connection):
        self.conn = conn

    def set_context(self, org_id: str | None, user_id: str | None = None) -> None:
        self.conn.execute("SELECT set_config('app.org_id', %s, true), set_config('app.user_id', %s, true)",
                          (str(org_id) if org_id else "", str(user_id) if user_id else ""))

    def one(self, sql: str, params: Any = None) -> dict | None:
        return self.conn.execute(sql, params).fetchone()

    def all(self, sql: str, params: Any = None) -> list[dict]:
        return self.conn.execute(sql, params).fetchall()

    def run(self, sql: str, params: Any = None) -> int:
        return self.conn.execute(sql, params).rowcount

    def scalar(self, sql: str, params: Any = None) -> Any:
        row = self.conn.execute(sql, params).fetchone()
        return None if row is None else next(iter(row.values()))


@contextlib.contextmanager
def transaction(url: str | None = None) -> Iterator[Tx]:
    with pool(url).connection() as conn:
        with conn.transaction():
            yield Tx(conn)


def J(value: Any) -> Jsonb:
    return Jsonb(value)


def worker_transaction():
    """Transaction for the background worker's role (cross-tenant processing)."""
    import os
    return transaction(os.environ.get("WORKER_DATABASE_URL") or None)
