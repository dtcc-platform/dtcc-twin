import type { Dataset } from "@repo/contracts";
import { useQuery } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { useState } from "react";
import { datasetQueries } from "@/api/datasets";
import { Badge } from "@/components/ui/badge";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type DatasetCatalogueProps = { onSelect: (dataset: Dataset) => void };

/** Every Dataset the engine describes, grouped by category; the ones it can't run are listed but disabled. */
export function DatasetCatalogue({ onSelect }: DatasetCatalogueProps) {
  const datasets = useQuery(datasetQueries.list());
  const [search, setSearch] = useState("");

  if (datasets.isPending) return <Spinner />;
  if (datasets.isError) return <p className="text-destructive">Couldn't load the Datasets: {datasets.error.message}</p>;

  const groups = groupByCategory(matching(datasets.data.items, search));

  return (
    <div className="flex flex-col gap-3">
      <InputGroup>
        <InputGroupAddon>
          <SearchIcon />
        </InputGroupAddon>
        <InputGroupInput
          type="search"
          placeholder="Search Datasets"
          aria-label="Search Datasets"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
          }}
        />
      </InputGroup>
      {groups.length === 0 && <p className="text-muted-foreground">No Dataset matches “{search}”.</p>}
      {groups.map(([category, members]) => (
        <div key={category} className="flex flex-col gap-1">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{category}</h3>
          <ul className="flex flex-col">
            {members.map((dataset) => (
              <li key={dataset.name}>
                <DatasetRow dataset={dataset} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function DatasetRow({ dataset, onSelect }: { dataset: Dataset; onSelect: (dataset: Dataset) => void }) {
  return (
    <button
      type="button"
      disabled={!dataset.available}
      title={dataset.description}
      onClick={() => {
        onSelect(dataset);
      }}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        dataset.available ? "hover:bg-muted" : "cursor-not-allowed text-muted-foreground",
      )}
    >
      <span className="flex-1 truncate">{dataset.title}</span>
      {!dataset.available && <Badge variant="outline">Not in this demo</Badge>}
    </button>
  );
}

function matching(datasets: Dataset[], search: string): Dataset[] {
  const query = search.trim().toLowerCase();
  if (!query) return datasets;
  return datasets.filter((dataset) =>
    [dataset.title, dataset.name, dataset.description].some((text) => text.toLowerCase().includes(query)),
  );
}

// Categories come from DTCC Core; runnable Datasets first within each, then by title.
function groupByCategory(datasets: Dataset[]): [string, Dataset[]][] {
  const groups = new Map<string, Dataset[]>();
  for (const dataset of datasets) {
    const members = groups.get(dataset.dataCategory) ?? [];
    members.push(dataset);
    groups.set(dataset.dataCategory, members);
  }
  const byAvailabilityThenTitle = (a: Dataset, b: Dataset) =>
    Number(b.available) - Number(a.available) || a.title.localeCompare(b.title);
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, members]) => [category, members.toSorted(byAvailabilityThenTitle)]);
}
