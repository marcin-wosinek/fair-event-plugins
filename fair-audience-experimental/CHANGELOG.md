## 1.4.0

### Minor Changes

-   e12f143: Send emails to event participants from Fair Audience → Custom Mail, without Fair Audience Experimental. Pick an event date, write the subject and content, check who will receive it, exclude individual people, and send. Sent messages, including those from before this change, stay in Mail History.

    An email now goes only to the people registered for the selected date. Before, picking one date of a recurring event also reached people registered for its other dates. A missing or malformed address is reported instead of being handed to the mailer, an empty subject or content is refused, and the page says which emails could not be sent and why. Deleting a history record asks for confirmation.

    Sending to the whole audience stays experimental: the option appears on the same page while the Messaging feature of Fair Audience Experimental is on. Group filters and photo upload links likewise need their experimental features.

    Update the two plugins together. An older Fair Audience Experimental keeps showing its own Custom Mail page until it is updated, and Fair Audience says so on its screens; an updated companion next to an older Fair Audience has no Custom Mail page until Fair Audience is updated.

-   15d8327: Edit Fee now has the same Budget select as Create Fee, opened on the budget
    the fee is linked to. Pick another budget to move the fee, or "No Budget" to
    unlink it. A fee keeps its budget unless you change it — also when budgets
    cannot be loaded, or when its budget is no longer in the list, in which case
    the select still shows it.

    While Fair Finance is not active, neither dialog shows the Budget select or
    the notice about it any more; fees are created and edited without it and keep
    the budget they already had.

    The fees REST route now refuses a `budget_id` that is not a positive integer
    or `null`, and an update clears the budget only when it is sent as `null`.

-   aa50d3d: **Send Invitations** on the Event Participants page and on the Manage Event Audience tab now shows a summary before anything is sent. It names the event and its date and lists the selected groups or people. Group memberships are counted separately from the number of different people selected, and the summary says how many people will receive the invitation. People who will not get it are counted by reason: already signed up for this date, no longer in the audience, no valid email address, or no confirmed consent to marketing emails. When nobody can be invited, the summary says so and sending stays disabled with the reason shown. Sending goes to exactly the people counted in the summary. Each person is checked again when sending, but nobody who joined a group after the summary was shown gets an invitation. While sending, the dialog cannot be closed and the selection cannot be changed. If sending fails, the error is shown in the dialog and the selection is kept.

    **Disconnect Instagram** now asks for confirmation in an in-page dialog instead of the browser's own confirmation box. The dialog names the account by username, or by account ID when there is no username. It explains that the access token and connection details stored on the site are removed, and that publishing needs a reconnection. Posts already on Instagram and the site's post records are kept. A failure is shown in the dialog, and repeated clicks cannot disconnect twice.

    The new `POST /fair-audience/v1/event-dates/{event_date_id}/event-invitations/preview` endpoint returns these counts without sending any mail. Invitation requests with non-integer participant or group IDs are now rejected with a 400 error.

-   91f5928: Remove the Weekly Schedule admin page from Fair Audience Experimental, with its menu entry and its "Weekly schedule" feature toggle. A bookmark to the old page now gets WordPress's standard answer for a page that does not exist, and a stored `weekly-schedule` setting is ignored and dropped the next time the experimental settings are saved. The two REST routes only that page used are gone as well: `POST fair-audience/v1/instagram/upload-blob` and `GET fair-events/v1/weekly-events`. Instagram Posts, Image Templates, the weekly digest and weekly notifications work as before, and no events, participants, settings, media or Instagram records are changed.
-   3470321: These plugins now require WordPress 7.0 or later. Their admin lists (All
    Events, All Participants, By Event, the Fair Form answer screens, Groups,
    Collaborators and Membership Fees) rely on scripts that WordPress only
    provides from 7.0, so on older versions those screens stayed blank. The
    plugins are now built with the latest WordPress editor and admin packages;
    existing blocks and saved content keep working unchanged.

### Patch Changes

