-- Apply only after deploying the updated backend that writes via service_role.
BEGIN;
REVOKE ALL ON public.studio_jobs FROM anon, authenticated;
GRANT SELECT ON public.studio_jobs TO authenticated;
GRANT ALL ON public.studio_jobs TO service_role;
ALTER TABLE public.studio_jobs ENABLE ROW LEVEL SECURITY;
COMMIT;
-- Verify authenticated cannot insert, update, delete or truncate.
SELECT has_table_privilege('authenticated','public.studio_jobs','INSERT') AS can_insert,
       has_table_privilege('authenticated','public.studio_jobs','UPDATE') AS can_update,
       has_table_privilege('authenticated','public.studio_jobs','DELETE') AS can_delete,
       has_table_privilege('authenticated','public.studio_jobs','TRUNCATE') AS can_truncate;
