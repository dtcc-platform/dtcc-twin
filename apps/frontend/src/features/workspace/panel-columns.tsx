import { FloatingCard } from "@/components/floating-card";
import { cn } from "@/lib/utils";
import { useLeftContent, useRightContent, useWorkspaceActions, type RightContent } from "./workspace-store";

// Each column spans the map's height; only its panels take clicks, so the map below a short panel stays draggable.
const column = "pointer-events-none flex w-72 flex-col gap-2 *:pointer-events-auto";

/** The panel column on the right of the map, under the title. */
export function RightColumn() {
  const right = useRightContent();
  if (!right) return null;

  // Keyed by the content, so switching starts it afresh: expanded, and sliding in again.
  return (
    <div
      key={right}
      className={cn(
        column,
        "absolute top-17 right-3 bottom-3 z-10 animate-in duration-200 fade-in slide-in-from-right-2",
      )}
    >
      <RightPanel content={right} />
    </div>
  );
}

/** The panel column beside the toolbar; it stretches to the height of the row they share. */
export function LeftColumn() {
  const left = useLeftContent();
  if (!left) return null;

  return (
    <div key={left} className={cn(column, "self-stretch animate-in duration-200 fade-in slide-in-from-left-2")}>
      <LeftPanel />
    </div>
  );
}

function RightPanel({ content }: { content: RightContent }) {
  const { closeRight } = useWorkspaceActions();

  switch (content) {
    case "bookmarks":
      return <FloatingCard title="Bookmarks" onClose={closeRight} />;
    case "datasets":
      return <FloatingCard title="Datasets" onClose={closeRight} />;
    case "simulations":
      return <FloatingCard title="Simulations" onClose={closeRight} />;
    case "downloads":
      return <FloatingCard title="Downloads" onClose={closeRight} />;
    case "upload":
      return <FloatingCard title="Upload" onClose={closeRight} />;
  }
}

// Layers is the only left content so far; this becomes a switch like RightPanel's with the second.
function LeftPanel() {
  const { closeLeft } = useWorkspaceActions();

  return <FloatingCard title="Layers" onClose={closeLeft} />;
}
