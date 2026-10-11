import type { ReactNode } from "react";

// The selectors style the `.active` class TanStack Router puts on the current `<Link>`.
export function SubNav({ children }: { children: ReactNode }) {
  return (
    <nav className="flex gap-6 border-b text-sm [&>a]:-mb-px [&>a]:border-b-2 [&>a]:border-transparent [&>a]:pb-2 [&>a]:text-muted-foreground [&>a:hover]:text-foreground [&>a.active]:border-foreground [&>a.active]:text-foreground">
      {children}
    </nav>
  );
}
