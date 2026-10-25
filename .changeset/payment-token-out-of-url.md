---
'fair-payments-connector': patch
'fair-events-shared': patch
---

The Simple Payment block no longer puts the payment's access token in the return URL. The token proves that a visitor started the payment, and a URL can leak it to other sites through the `Referer` header, browser history and server logs. The block now keeps the token in the browser tab's session storage before sending the buyer to Mollie, and sends it in a request header when it checks the payment status.

- After returning from Mollie, the block shows "processing" first, then the checked result. Reloading the page in the same tab still works.
- If the status can't be checked (for example, the return link was opened in another browser), the block says so and asks the buyer to check their email or contact the organizer before paying again. It no longer suggests the payment failed.
- If the browser blocks site data, the block won't start a payment. It asks the visitor to allow site data first, so nobody pays without seeing the result.
- Signed-in buyers and administrators can still check a payment without the token.

For flows that still put the token in their return URL, the status check keeps accepting it there for now.
