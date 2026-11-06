import { zodResolver } from "@hookform/resolvers/zod";
import { chatMessageBodySchema, type ChatMessageBody } from "@repo/contracts";
import { SendHorizontalIcon } from "lucide-react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { FieldError } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { areaBounds, areaSquareMetres, formatSquareMetres } from "@/features/area/area";
import { useAreaStore } from "@/features/area/area-store";
import { showSubmitError } from "@/lib/show-submit-error";

// The text is typed; the bounds come from the area drawn on the map when the message is sent.
const textSchema = chatMessageBodySchema.pick({ text: true });

type ComposerProps = {
  /** While a turn runs, the chat takes no new message. */
  disabled: boolean;
  onSend: (body: ChatMessageBody, onError: (error: Error) => void) => void;
};

/** The box to write to the assistant in, sending the drawn area along with each message. */
export function Composer({ disabled, onSend }: ComposerProps) {
  const area = useAreaStore((state) => state.area);
  const form = useForm({ resolver: zodResolver(textSchema), defaultValues: { text: "" } });

  function submit({ text }: { text: string }) {
    form.reset({ text: "" });
    onSend({ text, bounds: area ? areaBounds(area) : null }, (error) => {
      // Back in the box, so nothing typed is lost.
      form.reset({ text });
      showSubmitError(form.setError, error);
    });
  }

  return (
    <form
      // Stays in view at the bottom of the card while the conversation scrolls above it.
      className="sticky bottom-0 flex flex-col gap-2 bg-card pt-2"
      onSubmit={(event) => void form.handleSubmit(submit)(event)}
      noValidate
    >
      <Textarea
        {...form.register("text")}
        aria-label="Message"
        placeholder="Ask about the area"
        rows={2}
        maxLength={4000}
        disabled={disabled}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.shiftKey) return;
          event.preventDefault();
          void form.handleSubmit(submit)();
        }}
      />
      <FieldError errors={[form.formState.errors.text, form.formState.errors.root]} />
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs text-muted-foreground">
          {area ? `Area: ${formatSquareMetres(areaSquareMetres(area))}` : "No area drawn"}
        </p>
        <Button type="submit" size="sm" disabled={disabled}>
          <SendHorizontalIcon />
          Send
        </Button>
      </div>
    </form>
  );
}
