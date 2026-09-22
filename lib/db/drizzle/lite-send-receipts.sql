-- Additive development SQL; reviewed scope: one new table, no existing data changes.
-- Production schema application is owned by Publish, not an app startup hook.
CREATE TABLE IF NOT EXISTS dm_send_receipts (
  sender_id integer NOT NULL,
  client_message_id uuid NOT NULL,
  request_hash text NOT NULL,
  message jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sender_id, client_message_id)
);