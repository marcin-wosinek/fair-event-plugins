# Fair Events feature inventory

Code inventory prepared on 2026-10-10 for `fair-events` and
`fair-events-experimental`. This is a working reference for later cleanup tickets
and plugin-information updates, not an implementation plan or replacement README.

Features below are grounded in source registration, consumers, and build entries.
“Available” means wired in the source, not verified in a live WordPress session.
Defaults can be overridden by settings, constants, and filters. Stable IDs allow
future tickets and documentation changes to refer to the same capability.

## Fair Events

| ID | Feature | Scope and conditions | Main evidence |
| --- | --- | --- | --- |
| FE-01 | Event records and publishing | Dedicated event post type; start/end, all-day dates, categories/tags; event dates can link to existing posts, external URLs, or have no linked page. Publication and linked content managed together. | [Event](fair-events/src/PostTypes/Event.php), [EventDates](fair-events/src/Models/EventDates.php), [EventPublication](fair-events/src/Services/EventPublication.php) |
| FE-02 | Recurring events | Weekly recurrence and manually selected dates; occurrence edits, cancellations, series date management and previews. | [RecurrenceService](fair-events/src/Services/RecurrenceService.php), [SeriesModal](fair-events/src/Admin/manage-event/SeriesModal.js), [EditInstancesModal](fair-events/src/Admin/manage-event/EditInstancesModal.js) |
| FE-03 | Organizer dashboard | Admin monthly calendar with quick event creation, URL-based detail lookup, all-events list, and central Manage Event page. | [AdminPages](fair-events/src/Admin/AdminPages.php), [QuickEventModal](fair-events/src/Admin/calendar/components/QuickEventModal.js), [ManageEventApp](fair-events/src/Admin/manage-event/ManageEventApp.js) |
| FE-04 | Venue management | Reusable venues, address, coordinates, map links/previews, website/social links; inline venue creation from event editors. Always-on venues bundle. | [Venue](fair-events/src/Models/Venue.php), [VenuesApp](fair-events/src/Admin/venues/VenuesApp.js), [InlineVenueCreator](fair-events/src/Admin/components/InlineVenueCreator.js) |
| FE-05 | Public event displays | Monthly calendar, upcoming/past event lists and weekly views; category filtering, navigation and occurrence-aware display. Server-rendered blocks and list patterns. | [blocks](fair-events/src/blocks), [Patterns](fair-events/src/Patterns/Patterns.php) |
| FE-06 | Event details and prices blocks | Display event date/time, venue and ticket prices; use site date/time formats. | [event-info](fair-events/src/blocks/event-info), [event-dates](fair-events/src/blocks/event-dates), [event-prices](fair-events/src/blocks/event-prices) |
| FE-07 | Personal calendars and subscriptions | Add to Google/Apple/Outlook calendars; downloadable calendar data and public site ICS subscription feed. Add-to-calendar implementation spans this plugin and the dedicated calendar-button plugin. | [CalendarButtonHooks](fair-events/src/Hooks/CalendarButtonHooks.php), [calendar-button](fair-events/src/blocks/calendar-button), [CalendarFeedController](fair-events/src/API/CalendarFeedController.php) |
| FE-08 | Public event API and feed aggregation | Public JSON events endpoint and unified event feed. Core owns local-event querying and external iCal/Fair Events JSON parsing; source configuration is supplied by Experimental. | [PublicEventsController](fair-events/src/API/PublicEventsController.php), [EventFeedProvider](fair-events/src/Services/EventFeedProvider.php), [ICalParser](fair-events/src/Helpers/ICalParser.php), [FairEventsApiParser](fair-events/src/Helpers/FairEventsApiParser.php) |
| FE-09 | Ticket configuration | Ticket types, ordering, sale periods, scheduled prices, pay-what-you-can settings, ticket/activity capacity, add-ons/activity options and extension rules. Core `ticketing` bundle defaults on. Optional collaborator metadata uses Experimental models. | [TicketsController](fair-events/src/API/TicketsController.php), [EventTickets](fair-events/src/Admin/manage-event/EventTickets.js), [TicketCapacity](fair-events/src/Services/TicketCapacity.php), [TicketEditRules](fair-events/src/Services/TicketEditRules.php) |
| FE-10 | Public signup and checkout | Unified Event Signup block: ticket quantities, dates and activity selections; free signup and paid checkout, total display, payment recovery and checkout idempotency. Paid checkout requires Fair Payments Connector. Optional attendee/questionnaire features come through suite integrations. | [event-signup](fair-events/src/blocks/event-signup), [GetTicketsController](fair-events/src/API/GetTicketsController.php), [SignupPaymentSession](fair-events/src/Services/SignupPaymentSession.php) |
| FE-11 | Signup administration | Manage signups, ticket/answer edits, activity allocations and exports from the Manage Event list. Fair Audience supplies additional attendee-management integration. | [EventSignups](fair-events/src/Admin/manage-event/EventSignups.js), [SignupEditModal](fair-events/src/Admin/manage-event/SignupEditModal.js), [SignupExportModal](fair-events/src/Admin/manage-event/SignupExportModal.js) |
| FE-12 | Signup emails and payment updates | Signup email hooks, email service and payment-state synchronization. Exact delivery behavior depends on active suite services/settings. | [SignupEmailHooks](fair-events/src/Hooks/SignupEmailHooks.php), [EmailService](fair-events/src/Services/EmailService.php), [PaymentHooks](fair-events/src/Hooks/PaymentHooks.php) |
| FE-13 | Copy event | Core copy workflow with date adjustments and event/ticket configuration copying. Separate from Experimental's configurable duplication wizard. | [CopyEventPage](fair-events/src/Admin/CopyEventPage.php), [EventCopyService](fair-events/src/Services/EventCopyService.php), [EventTicketConfigurationCopier](fair-events/src/Services/EventTicketConfigurationCopier.php) |
| FE-14 | Event statistics | Ticket and financial statistics, charts and chart image export. Statistics controller is available only with Fair Audience; maintains the former Fair Audience API path as an alias. | [EventStatisticsController](fair-events/src/API/EventStatisticsController.php), [EventStatistics](fair-events/src/Admin/event-statistics/EventStatistics.js) |
| FE-15 | Finance integration | Link an event to a Fair Finance budget and show event finance information. Requires the corresponding finance integration. | [EventBudget](fair-events/src/Services/EventBudget.php), [EventFinance](fair-events/src/Admin/manage-event/EventFinance.js) |
| FE-16 | Multilingual events | Event/post translation links, activity-option translations and multilingual category handling, with Polylang integration. | [EventTranslation](fair-events/src/Services/EventTranslation.php), [PostTranslationLinks](fair-events/src/Services/PostTranslationLinks.php), [ActivityOptionTranslation](fair-events/src/Services/ActivityOptionTranslation.php) |
| FE-17 | SEO and occurrence pages | Event/organization structured data, Open Graph metadata, canonical URLs and date-specific event views. Organizer settings supply organization details. | [Hooks](fair-events/src/Hooks), [EventDateView](fair-events/src/Frontend/EventDateView.php), [Organizer](fair-events/src/Settings/Organizer.php) |
| FE-18 | Settings and translations | Enabled post types, organizer settings and feature controls. WordPress language packs by default; bundled translations are an opt-in on the shared suite settings screen. | [Settings](fair-events/src/Settings/Settings.php), [Features](fair-events/src/Core/Features.php) |

