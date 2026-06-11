-- Add assembly column to upload_batches to track genome assembly version
ALTER TABLE public.upload_batches
ADD COLUMN IF NOT EXISTS assembly TEXT CHECK (assembly IN ('hg19', 'hg38'));

COMMENT ON COLUMN public.upload_batches.assembly IS 'Genome assembly version (hg19 or hg38) selected for this batch';
