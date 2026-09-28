import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// twMerge lets a className prop override a component's own utilities (px-8 beats px-4) regardless of CSS order.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
