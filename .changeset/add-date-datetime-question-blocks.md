---
"fair-form": minor
"fair-events-shared": patch
"fair-audience": patch
"fair-events": patch
---

Add "Date" and "Date & Time" question blocks (mirroring the email/phone/url questions) that render the browser's native date/date-time picker on the frontend. Values are validated server-side as real, well-formed dates and rejected with the same error conventions as other typed fields; datetime answers are stored as site-local time. Stored answers render as localized, human-readable dates in the submission-detail and questionnaire-responses admin views. Also adds the new question types to Event Signup's block inserter (fair-audience and fair-events) and their shared validation (fair-events-shared).
