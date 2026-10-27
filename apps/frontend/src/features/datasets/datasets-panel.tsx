import type { Dataset } from "@repo/contracts";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { datasetQueries } from "@/api/datasets";
import { FloatingCard } from "@/components/common/floating-card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { catalogue, type CatalogueKind } from "./catalogue.ts";
import { DatasetForm } from "./dataset-form.tsx";

const titles: Record<CatalogueKind, string> = { datasets: "Datasets", simulations: "Simulations" };
const emptyTexts: Record<CatalogueKind, string> = {
  datasets: "No Datasets available",
  simulations: "No simulations available",
};

/** The Datasets or the simulations the engine can run; choosing one shows it in the same panel. */
export function DatasetsPanel({ kind, onClose }: { kind: CatalogueKind; onClose: () => void }) {
  const query = useQuery(datasetQueries.list());
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const selected = query.data?.items.find((dataset) => dataset.name === selectedName);

  if (selected) {
    return (
      <FloatingCard
        title={selected.title}
        onClose={onClose}
        onBack={() => {
          setSelectedName(null);
        }}
      >
        <div className="flex flex-col gap-5">
          <p className="text-sm text-muted-foreground">{selected.description}</p>
          <DatasetForm key={selected.name} dataset={selected} />
        </div>
      </FloatingCard>
    );
  }

  return (
    <FloatingCard title={titles[kind]} onClose={onClose}>
      {query.isPending && <Spinner className="mx-auto my-4" />}
      {query.isError && (
        <div className="flex flex-col items-start gap-2 text-sm">
          <p className="text-destructive">{query.error.message}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void query.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      )}
      {query.isSuccess && (
        <DatasetList kind={kind} datasets={catalogue(query.data.items, kind)} onSelect={setSelectedName} />
      )}
    </FloatingCard>
  );
}

type DatasetListProps = { kind: CatalogueKind; datasets: Dataset[]; onSelect: (name: string) => void };

function DatasetList({ kind, datasets, onSelect }: DatasetListProps) {
  if (datasets.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyTexts[kind]}</p>;
  }

  return (
    <ul className="-mx-2 flex flex-col">
      {datasets.map((dataset) => (
        <li key={dataset.name}>
          <button
            type="button"
            className="w-full rounded-xl px-2 py-2 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            onClick={() => {
              onSelect(dataset.name);
            }}
          >
            <span className="block text-sm font-medium">{dataset.title}</span>
            <span className="line-clamp-2 text-xs text-muted-foreground">{dataset.description}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
