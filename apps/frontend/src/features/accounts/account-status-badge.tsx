import type { UserStatus } from "@repo/contracts";
import { Badge } from "@/components/ui/badge";

const badges = {
  pending: { label: "Pending approval", variant: "outline" },
  active: { label: "Active", variant: "secondary" },
  disabled: { label: "Disabled", variant: "destructive" },
} as const;

export function AccountStatusBadge({ status }: { status: UserStatus }) {
  return <Badge variant={badges[status].variant}>{badges[status].label}</Badge>;
}
