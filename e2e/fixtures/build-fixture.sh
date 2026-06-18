#!/usr/bin/env bash
# ============================================================
# Build a small, deterministic cards-ygo fixture for E2E/CI.
#
# Reads your already-synced dev reference DB and extracts ~20
# well-known cards (plus their alt-artworks and a Forbidden card
# for the banlist spec) into e2e/fixtures/cards-ygo.test.db.
#
# Run this ONCE locally (you have the dev DB), then commit the
# resulting .db. Re-run it whenever the ygo 001 schema changes.
#
# Usage:
#   ./e2e/fixtures/build-fixture.sh
#   ./e2e/fixtures/build-fixture.sh /custom/path/to/cards-ygo.dev.db
# ============================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

# source dev DB (override via $1)
SRC="${1:-$HOME/.config/com.card-manager.app/cards-ygo.dev.db}"
# schema applied to the empty fixture (your real migration file)
SCHEMA="$REPO/src-tauri/migrations/ygo/001_initial.sql"
OUT="$HERE/cards-ygo.test.db"

if [ ! -f "$SRC" ]; then
  echo "ERROR: source dev DB not found: $SRC" >&2
  echo "Run the app in dev once to sync, or pass the path as \$1." >&2
  exit 1
fi
if [ ! -f "$SCHEMA" ]; then
  echo "ERROR: schema file not found: $SCHEMA" >&2
  exit 1
fi
command -v sqlite3 >/dev/null || { echo "ERROR: sqlite3 CLI not installed." >&2; exit 1; }

echo "Source : $SRC"
echo "Schema : $SCHEMA"
echo "Output : $OUT"

rm -f "$OUT" "$OUT-shm" "$OUT-wal"

# 1. create the empty fixture with the real schema (triggers + FTS)
sqlite3 "$OUT" < "$SCHEMA"

# 2. the cards we want (by NAME — robust to passcode differences).
#    Edit this list to grow the fixture. Keep Dark Magician (search
#    specs) and Pot of Greed (Forbidden — banlist spec).
NAMES="(
  'Dark Magician',
  'Dark Magician Girl',
  'Blue-Eyes White Dragon',
  'Red-Eyes Black Dragon',
  'Summoned Skull',
  'Celtic Guardian',
  'Kuriboh',
  'Exodia the Forbidden One',
  'Pot of Greed',
  'Monster Reborn',
  'Mirror Force',
  'Polymerization',
  'Swords of Revealing Light',
  'Raigeki',
  'Dark Hole',
  'Mystical Space Typhoon',
  'Trap Hole',
  'Change of Heart',
  'Harpie Lady',
  'Time Wizard'
)"

# 3. copy selected rows + alt-artworks + alias targets, lookups whole,
#    then rebuild FTS. Done in one transaction via ATTACH.
sqlite3 "$OUT" <<SQL
ATTACH DATABASE '$SRC' AS src;
PRAGMA foreign_keys = OFF;   -- defer FK during bulk copy

-- target id set: base names, their alt artworks, and alias targets
CREATE TEMP TABLE _ids AS
  SELECT id FROM src.cards WHERE name IN $NAMES
  UNION
  SELECT card_id FROM src.ygo_details
    WHERE alias IN (SELECT id FROM src.cards WHERE name IN $NAMES)
  UNION
  SELECT d.alias FROM src.ygo_details d
    WHERE d.alias IS NOT NULL
      AND d.card_id IN (SELECT id FROM src.cards WHERE name IN $NAMES);

-- lookup tables: copy whole (tiny)
INSERT OR IGNORE INTO card_types      SELECT * FROM src.card_types;
INSERT OR IGNORE INTO card_attributes SELECT * FROM src.card_attributes;
INSERT OR IGNORE INTO card_races      SELECT * FROM src.card_races;

-- cards
INSERT INTO cards (id,name,image_url,image_url_small,image_url_cropped,legal_text)
  SELECT id,name,image_url,image_url_small,image_url_cropped,legal_text
  FROM src.cards WHERE id IN (SELECT id FROM _ids);

-- ygo_details
INSERT INTO ygo_details
  SELECT * FROM src.ygo_details WHERE card_id IN (SELECT id FROM _ids);

-- printings
INSERT INTO printings
  SELECT * FROM src.printings WHERE card_id IN (SELECT id FROM _ids);

-- mark as fixture
INSERT OR REPLACE INTO sync_meta(key,value) VALUES('db_version','fixture');

-- rebuild the FTS index so search works regardless of insert order
INSERT INTO cards_fts(cards_fts) VALUES('rebuild');

PRAGMA foreign_keys = ON;
DETACH DATABASE src;
SQL

# 4. validate: FK integrity, FTS works, banlist present
echo "--- validation ---"
echo -n "cards:     "; sqlite3 "$OUT" "SELECT COUNT(*) FROM cards;"
echo -n "details:   "; sqlite3 "$OUT" "SELECT COUNT(*) FROM ygo_details;"
echo -n "printings: "; sqlite3 "$OUT" "SELECT COUNT(*) FROM printings;"
echo -n "FTS 'Dark':"; sqlite3 "$OUT" "SELECT COUNT(*) FROM cards_fts WHERE cards_fts MATCH 'Dark';"
echo -n "Forbidden: "; sqlite3 "$OUT" "SELECT COUNT(*) FROM ygo_details WHERE banlist_tcg='Forbidden';"
VIOL="$(sqlite3 "$OUT" "PRAGMA foreign_key_check;")"
if [ -n "$VIOL" ]; then echo "FK VIOLATIONS:"; echo "$VIOL"; exit 1; fi
echo "FK violations: none"

# 5. collapse WAL so the committed file is a single .db (no -wal/-shm)
sqlite3 "$OUT" "PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;" >/dev/null
rm -f "$OUT-shm" "$OUT-wal"

echo "OK -> $OUT"
echo "Commit it:  git add e2e/fixtures/cards-ygo.test.db e2e/fixtures/build-fixture.sh e2e/fixtures/passcodes.txt"