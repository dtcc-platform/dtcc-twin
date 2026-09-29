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
import {
  useLeftContent,
  useRightContent,
  useWorkspaceActions,
  type LeftContent,
  type RightContent,
} from "@/features/workspace/workspace-store";

const item =
  "h-10.5 w-full justify-start gap-3 px-0.75 aria-expanded:bg-primary/10 aria-expanded:text-primary [&_svg]:stroke-[1.5] [&_svg:not([class*='size-'])]:size-7.5";

/** The tools on the left of the map */
export function Toolbar() {
  const [expanded, setExpanded] = useState(false);
  const collapseTimer = useRef<number>(undefined);
  const right = useRightContent();
  const left = useLeftContent();
  const { setRight, closeRight, setLeft, closeLeft } = useWorkspaceActions();

  function openOrCloseRight(content: RightContent) {
    if (right === content) closeRight();
    else setRight(content);
  }

  function openOrCloseLeft(content: LeftContent) {
    if (left === content) closeLeft();
    else setLeft(content);
  }

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
      className="pointer-events-auto flex w-12 shrink-0 flex-col gap-1 overflow-hidden rounded-3xl border bg-card p-1 py-2 shadow-md transition-[width] duration-200 focus-within:w-52 data-expanded:w-52"
    >
      <Button variant="ghost" className={item} disabled>
        <SquareDashedIcon />
        Draw area
      </Button>
      <Button variant="ghost" className={item} disabled>
        <XIcon />
        Cancel
      </Button>
      <Button
        variant="ghost"
        className={item}
        aria-expanded={right === "bookmarks"}
        onClick={() => {
          openOrCloseRight("bookmarks");
        }}
      >
        <BookmarkIcon />
        Bookmarks
      </Button>
      <Separator className="my-1" />
      <Button
        variant="ghost"
        className={item}
        aria-expanded={right === "datasets"}
        onClick={() => {
          openOrCloseRight("datasets");
        }}
      >
        <FolderTreeIcon />
        Datasets
      </Button>
      <Button
        variant="ghost"
        className={item}
        aria-expanded={right === "simulations"}
        onClick={() => {
          openOrCloseRight("simulations");
        }}
      >
        <WavesIcon />
        Simulations
      </Button>
      <Button
        variant="ghost"
        className={item}
        aria-expanded={left === "layers"}
        onClick={() => {
          openOrCloseLeft("layers");
        }}
      >
        <LayersIcon />
        Layers
      </Button>
      <Button
        variant="ghost"
        className={item}
        aria-expanded={right === "downloads"}
        onClick={() => {
          openOrCloseRight("downloads");
        }}
      >
        <DownloadIcon />
        Downloads
      </Button>
      <Button
        variant="ghost"
        className={item}
        aria-expanded={right === "upload"}
        onClick={() => {
          openOrCloseRight("upload");
        }}
      >
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
