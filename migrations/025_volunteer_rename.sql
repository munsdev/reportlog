-- `involvement` becomes `volunteer` everywhere.
--
-- The public name has been Volunteer throughout — the page is
-- /volunteer/apply.html and the API is mounted at /api/volunteer. Only the
-- inside of the software still said `involvement`: three tables, their
-- indexes and check constraints, two modules and a pane id. The notes have
-- carried "the public name is Volunteer; the internal one is involvement"
-- as a thing to know before grepping, which is a reasonable warning and a
-- poor substitute for the two names being one name.
--
-- Nothing here touches `reports`. No fingerprint changes, nothing
-- re-verifies. These tables hold a pending application and the catalogue of
-- things somebody can volunteer for; none of it is in the chain.
--
-- WHY NOW. Renaming a table costs a migration today and costs a migration
-- plus a coordination problem once anybody else runs this software. There
-- is one deployment and the only reports anywhere are test reports.
--
-- ALTER TABLE ... RENAME does not rename the indexes and constraints that
-- came with the table, so those are renamed explicitly. Left alone they
-- would keep the old word alive in exactly the place somebody debugging a
-- constraint violation reads it.

BEGIN;

ALTER TABLE involvement_requests RENAME TO volunteer_requests;
ALTER TABLE involvement_groups   RENAME TO volunteer_groups;
ALTER TABLE involvement_kinds    RENAME TO volunteer_kinds;

-- Plain indexes.
ALTER INDEX involvement_requests_expires_idx RENAME TO volunteer_requests_expires_idx;
ALTER INDEX involvement_kinds_group_idx      RENAME TO volunteer_kinds_group_idx;

-- Constraints, INCLUDING THE PRIMARY KEYS AND THE FOREIGN KEY. The first
-- draft of this migration renamed the checks and forgot these four, which
-- would have left `involvement_kinds_pkey` and
-- `involvement_kinds_group_id_fkey` named after a word the software no
-- longer uses — read off the live database rather than assumed, which is
-- how they were caught. Renaming a pkey constraint renames its index with
-- it, so those need no separate ALTER INDEX.
ALTER TABLE volunteer_requests RENAME CONSTRAINT involvement_requests_pkey TO volunteer_requests_pkey;
ALTER TABLE volunteer_groups   RENAME CONSTRAINT involvement_groups_pkey   TO volunteer_groups_pkey;
ALTER TABLE volunteer_kinds    RENAME CONSTRAINT involvement_kinds_pkey    TO volunteer_kinds_pkey;

ALTER TABLE volunteer_groups RENAME CONSTRAINT involvement_groups_id_check    TO volunteer_groups_id_check;
ALTER TABLE volunteer_groups RENAME CONSTRAINT involvement_groups_label_check TO volunteer_groups_label_check;
ALTER TABLE volunteer_kinds  RENAME CONSTRAINT involvement_kinds_id_check     TO volunteer_kinds_id_check;
ALTER TABLE volunteer_kinds  RENAME CONSTRAINT involvement_kinds_label_check  TO volunteer_kinds_label_check;
ALTER TABLE volunteer_kinds  RENAME CONSTRAINT involvement_kinds_group_id_fkey TO volunteer_kinds_group_id_fkey;

COMMIT;
