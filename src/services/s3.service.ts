import * as s3lib from "@/lib/s3.server";

export async function uploadToS3(key: string, body: ArrayBuffer | Uint8Array) {
  return s3lib.uploadToS3(key, body as ArrayBuffer);
}

export async function headObjectSize(key: string): Promise<number | null> {
  return s3lib.headObjectSize(key);
}

export async function objectExists(key: string): Promise<boolean> {
  const size = await headObjectSize(key);
  return size !== null;
}

export function resultPathFor(userId: string, batchId: string, fileName: string) {
  // derive folder name by stripping .vcf or .vcf.gz
  const lower = fileName.toLowerCase();
  let base = fileName;
  if (lower.endsWith(".vcf.gz")) base = fileName.slice(0, -7);
  else if (lower.endsWith(".vcf")) base = fileName.slice(0, -4);
  return `users/${userId}/${batchId}/${base}/results/report.html`;
}