-   3a545db: Fix the Budget dropdown in the Create Fee dialog, which only offered "No
    Budget". It now lists the budgets kept in Fair Finance, reloaded each time the
    dialog opens, so a budget added a moment ago can be picked without refreshing
    the page. While budgets load the dialog says so; when there are none, or when
    they cannot be loaded, it says which — a failed load comes with a Retry button
    and the fee can still be created without a budget. The transfer dialog on Fee
    Detail reads budgets the same way, and Fee Detail now shows the budget a fee is
    linked to.

    Sites where Fair Finance was never installed can list and open membership fees
    again: a fee keeps the budget it was linked to, and its budget name is simply
    left empty.

    Creating a transfer from a pending payment on Fee Detail works again: it was
    sent to an address that no longer exists, so the transfer was never created
    and the payment stayed pending. A transfer that cannot be created now says
    why inside the dialog and keeps what was entered. If the transfer is created
    but the payment cannot be marked as paid, the page says so, so the transfer
    is not created a second time.

-   8ad0618: The poll editor's PDF export now ships DOMPurify 3.4.17, the release that
    fixes two published HTML-sanitisation advisories. Poll editing and the
    exported PDF are unchanged.

## 1.3.0

### Minor Changes

-   c7071f6: Send a payment reminder to one member from Fee Detail. Each pending payment's row menu now offers **Send Payment Reminder**: a popup names the member, the address the email goes to and the fee, and confirming sends the existing reminder email to that member only. The page then says where the reminder went, the row shows its new "Reminder Sent" date and the payment's audit log records who sent it. Paid and canceled payments cannot be reminded, a member without an email address is explained in the popup, and a failed send says so without recording anything. While one reminder is being sent, a second click and "Send Reminders" are held back.

    For developers: `POST fair-audience/v1/fees/{id}/payments/{pid}/send-reminder` (administrators only) answers 409 `payment_not_pending`, 404 `participant_not_found`, 400 `invalid_recipient_email` and 500 `reminder_send_failed`. A reminder that was sent but could not be recorded answers 200 with `recorded: false`.

### Patch Changes

-   f9a4eed: Fix the Groups tab on Manage Event opening onto a "No route was found" error. The tab is now offered only when everything it reads is available: Fair Events Experimental with its ticketing feature on, and this plugin's groups and manage-event extensions features on. A bookmarked link to the tab opens Event Details when it is not. When loading the rules does fail, the tab shows the error with a Retry button instead of "No group rules yet", and no longer reports a change as saved if the list could not be refreshed afterwards. Existing rules are untouched by turning these features off and on.

## 1.2.0

### Minor Changes

-   1246f44: Remove the event photo gallery. The Photos tab of Manage Event, the public gallery page, photo likes and downloads, gallery access links, the "Send Gallery Link" action, the gallery count on Event Participants and the Images/Likes columns of By Event are gone, together with their REST routes. Old `?gallery_key=`, `?event_gallery_id=` and `/event-gallery/{id}` links now answer 410 Gone without checking the token. On upgrade, the gallery relationship, likes and access key tables are dropped; the cleanup can safely repeat and is retried until it succeeds. Media files, photo authors and tags, participant and questionnaire photo uploads, and event promotional images are kept. In fair-audience-experimental the retained photo upload and attribution features move from the `galleries` bundle to a new `photos` bundle, which inherits the stored choice. See DEPLOYMENT.md for backup and rollback steps.

## 1.1.1

### Patch Changes

-   7281a45: Centralize amount and currency formatting behind a shared `FairEventsShared\Money` helper (PHP) and matching `formatMoney`/`formatMoneyInline` helpers (JS), fixing the Fair Audience and Fair Events signup blocks, which previously hardcoded the € symbol regardless of the site's configured currency. A non-EUR site (e.g. PLN, CZK, HUF) now shows its real currency on ticket labels, add-on prices, and the running total — including after ticking an option, which previously reverted to €. EUR output is unchanged everywhere (signup blocks, emails, Timeline, Mollie payloads).
-   ab61aba: Fixed a PHP 8.2 dynamic-property deprecation notice that fired on nearly every event-date read (`EventDates::$signup_price`, left over from a partially-reverted merge). Rather than re-declaring the field, finished removing it: the flat per-date "simple pricing" mode and pay-what-you-can sliding scale it powered were already superseded by ticket-type pricing everywhere except the legacy fair-audience Event Signup block, which now prices signups from ticket types only. The `signup_price` column is dropped from the event dates table via migration. Also fixed the same class of deprecation notice on `FairAudienceExperimental\Models\Group::$member_count`, populated by the groups admin list.
-   Updated dependencies [7281a45]
-   Updated dependencies [84cfda0]
-   Updated dependencies [8d196d7]
-   Updated dependencies [9ae94d2]
-   Updated dependencies [1f9fcc1]
    -   fair-events-shared@0.5.0

## 1.1.0

