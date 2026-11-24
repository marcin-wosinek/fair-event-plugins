# Marketing assets

The `marketing-assets` bundle (#2396, off by default) keeps the text and
images an organizer uses to promote one event date: an Instagram post, a
WhatsApp status, a WhatsApp group message. Organizers manage them in the
**Marketing** tab of Manage Event; external tools such as Event Content
Studio use the authenticated API below.

Nothing here is public yet. Anonymous asset pages, listings and asset
text, and any permission to publish team member names, belong to #2430.
A member linked to an asset is never authorization to publish their name.

## Turning it on and off

Enable **Marketing assets** in Fair Events → Settings → Experimental (or
`FAIR_EVENTS_EXPERIMENTAL_FEATURE_MARKETING_ASSETS`). While it is off:

- the Marketing tab is not loaded and every route below answers 404
  `rest_no_route`;
- every stored asset and link is kept, and comes back when it is turned on;
- the cleanup described under [Lifecycle](#lifecycle) keeps running;
- images are not touched: their files and direct URLs keep working.

## Data

Two site-scoped tables, installed by `Models\MarketingAssetRepository` on
`init` while the bundle is on (schema version in
`fair_events_experimental_marketing_assets_db_version`):

- `fair_events_marketing_assets` — one row per asset: the exact
  `event_date_id`, `label`, `text`, `attachment_id` (nullable),
  `image_removed`, `schedule_item_id` (nullable).
- `fair_events_marketing_asset_members` — one row per linked team member,
  unique on `(asset_id, member_id)`.

Assets belong to the exact event date they were created on. A generated
occurrence of a series has its own list; the series' other dates and
independent copies never show it. There is no series inheritance in this
version.

## Authentication

Every route requires a user with `manage_options` who may also
`edit_post` the event's linked post (an occurrence uses its series' post).
Anonymous requests get 401; other users 403.

External clients authenticate with
[Application Passwords](https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/)
over HTTPS: create one for an administrator in Users → Profile, then send
`Authorization: Basic base64(<username>:<application password>)` with each
request. WordPress only offers Application Passwords on HTTPS sites (or with
`WP_ENVIRONMENT_TYPE` set to `local`). Never send them over plain HTTP.

The admin tab uses the logged-in cookie and REST nonce through `apiFetch`.

## Routes

All in `fair-events/v1`, under `/event-dates/{event_date_id}/marketing-assets`:

| Route | Methods | Notes |
| ----- | ------- | ----- |
| `` (collection) | GET | `page` (from 1), `per_page` (1–100, default 50). Returns `{ items, total, page, per_page, total_pages }`, oldest first, plus `X-WP-Total` / `X-WP-TotalPages`. |
| `` (collection) | POST | Create. 201 with the asset. |
| `/options` | GET | What the date's assets can link (see below). |
| `/{asset_id}` | GET | One asset. |
| `/{asset_id}` | PUT, PATCH | Update. Omitted fields keep their value; `null` (or `[]`, `0`, `""` where it applies) clears an optional one. |
| `/{asset_id}` | DELETE | `{ deleted: true, previous }`. The attachment stays in the Media Library. |

An `asset_id` that belongs to another event date is 404
`marketing_asset_not_found`, also on another date of the same series. A
missing event date is 404 `rest_event_date_not_found`.

### Fields

Request fields (POST requires `label`):

| Field | Type | Meaning |
| ----- | ---- | ------- |
| `label` | string | What the asset is for, e.g. "Instagram post". One line, at least one visible character, up to 191 characters. |
| `text` | string \| null | Plain text, up to 10 000 characters. Stored and returned byte for byte: Unicode, whitespace, CRLF or LF line breaks and markup-like text are never changed or interpreted. |
| `attachment_id` | integer \| null | A PNG or JPEG attachment the user can read. |
| `member_ids` | integer[] \| null | Members of the date's team (the series' team for a generated occurrence). Replaces the linked set. Up to 50. |
| `schedule_item_id` | integer \| null | An entry of the date's schedule (the series' schedule for a generated occurrence). |

An asset needs **text with at least one visible character, a usable image,
or both**. Whitespace, separators and invisible formatting characters alone
do not count; the check never modifies the text.

The admin editor is a plain textarea. Browsers normalize a textarea's line
breaks to LF, so text edited there is saved with LF; text that is not
edited is not resent and keeps whatever line breaks the API stored.

Response (one asset):

```json
{
	"id": 12,
	"event_date_id": 140,
	"label": "Instagram post",
	"text": "Winter social is back!\n\nDec 12, 7 pm",
	"attachment_id": 55,
	"image": {
		"attachment_id": 55,
		"available": true,
		"unavailable_reason": null,
		"url": "https://example.org/wp-content/uploads/2026/11/poster.png",
		"mime_type": "image/png",
		"width": 1080,
		"height": 1080,
		"alt": null,
		"title": "poster"
	},
	"image_removed": false,
	"member_ids": [ 2 ],
	"members": [ { "id": 2, "name": "Ana", "surname": "Ruiz" } ],
	"schedule_item_id": 31,
	"schedule_item": {
		"id": 31,
		"title": "Acro workshop",
		"start_datetime": "2026-12-12 19:00:00",
		"end_datetime": "2026-12-12 20:00:00"
	},
	"created_at": "2026-11-24T10:00:00Z",
	"updated_at": "2026-11-24T10:00:00Z"
}
```

