-- Camera sources: ONVIF (default, existing rows), a direct RTSP URL entered by the operator, or a
-- USB (V4L2) camera attached to the store edge appliance (address holds the device path).
ALTER TABLE cameras ADD COLUMN source_type text NOT NULL DEFAULT 'onvif'
  CHECK (source_type IN ('onvif','rtsp','usb'));
ALTER TABLE cameras ADD COLUMN rtsp_port integer CHECK (rtsp_port BETWEEN 1 AND 65535);
ALTER TABLE cameras ADD COLUMN rtsp_scheme text CHECK (rtsp_scheme IN ('rtsp','rtsps'));

-- An NVR serves many channels from one address: uniqueness is per stream target.
ALTER TABLE cameras DROP CONSTRAINT cameras_org_id_store_id_address_key;
CREATE UNIQUE INDEX cameras_stream_target ON cameras
  (org_id, store_id, address, COALESCE(rtsp_port, 0), COALESCE(rtsp_path, ''));

-- Discovery without a chosen interface probes every private interface of the appliance.
ALTER TABLE discovery_jobs ALTER COLUMN interface DROP NOT NULL;
