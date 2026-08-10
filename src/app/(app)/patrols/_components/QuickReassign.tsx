"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function QuickReassignSchedule({
  scheduleId,
  currentOfficerId,
  officers,
  reassign,
}: {
  scheduleId: string;
  currentOfficerId: string | null;
  officers: { id: string; name: string }[];
  reassign: (
    formData: FormData,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const fd = new FormData();
    fd.set("scheduleId", scheduleId);
    fd.set("officerId", e.target.value);
    startTransition(async () => {
      await reassign(fd);
      router.refresh();
    });
  }

  return (
    <select
      aria-label="Reassign officer"
      defaultValue={currentOfficerId ?? ""}
      onChange={onChange}
      disabled={pending}
      className="input md:text-xs py-1"
    >
      <option value="">— Unassigned —</option>
      {officers.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

export function QuickReassignVisit({
  visitId,
  currentOfficerId,
  officers,
  reassign,
}: {
  visitId: string;
  currentOfficerId: string | null;
  officers: { id: string; name: string }[];
  reassign: (
    formData: FormData,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const fd = new FormData();
    fd.set("visitId", visitId);
    fd.set("officerId", e.target.value);
    startTransition(async () => {
      await reassign(fd);
      router.refresh();
    });
  }

  return (
    <select
      aria-label="Reassign officer"
      defaultValue={currentOfficerId ?? ""}
      onChange={onChange}
      disabled={pending}
      className="input md:text-xs py-1"
    >
      <option value="">— Unassigned —</option>
      {officers.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

export function QuickReassignLockUnlockSchedule({
  scheduleId,
  currentOfficerId,
  officers,
  reassign,
}: {
  scheduleId: string;
  currentOfficerId: string | null;
  officers: { id: string; name: string }[];
  reassign: (
    formData: FormData,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const fd = new FormData();
    fd.set("scheduleId", scheduleId);
    fd.set("officerId", e.target.value);
    startTransition(async () => {
      await reassign(fd);
      router.refresh();
    });
  }

  return (
    <select
      aria-label="Reassign officer"
      defaultValue={currentOfficerId ?? ""}
      onChange={onChange}
      disabled={pending}
      className="input md:text-xs py-1"
    >
      <option value="">— Unassigned —</option>
      {officers.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

export function QuickReassignJob({
  jobId,
  currentOfficerId,
  officers,
  reassign,
}: {
  jobId: string;
  currentOfficerId: string | null;
  officers: { id: string; name: string }[];
  reassign: (
    formData: FormData,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const fd = new FormData();
    fd.set("jobId", jobId);
    fd.set("officerId", e.target.value);
    startTransition(async () => {
      await reassign(fd);
      router.refresh();
    });
  }

  return (
    <select
      aria-label="Reassign officer"
      defaultValue={currentOfficerId ?? ""}
      onChange={onChange}
      disabled={pending}
      className="input md:text-xs py-1"
    >
      <option value="">— Unassigned —</option>
      {officers.map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

export function ToggleActive({
  scheduleId,
  active,
  toggle,
}: {
  scheduleId: string;
  active: boolean;
  toggle: (id: string, active: boolean) => Promise<{ ok: boolean }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function onClick() {
    startTransition(async () => {
      await toggle(scheduleId, !active);
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={
        active
          ? "chip-mint text-[10px] cursor-pointer"
          : "chip-slate text-[10px] cursor-pointer"
      }
    >
      {active ? "Active" : "Paused"}
    </button>
  );
}
