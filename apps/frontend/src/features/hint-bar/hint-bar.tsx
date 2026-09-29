import { SquareDashedIcon } from "lucide-react";

/** A line at the bottom of the map on what the user can do next. */
export function HintBar() {
  return (
    <div className="absolute bottom-3 left-1/2 z-10 flex h-12 -translate-x-1/2 items-center gap-2 rounded-full border bg-card px-5 text-sm whitespace-nowrap text-muted-foreground shadow-md">
      Click
      <SquareDashedIcon className="size-5 stroke-[1.5]" />
      to draw an area on the map
    </div>
  );
}
