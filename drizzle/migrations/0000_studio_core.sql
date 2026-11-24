CREATE TABLE public.studio_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  name text NOT NULL DEFAULT 'Projeto sem nome' CHECK (char_length(name) BETWEEN 1 AND 120),
  room text NOT NULL DEFAULT 'bed',
  style text NOT NULL DEFAULT 'modern',
  stage_prompt text,
  video_prompt text,
  first_path text,
  last_path text,
  video_path text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.studio_projects TO authenticated;
GRANT ALL ON public.studio_projects TO service_role;
ALTER TABLE public.studio_projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own projects select" ON public.studio_projects FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own projects insert" ON public.studio_projects FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own projects update" ON public.studio_projects FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own projects delete" ON public.studio_projects FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE INDEX studio_projects_user_idx ON public.studio_projects(user_id, updated_at DESC);

CREATE TABLE public.studio_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  project_id uuid REFERENCES public.studio_projects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('stage','video')),
  provider text NOT NULL CHECK (provider IN ('gemini','virtual','veo','kling')),
  model text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','error','timeout')),
  provider_task_id text,
  idempotency_key text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_path text,
  error text,
  polls integer NOT NULL DEFAULT 0,
  deadline_at timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.studio_jobs TO authenticated;
GRANT ALL ON public.studio_jobs TO service_role;
ALTER TABLE public.studio_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own jobs select" ON public.studio_jobs FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "own jobs insert" ON public.studio_jobs FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own jobs update" ON public.studio_jobs FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own jobs delete" ON public.studio_jobs FOR DELETE TO authenticated USING (auth.uid() = user_id);
CREATE UNIQUE INDEX studio_jobs_one_active ON public.studio_jobs(user_id, kind) WHERE status IN ('queued','running');
CREATE INDEX studio_jobs_user_idx ON public.studio_jobs(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.studio_touch() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER studio_projects_touch BEFORE UPDATE ON public.studio_projects FOR EACH ROW EXECUTE FUNCTION public.studio_touch();
CREATE TRIGGER studio_jobs_touch BEFORE UPDATE ON public.studio_jobs FOR EACH ROW EXECUTE FUNCTION public.studio_touch();

CREATE POLICY "studio media own select" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'studio-media' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "studio media own insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'studio-media' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "studio media own update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'studio-media' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "studio media own delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'studio-media' AND (storage.foldername(name))[1] = auth.uid()::text);