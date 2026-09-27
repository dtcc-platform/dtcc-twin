import { useId, type ReactNode } from "react";

type WorkspaceCardProps = { title: string; action?: ReactNode; children: ReactNode };

/** One group of the sidebar, such as the area or the layers: a card with a quiet header and its actions. */
export function WorkspaceCard({ title, action, children }: WorkspaceCardProps) {
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-xl bg-card p-4 text-card-foreground ring-1 ring-foreground/10"
    >
      <div className="flex min-h-7 items-center gap-2">
        <h2 id={headingId} className="flex-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
