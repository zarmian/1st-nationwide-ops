import { requireAdmin } from "@/lib/authz";
import { PageHeader } from "@/components/PageHeader";
import { getAllNotificationRoutings } from "@/lib/notificationSettings";
import { isSmsConfigured } from "@/lib/sms";
import { isWhatsAppConfigured } from "@/lib/whatsapp";
import { isTelegramConfigured } from "@/lib/telegram";
import { RoutingForm, type RoutingItem } from "./_components/RoutingForm";
import { ResetButton } from "./_components/ResetButton";

export const dynamic = "force-dynamic";

export default async function NotificationSettingsPage() {
  await requireAdmin();

  const all = await getAllNotificationRoutings();

  // Group in first-appearance order.
  const groups: { name: string; items: RoutingItem[] }[] = [];
  for (const item of all) {
    let g = groups.find((x) => x.name === item.meta.group);
    if (!g) {
      g = { name: item.meta.group, items: [] };
      groups.push(g);
    }
    g.items.push(item);
  }

  const channels = [
    { label: "Telegram", on: isTelegramConfigured() },
    { label: "SMS", on: isSmsConfigured() },
    { label: "WhatsApp", on: isWhatsAppConfigured() },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Who gets notified, and how"
        backHref="/admin/notifications"
        backLabel="Notifications"
        subtitle="Choose, for each alert, who receives it and whether it goes by Telegram or SMS. Changes apply to new alerts straight away."
      />

      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
        <div className="font-medium text-slate-700 mb-1">Channels right now</div>
        <div className="flex flex-wrap gap-2">
          {channels.map((c) => (
            <span
              key={c.label}
              className={
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium " +
                (c.on
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-slate-200 text-slate-500")
              }
            >
              <span
                aria-hidden
                className={
                  "size-1.5 rounded-full " +
                  (c.on ? "bg-emerald-500" : "bg-slate-400")
                }
              />
              {c.label}: {c.on ? "connected" : "not set up"}
            </span>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Picking a medium that isn't set up won't cause errors — the message
          just waits (or is skipped) until that channel is connected. A person
          only receives an alert if they have the matching detail on file (a
          linked Telegram, or a mobile number).
        </p>
      </div>

      <RoutingForm groups={groups} />

      <div className="border-t border-slate-200 pt-4">
        <ResetButton />
      </div>
    </div>
  );
}
