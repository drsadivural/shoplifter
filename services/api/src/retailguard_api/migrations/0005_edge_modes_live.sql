-- Edge processing mode: "streaming" (cameras are relayed for live view only) or "full" (the edge
-- also runs the installed analysis models and reports events). Chosen on the device at pairing and
-- changed from the console (optimistic concurrency via version).
ALTER TABLE edges ADD COLUMN processing_mode text NOT NULL DEFAULT 'streaming'
  CHECK (processing_mode IN ('streaming','full'));
ALTER TABLE edges ADD COLUMN reported_mode text CHECK (reported_mode IN ('streaming','full'));
ALTER TABLE edges ADD COLUMN version bigint NOT NULL DEFAULT 1;

-- On-demand live relay: a viewer's request marks demand; the camera's edge uploads short HLS
-- segments only while demand is recent.
ALTER TABLE cameras ADD COLUMN live_demand_at timestamptz;
ALTER TABLE cameras ADD COLUMN live_segment_at timestamptz;
-- live_seq numbers the stored segments consecutively (HLS media sequence); live_edge_seq is the
-- appliance's own increasing number, used to drop re-sent segments.
ALTER TABLE cameras ADD COLUMN live_seq bigint NOT NULL DEFAULT 0;
ALTER TABLE cameras ADD COLUMN live_edge_seq bigint NOT NULL DEFAULT 0;

ALTER TABLE edge_commands DROP CONSTRAINT edge_commands_kind_check;
ALTER TABLE edge_commands ADD CONSTRAINT edge_commands_kind_check CHECK (kind IN
  ('discover','provision_camera','activate_camera','pause_camera','update_zones','model_rollout','gallery_update',
   'set_processing_mode'));
