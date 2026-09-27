import type { Dataset } from "@repo/contracts";
import { useState } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DatasetCatalogue } from "./dataset-catalogue";
import { DatasetFormView } from "./dataset-form-view";

type AddDataSheetProps = { open: boolean; onOpenChange: (open: boolean) => void };

/**
 * Picks a Dataset and its parameters, then runs it on the area. Non-modal and below the site header, so the map
 * and the area stay visible and editable while it's open.
 */
export function AddDataSheet({ open, onOpenChange }: AddDataSheetProps) {
  const [selected, setSelected] = useState<Dataset | null>(null);

  function changeOpen(next: boolean) {
    // Reopening starts from the catalogue.
    if (!next) setSelected(null);
    onOpenChange(next);
  }

  return (
    <Sheet open={open} onOpenChange={changeOpen} modal={false} disablePointerDismissal>
      <SheetContent showOverlay={false} className="top-(--site-header-height)! h-auto! sm:max-w-md">
        <SheetHeader className="pr-12">
          <SheetTitle>Add data</SheetTitle>
          <SheetDescription>Choose a Dataset to run on the selected area.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {selected ? (
            <DatasetFormView
              key={selected.name}
              dataset={selected}
              onBack={() => {
                setSelected(null);
              }}
              onQueued={() => {
                changeOpen(false);
              }}
            />
          ) : (
            <DatasetCatalogue onSelect={setSelected} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
