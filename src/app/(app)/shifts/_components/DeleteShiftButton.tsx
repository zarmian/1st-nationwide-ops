"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteShift } from "../_actions";

export function DeleteShiftButton({ shiftId }: { shiftId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (
      !window.confirm(
        "Delete this shift? Check-in submissions stay in the system but will no longer be linked to a shift.",
      )
    ) {
      return;
    }
    startTransition(async () => {
      const res = await deleteShift(shiftId);
      if (res.ok) router.push("/shifts");
      else window.alert(res.error ?? "Couldn't delete.");
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="btn-secondary text-red-600 border-red-200 hover:bg-red-50"
    >
      {pending ? "Deleting…" : "Delete shift"}
    </button>
  );
}
