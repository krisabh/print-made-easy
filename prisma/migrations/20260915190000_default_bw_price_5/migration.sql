-- Phase 5: establish shop B&W single-side default at ₹5.00 per page.
-- Additive data update only. Does not alter PrintJob.totalPrice (historical).
UPDATE `PrintPrice` SET `bwSingle` = 5.00;
