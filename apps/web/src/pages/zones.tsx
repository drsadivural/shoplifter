// web-16 Detection zone editor (`?id=` camera).
//   GET /v1/cameras/{id}/zones -> {version, zones, acknowledged_version}; GET /v1/cameras/{id} for the
//   latest verified snapshot. PUT /v1/cameras/{id}/zones {expected_version, zones} (409 -> ConflictBanner).
// Zones are normalized [0,1] polygons (shelf, checkout, privacy mask: ≥3 points) or a 2-point exit line
// with direction in|out. Click to add points, drag (or arrow keys on a focused handle) to move them.
// The saved version is shown next to the version the store edge has acknowledged.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useSearchParams } from 'react-router';
import { endpoints } from '../api/endpoints';
import { useApiQuery, useMutation } from '../api/hooks';
import type { CameraZones, Zone } from '../api/types';
import { SelectField, TextField, fieldErrorText } from '../components/forms';
import { gb, type CameraDetail } from '../components/groupb/api';
import { AuthenticatedImage } from '../components/media';
import { PageHeader } from '../components/PageHeader';
import { Badge, Button, ButtonLink, Card, Notice, StatusPill } from '../components/primitives';
import { RouteStateBoundary } from '../components/RouteStateBoundary';
import { ConflictBanner, EmptyState } from '../components/states';
import { useI18n } from '../i18n';
import { screenPath } from '../routes.meta';
import { useSession } from '../session/SessionProvider';
import '../styles/group-b.css';

type ZoneType = Zone['type'];
type Tool = 'select' | ZoneType;
type Pt = [number, number];

// SVG user space with the same 16:9 aspect as the frame, so handles stay round.
const W = 160;
const H = 90;

export const ZONE_TYPE_LABEL: Record<ZoneType, string> = {
  shelf: 'Shelf zone',
  checkout: 'Checkout zone',
  exit_line: 'Exit line',
  privacy_mask: 'Privacy mask',
};

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

