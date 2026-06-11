import { createFileRoute } from "@tanstack/react-router";
import { Upload, Cpu, FileText } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/how-it-works")({
  component: HowItWorksPage,
});

const STEPS = [
  {
    icon: Upload,
    title: "Upload",
    description: "Submit a folder of VCF files for a processing session.",
  },
  {
    icon: Cpu,
    title: "Processing",
    description: "Files are processed through the genomic analysis pipeline.",
  },
  {
    icon: FileText,
    title: "Reports",
    description: "Generated reports become available for review and download.",
  },
];

function HowItWorksPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="How It Works"
        description="An overview of the upload, processing, and report generation workflow."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {STEPS.map((step) => (
          <div key={step.title} className="rounded-md border border-border bg-card p-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-sm border border-border bg-primary/8 text-primary">
              <step.icon className="h-5 w-5" />
            </div>
            <h2 className="mt-4 text-sm font-semibold text-foreground">{step.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{step.description}</p>
          </div>
        ))}
      </div>

      <div className="rounded-md border border-dashed border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Detailed documentation of the genomic processing pipeline and report
          generation workflow will be published here.
        </p>
      </div>
    </div>
  );
}
