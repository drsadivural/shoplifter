import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LivePlayer } from '../components/LivePlayer';
import { EdgeTree } from '../shell/EdgeTree';
import { mockFetch, renderWithProviders } from '../test/utils';
import EdgePairPage from './edge-pair';

const hlsInstances: { src?: string; attached?: HTMLMediaElement; destroyed: boolean }[] = [];
vi.mock('hls.js', () => {
  class FakeHls {
    static isSupported = () => true;
    static Events = { ERROR: 'hlsError' };
    static ErrorTypes = { MEDIA_ERROR: 'mediaError' };
    rec: { src?: string; attached?: HTMLMediaElement; destroyed: boolean } = { destroyed: false };
    constructor() {
      hlsInstances.push(this.rec);
    }
    on() {}
    loadSource(src: string) {
      this.rec.src = src;
    }
    attachMedia(v: HTMLMediaElement) {
      this.rec.attached = v;
    }
    recoverMediaError() {}
    destroy() {
      this.rec.destroyed = true;
    }
  }
  return { default: FakeHls };
});

const LIVE = (state: string, extra: Record<string, unknown> = {}) => ({
  camera_id: 'cam-1', state, reason: null, playlist: state === 'live' ? '/v1/cameras/cam-1/live.m3u8' : null,
  edge: { id: 'e-1', name: 'Register edge', processing_mode: 'streaming', state: 'online' }, ...extra,
});

const TREE = {
  items: [
    {
      id: 'e-1', store_id: 's-1', store_name: 'Store One', name: 'Register edge', fingerprint: 'SHA256:x', software_version: '0.4.0',
      last_seen_at: null, state: 'online', health: null, processing_mode: 'full', reported_mode: 'full', version: 2, models: [],
      cameras: [{ id: 'cam-1', name: 'Entrance', location: '', readiness: 'ready', analysis_state: 'unavailable', source_type: 'rtsp', store_id: 's-1' }],
    },
    {
      id: 'e-2', store_id: 's-1', store_name: 'Store One', name: 'Back office edge', fingerprint: 'SHA256:y', software_version: '0.4.0',
      last_seen_at: null, state: 'offline', health: null, processing_mode: 'streaming', reported_mode: 'streaming', version: 1, models: [],
      cameras: [],
    },
  ],
  unassigned_cameras: [],
};

beforeEach(() => {
  hlsInstances.length = 0;
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('LivePlayer', () => {
  it('waits while the relay starts, then plays the playlist with hls.js', async () => {
    let n = 0;
    mockFetch({ 'GET /v1/cameras/cam-1/live': () => ({ body: ++n < 2 ? LIVE('starting') : LIVE('live') }) });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderWithProviders(<LivePlayer cameraId="cam-1" name="Entrance" large />);
    expect(await screen.findByText('Starting live video…')).toBeInTheDocument();
    expect(hlsInstances).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    await waitFor(() => expect(hlsInstances).toHaveLength(1));
    expect(hlsInstances[0]!.src).toBe('/v1/cameras/cam-1/live.m3u8');
    const video = document.querySelector('video')!;
    expect(hlsInstances[0]!.attached).toBe(video);
    act(() => {
      video.dispatchEvent(new Event('playing'));
    });
    expect(await screen.findByText('LIVE')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Full screen' })).toBeInTheDocument();
  });

  it('explains why a camera cannot be watched', async () => {
    mockFetch({ 'GET /v1/cameras/cam-1/live': { body: LIVE('unavailable', { reason: 'edge_offline' }) } });
    renderWithProviders(<LivePlayer cameraId="cam-1" name="Entrance" />);
    expect(await screen.findByText('The edge appliance serving this camera is offline.')).toBeInTheDocument();
    expect(hlsInstances).toHaveLength(0);
  });
});

describe('Side menu edge devices', () => {
  it('lists each appliance with its cameras, linked to their live views', async () => {
    mockFetch({ 'GET /v1/edges/tree': { body: TREE } });
    renderWithProviders(<EdgeTree />, { route: '/web/dashboard' });
    const device = (await screen.findByText('Register edge')).closest('li') as HTMLElement;
    expect(within(device).getByText(/Store One · Full processing/)).toBeInTheDocument();
    expect(within(device).getByRole('link', { name: /Register edge/ })).toHaveAttribute('href', '/web/live?edge=e-1');
    expect(within(device).getByRole('link', { name: 'Entrance' })).toHaveAttribute('href', '/web/live?camera=cam-1');
    const toggle = within(device).getByRole('button', { name: 'Cameras of Register edge' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(device).toHaveClass('open');
    const empty = screen.getByText('Back office edge').closest('li') as HTMLElement;
    expect(within(empty).getByText('No cameras yet')).toBeInTheDocument();
  });

  it('keeps the device open while one of its cameras is shown', async () => {
    mockFetch({ 'GET /v1/edges/tree': { body: TREE } });
    renderWithProviders(<EdgeTree />, { route: '/web/live?camera=cam-1' });
    const device = (await screen.findByText('Register edge')).closest('li') as HTMLElement;
    expect(device).toHaveClass('open');
    expect(within(device).getByRole('link', { name: 'Entrance' })).toHaveAttribute('aria-current', 'page');
  });
});

describe('Edge devices management (web-08)', () => {
  it('switches an appliance between streaming only and full processing', async () => {
    const fetchMock = mockFetch({
      'GET /v1/edges': { body: { items: TREE.items.map(({ cameras: _c, store_name: _s, ...e }) => e), next_cursor: null } },
      'GET /v1/edges/tree': { body: TREE },
      'PATCH /v1/edges/e-2': (init) => ({ body: { ...TREE.items[1], ...JSON.parse(String(init?.body)), version: 2 } }),
    });
    renderWithProviders(<EdgePairPage />, { route: '/web/edge-pair' });
    const select = await screen.findByRole('combobox', { name: 'Processing mode for Back office edge' });
    expect(select).toHaveValue('streaming');
    expect(screen.getByText(/No analysis model installed on this appliance/)).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'full' } });
    await screen.findByText('Back office edge now runs full processing on the edge.');
    const call = fetchMock.mock.calls.find(([u, i]) => String(u).includes('/v1/edges/e-2') && (i as RequestInit)?.method === 'PATCH')!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ expected_version: 1, processing_mode: 'full' });
    const addLinks = screen.getAllByRole('link', { name: 'Add cameras' });
    expect(addLinks[0]).toHaveAttribute('href', '/web/camera-discovery?store_id=s-1&edge_id=e-1');
  });
});
