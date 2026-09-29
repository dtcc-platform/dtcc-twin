import { useQuery } from "@tanstack/react-query";
import { healthQueries } from "@/api/health";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const statuses = {
  pending: { label: "Checking", colour: "bg-muted-foreground" },
  error: { label: "Unreachable", colour: "bg-red-500" },
  success: { label: "Ready", colour: "bg-green-500" },
};

export function ServerStatus() {
  const health = useQuery(healthQueries.ready());
  const { label, colour } = statuses[health.status];

  return (
    <Tooltip>
      <TooltipTrigger render={<span role="status" aria-label={`Server: ${label}`} />}>
        <span className={cn("block size-2.5 rounded-full", colour)} />
      </TooltipTrigger>
      <TooltipContent side="bottom">Server: {label}</TooltipContent>
    </Tooltip>
  );
}
