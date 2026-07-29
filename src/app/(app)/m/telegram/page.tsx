import { getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { isTelegramConfigured, botUsername } from "@/lib/telegram";
import { ConnectTelegram } from "../../telegram/ConnectTelegram";
import {
  generateTelegramLinkCode,
  disconnectTelegram,
} from "../../telegram/_actions";

export const dynamic = "force-dynamic";

/**
 * Officer-facing Telegram connect. Same link/disconnect flow as the staff
 * page, minus the admin webhook tools. Reachable under /m/* so it's inside
 * the officer hard-lock.
 */
export default async function OfficerTelegramPage() {
  const me = await getSessionUser();
  const user = me
    ? await prisma.user.findUnique({
        where: { id: me.id },
        select: { telegramChatId: true },
      })
    : null;
  const configured = isTelegramConfigured() && Boolean(botUsername());

  return (
    <div className="section">
      <PageHeader
        title="Connect Telegram"
        backHref="/m/today"
        backLabel="Today"
        subtitle="Link Telegram to get your jobs and check in from your phone."
      />

      {!configured && (
        <div className="card p-4 text-sm text-amber-700 bg-amber-50">
          The Telegram bot isn&apos;t switched on yet. Ask your admin to finish
          setup, then come back here.
        </div>
      )}

      <ConnectTelegram
        linked={Boolean(user?.telegramChatId)}
        botConfigured={configured}
        generate={generateTelegramLinkCode}
        disconnect={disconnectTelegram}
      />

      <div className="card p-4 text-sm text-slate-600">
        <p className="font-medium text-brand-navy mb-1">Once linked, you can:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>
            Send <b>/mine</b> to see your jobs for today.
          </li>
          <li>
            Tap <b>On site</b> / <b>Complete</b> on a job the bot sends you.
          </li>
        </ul>
      </div>
    </div>
  );
}
