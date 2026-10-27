import { createFileRoute } from "@tanstack/react-router";
import { ApiPlayground } from "@/features/dev/api-playground";

export const Route = createFileRoute("/_authenticated/admin/dev")({ component: ApiPlayground });
