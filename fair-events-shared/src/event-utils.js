/**
 * Shared event helpers for Fair Event plugins.
 *
 * @package FairEventsShared
 */

/**
 * Whether an event date is a link-only (external URL) event.
 *
 * Link-only events have no registration/entry behind them, so
 * registration-dependent UI (tickets, audience, statistics, finance, etc.)
 * should be disabled for them.
 *
 * @param {Object|undefined} eventDate The event date object (or ctx.eventDate).
 * @return {boolean} True when the event's link type is `external`.
 */
export const isLinkOnlyEvent = (eventDate) =>
	eventDate?.link_type === 'external';
