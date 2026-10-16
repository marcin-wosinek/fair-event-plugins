/**
 * Consent-gated Meta engagement capture for event-page buttons: activating
 * the calendar button, and activating a link designated as a ticket button
 * with the `fair-events-ticket-button` class (on the link or its wrapper).
 *
 * One delegated capture-phase listener records each activation once — the
 * browser fires a single `click` for mouse, touch and keyboard (Enter)
 * activation alike. Capture never waits, never prevents the action and never
 * throws into the page.
 */

import apiFetch from '@wordpress/api-fetch';
import { identifiers } from './attribution.js';

export const TICKET_BUTTON_CLASS = 'fair-events-ticket-button';

const state = {
	context: null,
	listening: false,
};

/**
 * Which tracked action a click target activates.
 *
 * @param {EventTarget|null} target Click target, possibly a nested element.
 * @return {string|null} 'calendar', 'ticket', or null for anything else.
 */
export function actionFor( target ) {
	if ( ! target || typeof target.closest !== 'function' ) {
		return null;
	}
	if ( target.closest( 'a[data-calendar-button="true"]' ) ) {
		return 'calendar';
	}
	const designated = target.closest( `.${ TICKET_BUTTON_CLASS }` );
	if ( ! designated ) {
		return null;
	}
	// A designated wrapper counts only clicks on the link or button inside it.
	const control = target.closest( 'a[href], button' );
	return control && designated.contains( control ) ? 'ticket' : null;
}

function activationId() {
	if ( typeof window.crypto?.randomUUID === 'function' ) {
		return window.crypto.randomUUID();
	}
	const bytes = window.crypto.getRandomValues( new Uint8Array( 16 ) );
	bytes[ 6 ] = ( bytes[ 6 ] & 0x0f ) | 0x40;
	bytes[ 8 ] = ( bytes[ 8 ] & 0x3f ) | 0x80;
	const hex = Array.from( bytes, ( byte ) =>
		byte.toString( 16 ).padStart( 2, '0' )
	).join( '' );
	return [
		hex.slice( 0, 8 ),
		hex.slice( 8, 12 ),
		hex.slice( 12, 16 ),
		hex.slice( 16, 20 ),
		hex.slice( 20 ),
	].join( '-' );
}

/**
 * Send one engagement event when marketing consent and a valid Meta
 * identifier exist at activation time.
 *
 * @param {string} action  'calendar' or 'ticket'.
 * @param {Object} context `{ postId, eventDateId }`.
 * @return {Promise|null} The settled-safe request, or null when not sent.
 */
export function capture( action, context ) {
	try {
		const values = identifiers();
		if ( ! values.marketing_consent ) {
			return null;
		}
		return apiFetch( {
			path: '/fair-events-experimental/v1/meta-engagement',
			method: 'POST',
			// Lets the request outlive a navigation the click starts.
			keepalive: true,
			data: {
				action,
				activation_id: activationId(),
				post_id: context.postId,
				event_date_id: context.eventDateId,
				...values,
			},
		} ).catch( () => null );
	} catch {
		return null;
	}
}

function onClick( event ) {
	try {
		const action = actionFor( event.target );
		if ( action ) {
			capture( action, state.context );
		}
	} catch {
		// Tracking must never interfere with the button's own behaviour.
	}
}

/**
 * Start listening once per page.
 *
 * @param {Object} context `{ postId, eventDateId }` bootstrapped by PHP.
 * @return {boolean} Whether a listener is active.
 */
export function initialize( context = window.fairEventsMetaEngagement ) {
	if ( state.listening ) {
		return true;
	}
	const postId = Number( context?.postId );
	const eventDateId = Number( context?.eventDateId );
	if (
		! Number.isInteger( postId ) ||
		postId <= 0 ||
		! Number.isInteger( eventDateId ) ||
		eventDateId <= 0
	) {
		return false;
	}
	state.context = { postId, eventDateId };
	document.addEventListener( 'click', onClick, true );
	state.listening = true;
	return true;
}

/** Stop listening; used by tests. */
export function stop() {
	document.removeEventListener( 'click', onClick, true );
	state.context = null;
	state.listening = false;
}

function start() {
	initialize();
}
if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', start );
} else {
	start();
}
