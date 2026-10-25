# Weekly summary links for operators

An operator link opens a plain, public page for one community's events
calendar. It lists the week's public events and offers **Copy summary**, so
whoever posts the weekly message (for example in a WhatsApp community) can
review the week, copy the text and paste it by hand. Opening the page or
copying sends nothing anywhere.

The copied text is exactly what the calendar's own **Copy summary** button
gives for the same week: the same Fair Events code builds it from the same
events, page title, page URL and language.

## Set up a community

Each link points to an **Events Week View** block on a published page:

1. Edit the page that shows the community's calendar.
2. Select its Events Week View block and open **Advanced → HTML anchor**.
3. Enter an anchor, e.g. `community-week`. Letters, digits, `-`, `_`, `:`
   and `.` are allowed.
4. Make sure **Show Draft Events** is off. A calendar that shows drafts can't be
   shared through a public link.
5. Update the page.

The link follows the block: change the block's categories or event feeds
and the summary changes with it. There is nothing else to configure.

Several calendars can share one page as long as each has its own anchor.
The anchor must be unique on the page, including blocks inside groups,
columns and synced patterns. If two calendars carry the same anchor, the
link shows an error rather than guessing.

## Share the link

The link is the page URL plus `fair_weekly_summary` set to the anchor:

```text
https://example.com/valencia/?fair_weekly_summary=community-week
https://example.com/madrid/?fair_weekly_summary=community-week
https://example.com/barcelona/?fair_weekly_summary=community-week
```

Without a week, the page shows the current week, as the calendar does. Add
`week_view` with an ISO week to open a given week:

```text
https://example.com/valencia/?fair_weekly_summary=community-week&week_view=2026-W44
```

An invalid week (e.g. `2027-W53`, a week 2027 doesn't have) shows the
current week with a note. **Previous week** and **Next week** keep the
community. On a multilingual (Polylang) site, use the URL of the page in the
summary's language.

Operators need no WordPress account. Search engines are asked not to index
the page.

## What the page shows

-   The calendar page's title and URL, the week's date range and its ISO week.
-   The week's events in order, with day and time.
-   The summary text in a box, selectable for copying by hand.
-   After copying, a confirmation. If the browser blocks the clipboard, the
    page says so and selects the text, so it can be copied with the device's
    own copy command.
-   For a week without events, a note. The summary then has only its
    heading line, like the calendar's.

## What stays private

Only public events are listed, whoever opens the link, including logged-in
organizers: draft and private events never appear. A password-protected
event is listed by its title and link, as WordPress lists it elsewhere, but
its content is never included.

The link shows an "unavailable" page (HTTP 404) instead of a summary when:

-   no Events Week View block on the page has the anchor,
-   more than one does,
-   the block shows drafts,
-   the page isn't published and public (draft, private, or
    password-protected).

## Implementation

-   `src/Frontend/WeeklySummaryPage.php` serves the link and renders the page.
-   `src/Services/WeeklySummary.php` builds the summary with Fair Events'
    `EventsWeekSummary` and `EventsWeekSummaryFormatter`.
-   `src/Services/WeeklySummarySelection.php` finds the block by anchor.
-   `src/Frontend/weekly-summary.js` handles copying.
-   Tests: `__tests__/Services/WeeklySummarySelectionTest.php`,
    `src/Frontend/__tests__/weekly-summary.test.js` and
    `e2e/fair-events-experimental-weekly-summary.spec.js` at the repository
    root.
