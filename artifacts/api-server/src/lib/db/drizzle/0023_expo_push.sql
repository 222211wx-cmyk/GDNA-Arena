CREATE TABLE expo_push_installations (
  id bigserial PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_hash text NOT NULL,
  installation_id text NOT NULL,
  token text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX expo_push_installations_installation_id_unique ON expo_push_installations (installation_id);
--> statement-breakpoint
CREATE UNIQUE INDEX expo_push_installations_token_unique ON expo_push_installations (token);
--> statement-breakpoint
CREATE TABLE expo_push_deliveries (
  installation_id bigint NOT NULL REFERENCES expo_push_installations(id) ON DELETE CASCADE,
  event_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, event_key)
);