### Block availability

| Block | Current ownership/status |
| --- | --- |
| Events Calendar, Events List, Events Week | Fair Events; registered unconditionally. |
| Event Info, Event Dates, Event Prices | Fair Events; registered unconditionally. |
| Event Signup | Fair Events; registered unconditionally. Ticket configuration endpoints/UI have separate feature gating. |
| Get Tickets | Legacy Fair Events block, hidden from inserter; delegates rendering to Event Signup. Preserve saved content compatibility. |
| Event Proposal | Source and build assets in Fair Events, submission controller in Experimental. Registration currently checks an undefined core `sources` flag; unavailable under the core registry as written. |
| Add to Calendar | Fair Events owns a core/button variation and local frontend assets through [CalendarButtonHooks](fair-events/src/Hooks/CalendarButtonHooks.php). Its editor also adds a transform to the separate Fair Calendar Button block when available. |

Registration evidence: [BlockHooks](fair-events/src/Hooks/BlockHooks.php).

## Fair Events Experimental

Companion plugin requiring Fair Events. Source/API namespaces often remain
`fair-events/v1`; namespace alone does not establish plugin ownership.

| ID | Feature | Scope and conditions | Main evidence |
| --- | --- | --- | --- |
| FEE-01 | Event source configuration | Create/manage named sources, combine local categories and external feeds, configure colors and source pages, preview sources and copy feed URLs. `sources` defaults on. Storage and aggregation live in Fair Events. | [EventSourceController](fair-events-experimental/src/API/EventSourceController.php), [SourcesList](fair-events-experimental/src/Admin/sources/SourcesList.js), [SourceViewApp](fair-events-experimental/src/Admin/source-view/SourceViewApp.js), [EventSourceRepository](fair-events/src/Database/EventSourceRepository.php) |
| FEE-02 | Source-specific ICS feed | Public calendar feed for a configured source, separate from core site-wide ICS endpoint. | [EventSourceController](fair-events-experimental/src/API/EventSourceController.php) |
| FEE-03 | Visitor event proposals | Submission API for event proposals under `sources`. Frontend block lives in Fair Events but currently has a registration mismatch; do not advertise a working end-to-end proposal form until resolved. | [EventProposalController](fair-events-experimental/src/API/EventProposalController.php), [event-proposal](fair-events/src/blocks/event-proposal) |
| FEE-04 | Weekly source schedule | Authenticated weekly-events API; consumes core WeeklyEventsProvider. Distinct from the public Events Week block. | [WeeklyEventsController](fair-events-experimental/src/API/WeeklyEventsController.php), [WeeklyEventsProvider](fair-events/src/Services/WeeklyEventsProvider.php) |
| FEE-05 | Weekly Telegram notifications | Scheduled upcoming-week summary, selected source/heading page/destinations, test send and delivery history. Uses WordPress Connectors for bot credentials, with environment/constant overrides. Dispatcher gated by `sources`; notifications need configuration. | [WeeklyNotifications](fair-events-experimental/src/WeeklyNotifications), [WeeklyNotifications settings](fair-events-experimental/src/Admin/settings/WeeklyNotifications.js) |
| FEE-06 | Group pricing and permissions | Group discount rules and permission rules, including integrations for participant signup visibility. Requires Fair Audience group/participant data. Experimental `ticketing` defaults on; core owns base ticket configuration. | [GroupPricingRulesController](fair-events-experimental/src/API/GroupPricingRulesController.php), [GroupPermissionRulesController](fair-events-experimental/src/API/GroupPermissionRulesController.php), [EventSignupPricing](fair-events-experimental/src/Services/EventSignupPricing.php) |
| FEE-07 | Activity collaborators | Collaborator associations for ticket/activity options; consumed by core ticket configuration and duplication UI. Treat as a cross-plugin integration rather than a standalone ticket system. | [TicketOptionCollaborator](fair-events-experimental/src/Models/TicketOptionCollaborator.php), [core TicketsController](fair-events/src/API/TicketsController.php) |
| FEE-08 | Advanced event duplication | Multi-step wizard with editable event details/dates/tickets, clone/reuse linked posts and selection of group rules/collaborators. Reuses core ticket editor and endpoints. `event-tools` defaults on. | [DuplicateEventWizard](fair-events-experimental/src/Admin/manage-event/DuplicateEventWizard.js), [EventDuplicationController](fair-events-experimental/src/API/EventDuplicationController.php) |
| FEE-09 | Event merge | Preview and merge one event date into another, with choices for moving/cleaning linked cross-plugin data. Gated by `event-tools`. | [MergeEventWizard](fair-events-experimental/src/Admin/manage-event/MergeEventWizard.js), [EventMergeController](fair-events-experimental/src/API/EventMergeController.php) |
| FEE-10 | Workshop/activity schedule editor | Manage Event Schedule tab, schedule rows and booking state; persistence/API and booking enforcement live in Fair Events. Not gated by `event-tools`; enqueue checks for the core schedule controller class. | [EventSchedule](fair-events-experimental/src/Admin/manage-event-schedule/EventSchedule.js), [Plugin](fair-events-experimental/src/Core/Plugin.php), [core EventScheduleController](fair-events/src/API/EventScheduleController.php) |
| FEE-11 | Compare events | Compare two occurrences' ticket-sales and amount timelines relative to their own start dates; chart image downloads. Menu registered independently of feature bundles; statistics require Fair Audience. | [CompareEventsPage](fair-events-experimental/src/Admin/compare-events/CompareEventsPage.js), [comparison helpers](fair-events-experimental/src/Admin/compare-events/comparison.js), [AdminPages](fair-events-experimental/src/Admin/AdminPages.php) |
| FEE-12 | Meta conversions | Opt-in, marketing-consent-gated server-side checkout/purchase measurements, browser attribution, asynchronous delivery and retention cleanup. Defaults off; requires Fair Payments Connector and configured credentials. | [Conversions](fair-events-experimental/src/Meta/Conversions.php), [Outbox](fair-events-experimental/src/Meta/Outbox.php), [meta-attribution](fair-events-experimental/src/Frontend/meta-attribution.js) |
| FEE-13 | Experimental settings | Feature toggles, Meta settings and weekly-notification settings. Companion always loads bundled translations. | [Features](fair-events-experimental/src/Core/Features.php), [settings](fair-events-experimental/src/Admin/settings) |

