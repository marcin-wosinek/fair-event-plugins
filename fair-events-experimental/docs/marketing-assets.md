# Marketing assets

The `marketing-assets` bundle (#2396, off by default) keeps the text and
images an organizer uses to promote one event date: an Instagram post, a
WhatsApp status, a WhatsApp group message. Organizers manage them in the
**Marketing** tab of Manage Event; external tools such as Event Content
Studio use the authenticated API below.

Assets are **public** (#2430): every event date has a page anyone can
open without an account or secret link, where collaborators browse,
filter, copy the texts and download the images. See
[Public sharing](#public-sharing). A team member's name appears there
only after an administrator confirms it when saving the link; see
[Publishing team member names](#publishing-team-member-names).

## Turning it on and off

Enable **Marketing assets** in Fair Events → Settings → Experimental (or
`FAIR_EVENTS_EXPERIMENTAL_FEATURE_MARKETING_ASSETS`). While it is off:

- the Marketing tab is not loaded, every route below (authenticated and
  public) answers 404 `rest_no_route`, and the public pages answer the
  theme's 404;
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
  unique on `(asset_id, member_id)`, with `disclosure_version`: the version
  of the public-name disclosure accepted when the link was saved, 0 when
  the name is not published (schema version 2, #2430).

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

| Route           | Methods    | Notes                                                                                                                                                          |
| --------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `` (collection) | GET        | `page` (from 1), `per_page` (1–100, default 50). Returns `{ items, total, page, per_page, total_pages }`, oldest first, plus `X-WP-Total` / `X-WP-TotalPages`. |
| `` (collection) | POST       | Create. 201 with the asset.                                                                                                                                    |
| `/options`      | GET        | What the date's assets can link (see below).                                                                                                                   |
| `/{asset_id}`   | GET        | One asset.                                                                                                                                                     |
| `/{asset_id}`   | PUT, PATCH | Update. Omitted fields keep their value; `null` (or `[]`, `0`, `""` where it applies) clears an optional one.                                                  |
| `/{asset_id}`   | DELETE     | `{ deleted: true, previous }`. The attachment stays in the Media Library.                                                                                      |

An `asset_id` that belongs to another event date is 404
`marketing_asset_not_found`, also on another date of the same series. A
missing event date is 404 `rest_event_date_not_found`.

### Fields

Request fields (POST requires `label`):

| Field                  | Type              | Meaning                                                                                                                                                                                    |
| ---------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `label`                | string            | What the asset is for, e.g. "Instagram post". One line, at least one visible character, up to 191 characters. Public, and offered as a filter.                                             |
| `text`                 | string \| null    | Plain text, up to 10 000 characters. Stored and returned byte for byte: Unicode, whitespace, CRLF or LF line breaks and markup-like text are never changed or interpreted.                 |
| `attachment_id`        | integer \| null   | A PNG or JPEG attachment the user can read.                                                                                                                                                |
| `member_ids`           | integer[] \| null | Members of the date's team (the series' team for a generated occurrence). Replaces the linked set. Up to 50. Adding a member needs `publish_member_names`.                                 |
| `schedule_item_id`     | integer \| null   | An entry of the date's schedule (the series' schedule for a generated occurrence). Never public.                                                                                           |
| `publish_member_names` | boolean           | Confirms that the name and surname of every member in `member_ids` are shown on the public page and offered as filters. See [Publishing team member names](#publishing-team-member-names). |

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
	"members": [
		{ "id": 2, "name": "Ana", "surname": "Ruiz", "public": true }
	],
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
  are the only profile fields returned; `public` says whether the name is
  published on the public page. `schedule_item` dates are naive
  site-local times, shifted to the occurrence for a series.

### Options

`GET …/options`:

```json
{
	"event_date_id": 140,
	"team": {
		"available": true,
		"members": [ { "id": 2, "name": "Ana", "surname": "Ruiz" } ]
	},
	"schedule": {
		"available": true,
		"items": [
			{
				"id": 31,
				"title": "Acro workshop",
				"start_datetime": "…",
				"end_datetime": "…"
			}
		]
	},
	"share_url": "https://example.org/?fair_marketing_assets=140",
	"index_url": "https://example.org/?fair_marketing_assets=all",
	"supported_mime_types": [ "image/jpeg", "image/png" ],
	"max_label_length": 191,
	"max_text_length": 10000,
	"max_members": 50
}
```

`share_url` is the date's public page and `index_url` the list of every
date's page. `team.available` is false while the `team-members` bundle is off;
`schedule.available` is false while this Fair Events has no schedules or
the event's schedule is not enabled. Their lists are then empty.

### Errors

| Status    | Code                                                                                                              | When                                                                                                        |
| --------- | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 400       | `rest_invalid_param`                                                                                              | Validation. `data.params` has one message per field; `data.details.<field>.code` is one of the codes below. |
|           | `marketing_asset_label_required`, `marketing_asset_label_invalid`, `marketing_asset_label_too_long`               | `label`                                                                                                     |
|           | `marketing_asset_text_invalid` (not UTF-8), `marketing_asset_text_too_long`                                       | `text`                                                                                                      |
|           | `marketing_asset_content_required`                                                                                | `content`: neither text nor a usable image                                                                  |
|           | `marketing_asset_attachment_not_found`, `marketing_asset_attachment_type`, `marketing_asset_attachment_forbidden` | `attachment_id`                                                                                             |
|           | `marketing_asset_member_not_on_team` (with `ids`), `marketing_asset_too_many_members`                             | `member_ids`                                                                                                |
|           | `marketing_asset_publication_unconfirmed` (with `ids`)                                                            | `member_ids`: a member added without `publish_member_names`                                                 |
|           | `marketing_asset_publication_needs_members`                                                                       | `member_ids`: `publish_member_names` sent without `member_ids`                                              |
|           | `marketing_asset_schedule_item_not_found`                                                                         | `schedule_item_id`                                                                                          |
| 401 / 403 | `rest_forbidden`                                                                                                  | Not logged in / not allowed.                                                                                |
| 404       | `rest_no_route`                                                                                                   | The bundle is off.                                                                                          |
| 404       | `rest_event_date_not_found`, `marketing_asset_not_found`                                                          | See above.                                                                                                  |
| 409       | `marketing_asset_team_unavailable`                                                                                | Adding a member, or publishing a name not yet public, while team management is off.                         |
| 409       | `marketing_asset_schedule_unavailable`                                                                            | Linking a new schedule item while the schedule is off.                                                      |
| 500       | `marketing_asset_save_failed`, `marketing_asset_delete_failed`                                                    | Nothing was changed.                                                                                        |

While team or schedule management is off, existing links are kept and can
be removed; only new links (and publishing names not yet public) are
refused.

## Publishing team member names

Linking a team member to an asset publishes their **name and optional
surname** on the date's public page, and offers them there as a filter.
Email, phone, Instagram, Facebook, website, bio and grammatical gender are
never published. Creating a profile or adding someone to an event's team
publishes nothing.

The publication is authorized by the save that links the member:

- **Admin editor.** The Team members section says that linked members'
  names are public and offered as filters. When members are added, saving
  requires checking **Show these names on the public marketing assets
  page**, which lists the names that become public.
- **API.** Send `publish_member_names: true` together with the complete
  `member_ids`. Without it, a request that adds a member is refused with
  `marketing_asset_publication_unconfirmed`. The confirmation is recorded
  on every link in `member_ids` (`disclosure_version` 1).

Links saved before #2430 have no confirmation (`disclosure_version` 0 after
the schema upgrade) and their names stay private: the editor marks them
"name not public", and `members[].public` is false. Other edits keep them
private. To publish them, check the confirmation in the editor, or send
`member_ids` with `publish_member_names: true`.

Removing a link removes that member's name from the asset; a member no
longer linked to any asset of the date disappears from its filters.
Removing someone from the event's team removes their links (see
[Lifecycle](#lifecycle)). Names are read from the current profile, so an
edit in Fair Events → Team members shows on the next read.

With **team management** (`team-members`) off, published names and
filters stay on the public page and links can still be removed, and asset
content can be edited, but members cannot be added or swapped and names
not yet public cannot be published: the editor hides the confirmation, and
the API answers 409 `marketing_asset_team_unavailable`. The directory and
its private profile fields stay unavailable.

## Public sharing

While the bundle is on, every event date has a public page, whatever the
event's publication status: draft, private and published events, single
dates and each occurrence of a series. Assets support preparing the
marketing, so they can be shared before the event is announced. Publishing
or drafting the event later changes nothing about the page. The page
shares only the assets: it does not publish the event, and the event's own
pages, feeds and facts follow their usual publication rules.

| Page                    | Link                                      |
| ----------------------- | ----------------------------------------- |
| Every date's asset page | `/?fair_marketing_assets=all`             |
| One date's assets       | `/?fair_marketing_assets={event_date_id}` |

The links work with any permalink setting. Manage Event → Marketing links
to the date's page, with a **Copy public page link** button, and to the
list; each date's page links back to the list. A published event is named
by its title; any other is named "Event #{id}", so its title stays private.
Both pages are `noindex` and sent with `Cache-Control: no-store`, so page
caches and CDNs keep no copy and a removal or turning the bundle off shows
on the next request. An unknown ID answers a 404 page.

On a date's page, visitors can:

- **filter** by team member and by use case, alone or together, and clear
  the filters. A member filter keeps every asset showing that member,
  including assets shared with others. Two people with the same name are
  separate choices;
- **copy** a text with **Copy text**: the text is copied exactly as
  stored, with Unicode, spacing and line breaks and without markup. When
  the browser refuses clipboard access, the text is selected for copying
  with the device's own command;
- **download** a PNG or JPEG with **Download image** when the file is on
  the site's own domain. When images are served from another domain (a
  CDN), browsers don't download cross-origin links, so the button reads
  **Open image** and opens it in a new tab to save from there.

The page shows a loading message, an empty state (no assets yet, or none
matching the filters), and an error with **Try again**. An asset whose
image was deleted shows that the image is no longer available.

### Public API

Anonymous and read-only, in `fair-events/v1`; registered only while the
bundle is on (else 404 `rest_no_route`). Responses carry
`Cache-Control: no-store` and `X-Robots-Tag: noindex`.

`GET /marketing-assets` — `page`, `per_page` (1–100, default 50). Every
event date, newest first:

```json
{
	"items": [
		{
			"event_date_id": 141,
			"title": null,
			"url": "https://example.org/?fair_marketing_assets=141"
		},
		{
			"event_date_id": 140,
			"title": "Winter social",
			"url": "https://example.org/?fair_marketing_assets=140"
		}
	],
	"total": 2,
	"page": 1,
	"per_page": 50,
	"total_pages": 1
}
```

`title` is the event's title, decoded to plain text, when it is published
and its linked page (if any) is publicly viewable without a password; null
otherwise.

`GET /marketing-assets/{event_date_id}` — `page`, `per_page`, `label`
(exact use case) and `member` (a key from `filters.members`). A
well-formed key that matches nobody returns no assets.

```json
{
	"event_date_id": 140,
	"title": "Winter social",
	"url": "https://example.org/?fair_marketing_assets=140",
	"index_url": "https://example.org/?fair_marketing_assets=all",
	"filters": {
		"members": [
			{ "key": "3f9a0c1d2b4e5f60", "name": "Ana", "surname": "Ruiz" }
		],
		"labels": [ "Instagram post", "WhatsApp status" ]
	},
	"items": [
		{
			"id": 12,
			"label": "Instagram post",
			"text": "Winter social is back!\n\nDec 12, 7 pm",
			"image": {
				"url": "https://example.org/wp-content/uploads/2026/11/poster.png",
				"mime_type": "image/png",
				"alt": null
			},
			"image_unavailable": false,
			"members": [
				{ "key": "3f9a0c1d2b4e5f60", "name": "Ana", "surname": "Ruiz" }
			]
		}
	],
	"total": 1,
	"page": 1,
	"per_page": 50,
	"total_pages": 1
}
```

- `filters` cover the whole date, not the page: `labels` in the order first
  used, `members` the members with a published link who are still on the
  team, by name.
- Member keys are scoped to the date: they reveal no profile ID and differ
  between dates for the same person.
- `image` is null without a usable image; `image_unavailable` is true when
  an image was linked but is deleted, trashed or missing.
- Never returned: schedule links, attachment IDs and metadata, timestamps,
  profile IDs and every other profile field.

| Status | Code                        | When                                                      |
| ------ | --------------------------- | --------------------------------------------------------- |
| 400    | `rest_invalid_param`        | A malformed parameter, e.g. a `member` that is not a key. |
| 404    | `rest_event_date_not_found` | No such event date.                                       |
| 404    | `rest_no_route`             | The bundle is off.                                        |

### Feature combinations

| `marketing-assets` | `team-members` | Result                                                                                                                                                                                |
| ------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| off                | off            | No Marketing tab, no public pages or routes (404). Directory hidden. Everything stored is kept.                                                                                       |
| off                | on             | As above for marketing; the directory and event teams work.                                                                                                                           |
| on                 | off            | Marketing tab, public pages and routes work with published names and filters. Members can be removed but not added, swapped or published. Directory and private profiles unavailable. |
| on                 | on             | Everything available.                                                                                                                                                                 |

Turning marketing off and on again restores the assets, their links and
their published names.

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
the editor before they choose or upload an image. The public page lists an
image's URL, but gating that page (turning the bundle off) never made the
file itself confidential. On a standard WordPress installation:

- anyone with an image's direct URL can open it as soon as it is
  uploaded, before the event is published or shared, and publishing the
  event or the public page changes nothing about it;
- removing an image from an asset, deleting the asset, or turning the
  bundle off removes the association only, and so removes the image from
  the public page. The attachment stays in the Media Library and its URL
  keeps working: none of these revokes it;
- to make the file itself unreachable, delete it in Media Library. That
  is a WordPress action, separate from removing it from a marketing asset;
- deleting the attachment in the Media Library follows WordPress' normal
  file deletion;
- site-level media access controls (from another plugin or the server)
  apply as they would to any other upload.

Marketing images are posted as they are, so they carry no focal-point
metadata and the editor offers no cropping (a #2396 decision, kept for
#2430).

## Lifecycle

Registered whether or not the bundle is on, and a no-op until the tables
exist (`Services\MarketingAssets::register_lifecycle_hooks()`):

| Event                                           | Effect                                                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `fair_events_event_date_deleted`                | The date's assets and their links are deleted.                                                                             |
| `delete_attachment`                             | Assets using it lose the image and are marked `image_removed`; label, text and links stay.                                 |
| `fair_events_experimental_team_member_unlinked` | Links to that member are removed from the assets of every date sharing the team (the owner and its generated occurrences). |
| `fair_events_schedule_item_deleted`             | Links to that schedule entry are cleared, inside the schedule save's transaction.                                          |

Writes lock the asset row and the team and schedule rows they link, inside
one transaction. A concurrent unlink or schedule save either happens first
(and the new link is refused, or an existing one dropped) or waits for the
write and then removes the link through the hooks above. Reads also leave
out links that no longer resolve.
