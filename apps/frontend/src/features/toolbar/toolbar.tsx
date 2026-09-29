import {
  BookmarkIcon,
  BoxIcon,
  DownloadIcon,
  FolderTreeIcon,
  LayersIcon,
  SearchIcon,
  SquareDashedIcon,
  UploadIcon,
  WavesIcon,
  XIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const item = "h-10.5 w-full justify-start gap-3 px-0.75 [&_svg]:stroke-[1.5] [&_svg:not([class*='size-'])]:size-7.5";

/** The tools on the left of the map */
export function Toolbar() {
  const [expanded, setExpanded] = useState(false);
  const collapseTimer = useRef<number>(undefined);

  function expand() {
    clearTimeout(collapseTimer.current);
    setExpanded(true);
  }

  function collapseSoon() {
    collapseTimer.current = setTimeout(() => {
      setExpanded(false);
    }, 300);
  }

  return (
    <div
      role="group"
      aria-label="Tools"
      data-expanded={expanded || undefined}
      onPointerEnter={expand}
      onPointerLeave={collapseSoon}
      className="absolute top-16 left-3 z-10 flex w-12 flex-col gap-1 overflow-hidden rounded-3xl border bg-card p-1 py-2 shadow-md transition-[width] duration-200 focus-within:w-52 data-expanded:w-52"
    >
      <Button variant="ghost" className={item} disabled>
        <SquareDashedIcon />
        Draw area
      </Button>
      <Button variant="ghost" className={item} disabled>
        <XIcon />
        Cancel
      </Button>
      <Button variant="ghost" className={item} disabled>
        <BookmarkIcon />
        Bookmarks
      </Button>
      <Separator className="my-1" />
      <Button variant="ghost" className={item} disabled>
        <FolderTreeIcon />
        Datasets
      </Button>
      <Button variant="ghost" className={item} disabled>
        <WavesIcon />
        Simulations
      </Button>
      <Button variant="ghost" className={item} disabled>
        <LayersIcon />
        Layers
      </Button>
      <Button variant="ghost" className={item} disabled>
        <DownloadIcon />
        Downloads
      </Button>
      <Button variant="ghost" className={item} disabled>
        <UploadIcon />
        Upload
      </Button>
      <Separator className="my-1" />
      <Button variant="ghost" className={item} disabled>
        <SearchIcon />
        Search
      </Button>
      <Button variant="ghost" className={item} disabled>
        <BoxIcon />
        3D view
      </Button>
    </div>
  );
}
