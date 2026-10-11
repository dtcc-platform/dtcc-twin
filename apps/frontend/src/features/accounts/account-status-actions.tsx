import type { SetUserStatusBody, User, UserStatus } from "@repo/contracts";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { accountMutations } from "@/api/accounts";
import { ConfirmButton } from "@/components/common/confirm-button";
import { Button } from "@/components/ui/button";

type Action = { label: string; done: string; status: SetUserStatusBody["status"]; variant: "default" | "outline" };

const actions: Record<UserStatus, Action[]> = {
  pending: [
    { label: "Approve", done: "approved", status: "active", variant: "default" },
    { label: "Reject", done: "rejected", status: "disabled", variant: "outline" },
  ],
  active: [{ label: "Disable", done: "disabled", status: "disabled", variant: "outline" }],
  disabled: [{ label: "Enable", done: "enabled", status: "active", variant: "outline" }],
};

export function AccountStatusActions({ user }: { user: User }) {
  const setStatus = useMutation(accountMutations.setStatus());

  function run(action: Action) {
    setStatus.mutate(
      { id: user.id, status: action.status },
      {
        onSuccess: () => toast.success(`${user.name} was ${action.done}.`),
        onError: (error) => toast.error(error.message),
      },
    );
  }

  return actions[user.status].map((action) =>
    action.status === "disabled" ? (
      <ConfirmButton
        key={action.label}
        label={action.label}
        variant={action.variant}
        title={`${action.label} ${user.name}?`}
        description="They can no longer log in, and their sessions end."
        disabled={setStatus.isPending}
        onConfirm={() => run(action)}
      />
    ) : (
      <Button
        key={action.label}
        variant={action.variant}
        size="sm"
        disabled={setStatus.isPending}
        onClick={() => run(action)}
      >
        {action.label}
      </Button>
    ),
  );
}
