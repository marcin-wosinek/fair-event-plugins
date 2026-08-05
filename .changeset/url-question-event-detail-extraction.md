---
"fair-form": minor
---

Add an opt-in "read event details from the linked page" setting to the URL question, off by default. When enabled, the submitted address is looked up as soon as the visitor leaves the field, and any structured event data it publishes (schema.org markup, falling back to social-sharing metadata or the page title) is shown live in an info bubble beneath the field, marked as read from the page. Nothing is stored — an unreachable page, a non-HTML response, or a page with no usable data simply shows no bubble.
