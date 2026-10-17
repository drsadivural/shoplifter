// Side menu: every paired edge appliance in the user's stores with the cameras it serves
// (GET /v1/edges/tree, refreshed every 30 s). A device's camera list opens while the pointer is
// over it or keyboard focus is inside it; the chevron keeps it open (touch screens). The device
// name opens its live wall (/web/live?edge=), a camera opens its live view (/web/live?camera=).
import { useState } from 'react';
import { Link, useLocation } from 'react-router';
import { endpoints } from '../api/endpoints';
import { useApiQuery } from '../api/hooks';
import type { EdgeTreeItem } from '../api/types';
import { useI18n } from '../i18n';
import { useSession } from '../session/SessionProvider';

export function EdgeTree() {
  const { t } = useI18n();
  const { can } = useSession();
  const allowed = can('camera.read');
  const q = useApiQuery((signal) => endpoints.edges.tree({ signal }), [], { enabled: allowed, pollMs: 30_000 });
  const [pinned, setPinned] = useState<Record<string, boolean>>({});
  const params = new URLSearchParams(useLocation().search);
  const activeCamera = params.get('camera');
  const activeEdge = params.get('edge');
  const items = q.data?.items ?? [];
  if (!allowed || items.length === 0) return null;

  return (
    <div className="nav-group edge-tree">
      <div className="nav-head">{t('Edge devices')}</div>
      <ul>
        {items.map((e: EdgeTreeItem) => {
          const holdsActive = e.cameras.some((c) => c.id === activeCamera);
          const open = Boolean(pinned[e.id]) || holdsActive;
          const listId = `edge-cams-${e.id}`;
          return (
            <li key={e.id} className={`edge-node ${open ? 'open' : ''}`}>
              <div className="edge-row">
                <Link
                  to={`/web/live?edge=${encodeURIComponent(e.id)}`}
                  className={activeEdge === e.id ? 'active' : undefined}
                  aria-current={activeEdge === e.id ? 'page' : undefined}
                  title={`${e.name} · ${e.store_name}`}
                >
                  <span className={`edge-led ${e.state}`} aria-hidden="true" />
                  <span className="nav-label">
                    {e.name}
                    <span className="edge-sub">
                      {e.store_name} · {e.processing_mode === 'full' ? t('Full processing') : t('Streaming only')}
                    </span>
                  </span>
                  <span className="visually-hidden">
                    {e.state === 'online' ? t('edge|Online') : e.state === 'revoked' ? t('edge|Revoked') : t('edge|Offline')}
                  </span>
                </Link>
                <button
                  type="button"
                  className="edge-toggle"
                  aria-expanded={open}
                  aria-controls={listId}
                  aria-label={t('Cameras of {name}', { name: e.name })}
                  onClick={() => setPinned((p) => ({ ...p, [e.id]: !open }))}
                >
                  <span aria-hidden="true">▸</span>
                  <span className="edge-count">{e.cameras.length}</span>
                </button>
              </div>
              <ul id={listId} className="edge-cams">
                {e.cameras.length === 0 ? (
                  <li className="edge-empty">{t('No cameras yet')}</li>
                ) : (
                  e.cameras.map((c) => (
                    <li key={c.id}>
                      <Link
                        to={`/web/live?camera=${encodeURIComponent(c.id)}`}
                        className={activeCamera === c.id ? 'active' : undefined}
                        aria-current={activeCamera === c.id ? 'page' : undefined}
                      >
                        <span className={`cam-led ${c.readiness}`} aria-hidden="true" />
                        <span className="nav-label">{c.name}</span>
                      </Link>
                    </li>
                  ))
                )}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
