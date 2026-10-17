## Purpose

Shows one Fair Events venue on any page or post: its name, address, and
separately labelled Website, Google Maps, Facebook, and Instagram links when
the venue has them. The block stores only the venue ID, so editing the venue
under Fair Events → Venues updates every page that shows it.

## Composition

No inner blocks and no parent restriction. It does not need an event: place
it on any page, post, or template. Several blocks on one page can each show a
different venue.

## Attributes

`venueId` is the venue to show. Without it, or when the venue has been
deleted, the editor explains what to do and the public page renders nothing.

## Prerequisites

- At least one venue under Fair Events → Venues. Choosing a venue in the
  editor needs the `edit_posts` capability; visitors need no permissions.

## Rendering

Renders `.wp-block-fair-events-venue-info` on the server; no frontend
JavaScript. The venue name links to the first available destination —
website, then Google Maps, then Instagram — and is plain text when there is
none. The Google Maps link uses the venue's coordinates when set, otherwise
its address. Instagram handles may be stored with or without `@`. Only
absolute `http`/`https` URLs are linked; missing or malformed destinations
are left out. All links open in a new tab with `rel="noopener noreferrer"`.
