/** Client-side helpers for selecting a folder of VCF files and zipping them. */

export interface SelectedVcf {
  file: File;
  relativePath: string;
}

const VCF_PATTERN = /\.(vcf)(\.gz)?$/i;

export function isVcfFile(name: string): boolean {
  return VCF_PATTERN.test(name);
}

export function deriveFolderName(files: SelectedVcf[]): string {
  for (const f of files) {
    const segment = f.relativePath.split("/")[0];
    if (segment && segment !== f.file.name) return segment;
  }
  return "VCF Upload";
}

/** Filter a FileList (from <input webkitdirectory>) down to VCF files. */
export function fromFileList(list: FileList | null): SelectedVcf[] {
  if (!list) return [];
  const out: SelectedVcf[] = [];
  for (const file of Array.from(list)) {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    if (isVcfFile(file.name)) {
      out.push({ file, relativePath: rel && rel.length > 0 ? rel : file.name });
    }
  }
  return out;
}

/** Recursively read dropped folder entries into a flat VCF file list. */
export async function fromDataTransfer(dt: DataTransfer): Promise<SelectedVcf[]> {
  const items = Array.from(dt.items)
    .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => e !== null);

  if (items.length === 0) {
    // Fallback: plain files
    return Array.from(dt.files)
      .filter((f) => isVcfFile(f.name))
      .map((file) => ({ file, relativePath: file.name }));
  }

  const out: SelectedVcf[] = [];
  await Promise.all(items.map((entry) => walkEntry(entry, "", out)));
  return out;
}

function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: SelectedVcf[],
): Promise<void> {
  return new Promise((resolve) => {
    if (entry.isFile) {
      (entry as FileSystemFileEntry).file((file) => {
        if (isVcfFile(file.name)) {
          out.push({ file, relativePath: `${prefix}${file.name}` });
        }
        resolve();
      }, () => resolve());
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      const entries: FileSystemEntry[] = [];
      const readBatch = () => {
        reader.readEntries(async (batch) => {
          if (batch.length === 0) {
            await Promise.all(
              entries.map((e) => walkEntry(e, `${prefix}${entry.name}/`, out)),
            );
            resolve();
          } else {
            entries.push(...batch);
            readBatch();
          }
        }, () => resolve());
      };
      readBatch();
    } else {
      resolve();
    }
  });
}

/** Build a flat zip (base filenames) from the selected VCF files. */
export async function buildZip(
  files: SelectedVcf[],
  onProgress?: (percent: number) => void,
): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  const seen = new Map<string, number>();

  for (const { file } of files) {
    let name = file.name;
    // Avoid collisions of identical base names across subfolders.
    if (seen.has(name)) {
      const count = seen.get(name)! + 1;
      seen.set(name, count);
      const dot = name.indexOf(".");
      name = dot > 0 ? `${name.slice(0, dot)}_${count}${name.slice(dot)}` : `${name}_${count}`;
    } else {
      seen.set(name, 0);
    }
    zip.file(name, file);
  }

  return zip.generateAsync(
    { type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } },
    (meta) => onProgress?.(Math.round(meta.percent)),
  );
}
