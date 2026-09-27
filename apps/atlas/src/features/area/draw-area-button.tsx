import { SquareDashedIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAreaActions, useDrawing } from "./area-store";

export function DrawAreaButton() {
  const drawing = useDrawing();
  const { startDrawing, cancelDrawing } = useAreaActions();

  if (drawing) {
    return (
      <Button size="sm" variant="secondary" onClick={cancelDrawing}>
        <XIcon />
        Cancel drawing
      </Button>
    );
  }

  return (
    <Button size="sm" onClick={startDrawing}>
      <SquareDashedIcon />
      Draw area
    </Button>
  );
}
