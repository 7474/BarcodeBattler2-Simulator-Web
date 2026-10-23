PRAGMA foreign_keys = ON;

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Room rules are data so more official rooms can be added by migration later.
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  barcode_prefix TEXT,
  owner_session_hash TEXT REFERENCES sessions(id_hash),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  revision INTEGER NOT NULL DEFAULT 0,
  champion_barcode TEXT,
  champion_fighter TEXT,
  champion_owner_hash TEXT REFERENCES sessions(id_hash),
  champion_wins INTEGER NOT NULL DEFAULT 0,
  last_battle_id TEXT,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  CHECK (
    (champion_barcode IS NULL AND champion_fighter IS NULL AND champion_owner_hash IS NULL)
    OR (champion_barcode IS NOT NULL AND champion_fighter IS NOT NULL AND champion_owner_hash IS NOT NULL)
  )
);

CREATE TABLE battles (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  room_revision INTEGER NOT NULL,
  challenger_barcode TEXT NOT NULL,
  defender_barcode TEXT,
  challenger_owner_hash TEXT NOT NULL REFERENCES sessions(id_hash),
  winner_barcode TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(room_id, room_revision)
);
CREATE INDEX battles_room_recent ON battles(room_id, room_revision DESC);

CREATE TABLE rate_limits (
  session_hash TEXT NOT NULL REFERENCES sessions(id_hash),
  scope TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  hits INTEGER NOT NULL,
  PRIMARY KEY(session_hash, scope, bucket)
);
CREATE INDEX rate_limits_scope_bucket ON rate_limits(scope, bucket);

CREATE TABLE products (
  barcode TEXT PRIMARY KEY,
  name TEXT,
  has_thumbnail INTEGER NOT NULL DEFAULT 0,
  checked_at INTEGER NOT NULL
);

INSERT INTO rooms (id, name, description, barcode_prefix) VALUES
  ('japan49', '国内49コード', 'Valid EAN-8 or EAN-13 barcodes beginning with 49.', '49'),
  ('unlimited', '無差別', 'Any valid EAN-8 or EAN-13 barcode.', NULL);
