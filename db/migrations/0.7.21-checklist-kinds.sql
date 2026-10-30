-- Migration for v0.7.21: hand-built checklists get a kind, so the same
-- checklist engine can back more than one tab. Every existing checklist is a
-- Topps one; Burger King cards get their own tab.

BEGIN;

ALTER TABLE topps_sets ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'topps';

COMMIT;
