# WhatsApp notifications: setup validation

Prerequisite validation for sending Fair Events notifications over the
WhatsApp Cloud API (issue #1922). This document records what must exist on
Meta's side before connector UI or delivery work starts. Nothing here enables
sending: there is no provider, REST route, setting or scheduled WhatsApp send.

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
| Status    | **Outstanding.** Deferred by the owner on 2026-10-20               |
| Sender    | Meta test business phone number (created by the App Dashboard)     |
| Recipient | Administrator's phone, added and verified as a test recipient      |
| Template  | `hello_world`, language `en_US`                                    |
| API       | Graph API `v24.0` (latest version listed in the changelog)         |
| Evidence  | Date, sanitized response and recipient confirmation (to be filled) |

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
| 13  | **Live send from the test sender.**                                                                                                                                                                                                                                                                                                  | **Outstanding** (owner deferred) | Run the controlled test send and record the result                                         |

### Onboarding other businesses (not built)

To connect other organizers' own numbers, Fair Events would have to become a
**Tech Provider**. That requires business verification, App Review with
advanced access for `whatsapp_business_messaging` and
`whatsapp_business_management`, an app icon, a privacy policy, two
screencasts, and an Embedded Signup integration. Embedded Signup v2 and v3
were deprecated on 2026-10-15; new work must use **v4**. None of this is needed
for La Mutable's own setup.

## Unresolved

- The controlled test send and receipt confirmation (prerequisite 13).
- Meta's documentation does not say how many messages a test number may send
  per day.
- Spain's per-message rates come from Meta's rate-card files and were not
  copied here, because they change.
- The getting-started guide's examples still use `v23.0`. Confirm the current
  Graph API version when implementing.

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
- [WhatsApp changelog](https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog)
