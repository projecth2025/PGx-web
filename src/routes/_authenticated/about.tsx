import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";

export const Route = createFileRoute("/_authenticated/about")({
  component: AboutPage,
});

function AboutPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="About Us"
        description="Information about the PGX platform and our mission."
      />

      <div className="rounded-md border border-border bg-card p-8">
        <h2 className="text-sm font-semibold text-foreground">Our Platform</h2>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          PGX provides laboratories and hospitals with a secure, controlled
          environment for genomic report processing. More information about our
          team, mission, and standards will be published here.
        </p>
      </div>
    </div>
  );
}
