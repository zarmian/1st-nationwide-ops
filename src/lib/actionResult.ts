/**
 * Canonical server-action return shape.
 *
 * Two shapes coexist in this codebase:
 *   - useFormState-style: `{ error?, fieldErrors? }` — react-dom needs the
 *     shape it knows. Don't change these; that's the framework boundary.
 *   - everything else: ActionResult<T> below.
 *
 * Use the helpers (ok / fail / fieldFail) so the discriminant is consistent
 * across every action. Components can pattern-match cleanly on `result.ok`.
 */

export type ActionOk<T> = { ok: true; data: T };
export type ActionFail = {
  ok: false;
  error: string;
  fieldErrors?: Record<string, string[]>;
};

export type ActionResult<T = void> = ActionOk<T> | ActionFail;

export function ok<T>(data: T): ActionOk<T> {
  return { ok: true, data };
}

export function okVoid(): ActionOk<void> {
  return { ok: true, data: undefined };
}

export function fail(error: string): ActionFail {
  return { ok: false, error };
}

export function fieldFail(
  error: string,
  fieldErrors: Record<string, string[]>,
): ActionFail {
  return { ok: false, error, fieldErrors };
}
