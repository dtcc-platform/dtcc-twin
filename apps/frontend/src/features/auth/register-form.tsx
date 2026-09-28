import { zodResolver } from "@hookform/resolvers/zod";
import { registerBodySchema, type RegisterBody } from "@repo/contracts";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { ApiError } from "@/api/client/api-error";
import { authMutations } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldError, FieldGroup } from "@/components/ui/field";
import { showSubmitError } from "./show-submit-error.ts";
import { TextField } from "./text-field.tsx";

/** Registering logs the new user in. */
export function RegisterForm({ onRegistered }: { onRegistered: () => void }) {
  const register = useMutation(authMutations.register());
  const form = useForm({
    resolver: zodResolver(registerBodySchema),
    defaultValues: { name: "", email: "", password: "" },
  });

  function submit(values: RegisterBody) {
    register.mutate(values, {
      onSuccess: onRegistered,
      onError: (error) => {
        // The only conflict a new account can hit is its email.
        if (error instanceof ApiError && error.status === 409) {
          form.setError("email", { message: "An account with this email already exists" });
          return;
        }
        showSubmitError(form.setError, error);
      },
    });
  }

  return (
    <form onSubmit={(event) => void form.handleSubmit(submit)(event)} noValidate>
      <FieldGroup>
        <TextField control={form.control} name="name" label="Name" autoComplete="name" />
        <TextField control={form.control} name="email" label="Email" type="email" autoComplete="email" />
        <TextField
          control={form.control}
          name="password"
          label="Password"
          type="password"
          autoComplete="new-password"
        />
        <FieldDescription>At least 8 characters.</FieldDescription>
        <FieldError errors={[form.formState.errors.root]} />
        <Button type="submit" disabled={register.isPending}>
          Create account
        </Button>
      </FieldGroup>
    </form>
  );
}
