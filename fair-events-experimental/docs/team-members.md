# Team members

The `team-members` bundle (#2394, off by default) keeps a sitewide directory
of the people who help run events, and each event's team.

## Data

Two site-scoped tables, installed by `Models\TeamMemberRepository` on `init`
while the bundle is on (schema version in
`fair_events_experimental_team_members_db_version`):

- `fair_events_team_members` — one profile per person: `name` (required),
  `surname`, `instagram`, `email`, `facebook_url`, `phone` (text, so
  international prefixes stay), `gender` (`male`, `female`, `nonbinary`
  or NULL for unset), and the promotional `website_url`, `bio` (plain
  text with line breaks; NULL reads as blank) and `portrait_attachment_id`
  (a Media Library image, 0 for none). Schema 2 (#2421) added the last
  three; upgrading keeps every row, ID and membership.
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

| Route                                        | Methods                   | Notes                                                                                                                                                                                               |
| -------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/team-members`                              | GET, POST                 | Profiles with `event_count`.                                                                                                                                                                        |
| `/team-members/{id}`                         | GET, PUT/PATCH, DELETE    | GET adds `events`. Omitted fields keep their value; `''` (or `null` for `gender` and `portrait_attachment_id`) clears one. DELETE is 409 `rest_team_member_linked` with `data.events` while linked. |
| `/event-dates/{id}/team-members`             | GET, POST `{ member_id }` | `{ owner_event_date_id, series_event_date_id, members: [{ id, name, surname }] }`. A repeated POST is 200 and changes nothing.                                                                      |
| `/event-dates/{id}/team-members/{member_id}` | DELETE                    | Removes one membership only.                                                                                                                                                                        |

Validation errors are 400 `rest_invalid_param` with per-field messages in
`data.params`. `website_url` must be an absolute http(s) URL and
`portrait_attachment_id` a usable image attachment (or the stored one, so a
portrait trashed meanwhile doesn't block unrelated edits). A new or changed
`instagram` must be blank or a valid handle once trimmed and stripped of one
leading `@`; an older invalid value stays and can be saved unchanged.
Removing a portrait detaches it and keeps the attachment. Writes on a generated occurrence are 409
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
- Removing a member from a team fires
  `fair_events_experimental_team_member_unlinked` (`$owner_id, $member_id`);
  marketing assets drop their links to that member on every date sharing
  the team.
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

`Services\PromotionalTeamProfiles::read( $ids )` is the campaign-facts v1
reader (#2421) for profile IDs the caller has already resolved and
authorized for an event. The event-scoped REST read is Fair Events'
`GET /event-dates/{id}/campaign-facts/complete` (#2424), which gets these
profiles through the `fair_events_campaign_team_profiles` filter
(`TeamMembership::filter_campaign_team_profiles()`, registered whether or not
the bundle is on) for the member IDs that `fair_events_campaign_contributors`
references. It returns
`members`, one entry per profile sorted by `sourceId`, with exactly these
keys:

```json
{
	"id": "team-member:9",
	"sourceId": 9,
	"displayName": "Ana Ruiz",
	"instagramHandle": "ana.dances",
	"websiteUrl": "https://example.com",
	"bio": "Teacher.\nDancer.",
	"portraitMediaId": "media:52"
}
```

and `portraits`, the `EventImages\Source::describe()` result of each usable
portrait keyed by attachment ID (once even when shared), for the caller's
`media` registry. `displayName` is the trimmed name and surname joined by
one space; blank optional values are `null`; an Instagram handle that fails
`^[A-Za-z0-9._]{1,30}$` after trimming and removing one `@` is `null`. The
portrait is resolved on every read: a cleared, deleted, trashed or non-image
attachment is `null`, and a restored one comes back. Contact details,
gender and event counts are never selected.

Every other outcome is a `WP_Error`, never an empty list: `rest_forbidden`
(401/403, without `edit_posts`; checked first),
`fair_events_team_directory_disabled` (409, bundle off or never installed;
the complete campaign-facts read reports it as the `team-members` feature
being `disabled`, never as `team.members: null`),
`fair_events_team_member_missing` (500, with `data.member_ids`),
`fair_events_source_unavailable` (500, failed query) and
`fair_events_campaign_facts_member_name_missing` (422). An authorized read of
no IDs returns `members: []`.

The team tables are added to the complete read's snapshot audit with
`fair_events_campaign_snapshot_tables`. Profile deletion, linking,
assignment, unassignment and reordering each commit in one transaction, so
the snapshot never sees half of one of these edits.
