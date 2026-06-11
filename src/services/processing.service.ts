export async function callProcessingApi(apiUrl: string, zipBuffer: ArrayBuffer, userId: string, batchId: string, originalZipName?: string) {
  const form = new FormData();
  form.append("user_id", userId);
  form.append("batch_id", batchId);
  form.append(
    "file",
    new Blob([zipBuffer], { type: "application/zip" }),
    originalZipName ?? "upload.zip",
  );

  const res = await fetch(apiUrl, {
    method: "POST",
    body: form,
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Processing API error ${res.status}: ${text}`);
  }

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text };
  }
}
