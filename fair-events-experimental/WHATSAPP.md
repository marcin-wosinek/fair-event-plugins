# WhatsApp notifications: setup validation

Prerequisite validation for sending Fair Events notifications over the
WhatsApp Cloud API (issue #1922). This document records what must exist on
Meta's side before delivery work starts.

The manual connection (issue #1923) is built: the access token is saved in
Settings → Connectors, and Fair Events → WhatsApp stores the WhatsApp Business
Account ID and Phone Number ID, validates them against Meta and sends one
approved test template on request (see [Manual connection](#manual-connection)).
Delivery updates (issue #1924) arrive through a webhook and show what happened
to each send (see [Delivery updates](#delivery-updates)). Automatic sending is
still off: there is no notification provider, scheduled send, subscriber
integration or delivery queue.

Findings were checked against Meta's official developer documentation on
**2026-10-20**. Meta changes these requirements often; re-check the linked
pages before acting on any item.

## Decisions

- **Destination:** individual subscribers who opted in. Groups and Channels
  are not used (see [Destination options](#destination-options)).
- **Sender:** a dedicated phone number registered to the Cloud API. Validation
  uses Meta's test sender. An existing WhatsApp Business app number is not
  migrated (see [Sender number](#sender-number)).
- **Scope:** La Mutable's own business assets first. Onboarding other
  businesses (Embedded Signup, Tech Provider) is documented but not built.
- **Plugin:** the integration belongs to fair-events-experimental. The
  existing Telegram connector in fair-events
  (`src/Notifications/TelegramConnector.php`, `Provider.php`, `Providers.php`,
  `Notifications.php`) is the reference for credential handling, the delivery
  contract and scheduling.

## Controlled test send

| Item      | Value                                                              |
| --------- | ------------------------------------------------------------------ |
| Status    | **Done.** Reported by the owner in #1922 on 2026-10-27             |
| Sender    | Meta test business phone number (created by the App Dashboard)     |
| Recipient | Administrator's phone, added and verified as a test recipient      |
| Template  | `hello_world`, language `en_US`                                    |
| API       | Graph API `v24.0` (latest version listed in the changelog)         |
| Evidence  | Screenshot of the sent message in the #1922 comment (2026-10-27)   |

Procedure:

1. In the App Dashboard → WhatsApp → API Setup, add the administrator's
   number as a **To** recipient and confirm the code that arrives on WhatsApp.
   Only send after the recipient has explicitly agreed to the test.
2. Generate a temporary access token on the same page. Keep the token, the
   phone number ID and the full recipient number out of the repository and
   GitHub.
3. Send `hello_world`, either with **Send message** on the API Setup page or:

    ```bash
    curl -X POST "https://graph.facebook.com/v24.0/<PHONE_NUMBER_ID>/messages" \
      -H "Authorization: Bearer <TOKEN>" -H 'Content-Type: application/json' \
      -d '{"messaging_product":"whatsapp","to":"<RECIPIENT>","type":"template",
           "template":{"name":"hello_world","language":{"code":"en_US"}}}'
    ```

4. Record the date, the HTTP status and a redacted response (replace the
   `wamid` and all but the last three digits of `wa_id`). A `200` with a
   `messages[].id` means **API acceptance** only. Record **receipt**
   separately, after the recipient confirms the message arrived.

Do not mark #1922 complete until this send and its receipt are recorded.

## Destination options

| Destination                       | Cloud API support                                                                                                                                                                                                                                 | Fit                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Individual opted-in recipient** | Supported. Template messages work outside the 24-hour customer service window; free-form messages only inside it.                                                                                                                                 | **Chosen.** No eligibility gate beyond the standard setup below.                      |
| Group                             | Groups API, launched 2025-10-06. Requires an **Official Business Account**. Max **8 participants** per group, invite-link join only, text and media messages and templates, per-message pricing. Not available for WhatsApp Business app numbers. | Unsuitable: an 8-person limit and the OBA requirement rule out a subscriber audience. |
| Channel                           | **No official API.** No Channels endpoint appears in Meta's Cloud API docs or changelog. Third-party "Channel APIs" use unofficial web-protocol clients, which risk an account ban.                                                               | Unsuitable.                                                                           |

No finding blocks the chosen delivery model.

## Sender number

**Dedicated number (chosen).** A number registered to the Cloud API cannot
be in use on WhatsApp Messenger or the WhatsApp Business app at the same
time, unless it is onboarded through coexistence. A fresh number avoids that.
It must be owned by the business, include a country code, be able to receive
SMS or voice calls, and not be a short code. A new business portfolio may
register **2** numbers. That limit rises to 20 after business verification or
after reaching the 2,000 messaging limit.

**Existing WhatsApp Business app number (coexistence, not chosen).** The
number keeps working in the Business app while also using the Cloud API.
Limitations:

- Onboarding requires **Embedded Signup** (`featureType:
whatsapp_business_app_onboarding`), so the integrating party must be a
  **Tech Provider or Solution Partner**. A business cannot connect its own
  app number through the plain App Dashboard flow.
- Business app version 2.24.17 or newer. Throughput is fixed at 20 messages
  per second.
- Group chats, Channels, disappearing and view-once messages, broadcast lists
  (made read-only), calls, catalog and marketing tools are unavailable through
  the API.
- History sync covers about the last 6 months of 1:1 chats and must happen
  within 24 hours of onboarding. Onboarding unlinks companion devices.
  Windows and WearOS companions are unsupported.
- If the primary phone is inactive for about 14 days, the connection drops
  (`PARTNER_REMOVED`, `PRIMARY_INACTIVITY`).
- Messages sent from the app stay free. API messages use Cloud API pricing.

## Production prerequisites

Status key: **verified** = confirmed in official docs; **outstanding** = an
action La Mutable still has to take; **blocked** = cannot proceed yet.

| #   | Prerequisite                                                                                                                                                                                                                                                                                                                         | Status                           | Next action                                                                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | **Meta business portfolio.** Created or selected when the app is created.                                                                                                                                                                                                                                                            | Verified / outstanding           | Confirm which portfolio La Mutable uses                                                    |
| 2   | **Developer app** with the "Connect with customers through WhatsApp" use case, owned by that portfolio.                                                                                                                                                                                                                              | Outstanding                      | Create the app                                                                             |
| 3   | **WhatsApp Business Account (WABA).** Connected to the app; its ID is needed for template calls.                                                                                                                                                                                                                                     | Outstanding                      | Create during app setup                                                                    |
| 4   | **Test sender and recipient.** Generated automatically. Up to **5** verified test recipients. No payment method is needed for test templates. Templates created on the test number may not carry over.                                                                                                                               | Verified                         | Run the [controlled test send](#controlled-test-send)                                      |
| 5   | **Production number.** Dedicated, meets eligibility rules, two-step verification PIN set, then registered with the Cloud API `register` endpoint. Registering through the dashboard alone is not enough.                                                                                                                             | Outstanding                      | Acquire a number; register it                                                              |
| 6   | **Display name.** Required at registration. Reviewed against Meta's display name guidelines. Shown in chats only after approval (`name_status: APPROVED`).                                                                                                                                                                           | Outstanding                      | Choose a name that matches the La Mutable brand                                            |
| 7   | **Long-lived token.** A system user in Business Settings, assigned to the app and the WABA, with a token that has `whatsapp_business_messaging` and `whatsapp_business_management` (and `business_management` per Meta's guide). The temporary token expires within hours.                                                           | Outstanding                      | Create a system user; store the token as a secret setting, as the Telegram token is stored |
| 8   | **Business verification.** Not strictly required to send, but it raises the number limit (2→20), the template limit (250→6,000) and the messaging limit (250→2,000). It is required to become a Tech Provider.                                                                                                                       | Outstanding (recommended)        | Start verification in Business Settings                                                    |
| 9   | **Billing.** Per-message pricing since 2025-07-01, by category and recipient country (Spain is its own market). A payment method goes in Billing Hub. Since **2026-10-01**, utility messages inside the service window and service messages above 1,000 per month are charged. Without a payment method, Meta stops delivering them. | Outstanding                      | Add a payment method; read the EUR rate card for Spain                                     |
| 10  | **Templates.** Each needs approval (automatic, up to 24 h in review). A reminder for an event the subscriber registered for can be **utility** if purely informational. Announcing a new event to subscribers is **marketing**. Mixed content is classified as marketing.                                                            | Outstanding                      | Draft and submit the notification templates in each language used                          |
| 11  | **Recipient opt-in.** Must state that the person agrees to receive messages from the business, name the business, and comply with local law. Can be collected on a website form. Opt-out must be clear and honored. Separate opt-in per message category is recommended.                                                             | Outstanding                      | Design opt-in capture with a timestamp (downstream work)                                   |
| 12  | **Messaging limit.** New portfolios can message 250 unique users per rolling 24 h outside service windows. Verification, or 2,000 delivered high-quality messages in 30 days, raises it to 2,000.                                                                                                                                    | Verified                         | Check the subscriber count against 250 before launch                                       |
| 13  | **Live send from the test sender.**                                                                                                                                                                                                                                                                                                  | **Done** (2026-10-27)            | None; the owner's screenshot in #1922 is the evidence                                      |

### Onboarding other businesses (not built)

To connect other organizers' own numbers, Fair Events would have to become a
**Tech Provider**. That requires business verification, App Review with
advanced access for `whatsapp_business_messaging` and
`whatsapp_business_management`, an app icon, a privacy policy, two
screencasts, and an Embedded Signup integration. Embedded Signup v2 and v3
were deprecated on 2026-10-15; new work must use **v4**. None of this is needed
for La Mutable's own setup.

## Unresolved

- The controlled test send was reported as a screenshot only; its HTTP
  status and sanitized response were not recorded as text.
- Meta's documentation does not say how many messages a test number may send
  per day.
- Spain's per-message rates come from Meta's rate-card files and were not
  copied here, because they change.
- The getting-started guide's examples still use `v23.0`. The manual
  connection uses `v26.0`, the latest version in the Graph API changelog on
  2026-10-28.

## Manual connection

Built in #1923, in fair-events-experimental:

- **Token:** Settings → Connectors → WhatsApp (`fair-events-whatsapp`). It is
  separate from the Meta Conversions API token. An environment variable or
  PHP constant named `FAIR_EVENTS_EXPERIMENTAL_WHATSAPP_ACCESS_TOKEN` takes
  precedence over the saved token, in that order. The token is never returned
  by the plugin's REST routes.
- **IDs:** Fair Events → WhatsApp saves the WhatsApp Business Account ID and
  the Phone Number ID (both digits, neither is the telephone number) without
  contacting Meta.
- **Validation** reads the account, then pages through its phone numbers to
  find the Phone Number ID and shows the sender's verified name, number and
  quality rating. Saving other IDs, or replacing or removing the token, makes
  the result stale.
- **Test send:** only approved templates without parameters are offered. Each
  send needs the administrator to confirm the recipient agreed to it, goes
  out once, and is reported as "accepted by WhatsApp", never as delivered. A
  timed-out send is reported as uncertain and is not retried. Only the masked
  recipient (last three digits) is stored, in the delivery history.
- **Errors** show a translated explanation, Meta's numeric error code and its
  trace ID. Meta's own messages, the token and recipient numbers are not
  logged or returned.

## Delivery updates

Built in #1924, in fair-events-experimental. Checked against Meta's webhook
documentation on **2026-10-29**.

### Setup

Fair Events → WhatsApp → **Delivery updates** shows the callback URL,
`/wp-json/fair-events-experimental/v1/whatsapp/webhook`, and stores two
credentials, neither of which is ever returned by a REST route:

- **App Secret** (App Dashboard → App settings → Basic) authenticates each
  callback. `FAIR_EVENTS_EXPERIMENTAL_WHATSAPP_APP_SECRET` as an environment
  variable or PHP constant takes precedence over the saved value, in that
  order.
- **Verify token**, any string of 8+ printable characters entered both here
  and in the App Dashboard (WhatsApp → Configuration → Webhook).
  `FAIR_EVENTS_EXPERIMENTAL_WHATSAPP_VERIFY_TOKEN` overrides it the same way.

Then subscribe the webhook to the **messages** field. The page reports two
separate facts: when Meta last **verified** the callback URL with the current
verify token, and when an **authenticated update** for the saved account last
arrived. Verification alone does not prove that updates arrive. Another
verify token clears the first; another App Secret or other IDs clear the
second.

### Endpoint

- **GET** answers `hub.mode=subscribe` with `hub.challenge` as plain text
  when `hub.verify_token` matches (PHP delivers these as `hub_mode` etc.;
  both spellings are read). The challenge must be `[A-Za-z0-9_-]`, anything
  else is refused with 403.
- **POST** requires `X-Hub-Signature-256: sha256=<hex>`, the HMAC-SHA256 of
  the exact raw body with the App Secret, compared in constant time; without
  a saved secret it answers 503, with a missing or wrong signature 401. Only
  entries whose `id` is the saved WhatsApp Business Account ID and changes
  whose `metadata.phone_number_id` is the saved Phone Number ID are applied;
  other accounts, numbers and fields are acknowledged with 200 and ignored.
  A storage or consumer failure answers 500, so Meta resends the batch;
  applying it again is safe. Bodies over 1 MB are refused (413).

### Delivery records

Each send is a row in `{prefix}fair_events_whatsapp_deliveries`, created
before the request to Meta; a send that cannot be recorded is not sent. A
row keeps the origin (`admin_test`; `scheduled` is reserved for scheduled
sends, which are not built), both IDs, Meta's message ID, the template, the
masked recipient, the send result and the delivery evidence. Raw payloads,
message bodies, full numbers and Meta's error text are never stored.

| Outcome        | Meaning                                                             |
| -------------- | ------------------------------------------------------------------- |
| `accepted`     | WhatsApp accepted the request; no delivery update yet               |
| `sent`         | WhatsApp sent it; not yet on the phone                              |
| `delivered`    | It reached the recipient's phone                                    |
| `read`         | The recipient opened it                                             |
| `failed`       | WhatsApp reported a delivery failure, with a translated explanation |
| `not_accepted` | WhatsApp refused the send                                           |
| `uncertain`    | The send timed out or was not confirmed; it is never retried        |

Transitions: `sent` → `delivered` → `read` only move forward, so duplicate
or older callbacks change nothing. The first failure is kept separately: it
decides the outcome until delivery is confirmed, and confirmed delivery or a
read wins over it while its code stays visible. Only failure codes on an
allowlist are kept (others are stored as 0). Each update is one conditional
`UPDATE`, so concurrent callbacks cannot interleave.

A callback that arrives before the send stores its message ID waits in
`{prefix}fair_events_whatsapp_unmatched` (unique per message and status) and
is applied as soon as the ID is stored. Delivery rows are kept 30 days,
waiting callbacks 24 hours and at most 500 of them; a daily cron event
(`fair_events_experimental_whatsapp_cleanup`) prunes both.

The page lists the 20 most recent sends and checks for updates every 10
seconds while one is still `accepted` or `sent` and the page is visible, up
to 30 times after each send or **Refresh statuses**.

### Incoming messages

Authenticated incoming messages for the saved account are passed to
`do_action( 'fair_events_experimental_whatsapp_incoming_message', $message )`
for the opt-out feature that follows. `$message` holds `id`, `from` (digits),
`timestamp`, `type`, `text` (the body of a text message or button reply,
otherwise null), `waba_id` and `phone_number_id`. The hook runs synchronously
and **at least once**: Meta resends a callback this site did not acknowledge,
so consumers must deduplicate by `id`. A consumer that throws makes the
callback answer 500. This plugin does not store, log or reply to incoming
messages, and nothing subscribes to the hook yet.

## Sources

- [Cloud API: Get started](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started)
- [Phone numbers](https://developers.facebook.com/docs/whatsapp/cloud-api/phone-numbers)
- [Display names](https://developers.facebook.com/docs/whatsapp/display-names)
- [Messaging limits](https://developers.facebook.com/docs/whatsapp/messaging-limits)
- [Pricing](https://developers.facebook.com/docs/whatsapp/pricing)
- [Getting opt-in](https://developers.facebook.com/docs/whatsapp/overview/getting-opt-in)
- [Message templates](https://developers.facebook.com/docs/whatsapp/business-management-api/message-templates)
  and [template categorization](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization)
- [Groups API](https://developers.facebook.com/docs/whatsapp/cloud-api/groups)
- [Onboarding WhatsApp Business app users (coexistence)](https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users)
- [Get started for Tech Providers](https://developers.facebook.com/docs/whatsapp/solution-providers/get-started-for-tech-providers)
- [Webhooks](https://developers.facebook.com/docs/graph-api/webhooks/getting-started)
  and [WhatsApp webhook verification (archived SDK)](https://whatsapp.github.io/WhatsApp-Nodejs-SDK/api-reference/webhooks/start/)
- [Cloud API error codes](https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes)
- [WhatsApp changelog](https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog)
