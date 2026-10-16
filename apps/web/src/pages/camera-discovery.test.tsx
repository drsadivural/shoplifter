import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeSession, makeMe, mockFetch, renderWithProviders } from '../test/utils';
import CameraDiscoveryPage from './camera-discovery';

afterEach(() => vi.unstubAllGlobals());

function bodyOf(fetchMock: ReturnType<typeof mockFetch>, path: string) {
  const call = fetchMock.mock.calls.filter(([u]) => String(u).includes(path)).at(-1);
  return call ? JSON.parse(String((call[1] as RequestInit).body)) : undefined;
}

function rtspCard() {
  return screen.getByText('Add by RTSP URL (manual)', { selector: 'h2, h3, h2 *, h3 *' }).closest('.card') as HTMLElement;
}

describe('Camera discovery (web-11)', () => {
  it('asks for a store first when the organization has none', () => {
    mockFetch({});
    renderWithProviders(<CameraDiscoveryPage />, { route: '/web/camera-discovery', session: fakeSession(makeMe({ stores: [] })) });
    expect(screen.getByText('Add a store first')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add store' })).toHaveAttribute('href', '/web/store-add');
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
  });

  it('searches without an interface and lists USB cameras next to ONVIF devices', async () => {
    const fetchMock = mockFetch({
      'POST /v1/discovery-jobs': { status: 202, body: { id: 'job-1', status: 'queued', devices: [] } },
      'GET /v1/discovery-jobs/job-1': {
        body: {
          id: 'job-1', status: 'completed', store_id: 's-1', created_at: '2026-10-16T00:00:00Z', completed_at: '2026-10-16T00:00:06Z',
          devices: [
            { kind: 'onvif', endpoint: 'urn:uuid:cam-1', address: '192.168.1.50', xaddrs: [], scopes: [], vendor: 'Axis', model: 'M3106', already_added: false },
            { kind: 'usb', endpoint: 'usb:/dev/v4l/by-id/usb-cam-video-index0', address: '/dev/v4l/by-id/usb-cam-video-index0', xaddrs: [], scopes: [], model: 'HD Webcam', already_added: false },
          ],
        },
      },
      'POST /v1/discovery-jobs/job-1/add': { status: 201, body: { id: 'cam-9', name: 'Register', readiness: 'pending' } },
    });
    renderWithProviders(<CameraDiscoveryPage />, { route: '/web/camera-discovery' });
    expect(screen.queryByLabelText(/Network interface/)).toBeNull();
    fireEvent.change(screen.getByLabelText('ONVIF username'), { target: { value: 'viewer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(bodyOf(fetchMock, '/v1/discovery-jobs')).toEqual({ store_id: 's-1', timeout_s: 5, include_usb: true }));
    expect(await screen.findByText('HD Webcam')).toBeInTheDocument();
    expect(screen.getByText('/dev/v4l/by-id/usb-cam-video-index0')).toBeInTheDocument();
    const usbRow = screen.getByText('HD Webcam').closest('li') as HTMLElement;
    fireEvent.click(within(usbRow).getByRole('button', { name: 'Add' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/No user name or password is needed/)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Username')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add camera' }));
    await waitFor(() =>
      expect(bodyOf(fetchMock, '/v1/discovery-jobs/job-1/add')).toMatchObject({
        endpoint: 'usb:/dev/v4l/by-id/usb-cam-video-index0', name: 'HD Webcam', username: '', password: '',
      }),
    );
  });

  it('adds a camera by RTSP URL and shows URL errors from the server', async () => {
    let attempt = 0;
    const fetchMock = mockFetch({
      'POST /v1/cameras/rtsp': () =>
        ++attempt === 1
          ? { status: 422, body: { code: 'validation_failed', message: 'x', request_id: 'r', retriable: false, field_errors: { url: 'address_not_permitted' } } }
          : { status: 201, body: { id: 'cam-5', name: 'Back door', readiness: 'pending' } },
    });
    renderWithProviders(<CameraDiscoveryPage />, { route: '/web/camera-discovery' });
    const card = rtspCard();
    fireEvent.change(within(card).getByLabelText(/Camera name/), { target: { value: 'Back door' } });
    fireEvent.change(within(card).getByLabelText(/RTSP URL/), { target: { value: 'http://192.168.1.20/stream' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Add camera' }));
    expect(await within(card).findByText(/starts with rtsp:\/\//)).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/v1/cameras/rtsp'))).toBe(false);

    fireEvent.change(within(card).getByLabelText(/RTSP URL/), { target: { value: 'rtsp://admin:pw@10.0.0.9:554/stream1' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Add camera' }));
    expect(await within(card).findByText('This address is outside the camera networks allowed for the store.')).toBeInTheDocument();

    fireEvent.click(within(card).getByRole('button', { name: 'Add camera' }));
    expect(await within(card).findByRole('link', { name: 'Check readiness' })).toHaveAttribute('href', expect.stringContaining('cam-5'));
    expect(bodyOf(fetchMock, '/v1/cameras/rtsp')).toEqual({
      store_id: 's-1', name: 'Back door', location: '', url: 'rtsp://admin:pw@10.0.0.9:554/stream1',
    });
  });
});
