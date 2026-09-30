import { SquareDashedIcon } from "lucide-react";
import { useAreaStore } from "@/features/area/area-store";

/** A line at the bottom of the map on what the user can do next. */
export function HintBar() {
  const drawing = useAreaStore((state) => state.drawing);
  const hasArea = useAreaStore((state) => state.area !== null);

  return (
    <div className="absolute bottom-3 left-1/2 z-10 flex h-12 -translate-x-1/2 items-center gap-2 rounded-full border bg-card px-5 text-sm whitespace-nowrap text-muted-foreground shadow-md">
      {drawing === "first-corner" && (
        <>
          Click one corner of the area, then the opposite one · <Key>Esc</Key> to cancel
        </>
      )}
      {drawing === "opposite-corner" && (
        <>
          Click the opposite corner · <Key>Esc</Key> to cancel
        </>
      )}
      {!drawing && hasArea && "Drag the area to move it, or a corner to resize it"}
      {!drawing && !hasArea && (
        <>
          Click
          <SquareDashedIcon className="size-5 stroke-[1.5]" />
          to draw an area on the map
        </>
      )}
    </div>
  );
}

function Key({ children }: { children: string }) {
  return <kbd className="rounded border bg-muted px-1.5 font-sans text-xs text-foreground">{children}</kbd>;
}
