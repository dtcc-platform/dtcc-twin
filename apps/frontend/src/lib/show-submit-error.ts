import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import { ApiError } from "@/api/client/api-error";

/**
 * Validation issues go under their fields (the API and the form share the contract's field names);
 * anything else goes above the submit button.
 */
export function showSubmitError<TValues extends FieldValues>(setError: UseFormSetError<TValues>, error: Error): void {
  if (error instanceof ApiError && error.body?.code === "VALIDATION_FAILED") {
    for (const issue of error.body.errors ?? []) {
      setError(issue.path as Path<TValues>, { message: issue.message });
    }
    return;
  }

  setError("root", { message: error.message });
}
