CREATE TABLE IF NOT EXISTS subscriber_deliveries (
  subscriber_id INTEGER NOT NULL,
  delivery_date TEXT NOT NULL,
  verse_path TEXT NOT NULL,
  provider_id TEXT,
  sent_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (subscriber_id, delivery_date)
);

CREATE INDEX IF NOT EXISTS idx_subscriber_deliveries_date
  ON subscriber_deliveries(delivery_date);
