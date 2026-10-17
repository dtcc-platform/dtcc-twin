import { ArrowLeftIcon, ChevronDownIcon, XIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

type FloatingCardProps = {
  title: string;
  onClose: () => void;
  /** Shows a back button before the title, for a card that has stepped into one of its items. */
  onBack?: () => void;
  children?: ReactNode;
  className?: string;
};

export function FloatingCard({ title, onClose, onBack, children, className }: FloatingCardProps) {
  return (
    <Collapsible
      defaultOpen
      render={<section aria-label={title} />}
      className={cn("flex max-h-full min-h-0 flex-col rounded-3xl border bg-card shadow-md", className)}
    >
      <header className={cn("flex items-center gap-1 py-2 pr-2", onBack ? "pl-2" : "pl-4")}>
        {onBack && (
          <Button variant="ghost" size="icon" aria-label="Back" onClick={onBack}>
            <ArrowLeftIcon />
          </Button>
        )}
        <h2 className="flex-1 truncate font-medium">{title}</h2>
        <CollapsibleTrigger
          render={(props, state) => (
            <Button
              {...props}
              variant="ghost"
              size="icon"
              aria-label={state.open ? `Collapse ${title}` : `Expand ${title}`}
            />
          )}
          className="[&_svg]:transition-transform data-panel-open:[&_svg]:rotate-180"
        >
          <ChevronDownIcon />
        </CollapsibleTrigger>
        <Button variant="ghost" size="icon" aria-label={`Close ${title}`} onClick={onClose}>
          <XIcon />
        </Button>
      </header>
      {children && <CollapsibleContent className="min-h-0 overflow-y-auto px-4 pb-4">{children}</CollapsibleContent>}
    </Collapsible>
  );
}
