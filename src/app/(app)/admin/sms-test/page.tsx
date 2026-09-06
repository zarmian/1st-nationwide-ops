import { requireAdmin } from "@/lib/authz";
import { isSmsConfigured } from "@/lib/sms";
import { PageHeader } from "@/components/PageHeader";
import { TestSmsForm } from "./_components/TestSmsForm";

export const dynamic = "force-dynamic";

export default async function SmsTestPage() {
  await requireAdmin();

  const configured = isSmsConfigured();
  const fromNumber = process.env.HTTPSMS_FROM ?? null;

  return (
    <div className="space-y-4">
      <PageHeader
        title="Test SMS"
        backHref="/admin"
        backLabel="Admin"
        subtitle="Send a one-off text through the httpsms gateway to check it's working. This goes out immediately — it doesn't wait for the queue."
      />

      <div
        className={
          "rounded-xl border px-4 py-3 text-sm " +
          (configured
            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : "border-amber-200 bg-amber-50 text-amber-900")
        }
      >
        {configured ? (
          <>
            <span className="font-medium">Gateway configured.</span> Texts send
            from{" "}
            <code className="text-xs bg-emerald-100 px-1 rounded">
              {fromNumber}
            </code>
            . Make sure the gateway phone is switched on, has signal, and the
            httpsms app is running.
          </>
        ) : (
          <>
            <span className="font-medium">Gateway not configured.</span> Set{" "}
            <code className="text-xs bg-amber-100 px-1 rounded">
              HTTPSMS_API_KEY
            </code>{" "}
            and{" "}
            <code className="text-xs bg-amber-100 px-1 rounded">
              HTTPSMS_FROM
            </code>{" "}
            in Vercel (Project → Settings → Environment Variables), then
            redeploy. You can still try below — it'll tell you what's missing.
          </>
        )}
      </div>

      <TestSmsForm configured={configured} />

      <div className="card p-5 max-w-xl text-sm text-slate-600 space-y-2">
        <h2 className="font-semibold text-brand-navy">How and when SMS sends</h2>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>
            <span className="font-medium text-slate-700">This test page</span>{" "}
            sends straight away, so it's the quickest way to prove the gateway
            works.
          </li>
          <li>
            <span className="font-medium text-slate-700">Real alerts</span>{" "}
            (shift &amp; job reminders, no-show and missed-call alerts, pay
            summaries) are added to a queue, and a background job sends them{" "}
            <span className="font-medium">once a minute</span> — so allow up to a
            minute after the event.
          </li>
          <li>
            Every text needs the gateway phone <span className="font-medium">
            on and online</span>. If it's off, texts wait in the queue and send
            when it's back.
          </li>
          <li>
            You can see every queued and sent message, and retry failures, on
            the Notifications page.
          </li>
        </ul>
      </div>
    </div>
  );
}
