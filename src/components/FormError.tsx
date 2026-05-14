/**
 * Shared error banner for forms. Single visual treatment so every server
 * action surfaces failures the same way — top-of-form, red, with the
 * message inline. Field-level errors stay inline next to their inputs;
 * this is for action-level errors only.
 */
export function FormError({
  message,
  className,
}: {
  message?: string | null;
  className?: string;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className={
        "rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 " +
        (className ?? "")
      }
    >
      {message}
    </div>
  );
}

/**
 * Inline field error. Use under inputs to surface validation failures
 * from a server action's fieldErrors map.
 */
export function FieldError({
  messages,
  className,
}: {
  messages?: string[];
  className?: string;
}) {
  if (!messages?.length) return null;
  return (
    <p className={"mt-1 text-xs text-red-600 " + (className ?? "")}>
      {messages.join(", ")}
    </p>
  );
}
