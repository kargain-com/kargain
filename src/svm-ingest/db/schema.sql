-- SVM raw ingest layer (S7c-1) — append-only; never dropped by ponder-reindex.sql
CREATE SCHEMA IF NOT EXISTS kargain_svm_raw;

CREATE OR REPLACE FUNCTION kargain_svm_raw.deny_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'kargain_svm_raw.% is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS kargain_svm_raw.structured_payload (
  id TEXT PRIMARY KEY,
  namespace INTEGER NOT NULL,
  slot BIGINT NOT NULL,
  tx_index_in_block INTEGER NOT NULL,
  log_index INTEGER NOT NULL,
  tx_signature TEXT NOT NULL,
  emitting_program TEXT NOT NULL,
  discriminator BYTEA NOT NULL CHECK (octet_length(discriminator) = 8),
  event_name TEXT NOT NULL,
  contract_name TEXT NOT NULL,
  payload_bytes BYTEA NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT structured_payload_order_unique UNIQUE (namespace, slot, tx_index_in_block, log_index)
);

CREATE INDEX IF NOT EXISTS structured_payload_slot_order_idx
  ON kargain_svm_raw.structured_payload (namespace, slot, tx_index_in_block, log_index);

DROP TRIGGER IF EXISTS structured_payload_no_mutation ON kargain_svm_raw.structured_payload;
CREATE TRIGGER structured_payload_no_mutation
  BEFORE UPDATE OR DELETE ON kargain_svm_raw.structured_payload
  FOR EACH ROW EXECUTE FUNCTION kargain_svm_raw.deny_mutation();

CREATE TABLE IF NOT EXISTS kargain_svm_raw.ingest_refusal (
  id TEXT PRIMARY KEY,
  namespace INTEGER,
  refusal_kind TEXT NOT NULL CHECK (
    refusal_kind IN (
      'log_truncated',
      'unknown_discriminator',
      'payload_malformed',
      'sequence_gap'
    )
  ),
  slot BIGINT,
  tx_index_in_block INTEGER,
  log_index INTEGER,
  tx_signature TEXT,
  emitting_program TEXT,
  discriminator BYTEA,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ingest_refusal_kind_idx
  ON kargain_svm_raw.ingest_refusal (refusal_kind, observed_at);

DROP TRIGGER IF EXISTS ingest_refusal_no_mutation ON kargain_svm_raw.ingest_refusal;
CREATE TRIGGER ingest_refusal_no_mutation
  BEFORE UPDATE OR DELETE ON kargain_svm_raw.ingest_refusal
  FOR EACH ROW EXECUTE FUNCTION kargain_svm_raw.deny_mutation();

CREATE TABLE IF NOT EXISTS kargain_svm_raw.ingest_cursor (
  id TEXT PRIMARY KEY,
  namespace INTEGER NOT NULL,
  last_contiguous_slot BIGINT NOT NULL,
  catchup_incident TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS ingest_cursor_no_delete ON kargain_svm_raw.ingest_cursor;
CREATE TRIGGER ingest_cursor_no_delete
  BEFORE DELETE ON kargain_svm_raw.ingest_cursor
  FOR EACH ROW EXECUTE FUNCTION kargain_svm_raw.deny_mutation();