- `image.available` is false (with `unavailable_reason` `trashed`,
  `unsupported_type` or `missing_file`) when the attachment still exists
  but cannot be used. `image` is null when there is none.
- `image_removed` is true after WordPress deleted the attachment. The
  label, text and links stay; an asset left without text must be repaired
  (text or another image) before any other change is saved, or deleted.
- `members` and `schedule_item` hold only links that still resolve. Names
  are the only profile fields returned. `schedule_item` dates are naive
  site-local times, shifted to the occurrence for a series.

### Options

`GET …/options`:

```json
{
	"event_date_id": 140,
	"team": { "available": true, "members": [ { "id": 2, "name": "Ana", "surname": "Ruiz" } ] },
	"schedule": { "available": true, "items": [ { "id": 31, "title": "Acro workshop", "start_datetime": "…", "end_datetime": "…" } ] },
	"supported_mime_types": [ "image/jpeg", "image/png" ],
	"max_label_length": 191,
	"max_text_length": 10000,
	"max_members": 50
}
```

`team.available` is false while the `team-members` bundle is off;
`schedule.available` is false while this Fair Events has no schedules or
the event's schedule is not enabled. Their lists are then empty.

### Errors

| Status | Code | When |
| ------ | ---- | ---- |
| 400 | `rest_invalid_param` | Validation. `data.params` has one message per field; `data.details.<field>.code` is one of the codes below. |
| | `marketing_asset_label_required`, `marketing_asset_label_invalid`, `marketing_asset_label_too_long` | `label` |
| | `marketing_asset_text_invalid` (not UTF-8), `marketing_asset_text_too_long` | `text` |
| | `marketing_asset_content_required` | `content`: neither text nor a usable image |
| | `marketing_asset_attachment_not_found`, `marketing_asset_attachment_type`, `marketing_asset_attachment_forbidden` | `attachment_id` |
| | `marketing_asset_member_not_on_team` (with `ids`), `marketing_asset_too_many_members` | `member_ids` |
| | `marketing_asset_schedule_item_not_found` | `schedule_item_id` |
| 401 / 403 | `rest_forbidden` | Not logged in / not allowed. |
| 404 | `rest_no_route` | The bundle is off. |
| 404 | `rest_event_date_not_found`, `marketing_asset_not_found` | See above. |
| 409 | `marketing_asset_team_unavailable` | Adding a member while team management is off. |
| 409 | `marketing_asset_schedule_unavailable` | Linking a new schedule item while the schedule is off. |
| 500 | `marketing_asset_save_failed`, `marketing_asset_delete_failed` | Nothing was changed. |

While team or schedule management is off, existing links are kept and can
be removed; only new links are refused.

## Uploading images

Images are uploaded with the core media route, then linked by ID:

```bash
curl -u "admin:<application password>" \
  -H "Content-Type: image/png" \
  -H 'Content-Disposition: attachment; filename="poster.png"' \
  --data-binary @poster.png \
  https://example.org/wp-json/wp/v2/media
# → { "id": 55, "source_url": "…", … }

curl -u "admin:<application password>" \
  -H "Content-Type: application/json" \
  -d '{"label":"Instagram post","attachment_id":55}' \
  https://example.org/wp-json/fair-events/v1/event-dates/140/marketing-assets
```

The upload uses WordPress' own permissions (`upload_files`) and file
checks: a file whose content doesn't match its type is refused there. Any
other file WordPress accepts (a GIF, a PDF) is refused when linked, with
`marketing_asset_attachment_type`. The admin tab opens the Media Library
filtered to PNG and JPEG for choosing or uploading.

## Image visibility

Images are ordinary WordPress attachments. This feature adds no private
storage, signed URLs or file-access layer, and organizers are told so in
the editor before they choose or upload an image. On a standard WordPress
installation:

- anyone with an image's direct URL can open it as soon as it is
  uploaded, before the event or any public sharing is published, and
  publishing changes nothing about it;
- removing an image from an asset, deleting the asset, or turning the
  bundle off removes the association only. The attachment stays in the
  Media Library and its URL keeps working;
- deleting the attachment in the Media Library follows WordPress' normal
  file deletion;
- site-level media access controls (from another plugin or the server)
  apply as they would to any other upload.

## Lifecycle

Registered whether or not the bundle is on, and a no-op until the tables
exist (`Services\MarketingAssets::register_lifecycle_hooks()`):

| Event | Effect |
| ----- | ------ |
| `fair_events_event_date_deleted` | The date's assets and their links are deleted. |
| `delete_attachment` | Assets using it lose the image and are marked `image_removed`; label, text and links stay. |
| `fair_events_experimental_team_member_unlinked` | Links to that member are removed from the assets of every date sharing the team (the owner and its generated occurrences). |
| `fair_events_schedule_item_deleted` | Links to that schedule entry are cleared, inside the schedule save's transaction. |

Writes lock the asset row and the team and schedule rows they link, inside
one transaction. A concurrent unlink or schedule save either happens first
(and the new link is refused, or an existing one dropped) or waits for the
write and then removes the link through the hooks above. Reads also leave
out links that no longer resolve.
