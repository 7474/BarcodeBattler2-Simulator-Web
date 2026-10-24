-- Room regulations (https://github.com/7474/BarcodeBattler2-Simulator-Web/issues/16).
-- second_card: 'none' = one character card only, 'both' = an optional second
-- card (item or fusion partner) under the same prefix rule.
ALTER TABLE rooms ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN second_card TEXT NOT NULL DEFAULT 'none' CHECK (second_card IN ('none', 'both'));
ALTER TABLE rooms ADD COLUMN allow_heal INTEGER NOT NULL DEFAULT 1 CHECK (allow_heal IN (0, 1));
ALTER TABLE rooms ADD COLUMN require_known_product INTEGER NOT NULL DEFAULT 0 CHECK (require_known_product IN (0, 1));
ALTER TABLE rooms ADD COLUMN champion_second_barcode TEXT;
ALTER TABLE battles ADD COLUMN challenger_second_barcode TEXT;
ALTER TABLE battles ADD COLUMN defender_second_barcode TEXT;

-- 規定: the existing single-card, any-prefix room keeps its champion.
UPDATE rooms SET name = '規定（キャラカード1枚・無差別）',
  description = 'One character card with any valid EAN-8 or EAN-13 barcode. No second card.',
  sort_order = 1, second_card = 'none', allow_heal = 1
  WHERE id = 'unlimited';

-- 49戦: 1992 official tournament rules as researched in issue #16. Both cards
-- must begin with 49; herbs, POWER and healing magic were banned. The
-- product-name check stays off because the product database misses most
-- Japanese products.
UPDATE rooms SET name = '49戦（公式大会準拠）',
  description = 'Official tournament rules: barcodes beginning with 49 (second card too), optional item or fusion card, no herbs, POWER or healing magic.',
  sort_order = 2, second_card = 'both', allow_heal = 0
  WHERE id = 'japan49';

INSERT INTO rooms (id, name, description, barcode_prefix, sort_order, second_card, allow_heal) VALUES
  ('open', '完全無差別', 'Any valid barcode, optional item or fusion card, recovery allowed.', NULL, 3, 'both', 1);
