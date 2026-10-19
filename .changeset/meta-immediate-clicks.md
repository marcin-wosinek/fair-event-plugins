---
'fair-events-experimental': minor
---

Meta calendar and ticket button clicks are now sent to Meta immediately, while WordPress handles the browser's tracking request, instead of waiting for WP-Cron. Each click gets one attempt with a three-second limit and no retry, so a slow or failing Meta answer loses that measurement; buttons never wait for it. Fair Events → Settings → Experimental shows each click's outcome (received, not confirmed, rejected, Meta error or unreachable) with Meta's HTTP status, received count, messages and trace ID, which now also appear for queued checkout and purchase deliveries. Checkout and purchase events keep the queue and its retries, and clicks already queued before upgrading are still delivered once.
