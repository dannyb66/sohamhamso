-- Temporary delivery fallback while the email provider integration is being
-- validated. Keep email_hash and email_ciphertext until the mailer is stable;
-- remove this column and its writes in the cleanup migration afterwards.
ALTER TABLE subscribers ADD COLUMN email TEXT;
