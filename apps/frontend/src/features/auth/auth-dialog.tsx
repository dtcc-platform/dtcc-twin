import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AuthMode } from "./auth-search";
import { LoginForm } from "./login-form";
import { RegisterForm } from "./register-form";

const views = {
  login: {
    title: "Log in",
    description: "With your email and password.",
    prompt: "No account yet?",
    other: { mode: "register", label: "Register" },
  },
  register: {
    title: "Create an account",
    description: "You are logged in straight away. An admin approves new accounts.",
    prompt: "Already have an account?",
    other: { mode: "login", label: "Log in" },
  },
} as const;

type AuthDialogProps = {
  /** Open on this view; closed when undefined. */
  mode: AuthMode | undefined;
  onModeChange: (mode: AuthMode) => void;
  onClose: () => void;
  onDone: () => void;
};

/** Login and registration in one dialog, switching between them in place. */
export function AuthDialog({ mode, onModeChange, onClose, onDone }: AuthDialogProps) {
  // Keeps the last view while the dialog animates closed, instead of jumping back to login.
  const [shown, setShown] = useState<AuthMode>(mode ?? "login");
  if (mode && mode !== shown) setShown(mode);
  const view = views[shown];

  return (
    <Dialog
      open={mode !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{view.title}</DialogTitle>
          <DialogDescription>{view.description}</DialogDescription>
        </DialogHeader>
        {shown === "login" ? <LoginForm onLoggedIn={onDone} /> : <RegisterForm onRegistered={onDone} />}
        <p className="text-sm text-muted-foreground">
          {view.prompt}{" "}
          <button
            type="button"
            className="text-foreground underline underline-offset-4"
            onClick={() => onModeChange(view.other.mode)}
          >
            {view.other.label}
          </button>
        </p>
      </DialogContent>
    </Dialog>
  );
}
