-- 001_multitenancy.sql
-- Adds multi-tenant + lettings/sales support.
-- Existing rows are backfilled to agency_id = 'quantistic' so nothing breaks.
-- Run this in Supabase SQL Editor BEFORE deploying the patched server.js.

-- Leads
ALTER TABLE leads ADD COLUMN IF NOT EXISTS agency_id    TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS pipeline     TEXT;        -- 'lettings' | 'sales' | NULL
ALTER TABLE leads ADD COLUMN IF NOT EXISTS monthly_rent NUMERIC;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS confidence   NUMERIC;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS source       TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS notes        TEXT;

UPDATE leads SET agency_id = 'quantistic' WHERE agency_id IS NULL;
ALTER TABLE leads ALTER COLUMN agency_id SET NOT NULL;
ALTER TABLE leads ALTER COLUMN agency_id SET DEFAULT 'quantistic';

CREATE INDEX IF NOT EXISTS idx_leads_agency_id           ON leads(agency_id);
CREATE INDEX IF NOT EXISTS idx_leads_agency_pipeline     ON leads(agency_id, pipeline);

-- Appointments
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS agency_id TEXT;
UPDATE appointments SET agency_id = 'quantistic' WHERE agency_id IS NULL;
ALTER TABLE appointments ALTER COLUMN agency_id SET NOT NULL;
ALTER TABLE appointments ALTER COLUMN agency_id SET DEFAULT 'quantistic';
CREATE INDEX IF NOT EXISTS idx_appointments_agency_id ON appointments(agency_id);

-- Events
ALTER TABLE events ADD COLUMN IF NOT EXISTS agency_id TEXT;
UPDATE events SET agency_id = 'quantistic' WHERE agency_id IS NULL;
ALTER TABLE events ALTER COLUMN agency_id SET NOT NULL;
ALTER TABLE events ALTER COLUMN agency_id SET DEFAULT 'quantistic';
CREATE INDEX IF NOT EXISTS idx_events_agency_id ON events(agency_id);

-- Optional: agencies table (handy for later when you onboard client #3+)
CREATE TABLE IF NOT EXISTS agencies (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  domain      TEXT,
  brand_color TEXT,
  logo_url    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO agencies (id, name) VALUES
  ('quantistic', 'Quantistic Systems'),
  ('reddoor',    'Red Door Homes')
ON CONFLICT (id) DO NOTHING;
