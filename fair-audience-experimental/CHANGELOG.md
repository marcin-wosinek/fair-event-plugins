## 1.1.0

### Minor Changes

-   efe9aae: Move the fees, polls, instagram, collaborators, image-templates, timeline, import, and weekly-schedule bundles out of `fair-audience` into the `fair-audience-experimental` companion, gated behind their `Features::is_enabled()` flags. None of these bundles had callers outside fair-audience, so this is the lowest-risk slice of the fair-audience/fair-audience-experimental split (issue #1041). The `fair-audience` top-level admin menu now lands on All Participants instead of the (now-moved) Activity Timeline page.
-   3e34be8: Move the groups and invitations bundles out of `fair-audience` into the `fair-audience-experimental` companion, gated behind their `Features::is_enabled()` flags (issue #1041). `Group`/`GroupParticipant` and their repositories are renamed to `FairAudienceExperimental\…` and now travel with the companion; every core `fair-audience` call site (participant lists, custom mail, payment discount labels, signup pricing, anonymization, the signups-list block) and the `fair-events-experimental` invitation-token controller degrade gracefully via `class_exists()` guards when the companion is inactive.
-   e84e6b3: Move the galleries and messaging bundles out of `fair-audience` into the `fair-audience-experimental` companion, gated behind their `Features::is_enabled()` flags (issue #1041). `PhotoParticipant`/`GalleryAccessKey` and `CustomMailMessage`/`ExtraMessage`/`ScheduledMessage` (plus their repositories, controllers, admin pages, media-library hooks, and the scheduled-message cron) are renamed to `FairAudienceExperimental\…` and now travel with the companion; every cross-plugin call site (`fair-events-experimental`'s gallery endpoint, stable `fair-events`' gallery page, `fair-form`'s questionnaire photo tagging, and core `fair-audience`'s email service and anonymization service) degrades gracefully via `class_exists()` guards when the companion is inactive.
-   ef647cf: Scaffold the fair-audience-experimental companion plugin: `plugins_loaded` bootstrap with a runtime guard on fair-audience, a `Features` registry (master constant `FAIR_AUDIENCE_EXPERIMENTAL_INTERNAL`) listing the thirteen advanced bundles (fees, polls, galleries, Instagram, groups, collaborators, messaging, image-templates, timeline, import, weekly-schedule, invitations, manage-event-ext), and a Settings page to toggle them. This is the clean-slate step of splitting fair-audience into a lean core plus this companion — feature bundles themselves still live in fair-audience and move out in follow-up changes.
-   8a1195f: Move the manage-event tab extensions (Audience, Groups, Mailings) out of `fair-audience` into the `fair-audience-experimental` companion under the `manage-event-ext` feature flag (issue #1041). The tab bundle's enqueue wiring on fair-events' manage-event page — previously always registered by `fair-audience` — now lives in the companion and only mounts when its `manage-event-ext` feature is enabled, mirroring how `fair-events-experimental` merges its own manage-event extensions.
-   2a3600a: Move the manage-event Audience tab from `fair-audience-experimental` back into core `fair-audience`, so it now renders on the fair-events Manage Event page without the experimental companion plugin active. The Groups and Mailings tabs remain in `fair-audience-experimental` behind the `manage-event-ext` feature flag.

### Patch Changes

-   f1985d8: Add e2e coverage for the fair-audience-experimental Features registry (all-bundles-on/off admin page and REST route checks) and wire `dist-archive:fair-audience-experimental` into the root release build, closing out the fair-audience/fair-audience-experimental split (issue #1041).
-   612b9b0: Fix Instagram schedule-image posting failing with an unrecognized-format error after tmpfiles.org stopped serving raw image bytes. `upload_blob()` now stores the PNG directly as a WordPress attachment (tagged `_fair_audience_instagram_temp`, deleted after a successful publish) instead of round-tripping through the third-party host; a new hourly cron sweep cleans up anything left by an abandoned publish (issue #1063).
-   Updated dependencies [b007d8a]
-   Updated dependencies [612b9b0]
-   Updated dependencies [612b9b0]
    -   fair-events-shared@0.3.0

## 1.0.0

### Minor Changes

-   Initial release — scaffolds the fair-audience-experimental companion plugin: `plugins_loaded` bootstrap with a runtime guard on `fair-audience`, a `Features` registry (master constant `FAIR_AUDIENCE_EXPERIMENTAL_INTERNAL`) listing the thirteen advanced bundles, and a Settings page to toggle them. Feature bundles themselves stay in `fair-audience` for now and move out in follow-up changes.
