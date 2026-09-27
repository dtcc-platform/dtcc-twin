import type { Job, JobResult } from "@repo/contracts";
import { DownloadIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import type { ReactNode } from "react";
import { jobPackageUrl } from "@/api/jobs";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { useLayerGeometry } from "./use-layer-geometry";

type LayerDetailsSheetProps = { job: Job | null; onClose: () => void };

/** A completed layer's result as its package describes it, and the package to download. */
export function LayerDetailsSheet({ job, onClose }: LayerDetailsSheetProps) {
  return (
    <Sheet
      open={job !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      modal={false}
      disablePointerDismissal
    >
      <SheetContent showOverlay={false} className="top-(--site-header-height)! h-auto! sm:max-w-md">
        {job && <LayerDetails job={job} />}
      </SheetContent>
    </Sheet>
  );
}

function LayerDetails({ job }: { job: Job }) {
  const { result, artifact } = useLayerGeometry(job);

  if (!result) {
    return (
      <SheetHeader>
        <SheetTitle>Details</SheetTitle>
        <Spinner />
      </SheetHeader>
    );
  }

  return (
    <>
      <SheetHeader className="pr-12">
        <SheetTitle>{result.title}</SheetTitle>
        <SheetDescription>{result.headline ?? result.description}</SheetDescription>
      </SheetHeader>
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-4">
        {result.summary && <p>{result.summary}</p>}
        {!artifact && (
          <p className="flex gap-2 rounded-lg bg-muted p-3 text-muted-foreground">
            <InfoIcon className="mt-0.5 size-4 shrink-0" />
            The map can't draw this result yet: its package holds only the DTCC model. Download it to use the data.
          </p>
        )}
        <Button className="w-fit" nativeButton={false} render={<a href={jobPackageUrl(job.id)} download />}>
          <DownloadIcon />
          Download package
        </Button>
        <ResultFacts result={result} />
        <List title="Warnings" items={result.warnings} warning />
        <List title="Limitations" items={result.limitations} />
        <List title="How it was made" items={result.processingSteps} />
      </div>
    </>
  );
}

function ResultFacts({ result }: { result: JobResult }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
      <Fact term="Sources">{result.providers.join(", ") || "Not stated"}</Fact>
      <Fact term="License">{result.license ?? "Not stated"}</Fact>
      {result.generatedBy && <Fact term="Made by">{result.generatedBy}</Fact>}
    </dl>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{term}</dt>
      <dd>{children}</dd>
    </>
  );
}

function List({ title, items, warning = false }: { title: string; items: string[]; warning?: boolean }) {
  if (items.length === 0) return null;

  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      <ul className="flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            {warning && <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />}
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
