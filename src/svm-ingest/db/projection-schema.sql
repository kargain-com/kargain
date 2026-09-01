-- SVM provenance + custody projection (S7c-2 / S7c-3) — dropped/rebuilt by svm-ingest; never by ponder-reindex.sql
CREATE SCHEMA IF NOT EXISTS kargain_svm_projection;

CREATE TABLE IF NOT EXISTS kargain_svm_projection.passport_record (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  author TEXT NOT NULL,
  record_type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  evidence_cid TEXT NOT NULL DEFAULT '',
  timestamp BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS passport_record_token_idx
  ON kargain_svm_projection.passport_record (token_id, timestamp DESC, id DESC);

CREATE INDEX IF NOT EXISTS passport_record_attestation_idx
  ON kargain_svm_projection.passport_record (author, record_type, timestamp DESC);

CREATE TABLE IF NOT EXISTS kargain_svm_projection.passport_uri_history (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  previous_uri TEXT NOT NULL DEFAULT '',
  new_uri TEXT NOT NULL,
  author TEXT NOT NULL,
  verification_reset BOOLEAN NOT NULL DEFAULT false,
  timestamp BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS passport_uri_history_token_idx
  ON kargain_svm_projection.passport_uri_history (token_id, timestamp DESC, id DESC);

CREATE TABLE IF NOT EXISTS kargain_svm_projection.custody_determining_event (
  id TEXT PRIMARY KEY,
  token_id TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  block_number INTEGER NOT NULL,
  log_index INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS custody_determining_event_token_idx
  ON kargain_svm_projection.custody_determining_event (token_id, chain_id, block_number, log_index);
