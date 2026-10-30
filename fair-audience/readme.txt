=== Fair Audience ===
Contributors: marcinwosinek
Tags: events, participants, audience, management
Requires at least: 7.0
Tested up to: 7.1
Stable tag: 1.22.0
Requires PHP: 8.2
License: GPLv3 or later
License URI: https://www.gnu.org/licenses/gpl-3.0.html

Manage event participants with custom profiles and many-to-many event relationships.

== Description ==

Fair Audience is a WordPress plugin that helps you manage event participants. It provides:

* Custom participant profiles with name, surname, email, Instagram handle
* Email preferences (minimal or in-the-loop)
* Many-to-many relationships between participants and events
* Participant interest levels (interested or signed up)
* Admin interface for managing participants and viewing them by event
* REST API for integration with other tools
* Custom Mail: email the participants of one event date, with a recipient preview, per-person exclusions, marketing-consent checks and a history of sent messages
* Weekly events email to subscribers who agreed to it, with an unsubscribe link and a separate weekly-summary opt-out. Its schedule and wording are managed in Fair Events → Event notifications; Fair Audience decides who receives it and sends it

== Installation ==

1. Upload the plugin files to the `/wp-content/plugins/fair-audience` directory, or install the plugin through the WordPress plugins screen directly.
2. Activate the plugin through the 'Plugins' screen in WordPress
3. Use the Fair Audience menu in the admin panel to manage participants

== Frequently Asked Questions ==

= What WordPress version do I need? =

WordPress 6.7 or higher.

= Does this work with custom event types? =

Yes, it integrates with the fair_event post type from the Fair Events plugin.

= How can site tools and AI assistants discover this plugin's blocks? =

Every release ships `block-docs/index.json` in the plugin folder. It lists each block the plugin supplies, with its block.json, a usage guide, and serialized examples that match this release. To check which blocks are registered on a particular site, use the authenticated WordPress endpoint `/wp-json/wp/v2/block-types` (it requires the `edit_posts` capability). `block-docs/README.md` explains the difference between shipped, registered, and insertable blocks.

== Changelog ==

## 1.22.0

### Minor Changes

- 20e6bdd: The Mailing Signup block can offer the weekly email of upcoming events. In the block's new "Weekly update" settings, editors show a "Receive a weekly update of upcoming events" checkbox, unchecked or checked by default, and either let subscribers choose event feeds or subscribe them to one feed without showing a choice. A checked weekly update needs at least one feed; the choice applies when the subscriber confirms their email address, and an already-subscribed address is emailed a link to change its preferences instead. When the form's feeds are not available, it says so and signs up without the weekly update. Existing blocks keep working unchanged. The form now also shows the right message when only a management link is sent or a signed-in subscriber's preferences are updated.
- 73a29b6: Show which weekly event feeds a participant subscribes to on their detail page, including feeds that are unavailable or deleted.
- 476994b: Remove the Collaborators page. The Fair Audience menu no longer lists it, a bookmarked link gets WordPress's standard "not allowed" page, and its import/export and event assignment controls and the `/fair-audience/v1/collaborators` route are gone. The public collaborator registration form is retired too: old `?collaborator_profile=1` links answer 410 Gone, accept no submissions and send no confirmation email, whether or not Fair Audience Experimental is active. The Collaborators bundle is gone from the experimental settings, and a `FAIR_AUDIENCE_EXPERIMENTAL_FEATURE_COLLABORATORS` constant no longer has any effect. On upgrade, only the stored Collaborators choice is deleted; participants, their collaborator roles on events, and collaborator recipients in event mailings are kept. See DEPLOYMENT.md for the upgrade notes.
- f4d1353: Subscribers can choose which event feeds' weekly emails they receive. The subscription-management page now offers "All weekly emails" (the default, which also covers feeds added later) or "Only the event feeds I choose" with a checkbox per feed, and each feed's weekly email goes only to the subscribers it is meant for. Existing subscribers keep receiving every weekly email until they choose. The mailing signup endpoint accepts optional `weekly_summary` and `weekly_feed_ids` fields: a new subscriber's choice applies when they confirm their email address, and a signup with an already-subscribed address only emails it a link to the management page. Update Fair Audience and Fair Events together: Fair Events pauses the weekly email until Fair Audience supports feed subscriptions.

### Patch Changes

- 3024913: Admin lists use the latest WordPress DataViews release. Bulk actions now appear in the table header, with a labeled action menu on small screens, and item counts follow the site language's number format.
- eaf9179: Apply the weekly-update choice, event feeds and announcement categories chosen at signup when a subscriber confirms through the link in the confirmation email; previously the link confirmed the address but dropped those choices.
- 1100da4: Content saved with the removed Fair Audience Event Signup block still shows "This form is temporarily unavailable" instead of a file upload when its file-upload question uses Fair Form's new `fair-form/fair-form-file-upload` block name.
- d1d2f1f: Admin screens no longer log "Using null as an array offset is deprecated" warnings on PHP 8.5. The hidden participant and form-response pages keep their titles and access rules.
- 92e5070: Ticket types limited to members of specific groups now stay protected when group membership can't be checked.

    - Without Fair Audience or Fair Audience Experimental active, a restricted ticket type is hidden from signup forms and direct signup or purchase requests for it are refused. Before, such requests were accepted from anyone.
    - Administrators see a warning across wp-admin while this applies. The group settings are kept, and members can buy these ticket types again once both plugins are active.

- Updated dependencies [5bc7dde]
    - fair-events-shared@0.7.1

## 1.21.0

### Minor Changes

- 68ef130: Each plugin now ships documentation of its blocks in `block-docs/`, matched
  to the release: `index.json` lists every block the plugin supplies, with its
  owning plugin, block.json, status, and when it is registered, and each block
  has a usage guide and serialized examples that open in the editor without
  validation errors. Site tooling and AI assistants can read these files from
  the installed plugin and compare them with the blocks a site reports through
  WordPress's authenticated `/wp/v2/block-types` endpoint.
- 993a9d0: Fair Audience now declares PHP 8.2 as its minimum in the plugin header and readme. Earlier releases declared PHP 8.0, but the spreadsheet libraries they bundled stopped the plugin from loading on any PHP older than 8.3. This release runs on PHP 8.2 and newer. Sites on PHP 8.0 or 8.1 must update PHP before installing it.
- d94a7c0: Event notifications now keep one history for Telegram summaries, individual
  emails and group emails. Each scheduled send and each test is recorded as an
  execution with its outcome (success, partial success, failure, skipped or
  unknown), the reason for a skip or failure, and counts of accepted, failed,
  skipped and unknown deliveries. Each delivery names its recipient or chat,
  when it was attempted and a safe reason code; an email is "accepted" once the
  site's mail system took it, which does not confirm it reached the inbox. A
  send that stops midway keeps the results it recorded and marks the rest
  unknown. Names and destinations are kept as they were, so history stays
  readable after a configuration is changed or removed.

    Administrators can read the history through the REST API, for the whole
    site or one configuration, filtered by configuration, channel, scheduled or
    test, outcome and date, a page at a time. Earlier run records and delivery
    records are imported once and marked as legacy, without adding details they
    did not record. History is kept for 365 days.

    Fair Audience reports each group email recipient as it sends. Fair Events
    waits for this Fair Audience version before sending group emails, showing
    the existing "update Fair Audience" notice until then.

- d8f427a: Remove photo authors, photo tags and the participant photo upload page. The media library no longer shows the Photo Author and tag fields, the Photo Author column and filters, the bulk upload author and tag selectors, or the "Set Photo Author" bulk action, and new uploads are no longer attributed or tagged. The Collaborators page drops its photo count column, and the Photos bundle is gone from the experimental settings; a `FAIR_AUDIENCE_EXPERIMENTAL_FEATURE_PHOTOS` constant no longer has any effect. The custom mail and event mailing editors no longer offer "Insert photo upload link". Old "Upload photos" links answer 410 Gone without checking the token or accepting files, and a photo upload link in a saved message is left out when the message is sent. File questions in Fair Form and in event signup still store the upload as a media attachment, without recording the uploader as its author. On upgrade, the photo author/tag records, the bulk upload preferences and the stored Photos choice are deleted; media files, participants and events are kept, and the cleanup can safely repeat and is retried until it succeeds. Update fair-audience-experimental first. See DEPLOYMENT.md for backup and rollback steps.

### Patch Changes

