import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { keyMutations, keyQueries } from "@/api/keys";
import { ConfirmButton } from "@/components/common/confirm-button";
import { Spinner } from "@/components/ui/spinner";

/** Another user's API keys, for an admin, who can revoke each of them. */
export function UserKeyList({ userId }: { userId: string }) {
  const keys = useQuery(keyQueries.forUser(userId));
  const revoke = useMutation(keyMutations.revokeForUser());

  if (keys.isPending) return <Spinner />;
  if (keys.isError) return <p className="text-destructive">{keys.error.message}</p>;
  if (keys.data.items.length === 0) return <p className="text-muted-foreground">No API keys.</p>;

  return (
    <ul className="divide-y rounded-lg border">
      {keys.data.items.map((apiKey) => (
        <li key={apiKey.id} className="flex items-center gap-4 p-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{apiKey.name}</p>
            <p className="text-muted-foreground">
              <code className="font-mono text-xs">{apiKey.prefix}…</code>, created{" "}
              {new Date(apiKey.createdAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
            </p>
          </div>
          <ConfirmButton
            label="Revoke"
            title={`Revoke ${apiKey.name}?`}
            description="Anything using this key stops working at once. This cannot be undone."
            disabled={revoke.isPending}
            onConfirm={() =>
              revoke.mutate(
                { userId, keyId: apiKey.id },
                {
                  onSuccess: () => toast.success(`${apiKey.name} was revoked.`),
                  onError: (error) => toast.error(error.message),
                },
              )
            }
          />
        </li>
      ))}
    </ul>
  );
}
