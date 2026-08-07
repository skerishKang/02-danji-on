-- DEVELOPMENT ONLY. Never run against production.
-- Fake contact values exist only to verify the verified-resident contact boundary.

insert into business_contacts (business_id, contact_type, contact_value, visibility, sort_order)
values
('00000000-0000-4000-8100-000000000001','phone','010-0000-1001','verified_residents',10),
('00000000-0000-4000-8100-000000000003','phone','010-0000-1003','verified_residents',10),
('00000000-0000-4000-8100-000000000006','phone','010-0000-1006','verified_residents',10),
('00000000-0000-4000-8100-000000000010','phone','062-000-1010','verified_residents',10)
on conflict do nothing;
