-- Public donation ledger (D1 database `sohamhamso-ledger`, binding LEDGER_DB).
-- Kept out of PII_DB on purpose: this data is meant to be public.
-- Apply: wrangler d1 migrations apply sohamhamso-ledger --remote
-- (wrangler.toml sets migrations_dir = "migrations-ledger" for this binding.)

CREATE TABLE IF NOT EXISTS ledger_entries (
  id            TEXT PRIMARY KEY,                 -- 'stripe:<payment_intent>' | 'upi:<UTR>' | 'ghs:<id>' | 'yt:<yyyy-mm>' | 'manual:<uuid>'
  occurred_at   TEXT NOT NULL,                    -- ISO-8601 UTC
  rail          TEXT NOT NULL CHECK (rail IN ('stripe','upi','github_sponsors','youtube','shop','bank')),
  direction     TEXT NOT NULL DEFAULT 'in' CHECK (direction IN ('in','out')),
  kind          TEXT NOT NULL CHECK (kind IN ('donation','sale','payout','expense','fee','transfer')),
  amount_minor  INTEGER NOT NULL CHECK (amount_minor > 0),   -- paise / cents
  currency      TEXT NOT NULL CHECK (length(currency) = 3),  -- 'INR' | 'USD'
  fee_minor     INTEGER CHECK (fee_minor IS NULL OR fee_minor >= 0),
  source        TEXT,                             -- 'site' | 'repo' | 'yt' | … (from ?src=)
  display_name  TEXT,                             -- NULL → "Anonymous"; only with donor consent
  memo          TEXT,                             -- public note
  external_ref  TEXT,                             -- PRIVATE: PaymentIntent id / UTR; never selected publicly
  is_public     INTEGER NOT NULL DEFAULT 1 CHECK (is_public IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_ledger_occurred ON ledger_entries (occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_external ON ledger_entries (rail, external_ref);

CREATE TABLE IF NOT EXISTS stripe_events (
  event_id     TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  received_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE VIEW IF NOT EXISTS ledger_public AS
SELECT id, occurred_at, rail, direction, kind, amount_minor, currency, fee_minor,
       source, COALESCE(display_name, 'Anonymous') AS display_name, memo
FROM ledger_entries
WHERE is_public = 1;
