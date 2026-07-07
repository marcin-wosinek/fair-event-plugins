/**
 * Shared event helpers for Fair Event plugins.
 *
 * @package FairEventsShared
 */

import { __ } from '@wordpress/i18n';

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

/**
 * Display title for an event, falling back for legacy untitled rows.
 *
 * @param {string|null|undefined} title Raw event title.
 * @return {string} The trimmed title, or a "(untitled event)" fallback.
 */
export const getEventDisplayTitle = (title) =>
	title && title.trim()
		? title.trim()
		: __('(untitled event)', 'fair-events');
