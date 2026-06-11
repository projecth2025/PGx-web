/**
 * Result Discovery Service
 *
 * Scans S3 for completed genomic reports (*.report.html) and updates
 * the Supabase database as reports become available.  Supports partial
 * completion — each call returns the current state without waiting for
 * all reports.
 *
 * S3 layout produced by the Lambda pipeline:
 *   users/{user_id}/{batch_id}/.../results/*.report.html
 *
 * The "results" folder may be at varying depth.  We locate it by
 * finding the "results" segment and reading the parent folder name.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface DiscoveredReport {
  fileId: string;
  fileName: string;
  reportFile: string;
  reportPath: string;
  reportSize: number;
}

export interface BatchStatusResult {
  totalFiles: number;
  completedFiles: number;
  pendingFiles: number;
  failedFiles: number;
  reports: Array<{
    fileName: string;
    reportFile: string | null;
    status: "completed" | "processing" | "failed";
  }>;
  allCompleted: boolean;
  /** Diagnostic info for debugging */
  diagnostics?: {
    s3ObjectsFound: number;
    reportObjectsFound: number;
    matchedFiles: number;
    unmatchedReports: string[];
    fileBaseNames: string[];
  };
}

/**
 * Strip the VCF extension from a file name.
 *   sample.vcf    → sample
 *   sample.vcf.gz → sample
 */
function stripVcfExtension(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".vcf.gz")) return name.slice(0, -7);
  if (lower.endsWith(".vcf")) return name.slice(0, -4);
  return name;
}

/**
 * Extract the report file name from a full S3 key.
 */
function extractReportFileName(s3Key: string): string {
  const parts = s3Key.split("/");
  return parts[parts.length - 1];
}

/**
 * Extract the VCF base name (parent folder of "results/") from an S3 key.
 * Works at ANY depth:
 *   users/uid/bid/sample/results/x.report.html → sample
 *   users/uid/bid/group/sample/results/x.report.html → sample
 */
function extractVcfBaseName(s3Key: string): string | null {
  const parts = s3Key.split("/");
  const resultsIdx = parts.indexOf("results");
  if (resultsIdx < 1) return null;
  return parts[resultsIdx - 1];
}

/**
 * Discover completed reports for a batch, persist new discoveries,
 * and return the current batch status summary.
 */
