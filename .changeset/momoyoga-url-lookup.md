---
'fair-events': minor
'fair-form': patch
'fair-events-shared': minor
---

Recognize Momoyoga event links in **From URL**. Momoyoga pages load their details with JavaScript, so a lookup used to find only the title. It now also fills the start and end date and time and the venue name from Momoyoga's public event data, converted to the site's timezone. Every value stays editable, and the link is kept as the event's external link. When Momoyoga's data can't be read, the page title is still filled and the missing fields are left for you to complete. Fair Form's link preview reads Momoyoga dates the same way.

When a looked-up page gives no start date, **Quick Add Event** no longer leaves its 10:00–12:00 default times in place, where they could pass for imported values. The calendar day you picked stays, and any times you had already entered are kept.
