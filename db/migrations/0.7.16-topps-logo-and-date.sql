-- Migration for v0.7.16: logo and release date for Topps checklists.
-- Adds two nullable columns; nothing existing is changed.

ALTER TABLE topps_sets ADD COLUMN logo_url TEXT;
ALTER TABLE topps_sets ADD COLUMN release_date DATE;
