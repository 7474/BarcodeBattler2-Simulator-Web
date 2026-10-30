-- The product's page on the platform that supplied it (Yahoo!ショッピング,
-- 楽天市場, Open Food Facts...), possibly with an affiliate ID; thumbnails link here.
ALTER TABLE products ADD COLUMN item_url TEXT;
