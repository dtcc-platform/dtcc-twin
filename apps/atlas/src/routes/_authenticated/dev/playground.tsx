import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, redirect } from "@tanstack/react-router";
import type { AxiosRequestConfig } from "axios";
import { type ReactNode, useState } from "react";
import { api } from "@/api/client/api-client";
import { ApiError } from "@/api/client/api-error";
import { itemMutations, itemQueries } from "@/api/items";
import { settingsMutations, settingsQueries } from "@/api/settings";
import { userMutations, userQueries } from "@/api/users";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/dev/playground")({
  beforeLoad: ({ context }) => {
    if (context.user.role !== "admin") throw redirect({ to: "/" });
  },
  component: PlaygroundPage,
});

// Exercises the API with valid and invalid calls; admin-only because most of them are.
function PlaygroundPage() {
  const [selectedId, setSelectedId] = useState<string>();
  const list = useQuery(userQueries.list({ limit: 5 }));
  const create = useMutation(userMutations.create());

  return (
    <main className="mx-auto max-w-6xl p-8">
      <Link to="/" className="text-sm underline underline-offset-4">
        ← Home
      </Link>
      <h1 className="my-4 text-4xl font-semibold tracking-tight">Users, settings and items API</h1>
      <p className="text-muted-foreground">
        Valid calls go through <code className={code}>src/api/users.ts</code>, <code className={code}>settings.ts</code>{" "}
        and <code className={code}>items.ts</code>; invalid ones use the raw <code className={code}>api</code> client to
        send what the typed options would not allow.
      </p>

      <h2 className={heading}>Valid calls</h2>
      <div className={calls}>
        <Call title="List users" request="GET /api/users?limit=5" outcome={list}>
          {list.data?.items.length ? (
            <div className={picker}>
              Act on:
              {list.data.items.map((user) => (
                <Button
                  key={user.id}
                  size="sm"
                  variant={user.id === selectedId ? "default" : "outline"}
                  aria-pressed={user.id === selectedId}
                  onClick={() => setSelectedId(user.id)}
                >
                  {user.name}
                </Button>
              ))}
            </div>
          ) : null}
        </Call>

        <Call
          title="Create a user"
          request="POST /api/users"
          outcome={create}
          action={
            <RunButton
              pending={create.isPending}
              onRun={() =>
                create.mutate(
                  {
                    email: `user-${String(Date.now())}@example.com`,
                    name: `User ${timestamp()}`,
                    password: "password",
                  },
                  { onSuccess: (user) => setSelectedId(user.id) },
                )
              }
            />
          }
        />

        {selectedId ? (
          <SelectedUser key={selectedId} id={selectedId} />
        ) : (
          <p className={hint}>Create a user or pick one from the list to run the calls that need an id.</p>
        )}
      </div>

      <h2 className={heading}>Invalid calls</h2>
      <div className={calls}>
        {invalidCalls.map((call) => (
          <InvalidCall key={call.title} {...call} />
        ))}
      </div>
    </main>
  );
}

function SelectedUser({ id }: { id: string }) {
  const [selectedItemId, setSelectedItemId] = useState<string>();
  const detail = useQuery(userQueries.detail(id));
  const rename = useMutation(userMutations.update());
  const settings = useQuery(settingsQueries.detail());
  const updateSettings = useMutation(settingsMutations.update());
  const items = useQuery(itemQueries.list({ limit: 5 }));
  const createItem = useMutation(itemMutations.create());
  const remove = useMutation(userMutations.delete());

  return (
    <>
      <Call title="Get the selected user" request={`GET /api/users/${id}`} outcome={detail} />
      <Call
        title="Rename them"
        request={`PATCH /api/users/${id}`}
        outcome={rename}
        action={
          <RunButton
            pending={rename.isPending}
            onRun={() => rename.mutate({ id, body: { name: `Renamed ${timestamp()}` } })}
          />
        }
      />
      <Call title="Get your settings" request="GET /api/settings" outcome={settings} />
      <Call
        title="Switch your theme"
        request="PATCH /api/settings"
        outcome={updateSettings}
        action={
          <RunButton
            pending={updateSettings.isPending}
            onRun={() => updateSettings.mutate({ theme: settings.data?.theme === "dark" ? "light" : "dark" })}
          />
        }
      />
      <Call title="List your items" request="GET /api/items?limit=5" outcome={items}>
        {items.data?.items.length ? (
          <div className={picker}>
            Act on:
            {items.data.items.map((item) => (
              <Button
                key={item.id}
                size="sm"
                variant={item.id === selectedItemId ? "default" : "outline"}
                aria-pressed={item.id === selectedItemId}
                onClick={() => setSelectedItemId(item.id)}
              >
                {item.name}
              </Button>
            ))}
          </div>
        ) : null}
      </Call>
      <Call
        title="Create an item"
        request="POST /api/items"
        outcome={createItem}
        action={
          <RunButton
            pending={createItem.isPending}
            onRun={() =>
              createItem.mutate(
                { name: `Item ${timestamp()}`, description: "Created from the playground" },
                { onSuccess: (item) => setSelectedItemId(item.id) },
              )
            }
          />
        }
      />
      {selectedItemId ? <SelectedItem key={selectedItemId} id={selectedItemId} /> : null}
      <Call
        title="Delete the user, with their settings and items"
        request={`DELETE /api/users/${id}`}
        outcome={remove}
        action={<RunButton pending={remove.isPending} onRun={() => remove.mutate(id)} />}
      />
    </>
  );
}

