-- Generic key-value store for client-side app state (cold-call tracker, billing, docs)
-- Each app/feature uses its own key; value is arbitrary JSONB.

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_state_updated ON app_state(updated_at);
