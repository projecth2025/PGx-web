import { useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  UploadCloud,
  FileArchive,
  FileText,
  X,
  CheckCircle2,
  Loader2,
  Cog,
  AlertTriangle,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import { processBatch } from "@/services/upload";

export const Route = createFileRoute("/_authenticated/upload")({
  component: UploadPage,
});

type Phase = "idle" | "validating" | "uploading" | "processing" | "done" | "error";

interface VcfFileInfo {
  name: string;
  size: number;
}

function UploadPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);

  const [zipFile, setZipFile] = useState<File | null>(null);
  const [vcfFiles, setVcfFiles] = useState<VcfFileInfo[]>([]);
  const [invalidFiles, setInvalidFiles] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const [assembly, setAssembly] = useState<string>("");

  const busy = phase === "validating" || phase === "uploading" || phase === "processing";

  const reset = () => {
    setZipFile(null);
    setVcfFiles([]);
    setInvalidFiles([]);
    setPhase("idle");
    setUploadProgress(0);
    setErrorMsg("");
    setAssembly("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const validateAndSetZip = async (file: File) => {
    // Must be a ZIP file
    const isZip =
      file.type === "application/zip" ||
      file.type === "application/x-zip-compressed" ||
      file.name.toLowerCase().endsWith(".zip");

    if (!isZip) {
      toast.error("Only ZIP files are accepted. Please upload a .zip file.");
      setErrorMsg("Only ZIP files (.zip) are accepted. Please compress your folder and upload the resulting ZIP file.");
      setPhase("error");
      return;
    }

    setPhase("validating");
    setErrorMsg("");
    setInvalidFiles([]);

    try {
      const { default: JSZip } = await import("jszip");
      const buffer = await file.arrayBuffer();
      const zip = await JSZip.loadAsync(buffer);

      const vcfList: VcfFileInfo[] = [];
      const invalid: string[] = [];

      zip.forEach((relativePath, entry) => {
        if (entry.dir) return;
        // Use just the basename for display
        const name = relativePath.includes("/")
          ? relativePath.slice(relativePath.lastIndexOf("/") + 1)
          : relativePath;
        const lower = name.toLowerCase();
        if (lower.endsWith(".vcf") || lower.endsWith(".vcf.gz")) {
          vcfList.push({ name, size: 0 }); // JSZip doesn't provide uncompressed size easily
        } else {
          invalid.push(name);
        }
      });

      if (invalid.length > 0) {
        setInvalidFiles(invalid);
        setPhase("error");
        setErrorMsg(
          `The ZIP file contains ${invalid.length} invalid file(s): ${invalid.slice(0, 10).join(", ")}${invalid.length > 10 ? "…" : ""}. Only .vcf and .vcf.gz files are allowed.`,
        );
        toast.error("ZIP contains invalid files. Only .vcf and .vcf.gz are allowed.");
        return;
      }

      if (vcfList.length === 0) {
        setPhase("error");
        setErrorMsg("The ZIP file contains no VCF files (.vcf or .vcf.gz).");
        toast.error("No VCF files found in the ZIP.");
        return;
      }

      setZipFile(file);
      setVcfFiles(vcfList);
      setPhase("idle");
    } catch (e) {
      setPhase("error");
      setErrorMsg(`Failed to read ZIP file: ${(e as Error).message}`);
      toast.error("Failed to read ZIP file.");
    }
  };

  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) validateAndSetZip(file);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (busy) return;
    const file = e.dataTransfer.files?.[0];
    if (file) validateAndSetZip(file);
  };

  const handleProcess = async () => {
    if (!zipFile) return;
    if (!assembly) {
      toast.error("Please select a genome assembly.");
      setErrorMsg("Please select a genome assembly before processing.");
      setPhase("error");
      return;
    }
    try {
      setErrorMsg("");
      setPhase("uploading");
      setUploadProgress(0);

      const folderName = zipFile.name.replace(/\.zip$/i, "");
      const meta = vcfFiles.map((f) => ({ name: f.name, size: f.size }));

      const result = await processBatch({
        zip: zipFile,
        folderName,
        zipName: zipFile.name,
        files: meta,
        forceAssembly: assembly,
        onUploadProgress: (pct) => {
          setUploadProgress(pct);
          if (pct >= 100) setPhase("processing");
        },
      });

      setPhase("done");
      await queryClient.invalidateQueries({ queryKey: ["batches"] });
      toast.success(
        `Processing started — ${result.total} file(s) submitted.`,
      );
      navigate({ to: "/history/$batchId", params: { batchId: result.batchId } });
    } catch (e) {
      setPhase("error");
      setErrorMsg((e as Error).message);
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title="Upload Files"
        description="Upload a ZIP archive containing genomic VCF files for processing into clinical reports."
      />

      {/* ZIP file input */}
      <input
        ref={inputRef}
        type="file"
        accept=".zip,application/zip,application/x-zip-compressed"
        className="hidden"
        onChange={onInputChange}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div
            role="button"
            tabIndex={0}
            onClick={() => {
              if (!busy) inputRef.current?.click();
            }}
            onKeyDown={(e) => {
              if (!busy && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault();
                inputRef.current?.click();
              }
            }}
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "flex cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed bg-card px-6 py-16 text-center transition-colors",
              dragging ? "border-primary bg-primary/5" : "border-border",
              busy && "pointer-events-none opacity-60",
            )}
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-sm bg-primary/10 text-primary">
              <UploadCloud className="h-7 w-7" />
            </div>
            <h3 className="mt-4 text-lg font-semibold text-foreground">
              Drag and drop a ZIP file here or click to browse
            </h3>
            <p className="mt-1 max-w-md text-sm text-muted-foreground">
              Upload a <span className="font-medium text-foreground">.zip</span> archive
              containing only <span className="font-medium text-foreground">.vcf</span> or{" "}
              <span className="font-medium text-foreground">.vcf.gz</span> genomic files.
              Folders must be compressed into a ZIP before uploading.
            </p>
            <Button
              variant="outline"
              className="mt-6"
              onClick={(e) => {
                e.stopPropagation();
                inputRef.current?.click();
              }}
              disabled={busy}
            >
              <FileArchive className="mr-1.5 h-4 w-4" />
              Select ZIP File
            </Button>
          </div>

          {/* ZIP contents list */}
          {zipFile && vcfFiles.length > 0 ? (
            <div className="mt-6 rounded-md border border-border bg-card">
              <div className="flex items-center justify-between border-b border-border px-5 py-3">
                <div className="flex items-center gap-2">
                  <FileArchive className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">{zipFile.name}</span>
                  <span className="text-xs text-muted-foreground">
                    · {vcfFiles.length} VCF file(s) · {formatBytes(zipFile.size)}
                  </span>
                </div>
                {!busy ? (
                  <Button variant="ghost" size="sm" onClick={reset}>
                    <X className="mr-1 h-4 w-4" />
                    Clear
                  </Button>
                ) : null}
              </div>
              <ul className="max-h-72 divide-y divide-border overflow-y-auto">
                {vcfFiles.map((f, i) => (
                  <li key={i} className="flex items-center justify-between px-5 py-2.5 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate font-mono text-xs text-foreground">
                        {f.name}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* Invalid files warning */}
          {invalidFiles.length > 0 ? (
            <div className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-4">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div>
                  <p className="text-sm font-medium text-destructive">
                    Invalid files detected in ZIP
                  </p>
                  <p className="mt-1 text-xs text-destructive/80">
                    The following files are not allowed: {invalidFiles.slice(0, 5).join(", ")}
                    {invalidFiles.length > 5 ? ` and ${invalidFiles.length - 5} more` : ""}.
                    Only .vcf and .vcf.gz files are accepted.
                  </p>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {/* Action panel */}
        <div className="space-y-4">
          <div className="rounded-md border border-border bg-card p-5">
            <h3 className="text-sm font-semibold text-foreground">Batch Summary</h3>
            <dl className="mt-4 space-y-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">ZIP file</dt>
                <dd className="max-w-[60%] truncate font-medium text-foreground">
                  {zipFile?.name ?? "\u2014"}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">VCF files detected</dt>
                <dd className="font-medium tabular-nums text-foreground">{vcfFiles.length}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">ZIP size</dt>
                <dd className="font-medium tabular-nums text-foreground">
                  {zipFile ? formatBytes(zipFile.size) : "\u2014"}
                </dd>
              </div>
            </dl>
          
            {/* Genome Assembly selection */}
            <div className="mt-5 space-y-1.5">
              <Label htmlFor="assembly">Genome Assembly</Label>
              <Select value={assembly} onValueChange={setAssembly} disabled={busy}>
                <SelectTrigger id="assembly">
                  <SelectValue placeholder="Select assembly" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hg19">hg19</SelectItem>
                  <SelectItem value="hg38">hg38</SelectItem>
                </SelectContent>
              </Select>
            </div>
          
            <Button
              className="mt-5 w-full"
              disabled={!zipFile || busy}
              onClick={handleProcess}
            >
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {phase === "validating"
                ? "Validating…"
                : phase === "uploading"
                  ? "Uploading…"
                  : phase === "processing"
                    ? "Processing…"
                    : "Process Files"}
            </Button>
          </div>

          {/* Progress stages */}
          {busy || phase === "done" ? (
            <div className="rounded-md border border-border bg-card p-5">
              <h3 className="text-sm font-semibold text-foreground">Progress</h3>
              <div className="mt-4 space-y-4">
                <StageRow
                  label="Uploading ZIP to server"
                  active={phase === "uploading"}
                  done={["processing", "done"].includes(phase)}
                  progress={uploadProgress}
                />
                <StageRow
                  label="Processing on server"
                  active={phase === "processing"}
                  done={phase === "done"}
                  indeterminate
                />
              </div>
            </div>
          ) : null}

          {phase === "error" && errorMsg ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
              {errorMsg}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StageRow({
  label,
  active,
  done,
  progress,
  indeterminate,
}: {
  label: string;
  active: boolean;
  done: boolean;
  progress?: number;
  indeterminate?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-sm">
        {done ? (
          <CheckCircle2 className="h-4 w-4 text-success" />
        ) : active ? (
          <Cog className="h-4 w-4 animate-spin text-primary" />
        ) : (
          <div className="h-4 w-4 rounded-full border border-border" />
        )}
        <span className={cn(done ? "text-foreground" : active ? "text-foreground" : "text-muted-foreground")}>
          {label}
        </span>
        {typeof progress === "number" && active && !indeterminate ? (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">{progress}%</span>
        ) : null}
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-sm bg-muted">
        <div
          className={cn(
            "h-full bg-primary transition-all",
            indeterminate && active && "w-1/3 animate-pulse",
          )}
          style={
            indeterminate
              ? undefined
              : { width: `${done ? 100 : active ? (progress ?? 0) : 0}%` }
          }
        />
      </div>
    </div>
  );
}
