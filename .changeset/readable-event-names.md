---
'fair-events': patch
'fair-events-shared': patch
'fair-payments-connector': patch
'fair-audience': patch
'fair-audience-experimental': patch
'fair-events-experimental': patch
'fair-finance': patch
'fair-form': patch
---

Event names show readable text wherever they appear, instead of HTML codes such as `&nbsp;`, `&amp;` or `&#8220;`. This covers transaction descriptions on the Payments Connector Transactions list and detail screens, including existing transactions, which are not rewritten. It also covers event names in the admin lists, calendars, selectors and dialogs of every Fair plugin, Fair Audience email subjects, the payment description shown at Mollie checkout, structured event data (JSON-LD), the experimental iCal source export and timeline, and the weekly summary page and email. Event names that look like HTML are shown as text and are never interpreted as markup.
