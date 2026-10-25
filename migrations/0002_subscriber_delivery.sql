ALTER TABLE subscribers ADD COLUMN email_ciphertext TEXT;
ALTER TABLE subscribers ADD COLUMN email_nonce TEXT;
ALTER TABLE subscribers ADD COLUMN email_sent_at TEXT;
ALTER TABLE subscribers ADD COLUMN email_failed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_subscribers_delivery
  ON subscribers(confirmed, language, email_sent_at);
