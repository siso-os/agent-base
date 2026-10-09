import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Join class names; the last conflicting Tailwind utility wins. */
export const cn = (...v: ClassValue[]) => twMerge(clsx(v));
