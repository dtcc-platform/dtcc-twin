import { zodResolver } from "@hookform/resolvers/zod";
import { loginBodySchema, type LoginBody } from "@repo/contracts";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { authMutations } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { FieldError, FieldGroup } from "@/components/ui/field";
import { showSubmitError } from "./show-submit-error.ts";
import { TextField } from "./text-field.tsx";

export function LoginForm({ onLoggedIn }: { onLoggedIn: () => void }) {
  const login = useMutation(authMutations.login());
  const form = useForm({ resolver: zodResolver(loginBodySchema), defaultValues: { email: "", password: "" } });

  function submit(values: LoginBody) {
    login.mutate(values, { onSuccess: onLoggedIn, onError: (error) => showSubmitError(form.setError, error) });
  }

  return (
    <form onSubmit={(event) => void form.handleSubmit(submit)(event)} noValidate>
      <FieldGroup>
        <TextField control={form.control} name="email" label="Email" type="email" autoComplete="email" />
        <TextField
          control={form.control}
          name="password"
          label="Password"
          type="password"
          autoComplete="current-password"
        />
        <FieldError errors={[form.formState.errors.root]} />
        <Button type="submit" disabled={login.isPending}>
          Log in
        </Button>
      </FieldGroup>
    </form>
  );
}
