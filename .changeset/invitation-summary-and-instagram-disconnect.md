---
"fair-audience": minor
"fair-audience-experimental": minor
---

**Send Invitations** on the Event Participants page and on the Manage Event Audience tab now shows a summary before anything is sent. It names the event and its date and lists the selected groups or people. Group memberships are counted separately from the number of different people selected, and the summary says how many people will receive the invitation. People who will not get it are counted by reason: already signed up for this date, no longer in the audience, no valid email address, or no confirmed consent to marketing emails. When nobody can be invited, the summary says so and sending stays disabled with the reason shown. Sending goes to exactly the people counted in the summary. Each person is checked again when sending, but nobody who joined a group after the summary was shown gets an invitation. While sending, the dialog cannot be closed and the selection cannot be changed. If sending fails, the error is shown in the dialog and the selection is kept.

**Disconnect Instagram** now asks for confirmation in an in-page dialog instead of the browser's own confirmation box. The dialog names the account by username, or by account ID when there is no username. It explains that the access token and connection details stored on the site are removed, and that publishing needs a reconnection. Posts already on Instagram and the site's post records are kept. A failure is shown in the dialog, and repeated clicks cannot disconnect twice.

The new `POST /fair-audience/v1/event-dates/{event_date_id}/event-invitations/preview` endpoint returns these counts without sending any mail. Invitation requests with non-integer participant or group IDs are now rejected with a 400 error.
