# Email rendering

Every HTML email the plugins send uses one design, rendered by
`FairEventsShared\Notifications\EmailLayout` in the shared package (#2322).
This page lists the email flows, what renders them, and why some messages
aren't part of the design.

## The layout

`EmailLayout` renders the document (a header with the title, the content
and an optional footer) and the elements messages repeat: paragraphs,
headings, the button with its copy-this-link fallback, text links, detail
and answer tables, lists, rich content blocks and two-line footers.

- **Identity:** blue `#0073aa` header, links and buttons; red `#b32d2e`
  header for failure notices; Arial; light grey page and footer.
- **Responsive:** the card is fluid up to 600px (an Outlook-only conditional
  table keeps 600px there). Long titles, URLs, names and translated labels
  wrap instead of widening the card, and answer tables use a fixed layout so
  long values wrap inside their column.
- **Contract:** callers pass translated text, escaped for its context, and
  HTML they prepared. The layout never escapes, translates or sanitizes, so
  every message keeps its own text domain and content rules. Subjects stay
  plain text and are built by the sending service.
- **Markup:** inline styles only (email clients strip `<style>`). Layout
  tables carry `role="presentation"`; detail and answer tables don't.

Two composed documents build on it, taking the same arguments as the legacy
renderers they replace for current callers:

| Class                         | Replaces for current callers | Notes                         |
| ----------------------------- | ---------------------------- | ----------------------------- |
| `BookingConfirmationDocument` | `BookingConfirmationEmail`   | Adds `alert` (failure header) |
| `FormSubmissionDocument`      | `FormSubmissionEmail`        |                               |

`BookingConfirmationEmail`, `SignupConfirmationEmail::html()` and
`FormSubmissionEmail` keep their previous output, because each plugin
bundles its own copy of the package and an older plugin may still call
them against the newest copy. New capability goes into new classes, which
older copies can't shadow (see
[PHP_PATTERNS.md § Shared Package](../PHP_PATTERNS.md#shared-package-fair-events-shared)).

## Inventory

| Plugin                  | Flow                                                                          | Composed in                                                                                            | Rendered by                                                                          | Personalized actions             | Coverage                                                                                                                 |
| ----------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Fair Audience           | Poll invitation, single and bulk                                              | `EmailService::send_poll_invitation()`, `send_bulk_invitations()`                                      | `EmailLayout`                                                                        | Poll link                        | `EmailCompositionTest`                                                                                                   |
| Fair Audience           | Event invitation, single and bulk                                             | `send_event_invitation()`, `send_bulk_event_invitations()`                                             | `EmailLayout`                                                                        | Signup link, manage preferences  | `EmailCompositionTest`, `EventInvitationRecipientsTest`                                                                  |
| Fair Audience           | Mailing-list email verification                                               | `send_confirmation_email()`                                                                            | `EmailLayout`                                                                        | Confirm link                     | `EmailCompositionTest`                                                                                                   |
| Fair Audience           | Signup answers                                                                | `send_audience_signup_answers_email()`                                                                 | `EmailLayout`, `QuestionnaireAnswerRows`                                             | Edit-answers link                | `EmailCompositionTest`, `EmailServiceAnswerRowsTest`                                                                     |
| Fair Audience           | Resume registration                                                           | `send_resume_registration_email()`                                                                     | `EmailLayout`                                                                        | Resume link                      | `EmailCompositionTest`                                                                                                   |
| Fair Audience           | Custom, bulk and scheduled mail (Experimental's scheduled messages call this) | `send_custom_mail*()`, `send_bulk_custom_mail*()`                                                      | `EmailLayout` (author HTML kept, sanitized with `wp_kses_post`)                      | Placeholders, manage preferences | `EmailCompositionTest`, `EmailServiceBulkObserverTest`, `CustomMail.api.spec.js`                                         |
| Fair Audience           | Weekly digest to subscribers, preview and test send                           | `WeeklyDigestMailer` → `send_bulk_custom_mail_to_all()`, `send_html_mail_to_address()`                 | `EmailLayout` around `WeeklyEmailRenderer::body()` (fallback `WeeklyDigestRenderer`) | Manage preferences               | `WeeklyDigestMailerTest`, `WeeklyDigestRendererTest`, `EmailCompositionTest`                                             |
| Fair Audience           | Fee reminders, single and bulk (called by Experimental)                       | `send_fee_reminder()`, `send_bulk_fee_reminders()`                                                     | `EmailLayout`                                                                        | Pay link                         | `EmailCompositionTest`                                                                                                   |
| Fair Audience           | Form notification (deprecated path) and form confirmation                     | `send_form_notification()`, `send_form_confirmation()`                                                 | `FormSubmissionDocument`, `EmailLayout`, `QuestionnaireAnswerRows`                   | —                                | `EmailCompositionTest`                                                                                                   |
| Fair Audience           | Booking confirmation                                                          | `send_signup_payment_confirmation()`                                                                   | `BookingConfirmationDocument`                                                        | Event link                       | `EmailCompositionTest`, `SignupConfirmationEventTitleTest`, `EmailDocumentTest`                                          |
| Fair Audience           | Activities added, payment failed                                              | `send_activities_added_confirmation()`, `send_signup_payment_failed()`                                 | `EmailLayout`                                                                        | Event link, resume-payment link  | `EmailCompositionTest`                                                                                                   |
| Fair Audience           | Interest confirmation, mailing-list welcome, manage-subscription link         | `send_event_interest_confirmation()`, `send_mailing_list_welcome()`, `send_manage_subscription_link()` | `EmailLayout`                                                                        | Unsubscribe, manage subscription | `EmailCompositionTest`                                                                                                   |
| Fair Events             | Standalone booking confirmation and payment failure                           | `Services\EmailService::send_signup_confirmation()`, `send_signup_payment_failed()`                    | `BookingConfirmationDocument` (failure uses `alert`)                                 | Event link                       | `EmailServiceTest`, `EventDatesBookingMessage.api.spec.js`                                                               |
| Fair Events             | Individual weekly email, scheduled and test send                              | `IndividualEmailDispatcher`, `EventNotificationsController` → `send_notification()`                    | `EmailLayout` around `WeeklyEmailRenderer::body()`                                   | —                                | `EmailServiceTest`, `IndividualEmailRendererTest`, `WeeklyEmailRendererTest`, `EventNotificationsController.api.spec.js` |
| Fair Form               | Submission notification                                                       | `FormNotificationService`                                                                              | `FormSubmissionDocument`, `QuestionnaireAnswerRows`                                  | —                                | `FormNotificationServiceTest`, `e2e/user-flows/fair-form-notification-email.spec.js`                                     |
| Fair Payments Connector | Payment notification email                                                    | `Services\EmailChannel` (via `NotificationHooks`)                                                      | `EmailLayout` around the rendered notification text                                  | —                                | `EmailChannelTest`, `e2e/fair-payments-connector-notifications.spec.js`                                                  |

The "Powered by Fair Event Plugins" line is appended once, below the card,
by Fair Audience's and Fair Form's delivery when the branding setting is on.
Fair Audience's mixed-version coverage is in
`fair-audience/__tests__/Shared/MixedVersionAutoloadTest.php`.

## Not part of the design

- **WordPress core emails** (password reset, new user, admin notices): core
  composes and sends them.
- **Non-email channels:** Telegram notifications from Fair Events and Fair
  Payments Connector share text with the payment email but aren't HTML
  email.
- **Browser pages:** `EmailConfirmationRenderer`, `ManageSubscriptionRenderer`,
  Fair Events' `EventDateView`, Events Experimental's `WeeklySummaryPage`
  and Fair Platform's pages render full HTML documents for the browser, not
  for mail.
- **Admin previews:** the weekly-email previews show the content fragment
  inside the admin page; the sent email wraps the same fragment in the
  layout.
