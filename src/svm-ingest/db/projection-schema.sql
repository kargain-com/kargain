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

CREATE TABLE IF NOT EXISTS kargain_svm_projection.passport (
  id TEXT PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  owner TEXT NOT NULL,
  status TEXT NOT NULL,
  verifier TEXT NOT NULL DEFAULT '',
  verified_at BIGINT NOT NULL DEFAULT 0,
  token_uri TEXT NOT NULL DEFAULT '',
  cover_photo_uri TEXT NOT NULL DEFAULT '',
  vin TEXT NOT NULL DEFAULT '',
  make TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  year INTEGER NOT NULL DEFAULT 0,
  mileage_km INTEGER NOT NULL DEFAULT 0,
  last_disputer TEXT NOT NULL DEFAULT '',
  dispute_reason TEXT NOT NULL DEFAULT '',
  dispute_withdrawn_at BIGINT NOT NULL DEFAULT 0,
  last_verification_reset_at BIGINT NOT NULL DEFAULT 0,
  duplicate_vin BOOLEAN NOT NULL DEFAULT false,
  last_metadata_change_at BIGINT NOT NULL DEFAULT 0,
  verification_reset_count INTEGER NOT NULL DEFAULT 0,
  had_dispute BOOLEAN NOT NULL DEFAULT false,
  last_dispute_resolved_at BIGINT NOT NULL DEFAULT 0,
  last_dispute_terminal TEXT NOT NULL DEFAULT '',
  dispute_opened_at BIGINT NOT NULL DEFAULT 0,
  fuel_type TEXT NOT NULL DEFAULT '',
  body_type TEXT NOT NULL DEFAULT '',
  transmission TEXT NOT NULL DEFAULT '',
  condition TEXT NOT NULL DEFAULT '',
  vehicle_type TEXT NOT NULL DEFAULT '',
  colour TEXT NOT NULL DEFAULT '',
  location_label TEXT NOT NULL DEFAULT '',
  location_place_id TEXT NOT NULL DEFAULT '',
  location_country_code TEXT NOT NULL DEFAULT '',
  dispute_deposit BIGINT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS passport_status_idx ON kargain_svm_projection.passport (status);
CREATE INDEX IF NOT EXISTS passport_make_idx ON kargain_svm_projection.passport (lower(make));
CREATE INDEX IF NOT EXISTS passport_model_idx ON kargain_svm_projection.passport (lower(model));
CREATE INDEX IF NOT EXISTS passport_year_idx ON kargain_svm_projection.passport (year);
CREATE INDEX IF NOT EXISTS passport_mileage_idx ON kargain_svm_projection.passport (mileage_km);
CREATE INDEX IF NOT EXISTS passport_place_idx ON kargain_svm_projection.passport (location_place_id);
CREATE INDEX IF NOT EXISTS passport_fuel_idx ON kargain_svm_projection.passport (lower(fuel_type));
CREATE INDEX IF NOT EXISTS passport_body_idx ON kargain_svm_projection.passport (lower(body_type));
CREATE INDEX IF NOT EXISTS passport_transmission_idx ON kargain_svm_projection.passport (lower(transmission));
CREATE INDEX IF NOT EXISTS passport_condition_idx ON kargain_svm_projection.passport (lower(condition));
CREATE INDEX IF NOT EXISTS passport_vehicle_idx ON kargain_svm_projection.passport (lower(vehicle_type));
CREATE INDEX IF NOT EXISTS passport_owner_idx ON kargain_svm_projection.passport (owner);
CREATE INDEX IF NOT EXISTS passport_vin_idx ON kargain_svm_projection.passport (vin);
