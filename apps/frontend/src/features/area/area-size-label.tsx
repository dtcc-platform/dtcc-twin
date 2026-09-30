import { Marker } from "react-map-gl/maplibre";
import { cn } from "@/lib/utils";
import { areaSizeProblem, areaSquareMetres, formatSquareMetres, minSquareMetres } from "./area";
import { useAreaStore } from "./area-store";

/** The size of the box being drawn, moved or resized, at its north-east corner. */
export function AreaSizeLabel() {
  const preview = useAreaStore((state) => state.preview);
  if (!preview) return null;

  const squareMetres = areaSquareMetres(preview);
  const problem = areaSizeProblem(squareMetres);
  const tooSmall = squareMetres < minSquareMetres;

  return (
    <Marker longitude={preview.east} latitude={preview.north} anchor="bottom-left" offset={[6, -6]}>
      <div
        className={cn(
          "pointer-events-none rounded-md bg-foreground px-2 py-1 text-xs whitespace-nowrap text-background shadow-md",
          problem && (tooSmall ? "bg-orange-600 text-white" : "bg-destructive text-white"),
        )}
      >
        {formatSquareMetres(squareMetres)}
        {problem && ` · ${problem}`}
      </div>
    </Marker>
  );
}
