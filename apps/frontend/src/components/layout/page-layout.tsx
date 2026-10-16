import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** A page away from the map: a back arrow to it at the top left, then the page's own content. */
export function PageLayout({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className="min-h-svh">
      <header className="p-3">
        <Link to="/" aria-label="Back to the map" className={buttonVariants({ variant: "ghost", size: "icon-lg" })}>
          <ArrowLeft />
        </Link>
      </header>
      <main className={cn("mx-auto flex flex-col gap-6 px-8 pb-8", className)}>{children}</main>
    </div>
  );
}
