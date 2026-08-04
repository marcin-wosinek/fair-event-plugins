---
"fair-form": minor
---

Add an opt-in "read event details from the linked page" setting to the URL question, off by default. When enabled, the submitted address is fetched server-side at submission time and any structured event data it publishes (schema.org markup, falling back to social-sharing metadata or the page title) is captured and shown beneath the link in the form-answers and submission-detail admin views, marked as read from the page. Extraction never blocks submission — an unreachable page, a non-HTML response, or a page with no usable data still stores the plain address.
