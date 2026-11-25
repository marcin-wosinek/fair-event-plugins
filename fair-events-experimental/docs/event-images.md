# Event images and focal regions

Organizers link ordered Media Library images to an event and to each of its
saved programme items, and can mark a circle on each image around what
matters (#2397). Fair Events Experimental only stores and serves these
links. Choosing images, cropping, target sizes and rendering are up to the
consumer, such as Event Content Studio.

## Availability

The `event-images` bundle (Fair Events → Settings → Experimental, or
`FAIR_EVENTS_EXPERIMENTAL_FEATURE_EVENT_IMAGES`) is off by default. While it
is off, the Images tab and the routes below do not exist (`404
rest_no_route`). Saved links stay in the database and come back unchanged
when the bundle is turned on again.

Links are removed when their event date is deleted or their attachment is
deleted permanently, also while the bundle is off. Unlinking an image in the
tab never deletes the attachment.

## Lists

Every event has:

- one list of its own (`event`), and
- one list per saved programme item (`scheduleItems[]`): standalone items
  and workshops linked to an add-on alike. An item added in the Schedule tab
  gets a list once the schedule is saved. A list stops being returned when
  its item leaves the schedule.

A list holds up to 50 images, each attachment at most once. The same
attachment may be in several lists; each link has its own ID and its own
circle.

**Series.** A series keeps its lists on its master, like its schedule
(`EventSchedule::config_event_date_id()`). A generated occurrence returns the
master's lists with the same IDs and circles, `readOnly: true` and an
`ownerEditUrl`; writing to it is `409 event_images_managed_on_series`.

Copying an event or its programme items does not copy images: copies start
with empty lists.

## Endpoints

Paths are relative to `/wp-json/fair-events-experimental/v1`. All need a
logged-in user who can `edit_posts` and, for an event with a page, `edit_post`
on that page (the series' page for an occurrence): 401 otherwise for
anonymous requests, 403 for others. A missing event date is 404.

### `GET /event-dates/{id}/images`

```json
{
  "eventDateId": 815,
  "ownerEventDateId": 812,
  "readOnly": true,
  "ownerEditUrl": "https://example.org/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=812&tab=images",
  "scheduleAvailable": true,
  "event": {
    "revision": "9f2c4be1a07d3e55",
    "images": [
      {
        "id": 31,
        "position": 0,
        "attachmentId": 52,
        "available": true,
        "unavailableReason": null,
        "sourceUrl": "https://example.org/wp-content/uploads/2026/11/poster.jpg",
        "width": 2400,
        "height": 1600,
        "sourceRevision": "0b8e5d2f6a1c9e33",
        "altText": "Dancers on stage",
        "credit": null,
        "title": "poster",
        "focalRegion": { "centerX": 0.62, "centerY": 0.4, "radius": 0.3 },
        "focalRegionNeedsReview": false
      }
    ]
  },
  "scheduleItems": [
    {
      "scheduleItemId": 41,
      "title": "Acro workshop",
      "ticketOptionId": 7,
      "startDatetime": "2026-12-03 11:00:00",
      "endDatetime": "2026-12-03 13:00:00",
      "revision": "4f53cda18c2baa0c",
      "images": []
    }
  ],
  "maxImagesPerList": 50,
  "supportedMimeTypes": ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"]
}
```

- `images` are in the organizer's order; `position` counts from 0 without
  gaps. The same stored state always gives the same response.
- `scheduleItems` follow the programme order of the schedule and carry its
  dates (shifted to the occurrence for a series date).
- `scheduleAvailable` is `false` when the active Fair Events stores no
  schedule; `scheduleItems` is then empty.
- `id` is stable across reorders and circle edits. A replaced image is a new
  link with a new ID.
- `available: false` means the attachment exists but cannot be used:
  `unavailableReason` is `trashed`, `not_image` or `missing_file`, and
  `sourceUrl`, `width`, `height`, `sourceRevision` and `focalRegion` are
  `null`. Consumers skip such images.

### `PUT /event-dates/{id}/images/event`, `PUT /event-dates/{id}/images/schedule-items/{schedule_item_id}`

Replace one list. The body is the whole list in order; images left out are
unlinked:

```json
{
  "revision": "9f2c4be1a07d3e55",
  "images": [
    { "id": 31, "attachmentId": 52, "focalRegion": { "centerX": 0.62, "centerY": 0.4, "radius": 0.3 }, "sourceRevision": "0b8e5d2f6a1c9e33" },
    { "attachmentId": 60, "focalRegion": null }
  ]
}
```

The response is the `GET` payload. Everything is validated before anything
is written; a refused save changes nothing.

| Status | Code                                   | When                                                                                   |
| ------ | -------------------------------------- | -------------------------------------------------------------------------------------- |
| 400    | `rest_invalid_param`                   | More than 50 images, or a missing `revision` / `images`.                               |
| 400    | `event_images_invalid`                 | An entry without `attachmentId`, a repeated `id`, or an `id` of another list or image. |
| 400    | `event_images_duplicate`               | The same attachment twice in the list.                                                 |
| 400    | `event_images_invalid_attachment`      | `data.reason`: `missing`, `trashed`, `not_image`, `missing_file` or `not_readable`.    |
| 400    | `event_images_invalid_focal_region`    | `data.reason`: `malformed`, `dimensions_unknown`, `radius_not_positive`, `outside_image`. |
| 404    | `event_images_schedule_item_not_found` | The programme item is not on this event's schedule (any more).                         |
| 409    | `event_images_revision_mismatch`       | The list changed since `revision` was read. Reload and apply the change again.         |
| 409    | `event_images_source_changed`          | A circle was sent with a `sourceRevision` that is not the image's current one.         |
| 409    | `event_images_managed_on_series`       | The date is a generated occurrence; `data.owner_event_date_id` names the series.       |
| 409    | `event_images_busy`                    | Another save of the same list did not finish within 5 seconds.                         |

Per-image errors carry `data.index`, the entry's position in the request.

## Coordinate contract

A focal region is a circle on the image **as displayed**:

- The origin is the top-left corner of the oriented image.
- `centerX` is a fraction of the oriented width, `centerY` a fraction of the
  oriented height, both measured from that corner.
- `radius` is a fraction of the shorter oriented side.

In pixels of a `W × H` image the circle is centred at `(centerX · W,
centerY · H)` with radius `radius · min(W, H)`. The whole circle lies inside
the image: `radius > 0`, `centerX · W ± radius · min(W, H)` within `[0, W]`
and `centerY · H ± radius · min(W, H)` within `[0, H]`. Values are stored and
returned with six decimals. Because every value is relative, the same circle
applies to every proportional resize of the source (WordPress's generated
sizes included, as long as they are not cropped).

The circle marks content of interest. It is not a crop and does not make the
image round.

**No region.** `focalRegion: null` means the organizer marked nothing. No
default circle is ever invented.

**Dimensions.** `width` and `height` are the oriented pixel size of
`sourceUrl` (the full-size file), both numbers or both `null`. WordPress
rotates JPEG uploads by their EXIF orientation and stores orientation 1, so
the stored size is the displayed one. When it could not rotate a file, the
file keeps its EXIF orientation 5–8 and the stored width and height are
reported swapped, as browsers display it. An image without a known size can
be linked but cannot take a circle (`dimensions_unknown`).

**Edited images.** `sourceRevision` fingerprints the file and its size. When
an image is edited in place in the Media Library (cropped, rotated, scaled)
after its circle was marked, the link stays, `focalRegion` is returned as
`null` and `focalRegionNeedsReview` is `true` until a new circle (or an
explicit `null`) is saved. A circle is only accepted with the image's current
`sourceRevision`.

## Mapping to Event Content Studio campaign facts

For [campaign facts v1](https://github.com/marcin-wosinek/event-content-studio/blob/main/docs/campaign-facts.md),
Fair Events' `GET /fair-events/v1/event-dates/{id}/campaign-facts/complete`
(#2424) reads these lists through `EventImages\CampaignMedia`, which answers
the `fair_events_campaign_media` filter and adds the images table to the
snapshot audit. It reads the same rows as the images read, checked:

- `event.mediaIds`: `media:<attachmentId>` for each available image of
  `event.images`, in order. `schedule.items[].mediaIds` likewise from the
  matching `scheduleItems[]` entry (by `scheduleItemId` = `sourceId`).
- `focalRegions`: for each of those images with a non-null `focalRegion`, an
  entry keyed by its `media:<attachmentId>` with `centerX`, `centerY` and
  `radius` as they are. Images without a circle get no entry.
- `media[]`: one entry per distinct attachment across all lists, deduplicated
  by `media:<attachmentId>`: `sourceUrl`, `width`, `height`, `altText`
  (`null` when blank) and `credit` (`null` when unknown).
- Unusable images (`trashed`, `not_image`, `missing_file`) are skipped. A
  stored link to an attachment that no longer exists is
  `500 fair_events_event_image_missing`, and a failed query is
  `500 fair_events_source_unavailable`. Neither becomes an empty list.
- An empty `images` list is an available, empty list: `mediaIds: []` and
  `focalRegions: {}`. With the bundle off, the provider answers
  `409 fair_events_event_images_disabled` (registered whether or not the
  bundle is on). The complete read then fails with
  `409 fair_events_campaign_facts_features_unavailable` naming
  `event-images` as `disabled`, or as `not_provided` while this plugin is
  inactive. Any other failed read stops the import instead of being read
  as "no images".

The consumer owns image choice, crop feasibility, target dimensions and
rendering.
