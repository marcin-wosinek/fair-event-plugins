---
"fair-form": minor
---

Add stable `formId` UUID and `formTitle` attributes to the Fair Form block. The UUID is minted on first insert and regenerated on paste/duplicate collision. Both values are persisted in a new `form_id` / `form_title` column on the submissions table, enabling "by form" grouping in a future release. Existing submissions land in a legacy bucket (NULL form_id).