- 300e901: Confirmations for deleting a registration, deleting an event, changing an event's publication and deleting a Mail History record now stay open until the request succeeds. While it runs they cannot be dismissed or confirmed twice, and a failure is shown inside the dialog so you can retry or cancel. Their titles, and those for ending a series and deleting a form submission, name the registration, event, series, record or submission they act on.
- f32a184: Moving a registration, changing its ticket type, editing a ticket and importing transactions now keep their popup open until the request finishes. While it runs, the popup cannot be dismissed or submitted twice and its fields are locked. A failure keeps your choices, reason or imported file in the popup, with the error shown inline, so you can retry. A failed transaction import offers **Retry import** without choosing the file again. A successful move, type change or ticket edit is now confirmed above the List.
- 24cb456: The Instagram access token and the Telegram bot token are now stored encrypted, the same way as the Mollie credentials (Sodium authenticated encryption, with a key derived from the site's WordPress security keys). Existing tokens are converted automatically on upgrade, whether or not the Instagram bundle or any Telegram route is enabled; nothing needs to be entered again. Instagram posting, connection tests and the daily token refresh, and Telegram notifications, work as before. The Instagram access token is no longer returned by the settings REST API (it was never shown on the settings screen); the Telegram bot token is still shown to administrators on the Notifications screen.

    - **Without Sodium support:** a site whose tokens are still stored as plaintext keeps working and keeps storing plaintext; the conversion runs once support is available.
    - **Losing Sodium support after conversion:** the encrypted tokens are kept unchanged. Instagram and Telegram notifications pause, the settings screens explain why, a new token cannot be saved until support returns, and both resume without re-entering anything once it does.
    - **Changing the security keys or moving the database to another site:** the stored tokens can no longer be decrypted. Instagram is shown as needing a reconnection (connect again or enter a new access token), and the Notifications screen asks for the bot token to be entered again; until then nothing is sent. The unreadable values are left in place until they are replaced, or until Instagram is disconnected. If you rotate your WordPress keys routinely, reconnect Instagram and re-enter the Telegram bot token afterwards.
    - **Limits:** this protects against partial leaks such as a table export, a settings export or a value copied into a log. When the WordPress security keys are not defined in `wp-config.php`, WordPress keeps them in the database, so a full database dump still contains what is needed to decrypt the tokens.

- 2a4f217: Event notifications can now have several notifications of the same kind —
  for example two Telegram summaries for different event feeds, or two weekly
  emails to the same address. Each one has its own name, settings, schedule,
  history and duplicate protection, and pausing or changing one leaves the
  others alone. New notifications start paused. Existing Telegram, bulk email
  and individual email settings, including whether they are on, their queued
  sends and the weeks already sent, move over automatically on update.

    Fair Audience keeps one weekly-summary preference for all bulk emails, and
    no longer counts a bulk email that was never set up as configured.

- f95eda6: Event dates are now stored and exchanged only as dates with optional start and end times. The `start_datetime` and `end_datetime` fields are gone from the `fair-events/v1/event-dates` API: requests that send them are rejected, and responses no longer include them. List sorting uses `orderby=start_date`. The public events feed sends `start` and `end` only for a time that is set (or the day boundaries of an all-day event), and `null` instead of an invented midnight. Events imported from another Fair Events site without a start time are no longer skipped. On upgrade, the old datetime columns are removed once every event date has been converted. Admin screens, emails and date labels across the plugins show a time only when one is set.
- 14abf94: Ticketing availability no longer depends on which plugin's setting wins. The
  Fair Events Ticketing feature alone decides whether ticket types, sale periods
  and prices can be configured; the Experimental setting, now labelled
  "Ticketing extensions", only turns group pricing and group permission rules on
  or off. Before, turning Ticketing off in Experimental hid the Prices and List
  tabs although Fair Events still served them, and turning it off in Fair Events
  left the tabs visible while their routes were gone. Group rules now also need
  Fair Events Ticketing to be on, and the Audience tab no longer requests invited
  groups while those rules are unavailable. Existing settings, tickets, prices
  and rules are kept.
- b05c7e3: Event lists, session status and metadata now read event dates with optional times. A date without an end time stays current and upcoming through its end date and is past from the next day, in every events list view. A timed date missing its start time stays upcoming until it ends. JSON-LD and Open Graph show a bare date where a time is missing, and for all-day events, instead of a midnight timestamp. A whole-series pass bought on the start date of a date without a start time covers it. Scheduled mailings anchored to a time that is not set wait without a send time and are rescheduled when the time is set. Signup emails and the mailing event picker show only the date when there is no start time. Events imported from another Fair Events site keep their dates and optional times.
- f7cce69: Recently added text is now translated on sites running in German, Spanish, French or Polish: the notification history and search, the Other Sessions block, the weekly email notices, Mollie and Telegram encryption warnings, and smaller messages that had stayed in English.
- Updated dependencies [f32a184]
- Updated dependencies [21cf6c7]
- Updated dependencies [79f6ea4]
- Updated dependencies [d6adc05]
- Updated dependencies [f95eda6]
- Updated dependencies [157e1ea]
- Updated dependencies [b05c7e3]
    - fair-events-shared@0.7.0

## 1.20.0

### Minor Changes

- 8640376: **Delete My Data** on the subscription-management page now asks for confirmation in an accessible dialog instead of the browser's own confirmation box. The dialog names the profile by its email address and says what is deleted, what is kept (event signups and tickets, attendance records, consent history, payment records and the user account) and that it cannot be undone. Opening, cancelling or dismissing it changes nothing, and a confirmed deletion cannot be sent twice. Without JavaScript the same confirmation is shown as a page before anything is deleted.

    Deleting now needs an explicit confirmed request carrying a short-lived proof issued for that profile, in addition to the signed link. A failed deletion is reported on the page and can be retried, and refreshing the page after a deletion no longer sends it again.

- aa7b447: Manage weekly event notifications on one page, Fair Events → Event notifications. Telegram summaries (formerly in Fair Events Experimental) and the weekly email to subscribers (formerly Fair Audience → Weekly Digest) each keep their own schedule, event source, save button, preview, test send and delivery status. Telegram now needs only Fair Events; the weekly email needs Fair Audience, which still decides who receives it, adds the unsubscribe link and sends it.

    Existing settings, schedules, chats, email wording, the Telegram bot token (still in Settings → Connectors, same environment variable and constant) and the delivery history are taken over automatically. Nothing is sent and no channel is turned on by the takeover; missed sends are not replayed, and a channel that was not being sent arrives turned off. The former settings screens lead to the new page, and their REST routes (`fair-events-experimental/v1/weekly-notifications`, `fair-audience/v1/weekly-digest`) and the `fair_audience_weekly_digest` setting are retired.

    Update the three plugins together. An older Fair Events Experimental or Fair Audience keeps running its own channel until it is updated, and an updated companion next to an older Fair Events pauses that channel until Fair Events is updated. Deactivating Fair Audience pauses the weekly email only; deactivating Fair Events pauses every channel.

- e12f143: Send emails to event participants from Fair Audience → Custom Mail, without Fair Audience Experimental. Pick an event date, write the subject and content, check who will receive it, exclude individual people, and send. Sent messages, including those from before this change, stay in Mail History.

    An email now goes only to the people registered for the selected date. Before, picking one date of a recurring event also reached people registered for its other dates. A missing or malformed address is reported instead of being handed to the mailer, an empty subject or content is refused, and the page says which emails could not be sent and why. Deleting a history record asks for confirmation.

    Sending to the whole audience stays experimental: the option appears on the same page while the Messaging feature of Fair Audience Experimental is on. Group filters and photo upload links likewise need their experimental features.

    Update the two plugins together. An older Fair Audience Experimental keeps showing its own Custom Mail page until it is updated, and Fair Audience says so on its screens; an updated companion next to an older Fair Audience has no Custom Mail page until Fair Audience is updated.

- aa50d3d: **Send Invitations** on the Event Participants page and on the Manage Event Audience tab now shows a summary before anything is sent. It names the event and its date and lists the selected groups or people. Group memberships are counted separately from the number of different people selected, and the summary says how many people will receive the invitation. People who will not get it are counted by reason: already signed up for this date, no longer in the audience, no valid email address, or no confirmed consent to marketing emails. When nobody can be invited, the summary says so and sending stays disabled with the reason shown. Sending goes to exactly the people counted in the summary. Each person is checked again when sending, but nobody who joined a group after the summary was shown gets an invitation. While sending, the dialog cannot be closed and the selection cannot be changed. If sending fails, the error is shown in the dialog and the selection is kept.

    **Disconnect Instagram** now asks for confirmation in an in-page dialog instead of the browser's own confirmation box. The dialog names the account by username, or by account ID when there is no username. It explains that the access token and connection details stored on the site are removed, and that publishing needs a reconnection. Posts already on Instagram and the site's post records are kept. A failure is shown in the dialog, and repeated clicks cannot disconnect twice.

    The new `POST /fair-audience/v1/event-dates/{event_date_id}/event-invitations/preview` endpoint returns these counts without sending any mail. Invitation requests with non-integer participant or group IDs are now rejected with a 400 error.

- a41bfbb: Deleting participants and removing them from an event now ask in the same
  kind of popup everywhere, instead of in browser dialogs.

    - **Deleting a profile** — from All Participants or a participant's own page —
      names the person, or counts and lists everyone selected, and says what
      deletion does: the profile is gone for good, while tickets, event
      registrations and payments are not cancelled, deleted or refunded. When
      some profiles cannot be deleted, the others are, and only the failed ones
      stay selected for another try.
    - **Removing from an event** on the Event Participants page uses the popup of
      the Manage Event Audience tab, for one participant or several. It names the
      event and its date, lists who is removed, and says that profiles, other
      dates and payments are kept. Participants who still hold tickets or
      registrations are listed with what to resolve first and stay in the
      audience; the rest are removed. Inherited series passes are no longer
      offered for removal there, and the bulk action is reachable on phones.
    - **Feedback** for adding or editing a participant, adding people to an
      event, changing a role and sending invitations appears next to the form
      that caused it. A failure keeps what you typed or selected, a save cannot
      be sent twice, and a profile that was created before a group change failed
      is updated — not created again — when you retry.

    Also fixed: the Event Participants page showed the event time shifted by the
    browser's timezone, and the participant page linked back to — and returned
    after deletion to — a page that does not exist.

    The batch removal route (`DELETE
fair-audience/v1/event-dates/{id}/participants/batch`) additionally returns
    `failures`: the participant ID, error code, message and blockers of each
    participant it kept.

- 0b3b08b: Add a guarded "Remove participant" action to the Manage Event Audience tab. An organizer can take a person out of one event date's audience after a confirmation naming the person, the event and the date. Only their place on that date is removed, with the role, activities, check-in and comment recorded for it: the participant profile, their other dates, tickets, registrations, purchases and payments are kept. A participant who still holds tickets, has a registration, or has a payment in progress for the date is not removed; the dialog says what to resolve first (the ticket actions or the List tab), and the server applies the same check, so `DELETE fair-audience/v1/event-dates/{id}/participants/{participant_id}` and the batch route now answer 409 `removal_blocked` in those cases and 404 for a missing event date or relationship. The participants list reports `removal_blockers` per row, and a `fair_audience_event_participant_removed` action fires inside the removal's transaction.
- 3470321: These plugins now require WordPress 7.0 or later. Their admin lists (All
  Events, All Participants, By Event, the Fair Form answer screens, Groups,
  Collaborators and Membership Fees) rely on scripts that WordPress only
  provides from 7.0, so on older versions those screens stayed blank. The
  plugins are now built with the latest WordPress editor and admin packages;
  existing blocks and saved content keep working unchanged.

### Patch Changes

- fdde512: A group discount of a fixed amount larger than an activity's price now makes
  that activity free instead of giving it a negative price. The signup form no
  longer shows a negative activity price or a reduced order total, and the
  discount no longer lowers the price charged for the ticket or for other
  activities in the same order, so a paid signup can no longer be recorded as
  free with a negative amount.
- dfa226f: Update the bundled PhpSpreadsheet library from 5.9.0 to 5.10.0. Spreadsheet
  imports read the same rows and report the same errors as before.
- 4ac5259: An add-on that a participant started paying for but did not finish (an abandoned, failed, cancelled or expired checkout) is offered again when they come back, and they can buy it on a later attempt. Only confirmed add-ons are treated as already bought, and with several tickets an add-on confirmed on one ticket can still be added to another. A participant whose own unfinished checkout holds an activity's last place can start a new attempt, and an activity filled by someone else is now reported as full instead of being silently dropped.
- 56dd426: The individual weekly email now looks like the weekly email to subscribers. It has the site-name header, the events grouped by day with their time and a link, a note on events from other websites, a sign-off and a site-name footer, and it fits phone screens. Both emails get their events and content from Fair Events, so the same week lists the same events in both.

    The weekly email to subscribers keeps its greeting and subscription link. Its empty-week message now names the week, and a missing or disabled event source is reported in its delivery status instead of an empty email being sent. With an older Fair Events, Fair Audience keeps rendering the email itself.

## 1.19.0

### Minor Changes

- 946a907: Sell priced add-ons with Fair Events alone. Add-ons (activities) configured on an event's Tickets tab — with one flat price or a price per sale period — now appear on the signup form and are charged at checkout without Fair Audience or Fair Events Experimental. Each add-on is charged once for every ticket that selects it, and the total shown on the form is the amount charged.

    An add-on that has no price for the sale period currently on sale is no longer offered, and a purchase that still selects it is refused with a message naming it instead of the add-on being given away. An add-on priced at zero stays free, and can now be combined with a paid ticket. Add-ons that are full are marked as full for every visitor.

    Existing add-ons, their prices, past selections and pending payments are kept as they are. With Fair Audience active, its signup and add-activities flows use the same prices and rules, and group discounts keep applying on top.

    For developers: `TicketOption`, `TicketOptionPrice`, `ActivityOptionPriceResolver` and `ActivityOptionTranslation` moved from `FairEventsExperimental` to the matching `FairEvents` namespaces (the old names remain as aliases while Fair Events Experimental is active). Fair Events builds add-on line items itself; the `fair_events_signup_option_line_items` filter is replaced by `fair_events_signup_option_prices`, which only adjusts prices.

- fbd90d6: Let a recognised participant buy another ticket for themselves. A participant who already holds a ticket for an event date now sees their tickets — each with its own ticket type and activities — and, right below, the signup form headed "Buy another ticket for yourself" with their name and email. Their identity, discounts and access to restricted tickets are kept, nothing from the earlier ticket is carried into the new purchase, and "Not you? Start fresh" stays a separate way to continue as someone else. Dates already held are marked in the date pickers and can be chosen again. Each purchase keeps its own signup, tickets and payment, and ticket and activity limits apply as for any other purchase.

    After a purchase, the form gives way to a "Back to the signup form" link, which shows the tickets now held and a fresh form; the payment confirmation page offers the same link and lists the tickets of the purchase just paid for. Confirmation emails for free signups now list the activities chosen with that purchase.

    "Cancel signup" is no longer offered to participants whose signup has tickets, and the request is refused: it removed the participant from the event together with every ticket they hold. It is still available for signups without tickets, such as those added by an organizer. Cancelling a single ticket is done by an organizer from Manage Event.

    For developers: the signed-up card moved from `fair_events_signup_render_before_form` to the new `fair_events_signup_render_existing_signup` action, returned as `existing_signup_html` by `GET fair-events/v1/get-tickets/viewer-context` and placed before the form; `suppress_form` is no longer set for a signed-up viewer. `DELETE fair-audience/v1/event-signup` answers 409 `signup_has_tickets` for a ticket-backed signup. The payment-state response gained `tickets`.

- e751903: Manage single tickets from the Audience tab. Each ticket row now offers **Move ticket** (to another date of the same recurring event, with a required reason when the target date or an activity is full), **Cancel ticket** and, once cancelled, **Delete ticket**. Every action changes only the ticket it names: the purchase, its payment and its other tickets stay as they are, nothing is refunded automatically, and the popups say so before anything changes. A participant left without tickets stays in the audience, no longer listed as signed up.

    The Audience search now finds participants and tickets by purchaser, assignee, email and ticket reference and shows only the matching tickets, and **Export tickets CSV** downloads those tickets one per row with their purchaser and assignee.

- a5b30c4: Let a returning participant register another person. A participant the browser remembers who already holds a ticket for an event date now finds "Register another person" below their tickets. It opens an empty signup form headed "Registering another person": no name, email, ticket choice, activities or answers are carried over, the other person's ticket types and prices are their own (no member discount or members-only ticket), and their signup, tickets and payment are recorded under their own name. The participant's own ticket and the browser's memory of them stay as they were: "Back to your ticket", completing a free registration, or reloading the page shows their ticket again; a paid registration ends on the usual payment confirmation.

    The action is not offered to someone who opened a personal signup link or is signed in to the site. "Buy another ticket for yourself" and "Not you? Start fresh" keep working as before. If the email entered for the other person already belongs to a participant, they get the usual link by email to continue.

    For developers: `POST fair-events/v1/get-tickets` and `GET fair-events/v1/get-tickets/viewer-context` accept `register_another_person` (400 `register_another_person_unavailable` together with a participant token or a signed-in account). Every signup hook that passes `$participant_token` now also passes a trailing `$request_context` array (`register_another_person`); see REST_API_BACKEND.md.

- 85e31c0: Remove the old Fair Audience Event Signup block. Pages that still contain it keep working: they now show the Event Signup form, with their button text and custom questions in the same order. A saved form that asks for a file upload shows a notice to contact the organizer instead, because the Event Signup form does not accept uploads. In the editor, old pages show the block as unsupported and it can be replaced with Event Signup.

    The Event Signup form now protects existing participants. When a visitor types the email of someone already known to the site, and is not recognised as that person, nothing is saved and a link is sent to that address. Opening the link brings back the ticket choice and answers so the signup can be finished. Signed-in members and visitors arriving from their own link continue as before.

### Patch Changes

- 9413f36: Load the plugins' own scripts with WordPress's `defer` strategy. The Add to Calendar button script, the payment return notification script, and the admin and editor scripts of these plugins no longer pause page parsing while they download; they stay in the footer and behave as before. WordPress still loads a script the usual way where deferring would break ordering — Manage Event while a plugin adds tabs to it (Fair Audience does), and Fair Events → Settings while an extension adds a settings tab.
- 3a7b83d: Calculate signup and payment totals in one way. The amount saved with a signup, whether it is free or paid, the amount charged and the line items recorded in the finance ledger now all come from the same calculation: amounts have two decimals and are rounded half up — each unit price first, then each line, then the total. Purchases at ordinary two-decimal prices are unchanged.

    A price with a fraction of a cent (for example after a discount) can now differ by a cent from what one of these places showed before, and a total that rounds to zero is confirmed as free instead of being sent to payment. In a purchase for several dates, each date's signup now holds its own rounded amount.

    For developers: a transaction's amount is always the total of its line items. `fair_payment_before_validate_line_items` may still change the line items, which are validated again; a total changed through `fair_payment_calculated_total` or `fair_payment_before_create_transaction` without matching line items is refused. Line items may now be negative (discounts) or zero as long as the total is positive, and a quantity must be a positive whole number. `fair_payment_create_transaction()` accepts `expected_amount` to refuse a transaction whose total differs from the amount the caller decided on.

- 48275f4: Reject participant signups for a ticket type that has no price for the current sale period instead of completing them for free. Signups without a ticket type and ticket types with an explicit zero price still confirm for free.
- 3cbb450: Payment Transactions: search by transaction ID, Mollie payment ID, description, or the person's name or email, and filter by date and amount range. Filters apply together with Status and Mode, show the number of matching transactions, and reset to the Paid / Live defaults.
- c0c3d69: Keep purchases that are not paid out of the rosters. In the Audience tab, someone whose purchase awaits payment is now shown as **Payment in progress** (or **Payment not completed** once the payment failed or its hold ran out) instead of a raw status, and is counted apart from signed-up participants. Saving a comment or other details for them no longer marks them as signed up; an administrator can still pick a role on purpose. A collaborator, or someone holding a ticket another participant gave them, keeps that role when a purchase of their own fails or expires.

    The List tab and its export now show only tickets that are confirmed: a cancelled ticket of an otherwise confirmed registration is no longer listed, and the registration's ticket count matches the rows shown.

- 64c0160: Plan a workshop schedule in Manage Event. With Fair Events Experimental active, Manage Event → Prices → More options has a new **Workshop schedule** setting; once saved, a **Schedule** tab appears after Prices. There you add each add-on as a workshop with its date, start and end time, room or location and description — its name, price and capacity stay in Prices — and add schedule items such as breaks, which are never a ticket choice. Workshops may run at the same time, also in the same room. A workshop can be marked **Not bookable**: it stays on the schedule and leaves the signup form, and purchases that try to include it are refused. That switch is refused while tickets or reservations include the workshop, and an add-on that is on the schedule cannot be deleted or replaced by an import in Prices. A series keeps one schedule, managed on the series and shifted to each of its dates; copying an event copies its schedule. Turning the setting off hides the tab and keeps the entries and their booking status. Fair Audience no longer accepts a not-bookable workshop in its own signup routes.

## 1.18.0

### Minor Changes

- 93df554: Administrators can now give one ticket of a purchase to someone else from the Audience tab. "Assign ticket" on a ticket shows who bought it and who holds it, and lets you pick any existing participant — including the purchaser, to take it back — or add a new one in the same step. If the email you enter already belongs to someone, you are offered that person instead of a duplicate. Only the chosen ticket changes hands: the purchase, its payment and its other tickets stay with the purchaser, who keeps receiving confirmation and refund messages. The ticket then appears under its new holder with "Purchased by …", and a purchaser who has given away every ticket is listed as the purchaser rather than as attending. A checked-in ticket has to have its check-in cleared first, and tickets that failed, expired, were cancelled or refunded cannot be assigned.
- f6f2aa4: The List and Audience tabs now open the same "Edit ticket" popup for an individual ticket. It names the participant and the ticket ("Ticket 2 (AE2671B5)"), shows its status, and lets an administrator change the ticket's type, activities and check-in in one save, without touching the other tickets of the purchase or its payment. It says that a type change makes no charge or refund, checks the type's activity rules, and shows every ticket-type and activity limit the change would pass, saving over capacity only with a reason. A failed save keeps the popup open with the edits. With Fair Audience active, the List shows each purchase's tickets with their own types; without it, the List keeps its "Change ticket type" action for the whole purchase, which is now refused once a ticket has been given its own type. Tickets awaiting payment are read-only, including their check-in.
- f62e157: Let a participant buy tickets again for a date they already hold a ticket for. Each purchase keeps its own signup, tickets and payment. The Event Signup form now protects against accidental repeats instead: submitting the same purchase twice, or retrying after a lost connection or a payment that could not be started, continues the first purchase and never charges twice. After an error message the form can be submitted again without reloading the page.
- 22a1e88: Event statistics now count confirmed tickets instead of participants. A purchase of three tickets adds three to the total and the cumulative chart, and cancelling or refunding one ticket removes one. Whole-series tickets count once on each occurrence they cover. The activity charts show tickets per activity and activities per ticket, with a notice for older tickets whose activities were recorded per participant. Revenue is unchanged.
- 928d9f2: Move event Statistics into Fair Events. The Statistics tab on Manage Event and the standalone Statistics page no longer need Fair Events Experimental, and the page explains when Fair Audience is missing. The statistics endpoint now lives at `/fair-events/v1/event-dates/{id}/statistics`; the former `/fair-audience/v1/...` path keeps working as an alias. Experimental's "Audience statistics" setting is retired.
- 98c6e65: Fair Form answers collected during a ticket signup now belong to a specific ticket: the purchase's first ticket, since the signup form still collects one set of answers. A second purchase by the same person keeps its own answers instead of replacing the first one's. The "Edit ticket" popup shows the answers of that ticket, the Event Participants list shows each ticket's answers under that ticket, and the signup export names the ticket each answer set belongs to. Answers collected before this change are attached to the first ticket of the person's earliest purchase for that date and flagged for review; answers with no matching ticket, or whose ticket is removed, stay with the person and are flagged for review too. Standalone Fair Form submissions are unchanged.

### Patch Changes

- 7ccd235: Remove the Delete action from the Manage Event Audience tab; registrations are deleted from the List tab.
- e803bba: Link ticket payments to the participant who bought them. Payments show the buyer as the Person, and the purchase appears in that participant's activity, also for first-time buyers, retried payments and series purchases. Earlier ticket payments are linked where their signups clearly identify one participant.
- 78727b4: Pages with the Mailing Signup, Fair Form, or Simple Payment block load much less JavaScript. These blocks no longer load the block editor's component library for visitors. The forms and the payment button work as before.

## 1.17.0

### Minor Changes

- 6be67b2: Count activity places per ticket. Several tickets bought together each take their own place in the activities they select, and the signup form asks for each ticket's activities, with a button that applies the first ticket's choice to all. Every purchase, added activity, retried payment, move and admin edit checks the activity's remaining places, so buying at the same moment can no longer overbook it. On recurring events each date has its own activity places, and a whole-series ticket takes one on every date it covers. An administrator can go past an activity's limit only by giving a reason, and the change is shown as over capacity. A payment that arrives after its place was taken is still honored and flagged. A failed payment for added activities releases their places at once.
- 9af947f: Show each ticket as its own row in the event Audience tab, under the purchaser. Every ticket row shows its reference, type, activities, and status. It has its own check-in box and an "Edit ticket" action, while participant actions stay on the participant row as "Edit participant", "Delete", and "Move". Activity totals now count tickets. Activities not tied to a ticket are totalled separately and appear on a "Not tied to a ticket" row. The printed list gives each ticket its own row. On narrow screens the table stacks into labelled cards.
- 1246f44: Remove the event photo gallery. The Photos tab of Manage Event, the public gallery page, photo likes and downloads, gallery access links, the "Send Gallery Link" action, the gallery count on Event Participants and the Images/Likes columns of By Event are gone, together with their REST routes. Old `?gallery_key=`, `?event_gallery_id=` and `/event-gallery/{id}` links now answer 410 Gone without checking the token. On upgrade, the gallery relationship, likes and access key tables are dropped; the cleanup can safely repeat and is retried until it succeeds. Media files, photo authors and tags, participant and questionnaire photo uploads, and event promotional images are kept. In fair-audience-experimental the retained photo upload and attribution features move from the `galleries` bundle to a new `photos` bundle, which inherits the stored choice. See DEPLOYMENT.md for backup and rollback steps.
- 66142ed: Store activities and check-in per ticket. A purchaser with several tickets can have different activities on each and be checked in one ticket at a time from the Audience tab. Activities added later go to the chosen ticket. Earlier participant-level activities and check-ins are moved to a ticket only when the participant holds exactly one ticket for that date. Otherwise they stay visible as participant-level history.

### Patch Changes

- afe881c: Add an Event Prices block that displays an event's public ticket prices — enabled ticket types, sale periods, and their formatted prices — directly from the linked event's Prices tab, automatically following the visitor's selected recurring-event occurrence. Free, unavailable, and disabled tickets are shown without implying they can be purchased.

    Ticket pricing across the signup and purchase flows now treats only an explicitly stored zero price as free. A ticket type with no price row at all is unavailable rather than free by convention, matching what the new block (and the Prices tab) shows — closing a gap where a ticket that looked unavailable could previously still be purchased for free at checkout.

- 4d692f4: Record every purchased admission as its own ticket unit. A signup for three tickets now owns three individually identifiable tickets, each with a permanent ID, an unguessable public reference, its event date, ticket type, status, purchaser, and current holder. Ticket status follows the signup through payment, expiry, retry, failure, and checkout cancellation, and deleting a signup removes its tickets. Existing signups, including pending, expired, and failed ones, receive their tickets through a background migration that runs in small batches, can resume after an interruption, never creates duplicates, and finishes only after every signup's tickets match its quantity. When fair-audience matches existing signups to participants by email, their tickets are linked to that participant too, and deleting a participant's data removes the participant from their tickets while keeping the purchase history. Signup data and event participation records are unchanged.
- 74f0e21: Simplify the Manage Event List tab into a registration roster. It now shows only confirmed registrations (paid or free), numbers them from 1, and adds one column per configured extra showing whether each person holds it. Email addresses and amounts paid are no longer shown in the table or its delete dialog, but remain available in exports, which cover the displayed registrations. Fair Audience's event participants endpoint now also reports `confirmed_ticket_option_ids`, excluding extras still waiting for payment; without Fair Audience the extra columns show that selections are unavailable.
- eaa4a73: Administrators can now move a signup to another date of its series, or give it another ticket type, from the Manage Event List tab. The signup and all its tickets except cancelled or refunded ones change together, and each choice shows how many places are left. When the chosen date or ticket type is full, the change needs a reason: it is then saved, the signup is marked "Confirmed — over capacity", and a details link shows who went over capacity, when, and why. A signup flagged because its payment arrived after its hold expired says so. The amount paid never changes. Fair Audience moves or updates the participant's registration to match, so the Audience tab agrees with the List.
- 3af47de: Add a "Download PNG" action to the Cumulative sales and Cumulative sales amount charts on the event Statistics tab. Each image includes the event name, the chart title, and the complete chart, and is saved under a filename that identifies both the event and the chart. The event name now also appears as a subtitle on those two charts. The event statistics endpoint returns the event's display name as `event_name`.
- 48f7df4: Event and ticket-type capacity is now counted per ticket and enforced when tickets are bought. A purchase of four tickets takes four places, and buyers who ask for more than is left are told how many places or tickets remain. Both limits are checked and the tickets saved together, so buyers purchasing at the same moment can no longer take the same last place. A paid reservation holds its places from the moment it is made until its payment window ends. A failed, cancelled or expired payment frees them. Retrying a failed payment succeeds only if its places are still free. A payment that arrives after its window ended is still honored, and the signup is flagged as over capacity when someone else took the places in the meantime. For recurring events, a ticket for one date or for chosen dates takes a place on each of those dates, and a whole-series pass takes one place on every date from its purchase on. Admissions recorded before individual tickets existed, including participants added by hand in fair-audience, keep their places and are never counted twice. The "has sales" check that protects ticket types from risky edits uses the same count and no longer needs fair-audience.

## 1.16.0

### Minor Changes

- dde767a: Add net paid sales totals and cumulative revenue charts to event statistics, including refund timing, transaction deduplication, and currency-mismatch warnings.

### Patch Changes

- b8821ed: Show each participant's printed-list number in the "Record email consent" popup so organizers can match answers to the printed roster while going through both lists in parallel.
- 8725b13: Limit the "Participant" copy list on the Audience tab to Signed up registrations, so Interested and Collaborator rows no longer show up in a copied roster of confirmed registrations.
- e9bcbcc: The "Record email consent" popup now lists participants in the same order as the printable participant list, following the Audience table's active sort instead of the raw participant fetch order.
- a1c2dd7: Stop cumulative event sales statistics at the current website-local day instead of extending into the future.
- d0dd54a: Keep cumulative sales charts anchored to the event date while distinguishing recorded sales from the future event horizon.
- 452cc30: Consolidate ticket sale-period and ticket-type availability into a single `TicketAvailability` service in fair-events, always evaluated in the WordPress site timezone. Fixes two boundary inconsistencies found while consolidating: event JSON-LD offers now respect a ticket type's scheduled end date (previously only manual disabling was checked), and the fair-audience signup form's purchase validation now also rejects a manually disabled ticket type (previously only its scheduled end date), matching what the signup form already hides.
- Updated dependencies [19d0333]
    - fair-events-shared@0.6.2

## 1.15.0

### Minor Changes

- 8e78b19: Add server-backed cumulative event sales statistics and a responsive sales summary chart.
- 8c56f63: Recognize participant-token links throughout the unified Event Signup flow, including personalized hydration, authoritative pricing and eligibility, and participant linkage.

### Patch Changes

- adf8ba3: Prevent active payment reservations from being flagged over capacity, serialize genuinely late confirmations, and clear unreliable historical warnings during upgrade.
- 2971a6b: Preserve site-local event times when formatting signup emails.
- Updated dependencies [a96d4f1]
    - fair-events-shared@0.6.1

## 1.14.0

### Minor Changes

- 04cce70: Add per-ticket extension selection controls with authoritative minimum and maximum enforcement in the signup interface and API.

### Patch Changes

- 41cdb3c: Replace registered attendees' recurring-date link lists with compact selectors that navigate to the correct public occurrence.
- f45f69a: Keep the event signup cancellation button legible in every interaction state.
- cd96441: Let cookie-recognized visitors safely forget the remembered identity from an existing signup without cancelling it.
- 47b9041: Persist and enforce audience-group ticket restrictions without requiring Fair Events Experimental.
- 68a2a52: Use configured activity short names in copied activity summaries, falling back to full names when needed.

## 1.13.1

### Patch Changes

- 121db5a: Keep paid signup holds active for their full duration regardless of the WordPress site timezone.
- 0c2aaad: Retain expired paid signups for reconciliation, safely process late payment notifications, and scrub retained signup details during participant anonymization.
- c43db89: Fix paid-transaction Telegram/email notifications missing event, ticket, activities, discounts, and even the participant name when a transaction's `participant_id` never resolved at creation time — enrichment now uses the payment ledger to fill in event/ticket data and falls back to the ledger's participant for the name, instead of silently skipping everything.
- af12d06: Make Telegram/email payment notifications describe the purchased item — membership-fee payments now show the group and fee name instead of empty ticket/activity/discount lines, and any line whose value can't be resolved (including the event link) is omitted rather than rendered blank.

## 1.13.0

### Minor Changes

- 49f2e0a: Link the event name to its page in the confirmation-family emails — signup confirmation, payment-failed, activities-added, event-interest, and mailing-list-welcome — instead of just bolding it. Falls back to the previous bold-only text when no event URL is available.
- f64745d: Move fair-audience's signup confirmation email formatting into a shared `FairEventsShared\Notifications\SignupConfirmationEmail` formatter, and use it for both plugins' confirmation emails. fair-audience's confirmation email now also shows the event date, a registration reference, and the ticket type. fair-events' standalone confirmation email (sent when fair-audience isn't active) is now built from the same branded HTML template instead of a plain-text message, and includes the ticket type and — on paid signups — the amount paid.

### Patch Changes

- 4b9d893: Add "Date" and "Date & Time" question blocks (mirroring the email/phone/url questions) that render the browser's native date/date-time picker on the frontend. Values are validated server-side as real, well-formed dates and rejected with the same error conventions as other typed fields; datetime answers are stored as site-local time. Stored answers render as localized, human-readable dates in the submission-detail and questionnaire-responses admin views. Also adds the new question types to Event Signup's block inserter (fair-audience and fair-events) and their shared validation (fair-events-shared).
- 4ec1056: Add a URL question block (mirrors the email question) that renders a mobile-friendly text input on the frontend, normalizes bare domains to `https://`, and rejects non-web values server-side. Stored answers render as links in the submission-detail and questionnaire-responses admin views. Also fixes the url and email questions never appearing in the block inserter inside Event Signup (fair-audience and fair-events), and extracts the question-block allow-list into fair-events-shared so fair-form-conditional stays in sync.
- 5fe6658: Reduce the database queries issued when rendering or purchasing through the Event Signup form: the active sale period, the viewer's group memberships, and the event's discount rules are now resolved once per render/request and reused across every ticket tier and activity, instead of being re-resolved once per tier. Query count no longer scales with the number of ticket tiers; displayed and charged prices are unchanged.
- 0e27b5c: Fix the Event Signup form leaking one visitor's group-restricted ticket tiers, discounted prices, and name/email pre-fill to another visitor under full-page caching. The form now server-renders the same unrestricted, undiscounted, unfilled markup for every viewer, and fetches the actual viewer's personalization (restricted tiers, discounts, pre-fill, signed-up state) client-side after load.
- 4eb856e: Fix the group discount note on the signup form so it always matches the price actually charged: it now compares each rule against the ticket's real price (not a notional reference price), stays hidden unless a price is genuinely reduced, and shows fractional percentages (e.g. 12.5%) without rounding them away. When different ticket tiers get their best price from different rules, the shared note is dropped in favor of a per-tier label.
- ee7eafc: Fix the Event Signup form and its checkout/payment paths fataling with a white screen when fair-events-experimental lags behind fair-audience's expected pricing interface (e.g. a partial or delayed update). Group-discount pricing lookups now degrade gracefully to the base price and log a warning instead of crashing the page.
- c58909d: Hold capacity for a paid activity while its add-on payment is in flight, instead of only counting it once payment confirms. Previously, two buyers could both pass the capacity check for the last spot on a capacity-limited activity because an in-progress add-on purchase wasn't reserved anywhere. An unpaid add-on selection also no longer appears as an already-granted activity on the signup form while its payment is still pending.
- Updated dependencies [4b9d893]
- Updated dependencies [4ec1056]
- Updated dependencies [49f2e0a]
- Updated dependencies [aeda159]
- Updated dependencies [f64745d]
- Updated dependencies [7932bb2]
    - fair-events-shared@0.6.0

## 1.12.0

### Minor Changes

- 3e696d0: Move the "Bundled translations" toggle out of each plugin's own settings screen into a single shared **Settings → Fair Event Plugins** screen that lists one row per active plugin. Previously saved values keep working unchanged. fair-audience and fair-payments-connector lose their Features tab (bundled-translations was its only entry); fair-timetable loses its whole Settings page; fair-platform loses its Features submenu. fair-events keeps its Features tab for the Ticketing bundle. The experimental companion plugins (fair-events-experimental, fair-audience-experimental, fair-payments-connector-experimental) now always load their bundled translation files instead of waiting on a WordPress.org language pack that will never exist for them.
- 8fa5d96: The unified Event Signup block (`fair-events/event-signup`) no longer delegates its render to fair-audience's legacy block when fair-audience is active — it renders its own markup unconditionally, and fair-audience enriches that same render via the existing filter/render-slot hooks instead of owning a competing template. A returning participant who already holds a ticket for the date now sees a signed-up/cancel card in place of the signup form, with a "cancel signup" action; per-occurrence date pickers label dates the viewer already holds (including via a whole-series pass); a resubmitted paid-ticket purchase for a date already held is rejected instead of silently creating a second charge; the per-IP rate limit is raised to 20/hour with an added 3/hour per-email limit, so a shared venue Wi-Fi no longer blocks legitimate signups. Sites without fair-audience see no change. The legacy `fair-audience/event-signup` block, its own identity routes, and existing signup links keep working unchanged for content authored before this change; participant_token URL login and the "I have an account" resume-by-email flow are not yet available on the unified form and remain on the legacy block for now.
- d5ca5fa: The unified Event Signup form (used once fair-audience owns the flow, #1245) now respects group-restricted ticket types and group discount pricing: a ticket type restricted to specific groups is rejected server-side for a visitor who isn't a member, and the charged price reflects the viewer's best-matching group discount, with a note shown above the submit button. Entitlement is resolved from the signed-in/known viewer's session, never from the submitted name/email, so a crafted request can't unlock a restricted tier or a discount it isn't entitled to.
- 8f1871d: The unified Event Signup form (used once fair-audience owns the flow, #1245) now supports selectable activities (ticket options): a participant can pick zero or more paid or free add-on activities at signup, subject to a minimum-activities requirement (global or raised by the selected ticket type), and a signed-up participant can add further activities to an existing registration. Capacity, pricing, and group discounts are all enforced server-side, so a crafted request can't buy a full activity, skip the minimum, or dodge the charge.

### Patch Changes

- 7281a45: Centralize amount and currency formatting behind a shared `FairEventsShared\Money` helper (PHP) and matching `formatMoney`/`formatMoneyInline` helpers (JS), fixing the Fair Audience and Fair Events signup blocks, which previously hardcoded the € symbol regardless of the site's configured currency. A non-EUR site (e.g. PLN, CZK, HUF) now shows its real currency on ticket labels, add-on prices, and the running total — including after ticking an option, which previously reverted to €. EUR output is unchanged everywhere (signup blocks, emails, Timeline, Mollie payloads).
- 84cfda0: The Conditional Section block, when nested inside a signup form, can now show or hide its contents based on the visitor's selected ticket type (in addition to the existing question and event-option sources) — pick one or more ticket types and an "is selected" / "is not selected" operator, and the section reacts live as the visitor changes their selection. Also fixes the Conditional Section's "Event option" condition source, which failed to appear when nested inside the unified Event Signup block (it only recognized the older, hidden legacy block).
- 930991b: Fix the Participant Detail admin page on mobile: it now renders with an even `.wrap` gutter on both sides, the header and Profile card stack instead of overflowing the screen, and the Events/Form-submissions tables scroll inside their own card instead of dragging the whole page sideways.
- 41c5000: Fix the unified Event Signup form crashing with a server error on every submission when fair-audience is active. Two hook registrations in `SignupHookBridge` accepted fewer arguments than fair-events actually passes them, so WordPress threw a fatal `ArgumentCountError` before any signup could save — for every combination, with or without a ticket type or selected activities.
- 1f9fcc1: Fix long-answer question fields rendering collapsed to a single line instead of sizing to fit their content. A long-text question nested inside a Conditional Section stayed collapsed until the respondent typed in it, because the auto-grow behavior ran on hidden textareas (always 0 height) and never re-ran once the section was revealed. Long-text fields also had no styling at all outside the plain Fair Form block (e.g. in the Event Signup blocks), and could grow without limit; they now cap at roughly 12 lines and scroll internally beyond that.
- 1c4ac34: Removed the invitation-gated ticket signup mechanism: the "invitation only" ticket type toggle, the Manage Invitations admin page and its REST routes, and the public signup form's `?invitation=` link handling and "show inviter's name" option. The gating check had silently broken (an autoloader namespace mismatch made it dead code — invitation-only ticket types were already invisible on the public form, not merely restricted), so a migration disables any ticket type that was previously marked invitation-only rather than making it suddenly public, and drops the now-unused `invitation_only` column and `fair_events_invitation_tokens` table. Group-restricted ticket types and the separate bulk "send invite emails" outreach feature are unaffected.
- ab61aba: Fixed a PHP 8.2 dynamic-property deprecation notice that fired on nearly every event-date read (`EventDates::$signup_price`, left over from a partially-reverted merge). Rather than re-declaring the field, finished removing it: the flat per-date "simple pricing" mode and pay-what-you-can sliding scale it powered were already superseded by ticket-type pricing everywhere except the legacy fair-audience Event Signup block, which now prices signups from ticket types only. The `signup_price` column is dropped from the event dates table via migration. Also fixed the same class of deprecation notice on `FairAudienceExperimental\Models\Group::$member_count`, populated by the groups admin list.
- Updated dependencies [7281a45]
- Updated dependencies [84cfda0]
- Updated dependencies [8d196d7]
- Updated dependencies [9ae94d2]
- Updated dependencies [1f9fcc1]
    - fair-events-shared@0.5.0

## 1.11.0

### Minor Changes

- a7c09e1: Time out unconfirmed marketing subscriptions after a week (reverting them to minimal+confirmed and sweeping expired confirmation tokens), let subscribers opt out of just the weekly events summary independently of their other topic preferences, and show that weekly-summary opt-out on the participant detail page. Show the link source (domain or @handle) next to off-site event links in the weekly digest. Route every outgoing email through a single consent-enforcing method so marketing-consent checks can no longer be skipped by a new send path, sanitize payment gateway errors before they reach the event-signup form, and drop the redundant event_participants.transaction_id column in favor of the transaction ledger. Remove the Add-on collaborator discount ticket option and standardize remaining block buttons on core Button styles.

### Patch Changes

- Updated dependencies [a7c09e1]
    - fair-events-shared@0.4.0

## 1.10.0

### Minor Changes

- 6973be8: Add a signup hook contract shared with fair-events, resolve payment webhooks via the transaction ledger, and support simple HTML in the weekly digest intro/outro text. Require confirmed status for the marketing email consent gate, fix the weekly digest to stamp its last-sent-week when the send slot already passed, and use the date param for the event-signup occurrence picker.

## 1.9.0

### Minor Changes

- efe9aae: Move the fees, polls, instagram, collaborators, image-templates, timeline, import, and weekly-schedule bundles out of `fair-audience` into the `fair-audience-experimental` companion, gated behind their `Features::is_enabled()` flags. None of these bundles had callers outside fair-audience, so this is the lowest-risk slice of the fair-audience/fair-audience-experimental split (issue #1041). The `fair-audience` top-level admin menu now lands on All Participants instead of the (now-moved) Activity Timeline page.
- 3e34be8: Move the groups and invitations bundles out of `fair-audience` into the `fair-audience-experimental` companion, gated behind their `Features::is_enabled()` flags (issue #1041). `Group`/`GroupParticipant` and their repositories are renamed to `FairAudienceExperimental\…` and now travel with the companion; every core `fair-audience` call site (participant lists, custom mail, payment discount labels, signup pricing, anonymization, the signups-list block) and the `fair-events-experimental` invitation-token controller degrade gracefully via `class_exists()` guards when the companion is inactive.
- e84e6b3: Move the galleries and messaging bundles out of `fair-audience` into the `fair-audience-experimental` companion, gated behind their `Features::is_enabled()` flags (issue #1041). `PhotoParticipant`/`GalleryAccessKey` and `CustomMailMessage`/`ExtraMessage`/`ScheduledMessage` (plus their repositories, controllers, admin pages, media-library hooks, and the scheduled-message cron) are renamed to `FairAudienceExperimental\…` and now travel with the companion; every cross-plugin call site (`fair-events-experimental`'s gallery endpoint, stable `fair-events`' gallery page, `fair-form`'s questionnaire photo tagging, and core `fair-audience`'s email service and anonymization service) degrades gracefully via `class_exists()` guards when the companion is inactive.
- 8a1195f: Move the manage-event tab extensions (Audience, Groups, Mailings) out of `fair-audience` into the `fair-audience-experimental` companion under the `manage-event-ext` feature flag (issue #1041). The tab bundle's enqueue wiring on fair-events' manage-event page — previously always registered by `fair-audience` — now lives in the companion and only mounts when its `manage-event-ext` feature is enabled, mirroring how `fair-events-experimental` merges its own manage-event extensions.
- 612b9b0: Add a `GET /participants/stats` endpoint and a row of clickable stat tiles (total, mailing, pending, declined) above the All Participants table, so audience size and mailing health are visible without manually combining filters (issue #1054).
- 2a3600a: Move the manage-event Audience tab from `fair-audience-experimental` back into core `fair-audience`, so it now renders on the fair-events Manage Event page without the experimental companion plugin active. The Groups and Mailings tabs remain in `fair-audience-experimental` behind the `manage-event-ext` feature flag.
- 612b9b0: Add a Move action on the Manage Event Audience tab to re-point a participant's signup to a sibling occurrence of a recurring event in one step, instead of deleting and re-adding and losing attendance state, admin comments, ticket options, and payment status (issue #954). Adds `GET /event-dates/{id}/siblings` to fair-events and `POST .../participants/{id}/move` to fair-audience.
- 845f26f: Resume anonymous event signups on a recognised email instead of discarding the filled-in form: a visitor who types a known email with no matching session now gets an email that restores their ticket, activity, sliding-scale and questionnaire answers and takes them straight to payment or completion.
- b40157e: Add the Weekly Digest admin page: configure the enable toggle, event source, send day/time, week scope, skip-empty, subject, and intro text, with a live preview pane, send-test-to-me button, and a last-run summary.
- 2bd2187: Add the weekly events digest backend: a `fair_audience_weekly_digest` option, `WeeklyDigestController` REST routes (config, sources, preview, test-send), a shared `WeeklyDigestRenderer`, and a `WeeklyDigestHooks` cron with `last_sent_week` idempotency (issue #916). No admin UI yet — configuration is REST-only until the admin page lands.

### Patch Changes

- 612b9b0: Replace `window.confirm`/`alert` on the All Participants page with a state-controlled ConfirmDialog naming the participant or count, a reusable EmailSendResultNotice for resend results, and Snackbar/Notice feedback for copy-link, per UI_GUIDELINES.md (issue #1056).
- f1985d8: Add e2e coverage for the fair-audience-experimental Features registry (all-bundles-on/off admin page and REST route checks) and wire `dist-archive:fair-audience-experimental` into the root release build, closing out the fair-audience/fair-audience-experimental split (issue #1041).
- 612b9b0: Preserve scroll position when switching the recurrence occurrence picker on the event-signup block, which previously reset to the top of the page on the `?event_date=<id>` reload.
- b007d8a: Centralize ticket price resolution in a new `FairEvents\Services\TicketPricing` service and a shared `ticket-pricing.js` module, so the fair-events get-tickets purchase paths and the fair-audience event-signup pricing agree on price. Previously get-tickets used a closed `[sale_start, sale_end]` sale-period interval while fair-audience used a half-open `[sale_start, sale_end)` interval with a `continues_pricing_period` fallback — the two could charge different prices for the same ticket type on a sale period's end day. get-tickets now uses the half-open convention too.
- a7f7373: Fix "Cancel and start over" leaving the participant's `pending_payment` row in place, which let render.php's DB-fallback resurrect the same stuck checkout on the next page load. The delete event-signup endpoint now accepts `pending_payment` (not just `signed_up`), and the frontend calls it before navigating to the stripped URL.
- f92bab0: Disable the Tickets, Signups, Finance, Groups, Audience, Mailings, and Statistics tabs on the Manage Event page when the event's link type is External URL, since there is no registration behind those tabs for link-only events.
- 612b9b0: Fix the consent checkbox block being registered but not insertable: add it to the allowed-blocks lists of fair-form, fair-form-conditional, and fair-audience's event-signup block.
- 91ca56d: Fix `create_multi_instance_signup()` paid response missing `success: true`, which left the buyer stranded on the event page instead of redirecting to checkout for `multiple_instances` ticket types.
- 91ca56d: Fix `register_and_signup()` (the public "I'm new" registration form) charging only one occurrence's price for `multiple_instances` ticket types instead of the sum across every chosen occurrence.
- a7f7373: Fix stale `fair-audience-submission-detail` links in the participant timeline and participant detail page — the submission detail page moved to `fair-form`, so these now point at `fair-form-submission-detail`.
- 612b9b0: Move Add Participant to the native page-title-action position, drop the mostly-empty Phone/Instagram columns from the default All Participants view (still available via view options), and replace the Status + Email Profile columns with a single Mailing column that names the mailing intention (issue #1055).
- 612b9b0: Fix the "continue where you left off" email link landing on the failed-payment retry card instead of the resume form when the participant also had a stale `pending_payment` hold. The resume-token branch is now checked first, and the signup block auto-scrolls into view on restore.
- a7f7373: Remove the seats-per-ticket capacity weighting feature. It let a ticket type consume more than one capacity slot, forcing every capacity query, signup projection, and participant snapshot to carry a per-row seat weight. Capacity math now collapses back to a plain row count; the Seats column/checkbox, the `seats_per_ticket` column, and the `seats` column on `event_participant` are dropped, with a forward migration for existing installs.
- f4c06ef: Restyle the All Participants page with native WordPress components: stat tiles sit in an equal-width responsive grid with hover feedback and an accent highlight on the tile matching the active filter (aria-pressed), the tiles/notices/table share consistent VStack spacing, the events popover uses ItemGroup, and the page's inline styles move to a `style.css` built to `style-index.css` (AdminHooks now enqueues per-page stylesheets when present).
- 547ed04: Show a paid/pending/failed status marker next to the transaction link in the participant detail Events table, so an admin can tell a successful payment from a failed or abandoned one without opening each transaction.
- 1cdf0b4: Add test coverage for the weekly events digest (issue #916): PHPUnit tests for `WeeklyDigestRenderer` (config sanitizing, HTML shaping) and `WeeklyDigestHooks` (due/idempotency guard), a REST API spec for `WeeklyDigestController`, and a component test for the Weekly Digest admin page. Also adds a PHPUnit setup (`phpunit.xml`, `__tests__/bootstrap.php`) to fair-audience, mirroring fair-events.
- Updated dependencies [b007d8a]
- Updated dependencies [612b9b0]
- Updated dependencies [612b9b0]
    - fair-events-shared@0.3.0

## 1.8.0

### Minor Changes

- 551e827: Add three-level email consent (Yes / missing / No): new `declined` profile value records that a participant was asked and refused, a renamed `marketing-consent` endpoint handles both upgrade and decline in one request, and the event-floor consent modal lets organizers record Yes/No per row. All-participants table, edit modal, and participant detail now display the declined state.
- 2cb0fb8: Move the Audience, Groups, and Mailings tabs out of fair-events and into fair-audience, which now owns audience-facing management for an event. fair-events registers the extension point and fair-audience renders these tabs, consolidating participant and mailing management in one plugin.
- 8a3310c: Allow upgrading an existing single-instance signup to a whole-series pass instead of blocking it as a duplicate. The buyer is charged only the difference between the series price and what they already paid, and every transaction on a registration is now preserved in a ledger (laying the groundwork for refunds).
- 2cb0fb8: Add sliding-scale (pay-what-you-can) event pricing: organizers can offer a ticket type where the buyer chooses the amount within a configured range. The manage-event admin UI exposes the new pricing mode, the event-signup block lets attendees enter their own price, and the server validates the chosen amount against the configured bounds.
- 2cb0fb8: Show test-mode ticket sales in the participant timeline while the site is in test mode, so organizers verifying a checkout flow can see the resulting sale events. Test-mode sales are hidden again when test mode is off.

### Patch Changes

- 2cb0fb8: Bump @wordpress/components 35→36 and @wordpress/dataviews 16→17. The DataViews upgrade can change table rendering in the admin views that use it, so the shipped bundles for these plugins are regenerated.
- 2cb0fb8: Add recurrence scope for ticket types on recurring events: a ticket type can apply to a single occurrence or to `multiple_instances`. A scope-choice modal prompts the organizer when editing ticket types on a recurring event, the Ticket Prices table shows the active scope in parentheses, and sold ticket types are locked against scope changes. The event-signup block respects the resolved scope when listing available tickets.
- 7e594d7: Add manual disable/enable for sold ticket types: a new `disabled` boolean column on ticket types lets admins hide a type from the signup form without deleting it. The admin UI replaces the Remove button with an Enable/Disable toggle when the type has sales. The server guards against deleting sold types omitted from the payload (defense in depth). The event-signup block and the GetTickets gate both respect the flag.
- Updated dependencies [2cb0fb8]
    - fair-events-shared@0.2.0

## 1.7.0

### Minor Changes

- c60efeb: Block paid-event signup when the payment connector is not configured. Previously `maybe_start_paid_signup()` and `maybe_start_addon_payment()` fell through to the free path whenever the resolved total reached zero — which happened when the EventSignupPricing service was unavailable or unconfigured, silently granting free access to paid events.

    Adds `TransactionAPI::is_configured()` (delegating to `MolliePaymentHandler::is_configured()`) and `EventSignupPricing::has_paid_price_configured()` so both conditions are checked before allowing a zero-total signup to proceed.

- c60efeb: Highlight the recognized participant's name in the signup block greeting by wrapping it in a bold, blue `<strong>` element, so users with a participant token clearly see the system has identified them.
- 44dd064: Move form answer admin pages (Form Answers, Questionnaire Responses, Submission Detail) from fair-audience into fair-form. The pages now appear under a new Fair Form admin menu. Cross-plugin links to fair-audience (participant detail, by-event back-link, event picker) are preserved as soft dependencies pending Phase 2.

### Patch Changes

- 8570634: Fix signups-list block always showing count-only view for token-bearing participants with group view_signups permission (stale GroupPermissionRule namespace after move to fair-events-experimental).
- 5043462: Move fair-form blocks and questionnaire data layer from fair-audience into fair-form. Block names (fair-audience/fair-form*) and table names (fair*audience_questionnaire\*\*) are unchanged for backward compatibility. fair-audience degrades gracefully when fair-form is absent via class_exists guards.

## 1.6.0

### Minor Changes

- 4363b40: Add an opt-in "Powered by Fair Event Plugins" attribution. A single toggle in the fair-events General settings (off by default) renders a subtle, translatable line under the fair-audience signup blocks and at the bottom of participant emails.

### Patch Changes

- fb3165c: Add a site-wide default currency setting. Admins can now choose the currency (EUR, USD, GBP, CHF, DKK, NOK, SEK, PLN, CZK, HUF) in Fair Payments Connector → Settings → Currency; all new transactions, fees, and price displays across the plugins inherit this setting instead of being hard-coded to EUR.

## 1.5.0

### Minor Changes

- 76c23f7: Upgrade @wordpress/dataviews from v4 to v16 for admin list views.

## 1.4.0

### Minor Changes

- d0daed8: Show group discount note on event-signup block

## 1.3.4

### Patch Changes

- 02cf7b6: Default to WordPress.org language packs; gate `load_plugin_textdomain()` and the
  `wp_set_script_translations()` path behind a new per-plugin `bundled-translations`
  feature flag (resolved through the same constant / master / filter / option /
  default chain as the existing Fair Events features). The flag is exposed in
  each plugin's Settings → Features tab (or Features submenu) and defaults to off.

## 1.3.3

### Patch Changes

- 0ebaea4: Group admin menus with string positions to avoid overwriting core menus

    Each plugin's top-level admin menu now registers with a unique string decimal
    position (`20.1`–`20.4`) so the four menus cluster together in order without
    colliding with each other or with core WordPress menu items.

## 1.3.2

## 1.3.1

## 1.3.0

### Minor Changes

- 7f6ab85: Let signed-up users add activities to their existing subscription: once signed up they see a registration view instead of the signup form, with the full activity list kept visible (already-booked ones shown disabled).
- 7f6ab85: Add an anonymous event-interest signup block, styled to match the event-signup block and pre-filled from a known identity when available.
- 6b8f010: Add scheduled per-event mailings: queue an email anchored to an event date's start/end with a signed offset, sent automatically by a recurring cron, managed from a new "Mailings" tab in the event admin.
- 7f6ab85: Send a mailing-list confirmation email for paid event signups, with an admin action to resend it for pending participants (single and bulk, surfaced in the selection footer). Signup confirmation emails are now deferred off the request path.
- 7682a28: Robust Mollie payment retry flow and signup identity handling. Resume links in payment-failure emails, a "Continue payment" UI for open Mollie status, recovery after cookie expiry, and preserved ticket selection across retries. Signup identity now prefers the logged-in WP user over the session cookie, with a 1-hour pre-fill cookie and a "start fresh" escape hatch. Ticket quantity limits are enforced.
- 7f6ab85: Make per-period activity pricing a global setting; activity option prices are derived from the active sale period.
- 3f8fdb4: Add an optional per-ticket-type minimum activities requirement that can raise the event-date-wide minimum (e.g. an "Early bird" ticket requiring at least 2 activities). The per-type value only ever increases the requirement; a value below the global minimum is ignored. Enforced both in the signup form (the gate updates live as the buyer switches ticket type) and server-side.
- 7f6ab85: Export questionnaire responses to Markdown, sharing one submission-markdown template between the submission detail and responses pages. Phone answers now persist in questionnaire submissions.
- 7682a28: Recurring events and sign-up management. Sign up for recurring events with synced date pickers, master-group inheritance, and orphan cleanup. New printable sign-up lists with comments, capacity limits, and in-popup role editing. Ticket settings reorganized with sales periods moved out of the ticket table. Finance tab filters failed/live transactions and deep-links to transactions and participants. Group invitations added.
- 7f6ab85: Record verbal marketing consent directly from the Audience tab.

### Patch Changes

- 7f6ab85: Miscellaneous fixes: link to the event page from the admin calendar, close the payment callback popup without a page reload, integrate the confirm & save buttons in the edit popup, keep a cancelled signup registered as "interested", remove the email from the purchase message, and stop nulling transactions.
- ca7cc51: Include the attendee's custom signup question answers in the signup confirmation email (free and paid signups). File-upload answers render as a link to the attachment; multiselect answers render as a readable list. Answer formatting is shared with the form-confirmation and form-notification emails.
- c41b5bc: Use ticket option short names in Telegram sale notifications. Falls back to the full name and then to the snapshot name when no short name is set, so existing configurations keep working unchanged.
- 7f6ab85: Update the local Docker environment and "Tested up to" headers to WordPress 7.

## 1.2.0

### Minor Changes

- 41a295c: Improve event audience management. Edit ticket type and options on existing sign-ups via a popup, delete sign-ups, and store the chosen option name on the sign-up record. Audience table gains copy buttons, activity totals, side counter, ticket shortname, and a wider layout that shows the activity options purchased by each participant.
- 41a295c: Improve participant management. Add a link to edit a user's mailing settings, and a remove-user button that anonymizes the participant across groups, poll access keys, and poll responses.
- 41a295c: Update the sign-up confirmation email and apply discount logic across activities and ticket options at sign-up time.
- 41a295c: Link tickets to event activities. Tickets can now be assigned to specific activities by ID, with per-activity discounts (including facilitator-based discounts) applied at sign-up and at the option level. Ticket option table extended to support this.

### Patch Changes

- 41a295c: Fix missing link from membership payment to participant.
- 41a295c: Fix free ticket error, ticket break in the editor, and price setting error.
- 41a295c: Activity log improvements. Combine multiple user sign-ups into a single timeline entry, add event sign-up entries, and hide test payments from the activity log.

## 1.1.1

### Patch Changes

- e22779c: Add email notification to form sign up & registrations
- c8a6a54: Add participant's import form kit.com

## 1.1.0

### Minor Changes

- 2708bf8: Add foto author to the image.

## 0.2.0

### Minor Changes

- 109ae1a: Add participant poll feature.
- fe6b0c8: Add import from Entradium xlsx.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-01-09

### Added

- Initial release
- Participant management with name, surname, email, Instagram handle
- Email preference settings (minimal or in-the-loop)
- Many-to-many relationships between participants and events
- Participant labels (interested or signed up)
- Admin interface for managing participants
- Events list with participant counts
- Event participants view
- REST API endpoints for participants and event-participant relationships
- Database tables for participants and event-participant relationships

[0.1.0]: https://github.com/marcin-wosinek/fair-event-plugins/releases/tag/fair-audience-0.1.0

== Upgrade Notice ==

= 0.1.0 =
Initial release
