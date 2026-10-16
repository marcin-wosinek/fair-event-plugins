## Purpose

A "Pay Now" box that collects one fixed amount through Mollie. Visitors see
the amount and description, click the button, pay on Mollie's checkout, and
return to the same page, where the block shows whether the payment was
confirmed, is still processing, or failed (with a "Try Again" button).

The block name uses the `fair-payment` namespace although the plugin is Fair
Payments Connector; rely on `ownerPlugin` in `index.json` rather than the
namespace.

## Composition

A standalone, top-level block with no inner blocks. It can be placed on any
post or page.

## Attributes

- `blockId` — a UUID that identifies this block within the post. The payment
  endpoint looks the block up by this id in the saved post content and takes
  the amount and currency **from the saved block**, never from the visitor's
  request. Each block on a post needs a unique, non-empty `blockId`; the
  editor generates one on insert and replaces duplicated ids. A block without
  one (or two blocks sharing one) cannot take payments, and the editor shows a
  warning until the post is saved with a fresh id.
- `amount` — the price as a decimal string, for example `"15"` or `"12.50"`.
- `currency` — an ISO 4217 code such as `EUR`. When empty, the site currency
  is used.
- `description` — shown under the amount and sent to Mollie as the payment
  description.

## Prerequisites

- Fair Payments Connector must be connected to Mollie (API keys configured in
  its settings). Without that the block renders the amount and a "Payment
  gateway is not configured" notice instead of the button.
- The post must be published and saved with the block, because the amount is
  read from the saved content.

## Rendering

Renders the amount and currency in `.fair-payments-connector-amount`, the
description, and a `.fair-payments-connector-button` (or the not-configured
notice). After a redirect back from Mollie (`?fair_payment_callback=true`
with a transaction id and access token), it shows the verified payment
status instead of the button.
