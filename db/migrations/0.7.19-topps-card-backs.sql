-- Migration for v0.7.19: Topps cards get a back picture too.
--
-- topps_cards.image_url (added in 0.7.17) is the front picture; back_image_url
-- is the back. Both hold the URL of a copy stored on our own server.

BEGIN;

ALTER TABLE topps_cards ADD COLUMN IF NOT EXISTS back_image_url TEXT;

COMMIT;
