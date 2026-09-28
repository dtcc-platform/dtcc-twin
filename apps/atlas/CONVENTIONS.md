# Atlas conventions

## Rules

### React

- Every Effect must be justified under [You Might Not Need an Effect](https://react.dev/learn/you-might-not-need-an-effect). Derive values during render and react to events in their handlers
- Server data lives in TanStack Query only. Never copy it into `useState` or a store. Only do it for valid exceptions (use it as default state in an edit form).
- Component state first. A Zustand store only when several components share client state, created per instance and handed down through context rather than as a global singleton, with its actions grouped under `actions`. See `src/features/counter/`.

### API

- Every file directly in `src/api/` is a backend module, named after it; the client they build on lives in `src/api/client/`.
- A module file exports `<module>Queries` and `<module>Mutations`: factories of `queryOptions` and `mutationOptions`, typed with contract types, passing `signal` on to axios.
- Query keys start from the module's `all` key: `[...all, "list", query]`, `[...all, "detail", id]`. A mutation invalidates `{ queryKey: all }`.
- Components use the factories as they are, `useQuery(itemQueries.list(…))`, and pass per-call callbacks to `mutate`.

### Routing

- Pages that need a login go under `src/routes/_authenticated/`.
- Redirect in `beforeLoad`, never by rendering `<Navigate>`. A page for one role checks `context.user.role` there.
- Pages for development, not for users, go under `src/routes/_authenticated/dev/`, admin-only.
- State that should survive a reload or the back button (page, filters) goes in the URL through `validateSearch`.
- The router's `defaultNotFoundComponent` and `defaultErrorComponent` in `main.tsx` cover every route; a route with something better to say sets its own `notFoundComponent` or `errorComponent`.

### Forms

- `react-hook-form` with `zodResolver(<contract request schema>)`, so the form validates exactly what the API will.
- Submit through a mutation, and hand failures to `showSubmitError`: validation issues land under their fields, anything else under the form.

### Code

- Import through `@/` from outside the current feature folder; relative imports only for files next to each other.
- Style with Tailwind utilities; merge a `className` prop with `cn()` from `@/lib/utils`.

## Recipes

### Add a page

1. Create `src/routes/<path>.tsx`, or `src/routes/_authenticated/<path>.tsx` if it needs a login. The Vite plugin regenerates `routeTree.gen.ts` on the next dev start or build; commit it.
2. Declare search params with `validateSearch` (see `_authenticated/items.tsx`).
3. Link it from `src/components/layout/site-header.tsx` if it belongs in the navigation.

### Call a new endpoint

1. Add a query or mutation factory to `src/api/<module>.ts`, creating the file after `src/api/items.ts` for a new module.
2. Key it under the module's `all` key; make its mutation invalidate `all`.
3. Use it in a component with `useQuery` or `useMutation`.

### Add a form

1. `useForm({ resolver: zodResolver(<contract body schema>), defaultValues })`.
2. On submit, `mutation.mutate(values, { onError: (error) => showSubmitError(form.setError, error) })`.
3. Render fields with `TextField`. `src/features/auth/login-form.tsx` shows the whole pattern.
