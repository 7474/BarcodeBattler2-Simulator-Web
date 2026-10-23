ALTER TABLE products ADD COLUMN source TEXT NOT NULL DEFAULT 'openfoodfacts';
ALTER TABLE products ADD COLUMN asin TEXT;
ALTER TABLE products ADD COLUMN thumbnail_url TEXT;
