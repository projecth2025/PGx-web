import JSZip from "jszip";

export interface ZipValidationResult {
  fileNames: string[];
}

export async function validateZip(buffer: ArrayBuffer): Promise<ZipValidationResult> {
  const zip = await JSZip.loadAsync(buffer);
  const files: string[] = [];
  const invalid: string[] = [];

  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    const name = relativePath;
    files.push(name);
    const lower = name.toLowerCase();
    if (!(lower.endsWith(".vcf") || lower.endsWith(".vcf.gz"))) {
      invalid.push(name);
    }
  });

  if (invalid.length > 0) {
    const err = new Error(`Invalid files in ZIP: ${invalid.join(", ")}`);
    (err as any).offending = invalid;
    throw err;
  }

  if (files.length === 0) {
    throw new Error("ZIP archive contains no files");
  }

  return { fileNames: files };
}
