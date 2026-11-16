/**
 * Shared event helpers for Fair Event plugins.
 *
 * @package FairEventsShared
 */

import { decodeEntities } from '@wordpress/html-entities';
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
export const isLinkOnlyEvent = ( eventDate ) =>
	eventDate?.link_type === 'external';

/**
 * Readable text for a value stored with HTML entities (#2300).
 *
 * WordPress stores titles HTML-encoded (`La&nbsp;Mutable`, `A &amp; B`),
 * and strings built from them, such as transaction descriptions, keep the
 * entities. Decode them exactly once, so text that is meant to show an
 * entity (`&amp;lt;` → `&lt;`) stays literal, and render the result as a
 * React text node or `textContent`, never as HTML. `&nbsp;` becomes a
 * non-breaking space. No trimming and no fallback: use
 * getEventDisplayTitle() for event names.
 *
 * @param {*} value Stored text; null and undefined become ''.
 * @return {string} The decoded text.
 */
export const decodeEntityText = ( value ) =>
	null === value || undefined === value
		? ''
		: decodeEntities( String( value ) );

/**
 * Display title for an event, falling back for legacy untitled rows.
 *
 * @param {string|null|undefined} title Raw event title.
 * @return {string} The decoded, trimmed title, or a "(untitled event)" fallback.
 */
export const getEventDisplayTitle = ( title ) => {
	const decoded = decodeEntityText( title ).trim();
	return decoded ? decoded : __( '(untitled event)', 'fair-events' );
};
