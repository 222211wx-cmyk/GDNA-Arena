CREATE TABLE native_call_push_installations (
  id bigserial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash text NOT NULL,
  installation_id text NOT NULL,
  provider text NOT NULL,
  token text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX native_call_push_installation_unique ON native_call_push_installations (installation_id);
--> statement-breakpoint
CREATE UNIQUE INDEX native_call_push_token_unique ON native_call_push_installations (provider, token);
--> statement-breakpoint
CREATE TABLE native_call_push_deliveries (
  installation_id bigint NOT NULL REFERENCES native_call_push_installations(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, event_key)
);