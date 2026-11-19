/**
 * Leave the page for another URL. A separate module, so tests can replace it.
 *
 * @param {string} url Destination.
 */
export function navigate( url ) {
	window.location.assign( url );
}