export async function discoverAndPersistResults(
  supabaseAdmin: SupabaseClient,
  userId: string,
  batchId: string,
): Promise<BatchStatusResult> {
  // ------------------------------------------------------------------
  // 1. Fetch uploaded_files rows for this batch
  // ------------------------------------------------------------------
  const { data: uploadedFiles, error: filesErr } = await supabaseAdmin
    .from("uploaded_files")
    .select("id, file_name, status")
    .eq("batch_id", batchId);

  if (filesErr) throw new Error(filesErr.message);

  const totalFiles = uploadedFiles?.length ?? 0;

  if (totalFiles === 0) {
    return { totalFiles: 0, completedFiles: 0, pendingFiles: 0, failedFiles: 0, reports: [], allCompleted: true };
  }

  // Build lookup: vcfBaseName (lowercased) → { id, file_name, status }
  const fileMap = new Map<string, { id: string; file_name: string; status: string }>();
  const fileBaseNames: string[] = [];
  for (const f of uploadedFiles ?? []) {
    const base = stripVcfExtension(f.file_name).toLowerCase();
    fileMap.set(base, { id: f.id, file_name: f.file_name, status: f.status });
    fileBaseNames.push(base);
  }

  // ------------------------------------------------------------------
  // 2. Fetch already-discovered results (to avoid reprocessing)
  //    FIX: Use .in() instead of .eq() for array matching
  // ------------------------------------------------------------------
  const fileIds = (uploadedFiles ?? []).map((f: { id: string }) => f.id);
  const { data: existingResults } = await supabaseAdmin
    .from("generated_results")
    .select("file_id, result_storage_path, result_file_name")
    .in("file_id", fileIds);

  const alreadyFound = new Set<string>(
    (existingResults ?? []).map((r: { file_id: string }) => r.file_id),
  );

  // ------------------------------------------------------------------
  // 3. List all S3 objects under users/{userId}/{batchId}/
  // ------------------------------------------------------------------
  const { listObjects } = await import("../lib/s3.server.js");
  const prefix = `users/${userId}/${batchId}/`;
  const objects = await listObjects(prefix);

  console.log(`[discovery] batch=${batchId} S3 prefix="${prefix}" objectsFound=${objects.length}`);

  // Filter: key must contain "/results/" AND end with ".report.html"
  const reportObjects = objects.filter(
    (o) => o.key.includes("/results/") && o.key.endsWith(".report.html"),
  );

  console.log(`[discovery] batch=${batchId} reportObjectsFound=${reportObjects.length}`);
  for (const obj of reportObjects) {
    console.log(`[discovery]   S3 key: ${obj.key}`);
  }

  // ------------------------------------------------------------------
  // 4. Map discovered S3 reports → uploaded_files rows
  //    FIX: Use resultsIndex-1 to get parent folder (works at any depth)
  //    FIX: Add fuzzy fallback matching
  // ------------------------------------------------------------------
  const newDiscoveries: DiscoveredReport[] = [];
  const unmatchedReports: string[] = [];

  for (const obj of reportObjects) {
    const vcfBase = extractVcfBaseName(obj.key);
    console.log(`[discovery]   key="${obj.key}" extractedBase="${vcfBase}"`);

    // Try exact match first
    let match = vcfBase ? fileMap.get(vcfBase.toLowerCase()) : null;

    // Fallback: try substring matching
    // e.g., folder "sample_processed" matches file base "sample"
    if (!match && vcfBase) {
      const lowerBase = vcfBase.toLowerCase();
      for (const [baseName, fileInfo] of fileMap.entries()) {
        if (lowerBase.includes(baseName) || baseName.includes(lowerBase)) {
          match = fileInfo;
          console.log(`[discovery]   fuzzy match: "${vcfBase}" → "${baseName}"`);
          break;
        }
      }
    }

    // Fallback: if report file name contains the VCF base name
    // e.g., "sample.report.html" matches file "sample.vcf"
    if (!match) {
      const reportName = extractReportFileName(obj.key).toLowerCase();
      for (const [baseName, fileInfo] of fileMap.entries()) {
        if (reportName.includes(baseName)) {
          match = fileInfo;
          console.log(`[discovery]   report-name match: "${reportName}" → "${baseName}"`);
          break;
        }
      }
    }

    if (!match) {
      unmatchedReports.push(obj.key);
      console.log(`[discovery]   NO MATCH for key="${obj.key}" (base="${vcfBase}")`);
      continue;
    }

    if (alreadyFound.has(match.id)) continue;

    newDiscoveries.push({
      fileId: match.id,
      fileName: match.file_name,
      reportFile: extractReportFileName(obj.key),
      reportPath: obj.key,
      reportSize: obj.size,
    });
  }

  console.log(`[discovery] batch=${batchId} newDiscoveries=${newDiscoveries.length} unmatched=${unmatchedReports.length}`);

  // ------------------------------------------------------------------
  // 5. Persist each new discovery: generated_results + uploaded_files
  // ------------------------------------------------------------------
  for (const discovery of newDiscoveries) {
    console.log(`[discovery]   persisting: fileId=${discovery.fileId} file=${discovery.fileName} report=${discovery.reportFile} path=${discovery.reportPath}`);

    // Insert into generated_results
    const { error: insertErr } = await supabaseAdmin.from("generated_results").insert({
      file_id: discovery.fileId,
      result_type: "vcf",
      result_storage_path: discovery.reportPath,
      result_file_name: discovery.reportFile,
      result_size_bytes: discovery.reportSize,
      summary: {},
    });

    if (insertErr) {
      console.error(`[discovery]   insert error for ${discovery.fileId}: ${insertErr.message}`);
      continue;
    }

    // Mark uploaded_files row as completed
    await supabaseAdmin
      .from("uploaded_files")
      .update({
        status: "completed",
        processing_step: "done",
        processing_completed_at: new Date().toISOString(),
      })
      .eq("id", discovery.fileId);

    // Log the discovery
    await supabaseAdmin.from("processing_logs").insert({
      batch_id: batchId,
      file_id: discovery.fileId,
      log_level: "info",
      step_name: "result",
      message: `Report discovered: ${discovery.reportFile}`,
      extra_data: { path: discovery.reportPath } as never,
    });

    // Update local tracking
    alreadyFound.add(discovery.fileId);
  }

  // ------------------------------------------------------------------
  // 6. Re-read final state and build response
  // ------------------------------------------------------------------
  const { data: finalFiles } = await supabaseAdmin
    .from("uploaded_files")
    .select("id, file_name, status")
    .eq("batch_id", batchId);

  let completedFiles = 0;
  let failedFiles = 0;

  // Build file_id → report_file_name lookup
  const reportNameMap = new Map<string, string>();
  for (const r of existingResults ?? []) {
    reportNameMap.set(
      (r as { file_id: string }).file_id,
      (r as { result_file_name: string }).result_file_name,
    );
  }
  for (const d of newDiscoveries) {
    reportNameMap.set(d.fileId, d.reportFile);
  }

  const reports = (finalFiles ?? []).map((f: { id: string; file_name: string; status: string }) => {
    if (f.status === "completed") completedFiles++;
    else if (f.status === "failed") failedFiles++;

    return {
      fileName: f.file_name,
      reportFile: reportNameMap.get(f.id) ?? null,
      status: f.status as "completed" | "processing" | "failed",
    };
  });

  const pendingFiles = totalFiles - completedFiles - failedFiles;
  const allCompleted = completedFiles + failedFiles === totalFiles;

  // ------------------------------------------------------------------
  // 7. Update batch-level progress
  // ------------------------------------------------------------------
  const batchUpdate: Record<string, unknown> = {
    processed_files: completedFiles,
    failed_files: failedFiles,
  };

  if (allCompleted) {
    const status =
      failedFiles === 0
        ? "completed"
        : completedFiles === 0
          ? "failed"
          : "partial";
    batchUpdate.status = status;
    batchUpdate.processing_completed_at = new Date().toISOString();
  }

  await supabaseAdmin
    .from("upload_batches")
    .update(batchUpdate)
    .eq("id", batchId);

  return {
    totalFiles,
    completedFiles,
    pendingFiles,
    failedFiles,
    reports,
    allCompleted,
    diagnostics: {
      s3ObjectsFound: objects.length,
      reportObjectsFound: reportObjects.length,
      matchedFiles: newDiscoveries.length,
      unmatchedReports: unmatchedReports,
      fileBaseNames,
    },
  };
}
