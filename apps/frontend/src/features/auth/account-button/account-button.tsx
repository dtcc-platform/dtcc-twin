import type { User } from "@repo/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CircleUser, LogOut, Moon, Shield, Sun, UserRound } from "lucide-react";
import { toast } from "sonner";
import { authMutations, authQueries } from "@/api/auth";
import { settingsMutations } from "@/api/settings";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useTheme } from "@/hooks/use-theme";
import { cn } from "@/lib/utils";
import { initials } from "./initials";

const floating =
  "rounded-full border bg-card shadow-md outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50";

/** Who is logged in, at a glance: a way to log in for nobody, the account menu for a user. */
export function AccountButton() {
  const me = useQuery(authQueries.me());

  // Not "Log in" while the answer is on its way, so a reload doesn't flash it before the initials.
  if (me.isPending) return <Skeleton className="size-12 rounded-full shadow-md" />;
  if (!me.data) {
    return (
      <Link
        to="/"
        search={{ auth: "login" }}
        className={cn("flex h-12 items-center gap-2 px-5 font-semibold", floating)}
      >
        <CircleUser className="size-5" />
        Log in
      </Link>
    );
  }
  return <AccountMenu user={me.data} />;
}

function AccountMenu({ user }: { user: User }) {
  const logout = useMutation(authMutations.logout());

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Account: ${user.name}`}
        className={cn("flex size-12 items-center justify-center font-semibold", floating)}
      >
        {initials(user.name)}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="flex flex-col">
            <span className="truncate text-sm text-foreground">{user.name}</span>
            <span className="truncate font-normal">{user.email}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLinkItem render={<Link to="/account" />}>
          <UserRound />
          Account
        </DropdownMenuLinkItem>
        {user.role === "admin" && (
          <DropdownMenuLinkItem render={<Link to="/admin" />}>
            <Shield />
            Admin
          </DropdownMenuLinkItem>
        )}
        <ToggleThemeItem />
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={logout.isPending}
          onClick={() => logout.mutate(undefined, { onError: (error) => toast.error(error.message) })}
        >
          <LogOut />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Saves the opposite of what shows, so a `system` preference becomes a fixed one; the account page offers it back. */
function ToggleThemeItem() {
  const theme = useTheme();
  const update = useMutation(settingsMutations.update());

  return (
    <DropdownMenuItem
      disabled={update.isPending}
      onClick={() =>
        update.mutate(
          { theme: theme === "dark" ? "light" : "dark" },
          { onError: (error) => toast.error(error.message) },
        )
      }
    >
      {theme === "dark" ? <Sun /> : <Moon />}
      Toggle theme
    </DropdownMenuItem>
  );
}