function SelectedItem({ id }: { id: string }) {
  const detail = useQuery(itemQueries.detail(id));
  const update = useMutation(itemMutations.update());
  const remove = useMutation(itemMutations.delete());

  return (
    <>
      <Call title="Get the selected item" request={`GET /api/items/${id}`} outcome={detail} />
      <Call
        title="Rename it"
        request={`PATCH /api/items/${id}`}
        outcome={update}
        action={
          <RunButton
            pending={update.isPending}
            onRun={() => update.mutate({ id, body: { name: `Renamed ${timestamp()}` } })}
          />
        }
      />
      <Call
        title="Delete it"
        request={`DELETE /api/items/${id}`}
        outcome={remove}
        action={<RunButton pending={remove.isPending} onRun={() => remove.mutate(id)} />}
      />
    </>
  );
}

const missingId = "0199a6b4-7c1e-7d2a-9f3b-2c4d5e6f7a8b";

type InvalidCallProps = {
  title: string;
  expected: string;
  config: AxiosRequestConfig & { method: string; url: string };
};

const invalidCalls: InvalidCallProps[] = [
  {
    title: "Invalid body",
    expected: "400 VALIDATION_FAILED with errors for email, name and password",
    config: { method: "POST", url: "/users", data: { email: "not-an-email", name: 42 } },
  },
  {
    title: "Unknown key",
    expected: "400 VALIDATION_FAILED naming the key (and the missing name)",
    config: {
      method: "POST",
      url: "/users",
      data: { email: "ada@example.com", nmae: "Ada", password: "password" },
    },
  },
  {
    title: "Malformed JSON",
    expected: "400 BAD_REQUEST",
    // Sent as is: axios would otherwise turn the invalid JSON text into a valid JSON string.
    config: {
      method: "POST",
      url: "/users",
      data: '{"name":',
      headers: { "Content-Type": "application/json" },
      transformRequest: (data: unknown) => data,
    },
  },
  {
    title: "Id that is not a UUID",
    expected: "400 VALIDATION_FAILED with an error for id",
    config: { method: "GET", url: "/users/not-a-uuid" },
  },
  {
    title: "Limit above 100",
    expected: "400 VALIDATION_FAILED with an error for limit",
    config: { method: "GET", url: "/items?limit=1000" },
  },
  {
    title: "Unknown theme",
    expected: "400 VALIDATION_FAILED with an error for theme",
    config: { method: "PATCH", url: "/settings", data: { theme: "sepia" } },
  },
  {
    title: "Missing user",
    expected: "404 NOT_FOUND",
    config: { method: "GET", url: `/users/${missingId}` },
  },
  {
    title: "Item with an owner",
    expected: "400 VALIDATION_FAILED: the owner is whoever asks",
    config: { method: "POST", url: "/items", data: { userId: missingId, name: "Orphan" } },
  },
  {
    title: "Delete a missing item",
    expected: "404 NOT_FOUND",
    config: { method: "DELETE", url: `/items/${missingId}` },
  },
  {
    title: "Unknown route",
    expected: "404 NOT_FOUND",
    config: { method: "GET", url: "/does-not-exist" },
  },
];

function InvalidCall({ title, expected, config }: InvalidCallProps) {
  const call = useMutation({ mutationFn: async () => (await api.request<unknown>(config)).data });
  const body = typeof config.data === "string" ? config.data : JSON.stringify(config.data);

  return (
    <Call
      title={title}
      request={`${config.method} /api${config.url}${config.data === undefined ? "" : ` ${body}`}`}
      outcome={call}
      action={<RunButton pending={call.isPending} onRun={() => call.mutate()} />}
    >
      <p className={hint}>Expected: {expected}</p>
    </Call>
  );
}

type Outcome = {
  status: "idle" | "pending" | "success" | "error";
  data: unknown;
  error: Error | null;
};

type CallProps = {
  title: string;
  request: string;
  outcome: Outcome;
  action?: ReactNode;
  children?: ReactNode;
};

function Call({ title, request, outcome, action, children }: CallProps) {
  return (
    <section className="flex min-w-0 flex-col gap-2 rounded-lg border p-4">
      <header className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        {action}
      </header>
      <code className={cn(code, "text-xs break-all")}>{request}</code>
      {children}
      <OutcomeView {...outcome} />
    </section>
  );
}

function OutcomeView({ status, data, error }: Outcome) {
  if (status === "idle") return <p className={hint}>Not run yet.</p>;
  if (status === "pending") return <p className={hint}>Waiting for the response…</p>;
  if (error) return <pre className={cn(outcome, "border-l-3 border-destructive")}>{describeError(error)}</pre>;
  return <pre className={outcome}>{data === undefined ? "(empty body)" : JSON.stringify(data, null, 2)}</pre>;
}

function describeError(error: Error): string {
  if (!(error instanceof ApiError)) return `${error.name}: ${error.message}`;
  const body = error.body ? JSON.stringify(error.body, null, 2) : error.message;
  return `HTTP ${String(error.status)}\n${body}`;
}

function RunButton({ pending, onRun }: { pending: boolean; onRun: () => void }) {
  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={onRun}>
      Run
    </Button>
  );
}

const heading = "mt-8 mb-3 text-2xl font-semibold tracking-tight";
const calls = "grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4";
const picker = "flex flex-wrap items-center gap-1.5 text-sm";
const hint = "text-sm text-muted-foreground";
const code = "rounded bg-muted px-1.5 py-0.5 font-mono text-sm";
const outcome = "max-h-80 overflow-auto rounded bg-muted p-3 font-mono text-xs";

function timestamp(): string {
  return new Date().toLocaleTimeString();
}