## Duplication and ownership findings for later tickets

These are investigation inputs, not instructions to delete code. Shared behavior
and compatibility layers are not automatically redundant.

| ID | Finding | Evidence and implication |
| --- | --- | --- |
| DUP-01 | Identical CopyUrlButton components | [Core](fair-events/src/Admin/components/CopyUrlButton.js) and [Experimental](fair-events-experimental/src/Admin/components/CopyUrlButton.js) contain identical implementations, including the core text domain. Strong candidate for one shared component. |
| DUP-02 | Parallel calendar components | Both plugins have CalendarGrid, CalendarHeader and DayCell under `src/Admin/calendar/components/`. Experimental uses its copies for source preview. Compare behavior before choosing a shared abstraction. |
| DUP-03 | Older Experimental ticket controller | [Experimental TicketsController](fair-events-experimental/src/API/TicketsController.php) parallels core ticket configuration/import code but is not instantiated by Experimental's current Plugin bootstrap. Confirm repository/external consumers before removal. |
| DUP-04 | Two ticketing flags and map overwrite | Both registries define `ticketing`; Experimental merges its flags into the core enabledFeatures map with the same key. UI can receive Experimental's value while core routes are gated by core's value. Reconcile ownership and conflicting settings. |
| DUP-05 | Two copy/duplicate workflows | FE-13 and FEE-08 overlap in dates, linked content and ticket copying, but the Experimental wizard offers different choices. Compare retained behavior and converge shared logic before consolidating UI. |
| DUP-06 | Schedule split across plugins | Core owns schedule model/API/enforcement; Experimental owns editor. Availability checks use class existence, while core API registration depends on core ticketing. Clarify the intended bundle and disabled-feature behavior. |
| DUP-07 | Proposal feature gate mismatch | Core BlockHooks checks `Features::is_enabled('sources')`; core registry has no such key and returns false for unknown keys. Experimental defines `sources` but merges only the UI map, which does not change that registry lookup. |
| DUP-08 | Stale mailings ownership | Experimental still defines/describes a `mailings` flag but implements no mailing controller/service. Scheduled mailing hooks, controller and tab now live in [fair-audience-experimental](fair-audience-experimental/src). Examine merged UI flag interactions before removing the stale flag. |
| DUP-09 | Feed logic versus feed configuration | Core owns EventFeedProvider, parsers, source repository and weekly summaries; Experimental owns source administration and separate ICS formatting. This split may be intentional; review feed parity and reused formatting rather than moving everything by filename. |
| DUP-10 | Legacy blocks and route aliases | Get Tickets delegation and the old statistics namespace are compatibility mechanisms. Any cleanup needs saved-content and existing-client compatibility decisions. |

