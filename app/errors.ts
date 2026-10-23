import { ConvexError } from "convex/values";

/** Server rule violations arrive as ConvexError with a friendly message. */
export function errorText(err: unknown): string {
  return err instanceof ConvexError ? String(err.data) : "Something went wrong. Please try again.";
}
