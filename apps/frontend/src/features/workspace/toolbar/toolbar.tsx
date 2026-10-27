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
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { authQueries } from "@/api/auth";
import { isActiveJob, jobQueries } from "@/api/jobs";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAreaStore } from "@/features/area/area-store";
import { useWorkspaceStore, type LeftContent, type RightContent } from "@/features/workspace/workspace-store";
import { cn } from "@/lib/utils";

const item =
  "h-10.5 w-full justify-start gap-3 px-0.75 aria-expanded:bg-primary/10 aria-expanded:text-primary aria-pressed:bg-primary/10 aria-pressed:text-primary [&_svg]:stroke-[1.5] [&_svg:not([class*='size-'])]:size-7.5";

/** The tools on the left of the map */
export function Toolbar() {
  const [expanded, setExpanded] = useState(false);
  const collapseTimer = useRef<number>(undefined);
  const right = useWorkspaceStore((state) => state.right);
  const left = useWorkspaceStore((state) => state.left);
  const { setRight, closeRight, setLeft, closeLeft } = useWorkspaceStore((state) => state.actions);
  const drawing = useAreaStore((state) => state.drawing);
  const hasArea = useAreaStore((state) => state.area !== null);
  const { startDrawing, cancelDrawing, clearArea } = useAreaStore((state) => state.actions);
  // The same first page as the Downloads panel's, so both share one poll.
  const me = useQuery(authQueries.me());
  const jobs = useQuery({ ...jobQueries.list({ limit: 20 }), enabled: Boolean(me.data) });
  const activeJobs = me.data ? (jobs.data?.items.filter(isActiveJob).length ?? 0) : 0;

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
      <Button
        variant="ghost"
        className={item}
        aria-pressed={drawing !== null}
        onClick={() => {
          if (drawing) {
            cancelDrawing();
            return;
          }
          startDrawing();
          setLeft("bounds");
        }}
      >
        <SquareDashedIcon />
        Draw area
      </Button>
      <Button variant="ghost" className={item} disabled={!hasArea && !drawing} onClick={clearArea}>
        <XIcon />
        Clear area
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
        className={cn(item, "relative")}
        aria-expanded={right === "downloads"}
        onClick={() => {
          openOrCloseRight("downloads");
        }}
      >
        <DownloadIcon />
        Downloads
        {activeJobs > 0 && (
          <>
            <span
              aria-hidden
              className="absolute top-0.5 left-6 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 font-semibold text-primary-foreground"
            >
              {activeJobs}
            </span>
            <span className="sr-only">, {activeJobs} running</span>
          </>
        )}
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
