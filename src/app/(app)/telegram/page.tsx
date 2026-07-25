import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { requireStaff } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/PageHeader";
import { isTelegramConfigured, botUsername } from "@/lib/telegram";
import { ConnectTelegram } from "./ConnectTelegram";
import { WebhookSetup } from "./WebhookSetup";
import {
  generateTelegramLinkCode,
  disconnectTelegram,
  registerTelegramWebhook,
  checkTelegramWebhook,
} from "./_actions";

export const dynamic = "force-dynamic";

export default async function TelegramPage() {
  const me = await requireStaff();
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id ?? null;

  const user = userId
    ? await prisma.user.findUnique({
        where: { id: userId },
        select: { telegramChatId: true },
      })
    : null;

  const configured = isTelegramConfigured() && Boolean(botUsername());
  const isAdmin = me.role === "ADMIN";

  return (
    <div className="section">
      <PageHeader
        title="Connect Telegram"
        backHref="/admin"
        backLabel="Admin"
        subtitle="Link your Telegram to get ops alerts here — and, soon, create callouts by messaging the bot."
      />

      {!configured && (
        <div className="card p-4 text-sm text-amber-700 bg-amber-50">
          The Telegram bot isn&apos;t set up yet. Add{" "}
          <code>TELEGRAM_BOT_TOKEN</code>, <code>TELEGRAM_BOT_USERNAME</code> and{" "}
          <code>TELEGRAM_WEBHOOK_SECRET</code> in Vercel, then register the
          webhook. Ask your admin (or me) for the exact steps.
        </div>
      )}

      <ConnectTelegram
        linked={Boolean(user?.telegramChatId)}
        botConfigured={configured}
        generate={generateTelegramLinkCode}
        disconnect={disconnectTelegram}
      />

      {configured && isAdmin && (
        <WebhookSetup
          register={registerTelegramWebhook}
          check={checkTelegramWebhook}
        />
      )}
    </div>
  );
}
