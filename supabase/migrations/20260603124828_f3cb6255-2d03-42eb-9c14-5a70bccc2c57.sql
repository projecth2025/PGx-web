-- Timestamp helper
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- =========================================================
-- profiles
-- =========================================================
CREATE TABLE public.profiles (
  id UUID NOT NULL PRIMARY KEY,
  full_name TEXT,
  organization_name TEXT,
  role TEXT NOT NULL DEFAULT 'lab_staff',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Users can insert their own profile"
  ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE TO authenticated
  USING (auth.uid() = id);

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, organization_name)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'organization_name'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================
-- upload_batches
-- =========================================================
CREATE TABLE public.upload_batches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  folder_name TEXT NOT NULL,
  original_zip_name TEXT,
  zip_storage_path TEXT,
  total_files INTEGER NOT NULL DEFAULT 0,
  processed_files INTEGER NOT NULL DEFAULT 0,
  failed_files INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending',
  upload_size_bytes BIGINT NOT NULL DEFAULT 0,
  processing_started_at TIMESTAMPTZ,
  processing_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.upload_batches TO authenticated;
GRANT ALL ON public.upload_batches TO service_role;

ALTER TABLE public.upload_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own batches"
  ON public.upload_batches FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own batches"
  ON public.upload_batches FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own batches"
  ON public.upload_batches FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own batches"
  ON public.upload_batches FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_upload_batches_user_id ON public.upload_batches(user_id);
CREATE INDEX idx_upload_batches_created_at ON public.upload_batches(created_at DESC);

CREATE TRIGGER update_upload_batches_updated_at
  BEFORE UPDATE ON public.upload_batches
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- uploaded_files
-- =========================================================
CREATE TABLE public.uploaded_files (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES public.upload_batches(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_extension TEXT,
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  s3_input_path TEXT,
  checksum TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  processing_step TEXT,
  processing_started_at TIMESTAMPTZ,
  processing_completed_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.uploaded_files TO authenticated;
GRANT ALL ON public.uploaded_files TO service_role;

ALTER TABLE public.uploaded_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view files in their batches"
  ON public.uploaded_files FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.upload_batches b WHERE b.id = batch_id AND b.user_id = auth.uid()));

CREATE POLICY "Users can insert files in their batches"
  ON public.uploaded_files FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.upload_batches b WHERE b.id = batch_id AND b.user_id = auth.uid()));

CREATE POLICY "Users can update files in their batches"
  ON public.uploaded_files FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.upload_batches b WHERE b.id = batch_id AND b.user_id = auth.uid()));

CREATE POLICY "Users can delete files in their batches"
  ON public.uploaded_files FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.upload_batches b WHERE b.id = batch_id AND b.user_id = auth.uid()));

CREATE INDEX idx_uploaded_files_batch_id ON public.uploaded_files(batch_id);

CREATE TRIGGER update_uploaded_files_updated_at
  BEFORE UPDATE ON public.uploaded_files
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- generated_results
-- =========================================================
CREATE TABLE public.generated_results (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  file_id UUID NOT NULL REFERENCES public.uploaded_files(id) ON DELETE CASCADE,
  result_type TEXT NOT NULL DEFAULT 'vcf',
  result_storage_path TEXT NOT NULL,
  result_file_name TEXT NOT NULL,
  result_size_bytes BIGINT,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.generated_results TO authenticated;
GRANT ALL ON public.generated_results TO service_role;

ALTER TABLE public.generated_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view results for their files"
  ON public.generated_results FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.uploaded_files f
    JOIN public.upload_batches b ON b.id = f.batch_id
    WHERE f.id = file_id AND b.user_id = auth.uid()
  ));

CREATE POLICY "Users can insert results for their files"
  ON public.generated_results FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.uploaded_files f
    JOIN public.upload_batches b ON b.id = f.batch_id
    WHERE f.id = file_id AND b.user_id = auth.uid()
  ));

CREATE INDEX idx_generated_results_file_id ON public.generated_results(file_id);

-- =========================================================
-- processing_logs
-- =========================================================
CREATE TABLE public.processing_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_id UUID REFERENCES public.upload_batches(id) ON DELETE CASCADE,
  file_id UUID REFERENCES public.uploaded_files(id) ON DELETE CASCADE,
  log_level TEXT NOT NULL DEFAULT 'info',
  step_name TEXT,
  message TEXT NOT NULL,
  extra_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.processing_logs TO authenticated;
GRANT ALL ON public.processing_logs TO service_role;

ALTER TABLE public.processing_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view logs for their batches"
  ON public.processing_logs FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.upload_batches b WHERE b.id = batch_id AND b.user_id = auth.uid()));

CREATE INDEX idx_processing_logs_batch_id ON public.processing_logs(batch_id);
CREATE INDEX idx_processing_logs_file_id ON public.processing_logs(file_id);