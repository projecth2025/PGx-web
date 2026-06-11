/** Application-level shared types built on top of generated DB types. */

export type BatchStatus =
  | "pending"
  | "processing"
  | "completed"
  | "partial"
  | "failed";

export type FileStatus = "pending" | "processing" | "completed" | "failed";

export interface UploadBatch {
  id: string;
  user_id: string;
  folder_name: string;
  original_zip_name: string | null;
  zip_storage_path: string | null;
  total_files: number;
  processed_files: number;
  failed_files: number;
  status: BatchStatus;
  upload_size_bytes: number;
  assembly: string | null;
  processing_started_at: string | null;
  processing_completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UploadedFile {
  id: string;
  batch_id: string;
  file_name: string;
  file_extension: string | null;
  file_size_bytes: number;
  s3_input_path: string | null;
  checksum: string | null;
  status: FileStatus;
  processing_step: string | null;
  processing_started_at: string | null;
  processing_completed_at: string | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface GeneratedResult {
  id: string;
  file_id: string;
  result_type: string;
  result_storage_path: string;
  result_file_name: string;
  result_size_bytes: number | null;
  summary: Record<string, unknown>;
  generated_at: string;
  created_at: string;
}

export interface ProfileRow {
  id: string;
  full_name: string | null;
  organization_name: string | null;
  role: string;
  created_at: string;
  updated_at: string;
}

export interface ProcessResponse {
  batchId: string;
  status: BatchStatus;
  total: number;
  processed: number;
  failed: number;
}
