import { zodResolver } from "@hookform/resolvers/zod";
import { createApiKeyBodySchema, type CreateApiKeyBody } from "@repo/contracts";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { keyMutations } from "@/api/keys";
import { TextField } from "@/components/common/text-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldError, FieldGroup } from "@/components/ui/field";
import { showSubmitError } from "@/lib/show-submit-error";

const defaultValues = { name: "", description: "" };

export function NewKeyDialog({ disabled }: { disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const create = useMutation(keyMutations.create());
  const form = useForm({ resolver: zodResolver(createApiKeyBodySchema), defaultValues });

  function submit({ name, description }: CreateApiKeyBody) {
    create.mutate(
      { name, description: description === "" ? null : description },
      { onError: (error) => showSubmitError(form.setError, error) },
    );
  }

  function changeOpen(next: boolean) {
    setOpen(next);
    if (!next) {
      create.reset();
      form.reset(defaultValues);
    }
  }

  function copy(key: string) {
    navigator.clipboard.writeText(key).then(
      () => toast.success("Copied to the clipboard."),
      () => toast.error("Couldn't copy. Select the key and copy it yourself."),
    );
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger render={<Button disabled={disabled} />}>New key</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        {create.data ? (
          <>
            <DialogHeader>
              <DialogTitle>{create.data.name}</DialogTitle>
              <DialogDescription>Copy this key now. It is not shown again.</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 rounded-md border bg-muted px-3 py-2 font-mono text-xs break-all select-all">
                {create.data.key}
              </code>
              <Button variant="outline" onClick={() => copy(create.data.key)}>
                Copy
              </Button>
            </div>
            <DialogFooter>
              <Button onClick={() => changeOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={(event) => void form.handleSubmit(submit)(event)} noValidate>
            <FieldGroup>
              <DialogHeader>
                <DialogTitle>New API key</DialogTitle>
              </DialogHeader>
              <TextField control={form.control} name="name" label="Name" autoComplete="off" />
              <TextField control={form.control} name="description" label="Description (optional)" autoComplete="off" />
              <FieldError errors={[form.formState.errors.root]} />
              <Button type="submit" disabled={create.isPending}>
                Create key
              </Button>
            </FieldGroup>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
