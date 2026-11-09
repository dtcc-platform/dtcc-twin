import { zodResolver } from "@hookform/resolvers/zod";
import { askBodySchema, defaultAgentMaxAreaKm2, type AreaBox } from "@repo/contracts";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { TextField } from "@/components/common/text-field";
import { Button } from "@/components/ui/button";
import { areaSquareMetres, formatSquareMetres } from "@/features/area/area";

export function Composer({
  answering,
  area,
  onSend,
}: {
  answering: boolean;
  area: AreaBox | null;
  onSend: (text: string) => Promise<void>;
}) {
  const form = useForm({ resolver: zodResolver(askBodySchema.pick({ text: true })), defaultValues: { text: "" } });
  const [sending, setSending] = useState(false);
  const size = area ? areaSquareMetres(area) : null;
  async function send({ text }: { text: string }) {
    if (answering || sending) return;
    setSending(true);
    form.reset({ text: "" });
    try {
      await onSend(text);
    } catch (error) {
      form.setValue("text", text);
      form.setError("root", { message: error instanceof Error ? error.message : "The question could not be sent." });
    } finally {
      setSending(false);
    }
  }
  return (
    <form
      onSubmit={(event) => void form.handleSubmit(send)(event)}
      className="mt-4 flex flex-col gap-3 border-t pt-3"
      noValidate
    >
      <p className="text-xs text-muted-foreground">
        {size === null ? "No area drawn" : `Current area · ${formatSquareMetres(size)}`}
      </p>
      {size !== null && size > defaultAgentMaxAreaKm2 * 1_000_000 && (
        <p role="alert" className="text-sm text-destructive">
          This area exceeds the default {defaultAgentMaxAreaKm2} km² limit.
        </p>
      )}
      <TextField control={form.control} name="text" label="Question" id="agent-question" />
      {form.formState.errors.root?.message && (
        <p role="alert" className="text-sm text-destructive">
          {form.formState.errors.root.message}
        </p>
      )}
      <Button type="submit" disabled={answering || sending}>
        Send
      </Button>
    </form>
  );
}
