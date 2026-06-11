import { supabase } from "@/integrations/supabase/client";
import type { ProcessResponse } from "@/types/app";

interface ProcessBatchArgs {
  zip: Blob;
  folderName: string;
  zipName: string;
  files: { name: string; size: number }[];
  forceAssembly: string;
  onUploadProgress?: (percent: number) => void;
}

/**
 * Uploads the zipped folder to the server, which archives it to S3,
 * forwards it to the processing API, and persists the results.
 * Uses XHR so we can report real upload progress.
 */
export async function processBatch(args: ProcessBatchArgs): Promise<ProcessResponse> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Your session has expired. Please sign in again.");

  // Internal backend route - the browser must not call the external processing API directly
  const uploadUrl = "/api/process-batch";

  const fd = new FormData();
  fd.append("file", args.zip, args.zipName);
  fd.append("folder_name", args.folderName);
  fd.append("original_zip_name", args.zipName);
  fd.append("files_meta", JSON.stringify(args.files));
  fd.append("force_assembly", args.forceAssembly);

  return new Promise<ProcessResponse>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        args.onUploadProgress?.(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(body as ProcessResponse);
        else reject(new Error(body?.error ?? `Request failed (${xhr.status})`));
      } catch {
        reject(new Error("Unexpected response from the server."));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(fd);
  });
}
