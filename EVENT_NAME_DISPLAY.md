# Event-name display

Event names reach users in many places: admin screens, emails, calendar
files, structured data and payment-provider pages. WordPress stores titles
HTML-encoded (`La&nbsp;Mutable`, `Rock &amp; Roll`, texturized
`&#8220;…&#8221;`), and strings built from them carry the entities along. For
example, a ticket transaction description is `Ticket for <post_title>`,
stored at purchase time. This doc says how each output turns that stored
text into readable text (#2300).

## The rule

1. **Decode exactly once, with the shared helper for the runtime.** Never
   decode in a loop or twice along one path: text that is meant to show an
   entity (`&amp;lt;` → `&lt;`) must stay literal. `&nbsp;` becomes a
   non-breaking space (U+00A0).
2. **Escape for the output context at the very end.**
3. **Never rewrite stored data.** Editable fields (the Manage Event title,
   post titles) and persisted values (transaction descriptions, line items,
   REST fields, JSON exports meant for re-import) keep their stored form.
   Existing transactions display correctly without a migration.

| Runtime | Helper                                                                 | Notes                                                                                                                                                   |
| ------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser | `decodeEntityText( value )` in `fair-events-shared/src/event-utils.js` | Decodes once; `null`/`undefined` → `''`; no trimming, no fallback. Uses `@wordpress/html-entities` (an inert `<textarea>`, so no elements are created). |
| Browser | `getEventDisplayTitle( title )`                                        | `decodeEntityText()`, trimmed, with the `(untitled event)` fallback. For event names in fair-events.                                                    |
| PHP     | `FairEventsShared\Helpers\DisplayText::decode( $value )`               | `html_entity_decode( …, ENT_QUOTES \| ENT_HTML5, 'UTF-8' )`, once.                                                                                      |
| PHP     | `DisplayText::event_title( $title, $fallback )`                        | Decoded, edge-trimmed (including U+00A0), caller's translated fallback.                                                                                 |
| PHP     | `DisplayText::html( $text )`                                           | Escapes **decoded** text for HTML, always encoding `&`.                                                                                                 |

### Output contexts

- **React:** render the decoded string as a text node or a string prop
  (`label`, `title`, `sprintf` argument). Never `dangerouslySetInnerHTML`.
- **PHP HTML, stored value:** `esc_html( $raw )` / `esc_attr( $raw )`.
  WordPress's escapers leave valid entities alone, so the browser decodes
  them exactly once. Nothing else is needed.
- **PHP HTML, decoded value:** `DisplayText::html( $decoded )`. Never pass
  decoded text to `esc_html()`, which would turn literal `&lt;` text back
  into a tag.
- **Plain text** (email subjects, iCalendar, JSON-LD, payment-provider
  descriptions, REST fields that the browser renders as text):
  `DisplayText::decode()`, then the format's own escaping/serializer
  (Sabre/VObject, `wp_json_encode()`, the Mollie SDK).
- **`data-*` attributes read by JavaScript:** `esc_attr( $raw )`. The
  browser's attribute parsing is the single decode, so the script must not
  decode `dataset` values again.
- **Props passed down a component tree:** decode once where the raw value
  enters the tree, and document that children receive text. For example,
  the Audience tab decodes Manage Event's `eventTitle` in its entry point.

Fair Calendar Button doesn't bundle `fair-events-shared`. Its only event
name is an `esc_attr( get_the_title() )` data attribute, which follows the
`data-*` rule above.

## Inventory

Paths are relative to each plugin's `src/`. "Verified" names the regression
test or the check made for #2300. "Shared helper tests" means the display
calls a helper covered by `fair-events-shared/src/__tests__/event-utils.test.js`
or `fair-events/__tests__/Shared/DisplayTextTest.php`, without a test of
its own.

### Transactions (Fair Payments Connector)

| Display                                                                                     | Source                               | Context             | Helper                                                                              | Verified                                                                          |
| ------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Transactions list: description under the reference                                          | stored `description`                 | React text          | `decodeEntityText`                                                                  | `TransactionsApp.test.jsx`; live check of the reported description                |
| Transaction detail: Description card, line-item name/description, delete-dialog description | stored `description`, `line_items[]` | React text          | `decodeEntityText`                                                                  | `TransactionPage.test.jsx`; live check                                            |
| Transaction detail: linked event, occurrence search results, purchases card, linked post    | REST `event.title`, `post_title`     | React text          | `decodeEntityText`                                                                  | `TransactionPage.test.jsx`                                                        |
| Transactions JSON export                                                                    | stored `description`                 | re-importable data  | none: raw on purpose                                                                | n/a                                                                               |
| Mollie payment description                                                                  | `create_payment()` `description`     | provider plain text | `DisplayText::decode`                                                               | `MolliePaymentHandlerTest`                                                        |
| Payment notifications (Telegram, email; immediate and digest): event title and other values | `fair_payment_notification_context`  | Telegram HTML       | `DisplayText::decode` + `DisplayText::html` in `TelegramService::render_template()` | `TelegramServiceTest` (#2450); live check of immediate, digest and email delivery |

### Fair Events

| Display                                                                              | Source                                      | Context                                    | Helper                                           | Verified                                                             |
| ------------------------------------------------------------------------------------ | ------------------------------------------- | ------------------------------------------ | ------------------------------------------------ | -------------------------------------------------------------------- |
| All Events: title, sort value, linked post                                           | REST `title`, `post.title`                  | React text                                 | `getEventDisplayTitle`, `decodeEntityText`       | shared helper tests                                                  |
| Admin calendar pills and tooltips (also Events Experimental source view)             | REST `title`                                | React text, `title` attribute              | `DayCell` → `decodeEntityText`                   | shared helper tests                                                  |
| Calendar "Event created" notice                                                      | created event `title`                       | `sprintf` text                             | `getEventDisplayTitle`                           | shared helper tests                                                  |
| Quick event / Event link modal post search, linked posts                             | `/wp/v2/search` titles, REST `linked_posts` | `SelectControl` label, text                | `decodeEntityText`                               | shared helper tests                                                  |
| Manage Event header, occurrence badge, public-page chip, publication dialog          | REST `title`, `master.title`, linked posts  | React text                                 | `getEventDisplayTitle`, `decodeEntityText`       | shared helper tests                                                  |
| Manage Event tickets import/merge dialogs                                            | editable `title` passed as `eventTitle`     | `sprintf` text                             | `decodeEntityText` in `EventTickets`             | shared helper tests                                                  |
| Signups list, printouts, gate sheet                                                  | `getEventDisplayTitle( eventTitle )`        | text; printouts escape with `escapeHtml()` | `getEventDisplayTitle`                           | shared helper tests                                                  |
| Manage Event Finance tab: online payments and unsuccessful attempts descriptions     | stored transaction `description`            | React text                                 | `decodeEntityText` in `OnlinePayments`           | `EventFinance.test.jsx` (#2399)                                      |
| Statistics, payment history                                                          | `eventTitle` or `statistics.event_name`     | text                                       | `getEventDisplayTitle`                           | shared helper tests                                                  |
| Event meta box "Link to event" options                                               | REST `title`, `linked_posts`                | option label                               | `decodeEntityText`                               | shared helper tests                                                  |
| Events calendar block, event signup block, event-date page `<h1>` and document title | stored titles                               | PHP HTML                                   | `esc_html( $raw )` (WordPress decodes once)      | unchanged; correct by the rule                                       |
| Calendar button (`data-title`)                                                       | `get_the_title()`                           | `data-*` attribute read by JS              | `esc_attr( $raw )`                               | unchanged; correct by the rule                                       |
| Calendar feed (`.ics` SUMMARY)                                                       | occurrence titles                           | iCalendar                                  | `DisplayText::decode`                            | `CalendarFeedController.api.spec.js`                                 |
| JSON-LD `name` (single event and lists)                                              | `get_title()`, occurrence DTO               | JSON                                       | `DisplayText::decode`                            | `event-list-jsonld.spec.js`                                          |
| Open Graph `og:title`                                                                | `get_title()`                               | PHP attribute                              | `esc_attr( $raw )`                               | unchanged; correct by the rule                                       |
| Notification page picker titles                                                      | `get_the_title()`                           | REST field rendered as text                | `DisplayText::event_title`                       | `DisplayTextTest`                                                    |
| Weekly summary text (Telegram/email)                                                 | occurrence and page titles                  | plain text                                 | `SummaryBuilder` → `DisplayText::event_title`    | `DisplayTextTest`; `fair-events-experimental-weekly-summary.spec.js` |
| Weekly email event list                                                              | occurrence titles                           | HTML email                                 | `DisplayText::event_title` + `DisplayText::html` | `WeeklyEmailRendererTest`                                            |
| Telegram ticket sale alert: event title, ticket type names (#2448)                   | owning event's title, ticket type `name`    | Telegram HTML                              | `SaleAlertFormatter` → `DisplayText::html`       | `SaleAlertFormatterTest`; `SaleAlerts.api.spec.js`                   |
| Event notifications: Recent ticket sale alerts                                       | owning event's title                        | REST field rendered as text                | `DisplayText::event_title`                       | `SaleAlerts.api.spec.js`                                             |
| Registration confirmation email (standalone sender)                                  | `post_title`                                | subject, HTML body                         | not yet adopted: raw title in subject            | open; Fair Audience fixed by #2291                                   |

### Fair Audience

| Display                                                                                                                         | Source                          | Context            | Helper                                               | Verified                           |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------ | ---------------------------------------------------- | ---------------------------------- |
| Events list title and sort value                                                                                                | REST `title`                    | React text         | `decodeEntityText`                                   | shared helper tests                |
| Event participants heading, invitation summary, invitation dialog                                                               | REST `eventInfo.title`          | React text         | `decodeEntityText`                                   | shared helper tests                |
| All participants event list                                                                                                     | REST `title`                    | React text         | `decodeEntityText`                                   | shared helper tests                |
| Participant detail: events, form submissions, purchases                                                                         | REST `event_title`              | React text         | `decodeEntityText`                                   | shared helper tests                |
| Manage Event Audience tab and its dialogs                                                                                       | Manage Event `eventTitle`       | text props         | decoded once in `manage-event-audience-tab/index.js` | shared helper tests                |
| Audience signup block event link panel                                                                                          | REST `title`                    | React text         | `decodeEntityText`                                   | shared helper tests                |
| Email subjects: poll invitation, resume registration, activities added, payment failed, event invitation, interest confirmation | `post_title`, `get_the_title()` | plain-text subject | `DisplayText::decode`                                | `DisplayTextTest`                  |
| Registration confirmation email                                                                                                 | `post_title`                    | subject, HTML body | `DisplayText::event_title` + `DisplayText::html`     | `SignupConfirmationEventTitleTest` |
| Email bodies and the `{event_name}` placeholder                                                                                 | stored titles                   | HTML email         | `esc_html( $raw )`                                   | unchanged; correct by the rule     |

### Experimental plugins, Finance and Form

| Display                                                                                                                                    | Source                                   | Context                       | Helper                                                                                   | Verified                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Audience Experimental timeline: ticket event link, signup summary                                                                          | REST `event_title`; summary built in PHP | React text                    | `decodeEntityText`; `DisplayText::decode` for the summary                                | shared helper tests                                                                                    |
| Audience Experimental import, poll editor (selector, invitation notice)                                                                    | REST `title`                             | text, option label            | `decodeEntityText`                                                                       | shared helper tests                                                                                    |
| Events Experimental compare events: labels, charts, export file names                                                                      | REST `title`                             | text, chart labels, file name | `decodeEntityText` in `comparison.js`                                                    | shared helper tests                                                                                    |
| Events Experimental Meta calendar test selector                                                                                            | REST `title`                             | option label                  | `decodeEntityText`                                                                       | shared helper tests                                                                                    |
| Events Experimental iCal source export                                                                                                     | `post_title`                             | iCalendar                     | `DisplayText::decode`                                                                    | `DisplayTextTest`                                                                                      |
| Events Experimental weekly summary page                                                                                                    | decoded by `SummaryBuilder`              | PHP HTML                      | `DisplayText::html` (no second decode)                                                   | `fair-events-experimental-weekly-summary.spec.js`                                                      |
| Events Experimental public marketing assets: list and API `title`, page `<h1>` and document title                                          | `get_display_title()` of published dates | REST text, PHP HTML           | `DisplayText::event_title`; `DisplayText::html` for the `<h1>` and `<title>`             | `PublicMarketingAssetsController.api.spec.js`                                                          |
| Finance entries event filter, event URL field, split modal                                                                                 | REST `title`                             | text, option label            | `decodeEntityText`                                                                       | shared helper tests                                                                                    |
| Finance entries: entry and allocation descriptions, parent-entry context, action labels, confirmations, notices; split modal entry summary | stored `description`                     | React text, string props      | `decodeEntityText` in `EntriesApp` (`entryLabel`) and `SplitModal`; edit fields stay raw | `EntriesAppTable.test.jsx`, `EntriesApp.test.jsx`, `SplitModal.test.jsx`, `EntryForm.test.jsx` (#2412) |
| Form answers list, editor, submission detail                                                                                               | REST `event_name`, event labels          | text, option label            | `decodeEntityText`                                                                       | shared helper tests                                                                                    |
| Form block sidebar Event selector                                                                                                          | REST `display_label` (title + date)      | option label                  | `decodeEntityText` in `blocks/fair-form/editor.js`                                       | `editor.test.jsx`; `fair-form-event-selector.spec.js` (#2408)                                          |

Form titles, page titles, ticket-type and category names are not event
names and are outside this inventory, even where they render through the
same components.
