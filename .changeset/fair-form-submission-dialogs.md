---
"fair-form": minor
---

Deleting a submission from **All Answers** or **Questionnaire Responses** now asks for confirmation in the same in-page dialog instead of the browser's own confirmation box. The dialog names the respondent (or "Anonymous respondent"), the form, the submission date and its ID, so repeated submissions stay distinguishable, and says that the participant, other submissions and uploaded files are kept. A failed deletion is reported inside the dialog and can be retried, and a confirmed deletion cannot be sent twice.

The event-assignment editor on **All Answers** now shows which submission it edits. A failed save is reported inside the dialog and keeps the chosen event for a retry, and if the list of events cannot be loaded the current assignment is kept and the list can be reloaded.
