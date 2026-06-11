-- ============================================================================
-- GenoSight Application Database Schema
-- ============================================================================
-- This migration creates the core schema for the genomic report processing app.
-- All tables include RLS (Row Level Security) policies for user data isolation.

-- ============================================================================
-- TABLE: profiles
-- Purpose: User profile information, linked to auth.users
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT,
  organization_name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Enable RLS on profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can read their own profile
CREATE POLICY "Users can read their own profile"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

-- RLS Policy: Users can update their own profile
CREATE POLICY "Users can update their own profile"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- RLS Policy: Users can insert their own profile
CREATE POLICY "Users can insert their own profile"
  ON public.profiles
  FOR INSERT
  WITH CHECK (auth.uid() = id);

-- ============================================================================
-- TABLE: upload_batches
-- Purpose: Represents a single upload session with multiple VCF files
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.upload_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_name TEXT NOT NULL,
  original_zip_name TEXT,
  zip_storage_path TEXT,
  total_files INTEGER NOT NULL DEFAULT 0,
  processed_files INTEGER NOT NULL DEFAULT 0,
  failed_files INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'partial', 'failed')),
  upload_size_bytes BIGINT NOT NULL DEFAULT 0,
  processing_started_at TIMESTAMP WITH TIME ZONE,
  processing_completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_upload_batches_user_id ON public.upload_batches(user_id);
CREATE INDEX IF NOT EXISTS idx_upload_batches_status ON public.upload_batches(status);
CREATE INDEX IF NOT EXISTS idx_upload_batches_created_at ON public.upload_batches(created_at DESC);

-- Enable RLS on upload_batches
ALTER TABLE public.upload_batches ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can read their own batches
CREATE POLICY "Users can read their own batches"
  ON public.upload_batches
  FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Users can update their own batches
CREATE POLICY "Users can update their own batches"
  ON public.upload_batches
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- RLS Policy: Users can insert their own batches
CREATE POLICY "Users can insert their own batches"
  ON public.upload_batches
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ============================================================================
-- TABLE: uploaded_files
-- Purpose: Individual VCF files within a batch
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.uploaded_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.upload_batches(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_extension TEXT,
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  s3_input_path TEXT,
  checksum TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  processing_step TEXT,
  processing_started_at TIMESTAMP WITH TIME ZONE,
  processing_completed_at TIMESTAMP WITH TIME ZONE,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_uploaded_files_batch_id ON public.uploaded_files(batch_id);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_status ON public.uploaded_files(status);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_created_at ON public.uploaded_files(created_at DESC);

-- Enable RLS on uploaded_files
ALTER TABLE public.uploaded_files ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can read files from their own batches
CREATE POLICY "Users can read files from their own batches"
  ON public.uploaded_files
  FOR SELECT
  USING (
    batch_id IN (
      SELECT id FROM public.upload_batches WHERE user_id = auth.uid()
    )
  );

-- RLS Policy: Users can update files from their own batches
CREATE POLICY "Users can update files from their own batches"
  ON public.uploaded_files
  FOR UPDATE
  USING (
    batch_id IN (
      SELECT id FROM public.upload_batches WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    batch_id IN (
      SELECT id FROM public.upload_batches WHERE user_id = auth.uid()
    )
  );

-- RLS Policy: Users can insert files to their own batches
CREATE POLICY "Users can insert files to their own batches"
  ON public.uploaded_files
  FOR INSERT
  WITH CHECK (
    batch_id IN (
      SELECT id FROM public.upload_batches WHERE user_id = auth.uid()
    )
  );

-- ============================================================================
-- TABLE: generated_results
-- Purpose: Output/report files generated from VCF processing
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.generated_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id UUID NOT NULL REFERENCES public.uploaded_files(id) ON DELETE CASCADE,
  result_type TEXT NOT NULL DEFAULT 'vcf',
  result_storage_path TEXT NOT NULL,
  result_file_name TEXT NOT NULL,
  result_size_bytes BIGINT,
  summary JSONB DEFAULT '{}',
  generated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_generated_results_file_id ON public.generated_results(file_id);
CREATE INDEX IF NOT EXISTS idx_generated_results_created_at ON public.generated_results(created_at DESC);

-- Enable RLS on generated_results
ALTER TABLE public.generated_results ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can read results from their own files
CREATE POLICY "Users can read results from their own files"
  ON public.generated_results
  FOR SELECT
  USING (
    file_id IN (
      SELECT id FROM public.uploaded_files uf
      JOIN public.upload_batches ub ON uf.batch_id = ub.id
      WHERE ub.user_id = auth.uid()
    )
  );

-- ============================================================================
-- TABLE: processing_logs
-- Purpose: Audit trail for batch and file processing
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.processing_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID REFERENCES public.upload_batches(id) ON DELETE CASCADE,
  file_id UUID REFERENCES public.uploaded_files(id) ON DELETE CASCADE,
  log_level TEXT NOT NULL DEFAULT 'info' CHECK (log_level IN ('debug', 'info', 'warn', 'error')),
  step_name TEXT,
  message TEXT NOT NULL,
  extra_data JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_processing_logs_batch_id ON public.processing_logs(batch_id);
CREATE INDEX IF NOT EXISTS idx_processing_logs_file_id ON public.processing_logs(file_id);
CREATE INDEX IF NOT EXISTS idx_processing_logs_created_at ON public.processing_logs(created_at DESC);

-- Enable RLS on processing_logs
ALTER TABLE public.processing_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can read logs from their own batches
CREATE POLICY "Users can read logs from their own batches"
  ON public.processing_logs
  FOR SELECT
  USING (
    batch_id IN (
      SELECT id FROM public.upload_batches WHERE user_id = auth.uid()
    )
  );

-- ============================================================================
-- FUNCTION: auto_create_profile
-- Purpose: Automatically create a profile row when a new user signs up
-- ============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, organization_name, role)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'organization_name',
    'user'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to call the function
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================================
-- FUNCTION: update_updated_at_column
-- Purpose: Automatically update the updated_at timestamp
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS update_profiles_updated_at ON public.profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_upload_batches_updated_at ON public.upload_batches;
CREATE TRIGGER update_upload_batches_updated_at
  BEFORE UPDATE ON public.upload_batches
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_uploaded_files_updated_at ON public.uploaded_files;
CREATE TRIGGER update_uploaded_files_updated_at
  BEFORE UPDATE ON public.uploaded_files
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================
-- Allow authenticated users to perform operations through RLS
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON public.profiles TO authenticated;
GRANT ALL ON public.upload_batches TO authenticated;
GRANT ALL ON public.uploaded_files TO authenticated;
GRANT ALL ON public.generated_results TO authenticated;
GRANT ALL ON public.processing_logs TO authenticated;

-- Allow anon (for public endpoints)
GRANT USAGE ON SCHEMA public TO anon;

-- Allow service role (admin operations - bypasses RLS)
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
