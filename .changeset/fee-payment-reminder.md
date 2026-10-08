---
"fair-audience-experimental": minor
---

Send a payment reminder to one member from Fee Detail. Each pending payment's row menu now offers **Send Payment Reminder**: a popup names the member, the address the email goes to and the fee, and confirming sends the existing reminder email to that member only. The page then says where the reminder went, the row shows its new "Reminder Sent" date and the payment's audit log records who sent it. Paid and canceled payments cannot be reminded, a member without an email address is explained in the popup, and a failed send says so without recording anything. While one reminder is being sent, a second click and "Send Reminders" are held back.

For developers: `POST fair-audience/v1/fees/{id}/payments/{pid}/send-reminder` (administrators only) answers 409 `payment_not_pending`, 404 `participant_not_found`, 400 `invalid_recipient_email` and 500 `reminder_send_failed`. A reminder that was sent but could not be recorded answers 200 with `recorded: false`.
