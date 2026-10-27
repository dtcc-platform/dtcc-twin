import type { User } from "@repo/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { accountMutations } from "@/api/accounts";
import { authQueries } from "@/api/auth";
import { ConfirmButton } from "@/components/common/confirm-button";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { UserKeyList } from "@/features/keys/user-key-list";
import { AccountStatusActions } from "./account-status-actions.tsx";
import { AccountStatusBadge } from "./account-status-badge.tsx";

export function AccountAdminDialog({ user }: { user: User }) {
  const me = useQuery(authQueries.me());
  const remove = useMutation(accountMutations.delete());
  const isSelf = me.data?.id === user.id;

  return (
    <Dialog>
      <DialogTrigger render={<Button variant="link" className="h-auto p-0 font-medium" />}>{user.name}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-baseline gap-x-2 pr-8">
            {user.name}
            <span className="text-sm font-normal text-muted-foreground">{user.email}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex min-h-8 items-center justify-between gap-4">
            <span className="text-muted-foreground">Status</span>
            <div className="flex items-center gap-3">
              <AccountStatusBadge status={user.status} />
              {isSelf ? (
                <span className="text-muted-foreground">You can't change your own status</span>
              ) : (
                <AccountStatusActions user={user} />
              )}
            </div>
          </div>
          <div className="flex min-h-8 items-center justify-between gap-4">
            <span className="text-muted-foreground">Role</span>
            <span className="capitalize">{user.role}</span>
          </div>
          <div className="flex min-h-8 items-center justify-between gap-4">
            <span className="text-muted-foreground">Registered</span>
            <span>{new Date(user.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}</span>
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-muted-foreground">API keys</span>
            <UserKeyList userId={user.id} />
          </div>
        </div>
        {!isSelf && (
          <DialogFooter className="justify-end">
            <ConfirmButton
              label="Delete"
              title={`Delete ${user.name}?`}
              description="Their account and everything in it are deleted for good. This cannot be undone."
              disabled={remove.isPending}
              onConfirm={() =>
                remove.mutate(user.id, {
                  onSuccess: () => toast.success(`${user.name} was deleted.`),
                  onError: (error) => toast.error(error.message),
                })
              }
            />
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
