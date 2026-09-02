"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { useToast } from "@/components/Toast";
import { formatDate } from "@/lib/dates";
import { addCertificationAction, deleteCertificationAction } from "../_actions";

export type CertView = {
  id: string;
  name: string;
  expiresOn: string | null; // ISO
  reference: string | null;
};

/** Manage an officer's training certificates (First Aid, CCTV/PSS, etc.). */
export function CertificationsEditor({
  officerId,
  certs,
}: {
  officerId: string;
  certs: CertView[];
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();

  const [name, setName] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [reference, setReference] = useState("");

  function add() {
    if (!name.trim()) {
      toast.show({ tone: "error", message: "Give the certificate a name." });
      return;
    }
    start(async () => {
      const res = await addCertificationAction(officerId, {
        name,
        expiresOn: expiresOn || null,
        reference,
      });
      if (res.ok) {
        toast.show({ tone: "success", message: "Certificate added." });
        setName("");
        setExpiresOn("");
        setReference("");
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't save." });
      }
    });
  }

  function remove(id: string) {
    start(async () => {
      const res = await deleteCertificationAction(id, officerId);
      if (res.ok) {
        toast.show({ tone: "success", message: "Certificate removed." });
        router.refresh();
      } else {
        toast.show({ tone: "error", message: res.error ?? "Couldn't delete." });
      }
    });
  }

  const expired = (iso: string | null) =>
    iso ? new Date(iso).getTime() < Date.now() : false;

  return (
    <div className="card p-4 space-y-3">
      <h3 className="text-xs uppercase tracking-wider text-slate-500">
        Training certificates
      </h3>

      {certs.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {certs.map((c) => (
            <li key={c.id} className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-brand-navy">{c.name}</div>
                <div className="text-xs text-slate-500">
                  {c.expiresOn ? (
                    <span className={expired(c.expiresOn) ? "text-red-600" : ""}>
                      {expired(c.expiresOn) ? "Expired " : "Expires "}
                      {formatDate(c.expiresOn)}
                    </span>
                  ) : (
                    "No expiry"
                  )}
                  {c.reference ? ` · ${c.reference}` : ""}
                </div>
              </div>
              <button
                type="button"
                onClick={() => remove(c.id)}
                disabled={pending}
                aria-label="Remove certificate"
                className="text-slate-400 hover:text-red-600 p-1 shrink-0"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 border-t border-slate-100 pt-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="input"
          placeholder="e.g. First Aid at Work"
          aria-label="Certificate name"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            type="date"
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
            className="input"
            aria-label="Expiry date"
          />
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="input"
            placeholder="Ref (optional)"
            aria-label="Reference"
          />
        </div>
        <button
          type="button"
          onClick={add}
          disabled={pending}
          className="btn-secondary text-sm w-full"
        >
          {pending ? "Saving…" : "Add certificate"}
        </button>
      </div>
    </div>
  );
}
