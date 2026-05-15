# WhatsApp Business setup

What you need to do at Meta before notifications can actually send. The code already queues messages — they'll show as `SKIPPED` in `/admin/notifications` until both env vars below are set.

End state: two env vars in Vercel (`WHATSAPP_PHONE_ID`, `WHATSAPP_ACCESS_TOKEN`) and seven approved message templates.

## 1. Meta Business Manager (~15 min)

1. Go to <https://business.facebook.com> and sign in.
2. **Business Settings → Business Info** — confirm "1st Nationwide Security Services Ltd" is the legal entity. If you don't have a Business Manager yet, create one with that name.
3. Verify the business — Business Settings → Security Center → Start Verification. Meta wants utility bills, certificate of incorporation, etc. **This can take 1–5 days**, but you can configure WhatsApp before it's complete; verification just lifts the messaging cap.

## 2. Get a phone number for WhatsApp Business (~10 min)

You need a phone number that's **not currently used on regular WhatsApp**. Options:
- Buy a new SIM (cheapest, easiest).
- Port an existing 1NW office number — but it'll stop receiving regular WhatsApp.
- Use a virtual number (some VOIP services support WhatsApp verification).

Once you have it, in Business Manager: **WhatsApp Accounts → Add → Create new account**. Enter the number, receive the verification code, confirm.

## 3. Create the Meta App (~5 min)

1. <https://developers.facebook.com/apps> → **Create App** → "Business" → name it "1st Nationwide Ops".
2. In the app, click **Add Product → WhatsApp**.
3. Under **WhatsApp → API Setup**, you'll see:
   - **Phone Number ID** — copy this. This is your `WHATSAPP_PHONE_ID`.
   - **Temporary access token** — works for 24 hours. Use this for testing first.

## 4. Test send to your own phone (~5 min)

1. Add your personal mobile as a "Recipient" on the API Setup page.
2. WhatsApp will send you a code; enter it.
3. Click **Send message** with the default `hello_world` template.
4. You should receive it in WhatsApp. If yes, the API works.

## 5. Generate a permanent token (~10 min)

The temporary one expires daily. For production:

1. Business Settings → **Users → System Users → Add** → name it "1nw-app", role "Admin".
2. With the system user selected, **Add Assets → Apps → 1st Nationwide Ops → Full control**.
3. **Generate New Token** → pick the app → tick **`whatsapp_business_messaging`** and **`whatsapp_business_management`** → Generate.
4. **Copy the token now** (it's not shown again). This is your `WHATSAPP_ACCESS_TOKEN`.

## 6. Set the env vars in Vercel

Project → Settings → Environment Variables → Production:

| Name | Value |
|---|---|
| `WHATSAPP_PHONE_ID` | the number ID from step 3 |
| `WHATSAPP_ACCESS_TOKEN` | the permanent token from step 5 |

Redeploy. The cron will start draining the queue within a minute.

## 7. Submit message templates

Outbound notifications outside a 24-hour customer-initiated window must use approved **Utility** templates. We use these names — recreate them exactly in **WhatsApp Manager → Templates → New**:

### `visit_started` (Utility, en_GB)
```
{{1}} on site at {{2}}, {{3}}
```
Sample values: `Hasnain` · `BR3 4PR · 25-27 Beckenham Road` · `02 May 14:23`

### `visit_completed` (Utility, en_GB)
```
Patrol of {{1}} completed by {{2}} at {{3}}
```

### `visit_late` (Utility, en_GB)
```
Visit to {{1}} is LATE — assigned to {{2}}, scheduled {{3}}
```

### `visit_missed` (Utility, en_GB)
```
Visit to {{1}} was MISSED — assigned to {{2}}, scheduled {{3}}
```

### `alarm_received` (Utility, en_GB)
```
ALARM at {{1}} — priority {{2}}, received {{3}}
```

### `key_handover` (Utility, en_GB)
```
Key handover: {{1}} from {{2}} to {{3}} at {{4}}
```

For each: **Category = Utility** (free-form text counts as marketing and gets rejected — keep them transactional in tone). Approval is usually 5–60 minutes. Rejected? Tweak the wording (more concrete, less salesy) and resubmit.

## 8. Add staff WhatsApp numbers in the app

1. Log into the app as admin.
2. `/officers` → for each admin / dispatcher, click Edit → fill the **WhatsApp number** field (`07700 900123` or `+44…`).
3. Officers without a number simply don't receive notifications — no error, no warning.

## 9. Verify end-to-end

1. Have an officer tap "I'm on site" on a test visit → check `/admin/notifications`.
2. Status should flip from `PENDING` → `SENT` within a minute (cron-driven).
3. Confirm WhatsApp arrived on the staff phone.

If a row goes `FAILED`, the error is shown inline. Most common:
- "Template name does not exist" — template not approved yet.
- "Recipient phone number not in allowed list" — only happens with the test temporary token; the permanent token doesn't have this restriction.
- "Invalid parameter" — usually the body parameters don't match the template's `{{N}}` placeholders.

## Costs

- 1,000 utility conversations per WhatsApp Business Account per month are free.
- Above that, ~£0.04 per conversation (UK). A "conversation" is a 24-hour window, not a single message — multiple notifications to the same number within 24 hours count as one.
- Set spending limits in **Business Settings → Payments → WhatsApp Account**.