### Minor Changes

-   efe9aae: Move the fees, polls, instagram, collaborators, image-templates, timeline, import, and weekly-schedule bundles out of `fair-audience` into the `fair-audience-experimental` companion, gated behind their `Features::is_enabled()` flags. None of these bundles had callers outside fair-audience, so this is the lowest-risk slice of the fair-audience/fair-audience-experimental split (issue #1041). The `fair-audience` top-level admin menu now lands on All Participants instead of the (now-moved) Activity Timeline page.
-   3e34be8: Move the groups and invitations bundles out of `fair-audience` into the `fair-audience-experimental` companion, gated behind their `Features::is_enabled()` flags (issue #1041). `Group`/`GroupParticipant` and their repositories are renamed to `FairAudienceExperimental\…` and now travel with the companion; every core `fair-audience` call site (participant lists, custom mail, payment discount labels, signup pricing, anonymization, the signups-list block) and the `fair-events-experimental` invitation-token controller degrade gracefully via `class_exists()` guards when the companion is inactive.
-   e84e6b3: Move the galleries and messaging bundles out of `fair-audience` into the `fair-audience-experimental` companion, gated behind their `Features::is_enabled()` flags (issue #1041). `PhotoParticipant`/`GalleryAccessKey` and `CustomMailMessage`/`ExtraMessage`/`ScheduledMessage` (plus their repositories, controllers, admin pages, media-library hooks, and the scheduled-message cron) are renamed to `FairAudienceExperimental\…` and now travel with the companion; every cross-plugin call site (`fair-events-experimental`'s gallery endpoint, stable `fair-events`' gallery page, `fair-form`'s questionnaire photo tagging, and core `fair-audience`'s email service and anonymization service) degrades gracefully via `class_exists()` guards when the companion is inactive.
-   ef647cf: Scaffold the fair-audience-experimental companion plugin: `plugins_loaded` bootstrap with a runtime guard on fair-audience, a `Features` registry (master constant `FAIR_AUDIENCE_EXPERIMENTAL_INTERNAL`) listing the thirteen advanced bundles (fees, polls, galleries, Instagram, groups, collaborators, messaging, image-templates, timeline, import, weekly-schedule, invitations, manage-event-ext), and a Settings page to toggle them. This is the clean-slate step of splitting fair-audience into a lean core plus this companion — feature bundles themselves still live in fair-audience and move out in follow-up changes.
-   8a1195f: Move the manage-event tab extensions (Audience, Groups, Mailings) out of `fair-audience` into the `fair-audience-experimental` companion under the `manage-event-ext` feature flag (issue #1041). The tab bundle's enqueue wiring on fair-events' manage-event page — previously always registered by `fair-audience` — now lives in the companion and only mounts when its `manage-event-ext` feature is enabled, mirroring how `fair-events-experimental` merges its own manage-event extensions.
-   2a3600a: Move the manage-event Audience tab from `fair-audience-experimental` back into core `fair-audience`, so it now renders on the fair-events Manage Event page without the experimental companion plugin active. The Groups and Mailings tabs remain in `fair-audience-experimental` behind the `manage-event-ext` feature flag.

### Patch Changes

-   f1985d8: Add e2e coverage for the fair-audience-experimental Features registry (all-bundles-on/off admin page and REST route checks) and wire `dist-archive:fair-audience-experimental` into the root release build, closing out the fair-audience/fair-audience-experimental split (issue #1041).
-   612b9b0: Fix Instagram schedule-image posting failing with an unrecognized-format error after tmpfiles.org stopped serving raw image bytes. `upload_blob()` now stores the PNG directly as a WordPress attachment (tagged `_fair_audience_instagram_temp`, deleted after a successful publish) instead of round-tripping through the third-party host; a new hourly cron sweep cleans up anything left by an abandoned publish (issue #1063).
-   Updated dependencies [b007d8a]
-   Updated dependencies [612b9b0]
-   Updated dependencies [612b9b0]
    -   fair-events-shared@0.3.0

## 1.0.0

### Minor Changes

-   Initial release — scaffolds the fair-audience-experimental companion plugin: `plugins_loaded` bootstrap with a runtime guard on `fair-audience`, a `Features` registry (master constant `FAIR_AUDIENCE_EXPERIMENTAL_INTERNAL`) listing the thirteen advanced bundles, and a Settings page to toggle them. Feature bundles themselves stay in `fair-audience` for now and move out in follow-up changes.
