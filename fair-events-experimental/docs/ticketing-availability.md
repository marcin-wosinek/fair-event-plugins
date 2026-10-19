# Ticketing availability

Fair Events and Fair Events Experimental each have a `ticketing` setting. They
control different things:

-   **Fair Events → Features → Ticketing** (core, option
    `fair_events_features`, constant `FAIR_EVENTS_FEATURE_TICKETING`) is the
    one decision for base ticket configuration: ticket types, sale periods,
    prices, the Prices and List tabs, and the workshop schedule.
-   **Experimental → Ticketing extensions** (option
    `fair_events_experimental_features`, constant
    `FAIR_EVENTS_EXPERIMENTAL_FEATURE_TICKETING`) controls only what
    Experimental adds on top: group pricing rules and group permission rules.
    The stored key stays `ticketing`; only its label changed.

## Matrix

| Core ticketing | Experimental ticketing | Base configuration | Group-rule extensions\* |
| -------------- | ---------------------- | ------------------ | ----------------------- |
| Off            | Off                    | Unavailable        | Unavailable             |
| Off            | On                     | Unavailable        | Unavailable             |
| On             | Off                    | Available          | Unavailable             |
| On             | On                     | Available          | Available               |

\*Also requires Fair Audience to be active. The Groups tab on Manage Event
additionally requires Fair Audience Experimental with its `groups` and
`manage-event-ext` bundles.

The rule lives in
`FairEventsExperimental\Core\Plugin::ticketing_extensions_available()`. It
gates registration of the `group-pricing-rules` and `group-permission-rules`
routes and is published to the Manage Event page as
`enabledFeatures.ticketingExtensions`. Experimental never writes core's
`enabledFeatures.ticketing`.

The workshop schedule follows core ticketing and its own prerequisites only;
the Experimental setting does not affect it.

## Conflicting settings

Existing sites keep their stored values; there is no migration.

-   **Core off, Experimental on.** Core wins: base configuration and the
    extensions are both unavailable. Before this change the Manage Event page
    still showed Prices and List here while their routes were unregistered.
-   **Core on, Experimental off.** Base configuration stays available; only
    the group rules are hidden. Before this change Experimental's `false`
    hid Prices and List although core served them.

## Stored data

Turning either setting off never deletes anything. Ticket types, prices,
options, sale periods, signups, and group pricing and permission rules stay in
the database and are available again once the settings allow it.
