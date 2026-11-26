CREATE TABLE IF NOT EXISTS institutions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  identity_key text NOT NULL UNIQUE,
  name text NOT NULL,
  city text NOT NULL,
  region text NOT NULL,
  leader_name text,
  institution_email text,
  institution_phone text,
  source_urls text[] NOT NULL,
  response_status text NOT NULL DEFAULT 'not_sent'
    CHECK (response_status IN ('not_sent', 'awaiting_reply', 'replied'))
);

ALTER TABLE institutions ADD COLUMN IF NOT EXISTS institution_email text;
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS institution_phone text;
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS manual_edits jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS school_enrollment jsonb;
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS institution_type text CHECK (
  institution_type IN ('university', 'college', 'school', 'kindergarten', 'supplementary', 'other')
);

CREATE TABLE IF NOT EXISTS institution_searches (
  query_key text PRIMARY KEY,
  institution_ids bigint[] NOT NULL
);

CREATE TABLE IF NOT EXISTS school_mail_deliveries (
  request_id uuid NOT NULL,
  institution_id bigint NOT NULL REFERENCES institutions(id),
  recipient text NOT NULL,
  template text NOT NULL,
  status text NOT NULL CHECK (status IN ('sending', 'sent', 'failed', 'uncertain')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, institution_id)
);

ALTER TABLE school_mail_deliveries ADD COLUMN IF NOT EXISTS message_id text;
ALTER TABLE school_mail_deliveries ADD COLUMN IF NOT EXISTS subject text;
ALTER TABLE school_mail_deliveries ADD COLUMN IF NOT EXISTS finished_at timestamptz;

CREATE INDEX IF NOT EXISTS school_mail_deliveries_sent_at_idx
  ON school_mail_deliveries (institution_id, (COALESCE(finished_at, created_at))) WHERE status = 'sent';

CREATE TABLE IF NOT EXISTS school_mail_templates (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  subject text NOT NULL,
  text text NOT NULL
);

ALTER TABLE school_mail_templates ADD COLUMN IF NOT EXISTS layout text NOT NULL DEFAULT 'plain'
  CHECK (layout IN ('plain', 'promotion', 'invitation', 'newsletter'));

ALTER TABLE school_mail_templates ADD COLUMN IF NOT EXISTS design jsonb;

CREATE TABLE IF NOT EXISTS outreach_campaigns (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  schedule text NOT NULL DEFAULT '',
  registration_url text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 0,
  state jsonb NOT NULL DEFAULT '{"messages":[],"schoolIds":[],"draft":null,"upperGrades":false}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE school_mail_deliveries ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES outreach_campaigns(id);
CREATE UNIQUE INDEX IF NOT EXISTS school_mail_active_campaign_recipient_idx
  ON school_mail_deliveries (campaign_id, institution_id)
  WHERE campaign_id IS NOT NULL AND status IN ('sending', 'sent', 'uncertain');

CREATE TABLE IF NOT EXISTS app_users (
  username text PRIMARY KEY,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'employee')),
  password_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS app_sessions (
  token_hash text PRIMARY KEY,
  username text NOT NULL REFERENCES app_users (username) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_sessions_expiry_idx ON app_sessions (expires_at);
CREATE INDEX IF NOT EXISTS app_sessions_seen_idx ON app_sessions (last_seen_at);

CREATE TABLE IF NOT EXISTS app_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'employee')),
  action text NOT NULL,
  details text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