export function polygonArea(pts: Pt[]): number {
  let s = 0;
  for (let k = 0; k < pts.length; k++) {
    const a = pts[k]!;
    const b = pts[(k + 1) % pts.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(s) / 2;
}

/** Client-side checks mirroring services/api validate_zones. Returns an i18n key or null. */
export function zoneProblem(z: Zone): string | null {
  if (z.type === 'exit_line') {
    if (z.points.length !== 2) return 'An exit line needs exactly two points.';
    if (z.direction !== 'in' && z.direction !== 'out') return 'Choose the direction of the exit line.';
    return null;
  }
  if (z.points.length < 3) return 'A zone needs at least three points.';
  if (polygonArea(z.points) < 1e-4) return 'This zone is too small. Make it larger.';
  return null;
}

function newId(): string {
  return `z${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export default function ZonesPage() {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const id = params.get('id');
  const zq = useApiQuery((signal) => endpoints.cameras.getZones(id!, { signal }), [id], { enabled: Boolean(id) });
  const cq = useApiQuery((signal) => gb.camera(id!, { signal }), [id], { enabled: Boolean(id) });

  if (!id) {
    return (
      <>
        <PageHeader screenId="web-16" />
        <EmptyState
          icon="cameras"
          title={t('No camera selected')}
          description={t('Open a camera from the camera inventory, then choose “Edit detection zones”.')}
          action={<ButtonLink to={screenPath('web-14')}>{t('Camera inventory')}</ButtonLink>}
        />
      </>
    );
  }
  const cam = cq.data;
  return (
    <>
      <PageHeader screenId="web-16" subtitle={cam ? [cam.name, cam.location].filter(Boolean).join(' · ') : undefined} />
      <RouteStateBoundary query={zq} permission="camera.manage">
        {(data) => <ZoneEditor cameraId={id} cam={cam} saved={data} setSaved={zq.setData} reload={zq.reload} reloading={zq.fetching} />}
      </RouteStateBoundary>
    </>
  );
}

function ZoneEditor({
  cameraId,
  cam,
  saved,
  setSaved,
  reload,
  reloading,
}: {
  cameraId: string;
  cam: CameraDetail | undefined;
  saved: CameraZones;
  setSaved: (z: CameraZones) => void;
  reload: () => void;
  reloading: boolean;
}) {
  const { t, fmt, locale } = useI18n();
  const { stores } = useSession();
  const tz = stores.find((s) => s.id === cam?.store_id)?.timezone ?? 'UTC';
  const [zones, setZones] = useState<Zone[]>(() => saved.zones.map((z) => ({ ...z, points: z.points.map((p) => [p[0], p[1]] as Pt) })));
  const [baseVersion, setBaseVersion] = useState(saved.version);
  const [dirty, setDirty] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [draft, setDraft] = useState<Pt[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<number, string>>({});
  const [showProblems, setShowProblems] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ zoneId: string; idx: number } | null>(null);

  // Adopt the server copy when it changes and the user has no unsaved edits.
  useEffect(() => {
    if (!dirty && saved.version !== baseVersion) {
      setZones(saved.zones.map((z) => ({ ...z, points: z.points.map((p) => [p[0], p[1]] as Pt) })));
      setBaseVersion(saved.version);
    }
  }, [saved, dirty, baseVersion]);

  // Poll for the edge acknowledgement while it lags behind the saved version.
  const waitingAck = (saved.acknowledged_version ?? 0) < saved.version;
  useEffect(() => {
    if (!waitingAck) return;
    const h = setInterval(() => reload(), 10_000);
    return () => clearInterval(h);
  }, [waitingAck, reload]);

  const update = (fn: (zs: Zone[]) => Zone[]) => {
    setZones(fn);
    setDirty(true);
  };

  const toPoint = useCallback((clientX: number, clientY: number): Pt | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return null;
    return [round5(clamp((clientX - r.left) / r.width)), round5(clamp((clientY - r.top) / r.height))];
  }, []);

  const finishDraft = (pts: Pt[] = draft) => {
    if (tool === 'select') return;
    const needed = tool === 'exit_line' ? 2 : 3;
    if (pts.length < needed) return;
    const count = zones.filter((z) => z.type === tool).length + 1;
    const z: Zone = {
      id: newId(),
      type: tool,
      label: `${t(ZONE_TYPE_LABEL[tool])} ${count}`,
      points: pts,
      ...(tool === 'exit_line' ? { direction: 'out' as const } : {}),
    };
    update((zs) => [...zs, z]);
    setSelected(z.id);
    setDraft([]);
    setTool('select');
  };

  const onCanvasPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (tool === 'select' || drag.current) return;
    const p = toPoint(e.clientX, e.clientY);
    if (!p) return;
    const next = [...draft, p];
    if (tool === 'exit_line' && next.length === 2) finishDraft(next);
    else setDraft(next);
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const p = toPoint(e.clientX, e.clientY);
    if (!p) return;
    update((zs) => zs.map((z) => (z.id === d.zoneId ? { ...z, points: z.points.map((q, i) => (i === d.idx ? p : q)) } : z)));
  };

  const endDrag = () => {
    drag.current = null;
  };

  const moveHandle = (zoneId: string, idx: number, dx: number, dy: number) =>
    update((zs) =>
      zs.map((z) =>
        z.id === zoneId
          ? { ...z, points: z.points.map((q, i) => (i === idx ? ([round5(clamp(q[0] + dx)), round5(clamp(q[1] + dy))] as Pt) : q)) }
          : z,
      ),
    );

  const onHandleKey = (e: KeyboardEvent<SVGCircleElement>, z: Zone, idx: number) => {
    const step = e.shiftKey ? 0.02 : 0.005;
    const map: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = map[e.key];
    if (d) {
      e.preventDefault();
      moveHandle(z.id, idx, d[0], d[1]);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && z.type !== 'exit_line' && z.points.length > 3) {
      e.preventDefault();
      update((zs) => zs.map((x) => (x.id === z.id ? { ...x, points: x.points.filter((_, i) => i !== idx) } : x)));
    }
  };

  const save = useMutation((body: { expected_version: number; zones: Zone[] }) => endpoints.cameras.putZones(cameraId, body), {
    successMessage: t('Zones saved — sent to the store edge'),
    onSuccess: (r) => {
      setSaved(r);
      setZones(r.zones.map((z) => ({ ...z, points: z.points.map((p) => [p[0], p[1]] as Pt) })));
      setBaseVersion(r.version);
      setDirty(false);
      setServerErrors({});
      setConflict(false);
    },
    onError: (e) => {
      if (e.status === 409) {
        setConflict(true);
        reload();
        return true;
      }
      if (e.status === 422) {
        const out: Record<number, string> = {};
        for (const [k, v] of Object.entries(e.fieldErrors)) {
          const m = /^zones\.(\d+)\./.exec(k);
          if (m?.[1]) out[Number(m[1])] = fieldErrorText(v, locale) ?? v;
        }
        setServerErrors(out);
        return Object.keys(out).length > 0;
      }
      return false;
    },
  });

  const problems = zones.map((z) => zoneProblem(z));
  const submit = () => {
    setShowProblems(true);
    if (problems.some(Boolean)) return;
    void save.run({
      expected_version: saved.version,
      zones: zones.map((z) => ({
        id: z.id,
        type: z.type,
        label: z.label.trim(),
        points: z.points,
        ...(z.type === 'exit_line' ? { direction: z.direction } : {}),
      })),
    });
  };

  const discard = () => {
    setZones(saved.zones.map((z) => ({ ...z, points: z.points.map((p) => [p[0], p[1]] as Pt) })));
    setBaseVersion(saved.version);
    setDirty(false);
    setDraft([]);
    setServerErrors({});
    setShowProblems(false);
  };

  const hasFrame = Boolean(cam?.snapshot);
  const ack = saved.acknowledged_version;
  const tools: { value: Tool; label: string }[] = [
    { value: 'select', label: t('Select and move') },
    { value: 'shelf', label: t('Shelf zone') },
    { value: 'checkout', label: t('Checkout zone') },
    { value: 'exit_line', label: t('Exit line') },
    { value: 'privacy_mask', label: t('Privacy mask') },
  ];

  return (
    <>
      {conflict ? (
        <ConflictBanner
          currentVersion={saved.version}
          reloading={reloading}
          onReload={() => {
            setConflict(false);
            discard();
            reload();
          }}
        />
      ) : null}
      <div className="grid gb-form-layout">
        <Card
          title={t('Live preview')}
          titleAddon={cam?.snapshot ? <Badge tone="info">{fmt.dateTime(cam.snapshot.captured_at, tz, { withZone: true })}</Badge> : undefined}
        >
          {!hasFrame && cam ? (
            <Notice tone="warning" title={t('No verified frame')}>
              {t('Draw zones only after the camera is ready and the edge has uploaded a frame. Without a real view the zones cannot be placed accurately.')}
            </Notice>
          ) : null}
          <div className="gb-tools" role="group" aria-label={t('Drawing tools')}>
            {tools.map((x) => (
              <Button
                key={x.value}
                size="sm"
                variant="secondary"
                className="gb-tool"
                aria-pressed={tool === x.value}
                onClick={() => {
                  setTool(x.value);
                  setDraft([]);
                }}
              >
                {x.label}
              </Button>
            ))}
          </div>
          <div className={`gb-zone-canvas ${hasFrame ? '' : 'neutral'}`}>
            {cam?.snapshot ? <AuthenticatedImage mediaId={cam.snapshot.media_id} alt={t('Latest verified frame from {camera}', { camera: cam.name })} /> : null}
            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              className={tool !== 'select' ? 'drawing' : undefined}
              role="img"
              aria-label={t('Zone drawing area. Use the zone list to edit zones with the keyboard.')}
              onPointerDown={onCanvasPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerLeave={endDrag}
              onDoubleClick={() => finishDraft()}
            >
              {zones.map((z) => {
                const pts = z.points.map((p) => `${p[0] * W},${p[1] * H}`).join(' ');
                const sel = z.id === selected;
                const first = z.points[0];
                return (
                  <g key={z.id}>
                    {z.type === 'exit_line' ? (
                      <polyline points={pts} className={`gb-zone-shape gb-zone-exit_line ${sel ? 'selected' : ''}`} />
                    ) : (
                      <polygon
                        points={pts}
                        className={`gb-zone-shape gb-zone-${z.type} ${sel ? 'selected' : ''}`}
                        onPointerDown={(e) => {
                          if (tool === 'select') {
                            e.stopPropagation();
                            setSelected(z.id);
                          }
                        }}
                      />
                    )}
                    {first ? (
                      <text x={first[0] * W + 1.5} y={first[1] * H - 1.5} className="gb-zone-tag" fontSize={3.2}>
                        {z.label || t(ZONE_TYPE_LABEL[z.type])}
                        {z.type === 'exit_line' && z.direction ? ` · ${z.direction === 'in' ? t('direction|In') : t('direction|Out')}` : ''}
                      </text>
                    ) : null}
                    {sel && tool === 'select'
                      ? z.points.map((p, i) => (
                          <circle
                            key={i}
                            cx={p[0] * W}
                            cy={p[1] * H}
                            r={1.8}
                            className="gb-handle"
                            tabIndex={0}
                            role="slider"
                            aria-label={t('Point {n} of {label}', { n: i + 1, label: z.label || t(ZONE_TYPE_LABEL[z.type]) })}
                            aria-valuetext={`x ${Math.round(p[0] * 100)}%, y ${Math.round(p[1] * 100)}%`}
                            onKeyDown={(e) => onHandleKey(e, z, i)}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              (e.currentTarget.ownerSVGElement ?? e.currentTarget).setPointerCapture?.(e.pointerId);
                              drag.current = { zoneId: z.id, idx: i };
                            }}
                          />
                        ))
                      : null}
                  </g>
                );
              })}
              {draft.length > 0 ? (
                <>
                  <polyline points={draft.map((p) => `${p[0] * W},${p[1] * H}`).join(' ')} className="gb-zone-draft" />
                  {draft.map((p, i) => (
                    <circle key={i} cx={p[0] * W} cy={p[1] * H} r={1.2} className="gb-handle" />
                  ))}
                </>
              ) : null}
            </svg>
          </div>
          <p className="muted small" aria-live="polite">
            {tool === 'select'
              ? t('Select a zone to drag its points. Focus a point and use the arrow keys to move it (Shift for larger steps); Delete removes a point.')
              : tool === 'exit_line'
                ? t('Click two points to draw the exit line.')
                : t('Click to add points ({n} so far). Double-click or press “Finish shape” to close the zone.', { n: draft.length })}
          </p>
          {tool !== 'select' && tool !== 'exit_line' && draft.length >= 3 ? (
            <div className="action-row">
              <Button size="sm" onClick={() => finishDraft()}>
                {t('Finish shape')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setDraft([])}>
                {t('Cancel')}
              </Button>
            </div>
          ) : tool !== 'select' && draft.length > 0 ? (
            <div className="action-row">
              <Button size="sm" variant="secondary" onClick={() => setDraft([])}>
                {t('Cancel')}
              </Button>
            </div>
          ) : null}
        </Card>

        <Card title={t('Detection zone editor')}>
          <div className="gb-inline">
            <StatusPill tone="info">{t('Saved version {n}', { n: saved.version })}</StatusPill>
            {ack === null || ack === undefined ? (
              <StatusPill tone="neutral">{t('Edge acknowledgement unavailable')}</StatusPill>
            ) : ack >= saved.version ? (
              <StatusPill tone="ok">{t('Edge applied version {n}', { n: ack })}</StatusPill>
            ) : (
              <StatusPill tone="warning">{t('Edge is on version {n} — waiting for acknowledgement', { n: ack })}</StatusPill>
            )}
            {dirty ? <Badge tone="warning">{t('Unsaved changes')}</Badge> : null}
          </div>
          {zones.length === 0 ? (
            <EmptyState compact icon="cameras" title={t('No zones yet')} description={t('Pick a tool and click on the preview to draw a shelf zone, checkout zone, exit line or privacy mask.')} />
          ) : (
            <ul className="gb-zone-list" aria-label={t('Zones')}>
              {zones.map((z, i) => {
                const problem = showProblems ? problems[i] : null;
                const server = serverErrors[i];
                return (
                  <li key={z.id} className={`gb-zone-item ${z.id === selected ? 'selected' : ''}`}>
                    <div className="gb-zone-item-head">
                      <Button size="sm" variant="ghost" aria-pressed={z.id === selected} onClick={() => {
                        setSelected(z.id);
                        setTool('select');
                      }}>
                        {t(ZONE_TYPE_LABEL[z.type])} · {t('{n} points', { n: z.points.length })}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          update((zs) => zs.filter((x) => x.id !== z.id));
                          if (selected === z.id) setSelected(null);
                        }}
                      >
                        {t('Delete zone')}
                      </Button>
                    </div>
                    <TextField
                      label={t('Label')}
                      maxLength={80}
                      value={z.label}
                      onChange={(e) => update((zs) => zs.map((x) => (x.id === z.id ? { ...x, label: e.target.value } : x)))}
                    />
                    {z.type === 'exit_line' ? (
                      <SelectField
                        label={t('Direction')}
                        value={z.direction ?? ''}
                        onChange={(e) => update((zs) => zs.map((x) => (x.id === z.id ? { ...x, direction: e.target.value as 'in' | 'out' } : x)))}
                        placeholder={t('Select direction')}
                        options={[
                          { value: 'in', label: t('direction|In') },
                          { value: 'out', label: t('direction|Out') },
                        ]}
                        hint={t('Whether crossing this line counts as entering or leaving.')}
                      />
                    ) : null}
                    <div className="gb-points">{z.points.map((p) => `(${p[0].toFixed(3)}, ${p[1].toFixed(3)})`).join(' ')}</div>
                    {problem || server ? (
                      <div className="field-error" role="alert">
                        {server ?? t(problem!)}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          <Notice tone="info">{t('Privacy masks are blacked out on the edge before analysis and before any snapshot or evidence leaves the store.')}</Notice>
          <div className="action-row">
            <Button onClick={submit} pending={save.pending}>
              {t('Save zones')}
            </Button>
            {dirty ? (
              <Button variant="secondary" onClick={discard}>
                {t('Discard changes')}
              </Button>
            ) : null}
            <ButtonLink to={screenPath('web-15', { id: cameraId })}>{t('Back to camera')}</ButtonLink>
          </div>
        </Card>
      </div>
    </>
  );
}
