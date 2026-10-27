import { Marker } from "react-map-gl/maplibre";
import { cn } from "@/lib/utils";
import { areaSizeProblem, areaSizeProblemText, areaSquareMetres, formatSquareMetres } from "@/features/area/area";
import { useAreaStore } from "@/features/area/area-store";

/** The size of the box being drawn, moved or resized, at its north-east corner. */
export function AreaSizeLabel() {
  const preview = useAreaStore((state) => state.preview);
  if (!preview) return null;

  const squareMetres = areaSquareMetres(preview);
  const problem = areaSizeProblem(squareMetres);

  return (
    <Marker longitude={preview.east} latitude={preview.north} anchor="bottom-left" offset={[6, -6]}>
      <div
        className={cn(
          "pointer-events-none rounded-md bg-foreground px-2 py-1 text-xs whitespace-nowrap text-background shadow-md",
          problem === "too-small" && "bg-primary text-primary-foreground",
          problem === "too-large" && "bg-destructive text-white",
        )}
      >
        {formatSquareMetres(squareMetres)}
        {problem && ` · ${areaSizeProblemText[problem]}`}
      </div>
    </Marker>
  );
}
