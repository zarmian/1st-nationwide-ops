"use client";

import { useTransition } from "react";
import { useToast } from "@/components/Toast";
import { skipFastFieldPlace, stopSkippingFastFieldPlace } from "../_actions";

const reports = (n: number) => `${n} report${n === 1 ? "" : "s"}`;

// The actions revalidate the page, so Next sends it back re-rendered with
// their result: no router.refresh() (that would render the page twice).

/** Set aside every waiting report typed as this place, and new ones typed the
 *  same way as they arrive. */
export function SkipPlaceButton({ placeKey, label, count }: { placeKey: string; label: string; count: number }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-secondary"
      disabled={pending}
      aria-label={`Skip reports typed “${label}”`}
      onClick={() => {
        if (
          !window.confirm(
            `Set aside the ${reports(count)} waiting for “${label}”, and new ones typed the same way?\n\n` +
              "They stay in the app, so you can bring them back under “Skipped places”.",
          )
        ) {
          return;
        }
        start(async () => {
          try {
            const res = await skipFastFieldPlace(placeKey);
            if (!res.ok) {
              toast.show({ tone: "error", message: res.error });
              return;
            }
            toast.show({
              tone: "success",
              message: `“${res.data.label}” skipped: ${reports(res.data.setAside)} set aside.`,
            });
          } catch {
            toast.show({
              tone: "error",
              message: `Couldn't skip “${label}”. Refresh the page and try again.`,
            });
          }
        });
      }}
    >
      {pending ? "Skipping…" : "Skip"}
    </button>
  );
}

/** Stop skipping a place: the reports it set aside go back to Needs linking. */
export function StopSkippingButton({ skipId, label, count }: { skipId: string; label: string; count: number }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-ghost"
      disabled={pending}
      aria-label={`Stop skipping “${label}”`}
      onClick={() => {
        if (
          !window.confirm(
            `Stop skipping “${label}”? Its ${reports(count)} set aside go back to Needs linking, ` +
              "and new ones typed the same way will wait to be linked again.",
          )
        ) {
          return;
        }
        start(async () => {
          try {
            const res = await stopSkippingFastFieldPlace(skipId);
            if (!res.ok) {
              toast.show({ tone: "error", message: res.error });
              return;
            }
            const { broughtBack, waitForYou } = res.data;
            toast.show({
              tone: "success",
              message:
                `“${res.data.label}” is no longer skipped: ${reports(broughtBack)} back in Needs linking.` +
                (waitForYou > 0
                  ? ` ${waitForYou} of them ${waitForYou === 1 ? "was" : "were"} taken off a shift by a person, so the robot leaves ${waitForYou === 1 ? "it" : "them"} for you.`
                  : ""),
            });
          } catch {
            toast.show({
              tone: "error",
              message: `Couldn't stop skipping “${label}”. Refresh the page and try again.`,
            });
          }
        });
      }}
    >
      {pending ? "Bringing back…" : "Stop skipping"}
    </button>
  );
}
