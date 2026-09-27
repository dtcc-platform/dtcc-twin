import { themeSchema } from "@repo/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { authMutations, authQueries } from "@/api/auth";
import { settingsMutations, settingsQueries } from "@/api/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/_authenticated/profile")({ component: ProfilePage });

function ProfilePage() {
  // The route guard (_authenticated.tsx) only lets this page load once `me` holds the user.
  const me = useQuery(authQueries.me());

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 p-8">
      <div>
        <h1 className="text-4xl font-semibold tracking-tight">{me.data?.name}</h1>
        <p className="text-muted-foreground">{me.data?.email}</p>
      </div>
      <SettingsCard />
      <SessionsCard />
    </main>
  );
}

function SettingsCard() {
  const settings = useQuery(settingsQueries.detail());
  const update = useMutation(settingsMutations.update());

  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
        <CardDescription>Saved as you change them.</CardDescription>
      </CardHeader>
      <CardContent>
        {settings.isPending && <Spinner />}
        {settings.isError && <p className="text-destructive">{settings.error.message}</p>}
        {settings.data && (
          <FieldGroup>
            <Field orientation="horizontal">
              <FieldLabel htmlFor="theme">Theme</FieldLabel>
              <NativeSelect
                id="theme"
                value={settings.data.theme}
                disabled={update.isPending}
                onChange={(event) => update.mutate({ theme: themeSchema.parse(event.target.value) })}
              >
                {themeSchema.options.map((theme) => (
                  <NativeSelectOption key={theme} value={theme}>
                    {theme}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field orientation="horizontal">
              <Switch
                id="notifications"
                checked={settings.data.notificationsEnabled}
                disabled={update.isPending}
                onCheckedChange={(checked) => update.mutate({ notificationsEnabled: checked })}
              />
              <FieldLabel htmlFor="notifications">Notifications</FieldLabel>
            </Field>
          </FieldGroup>
        )}
      </CardContent>
    </Card>
  );
}

function SessionsCard() {
  const sessions = useQuery(authQueries.sessions());
  const revoke = useMutation(authMutations.revokeSession());
  const logoutEverywhere = useMutation(authMutations.logoutEverywhere());
  const navigate = useNavigate();

  // This page needs a login, so the user leaves it for the public home page.
  function logOutEverywhere() {
    logoutEverywhere.mutate(undefined, { onSuccess: () => void navigate({ to: "/" }) });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>Everywhere you are logged in.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {sessions.isPending && <Spinner />}
        {sessions.isError && <p className="text-destructive">{sessions.error.message}</p>}
        {sessions.data && (
          <ul className="divide-y rounded-lg border">
            {sessions.data.items.map((session) => (
              <li key={session.id} className="flex items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{session.userAgent ?? "Unknown device"}</p>
                  <p className="text-sm text-muted-foreground">
                    Last used {new Date(session.lastUsedAt).toLocaleString()}
                  </p>
                </div>
                {session.current ? (
                  <Badge variant="secondary">This device</Badge>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={revoke.isPending}
                    onClick={() => revoke.mutate(session.id)}
                  >
                    Log out
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <Button
          variant="destructive"
          className="self-start"
          disabled={logoutEverywhere.isPending}
          onClick={logOutEverywhere}
        >
          Log out everywhere
        </Button>
      </CardContent>
    </Card>
  );
}
