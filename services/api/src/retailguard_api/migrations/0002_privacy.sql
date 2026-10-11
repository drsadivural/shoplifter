-- Legal holds on incident evidence and data-subject (access/correction/deletion) request tracking.
ALTER TABLE incidents ADD COLUMN legal_hold_reason text, ADD COLUMN legal_hold_review_at timestamptz,
  ADD COLUMN legal_hold_by uuid;

CREATE TABLE privacy_requests (
  id uuid PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id),
  kind text NOT NULL CHECK (kind IN ('access','correction','deletion')),
  subject_reference text NOT NULL CHECK (length(subject_reference) BETWEEN 1 AND 200),
  received_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','rejected')),
  resolution text,
  created_by uuid NOT NULL,
  completed_by uuid,
  completed_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, id)
);
ALTER TABLE privacy_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON privacy_requests
  USING (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid)
  WITH CHECK (org_id = NULLIF(current_setting('app.org_id', true), '')::uuid);
