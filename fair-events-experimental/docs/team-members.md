# Team members

The `team-members` bundle (#2394, off by default) keeps a sitewide directory
of the people who help run events, and each event's team.

## Data

Two site-scoped tables, installed by `Models\TeamMemberRepository` on `init`
while the bundle is on (schema version in
`fair_events_experimental_team_members_db_version`):

- `fair_events_team_members` — one profile per person: `name` (required),
  `surname`, `instagram`, `email`, `facebook_url`, `phone` (text, so
  international prefixes stay) and `gender` (`male`, `female`, `nonbinary`
  or NULL for unset).
- `fair_events_team_memberships` — one row per member of an owning event
  date, unique on `(owner_event_date_id, member_id)`. Roles and ordering
  are #2422's.

The owner is the series master for a generated occurrence, otherwise the
event date itself (`Services\TeamMembership::owner_id()`). Occurrences have no
rows of their own: they read the master's team, so past and newly generated
dates always show the current one.

The historical Fair Team plugin (#302, #342) used a public `fair_team_member`
post type keyed by post ID. Its records are left alone and not imported.

## REST

All routes are in `fair-events/v1`, require `manage_options`, and are only
registered while the bundle is on.

| Route | Methods | Notes |
| ----- | ------- | ----- |
| `/team-members` | GET, POST | Profiles with `event_count`. |
| `/team-members/{id}` | GET, PUT/PATCH, DELETE | GET adds `events`. Omitted fields keep their value; `''` (or `null` for `gender`) clears one. DELETE is 409 `rest_team_member_linked` with `data.events` while linked. |
| `/event-dates/{id}/team-members` | GET, POST `{ member_id }` | `{ owner_event_date_id, series_event_date_id, members: [{ id, name, surname }] }`. A repeated POST is 200 and changes nothing. |
| `/event-dates/{id}/team-members/{member_id}` | DELETE | Removes one membership only. |

Validation errors are 400 `rest_invalid_param` with per-field messages in
`data.params`. Writes on a generated occurrence are 409
`rest_team_managed_on_series` with `data.series_event_date_id`. Event routes
also require `edit_post` on the event's linked post, like the organizer
routes.

Profile deletion and linking both lock the profile row, so a deletion and a
concurrent link never leave a membership pointing at a deleted profile.

## Lifecycle

Registered whether or not the bundle is on, and a no-op until the tables
exist:

- `fair_events_event_date_deleted` removes the memberships the deleted event
  date owned.
- Fair Events' `fair_events_event_copy_extensions` filter copies the
  source owner's memberships to the copy. A failure there fails the copy,
  which removes the partial copy and so its memberships. Later changes on
  the source or the copy are independent.

## Privacy and marketing

Creating a profile or adding someone to an event publishes nothing.
`TeamMembership::published_names( $ids )` returns only `{ id, name,
surname }` for the IDs a marketing consumer supplies, whether or not the
directory is on. Deciding what may be published, and when, belongs to
#2396 and #2430.
