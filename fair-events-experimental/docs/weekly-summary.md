# Weekly summary links for operators

An operator link opens a plain, public page for one community's event feed.
It lists the week's public events and offers **Copy summary**, so whoever
posts the weekly message (for example in a WhatsApp community) can review
the week, copy the text and paste it by hand. Opening the page or copying
sends nothing anywhere.

The copied text is built by the same Fair Events code as the weekly
notification. It is exactly what an Events Week View block on the feed's
page, showing only that feed, copies for the same week: the same events,
page title, page URL and language.

## Set up a community

Each community is an **event feed** in Fair Events → Event Feeds:

1. Add or edit the community's event feed. Its feed inputs (categories,
   iCal feeds, other Fair Events sites) decide which events are listed.
2. Choose the feed's **page**. The page gives the summary its heading (title
   and link) and, on a Polylang site, its language. It must be published and
   public: not a draft, private or password-protected.
3. Make sure the feed is enabled.
4. Open the feed's view. **Weekly summary link** shows the link, with a
   **Copy link** button to share it with the operator.

A feed without a page shows a hint instead of the link. There is nothing
else to configure: change the feed's inputs and the summary follows.

## Share the link

The link carries the feed's slug in its path:

```text
https://example.com/fair-events-weekly-summary/valencia/
https://example.com/fair-events-weekly-summary/madrid/
https://example.com/fair-events-weekly-summary/barcelona/
```

Without a week, the page shows the current week, as Events Week View does.
Add `week` with an ISO week to open a given week:

```text
https://example.com/fair-events-weekly-summary/valencia/?week=2026-W44
```

On a site with plain permalinks, the same page is at
`https://example.com/?fair_weekly_summary=valencia&week=2026-W44`. The feed
view shows whichever form the site uses.

An invalid week (e.g. `2027-W53`, a week 2027 doesn't have) shows the
current week with a note. **Previous week** and **Next week** keep the
feed.

Operators need no WordPress account. Anyone who has the link can open the
page, so share it only with the people who post the summary. The page isn't
linked from anywhere on the site, and search engines are asked not to index
it.

## What the page shows

-   The feed's name, its page's title and URL, the week's date range and its
    ISO week.
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

The link shows an "unavailable" page (HTTP 404) instead of a summary, never
another feed's, when:

-   no event feed has the slug, or the feed is disabled,
-   the feed has no page,
-   the feed's page isn't published and public (draft, private, or
    password-protected).

## Implementation

-   `src/Frontend/WeeklySummaryPage.php` registers the link's rewrite rule,
    builds links and renders the page.
-   `src/Services/WeeklySummary.php` resolves the feed and builds the
    summary with Fair Events' `Notifications\SummaryBuilder`.
-   `src/Frontend/weekly-summary.js` handles copying.
-   `src/Admin/source-view/SourceViewApp.js` shows each feed's link.
-   Tests: `__tests__/Frontend/WeeklySummaryPageTest.php`,
    `src/Frontend/__tests__/weekly-summary.test.js`,
    `src/Admin/source-view/__tests__/SourceViewApp.test.jsx` and
    `e2e/fair-events-experimental-weekly-summary.spec.js` at the repository
    root.
