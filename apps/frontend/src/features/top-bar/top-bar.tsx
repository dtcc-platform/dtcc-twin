import { DtccMenu } from "./dtcc-menu";
import { ServerStatus } from "./server-status";

export function TopBar() {
  return (
    <header className="pointer-events-none absolute inset-x-3 top-3 z-10 flex items-start justify-between *:pointer-events-auto">
      <DtccMenu />
      <div className="flex h-12 min-w-72 items-center justify-center gap-3 rounded-full border bg-card px-5 shadow-md">
        <ServerStatus />
        <span className="font-semibold">DTCC Twin</span>
      </div>
    </header>
  );
}