## Plugin-information corrections for later work

| Surface | Findings to carry into the update |
| --- | --- |
| [Fair Events readme.txt](fair-events/readme.txt) | Add Event Prices to the block list; correct proposal availability/dependency; clarify calendar-button ownership; describe copy, venue management, statistics/finance integrations and activity options as appropriate. Scheduled mailings attribution needs the Audience Experimental companion. |
| [Experimental readme.txt](fair-events-experimental/readme.txt) | “Three advanced bundles excluded from the public build” is outdated: core ticketing is public. Add schedule editor, comparisons and current integrations. Meta and Telegram already have sections but should appear in the overview. Avoid unverified invitations/Facebook-import claims. |
| [Root README](README.md) | Core description is broad and Experimental is only described as an advanced-feature companion. Align summaries with actual ownership and dependencies. |
| Both feature registries and settings labels | Core/Experimental ticketing labels overlap; Experimental mailings description is stale; sources description claims Facebook import, without a corresponding importer found in these plugins. |
| Source type selector and validation | `meetup_api` is offered and accepted, but core EventFeedProvider handles categories, iCal and Fair Events API only. Treat Meetup ingestion as unverified/incomplete until its execution path is established. |
| Plugin headers and package metadata | Review alongside READMEs for consistent descriptions/dependencies and runtime requirements; do not copy existing marketing claims as evidence. |
| Other suite READMEs and product pages | Check descriptions of ticketing, attendee management, mailings, payments, finance and calendar buttons against this ownership map. Published pages have not been audited here. |

## Verification limits

This inventory is a source review. No runtime behavior was changed, no tickets
were created, and no published plugin descriptions were updated. Live availability,
payment-provider behavior, and external integration delivery still need the
appropriate integration checks when their tickets are implemented. Pricing and
fee claims are deliberately outside this feature inventory.
