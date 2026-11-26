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
ALTER TABLE institutions ADD COLUMN IF NOT EXISTS institution_type text CHECK (
  institution_type IN ('university', 'college', 'school', 'kindergarten', 'supplementary', 'other')
);

CREATE TABLE IF NOT EXISTS institution_searches (
  query_key text PRIMARY KEY,
  institution_ids bigint[] NOT NULL
);
