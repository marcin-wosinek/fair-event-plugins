/**
 * Addresses of the Custom Mail page's two views.
 *
 * The page lives at `admin.php?page=fair-audience-custom-mail`; a recorded
 * message is shown at the same address with `&message_id=<id>`, so it can be
 * linked to, opened in another tab, and reached with Back and Forward.
 */

const PARAM = 'message_id';

/**
 * The message the current address points at.
 *
 * @param {Location} [location] Location to read; the window's by default.
 * @return {number|null} Positive message ID, or null for the composer.
 */
export function getMessageId( location = window.location ) {
	const value = new URLSearchParams( location.search ).get( PARAM );
	if ( value === null || ! /^\d+$/.test( value ) ) {
		return null;
	}
	const id = parseInt( value, 10 );
	return id > 0 ? id : null;
}

/**
 * Address of a recorded message, or of the composer and history.
 *
 * @param {number|null} id         Message ID, or null for Mail History.
 * @param {Location}    [location] Location to start from.
 * @return {string} Absolute URL.
 */
export function viewUrl( id, location = window.location ) {
	const url = new URL( location.href );
	if ( id ) {
		url.searchParams.set( PARAM, String( id ) );
	} else {
		url.searchParams.delete( PARAM );
	}
	return url.toString();
}

/**
 * Whether a click should be left to the browser (new tab, new window, …).
 *
 * @param {MouseEvent} event Click event.
 * @return {boolean} True for modified or non-primary clicks.
 */
export function isModifiedClick( event ) {
	return (
		event.defaultPrevented ||
		event.button !== 0 ||
		event.metaKey ||
		event.ctrlKey ||
		event.shiftKey ||
		event.altKey
	);
}
