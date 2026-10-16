/**
 * Placeholder of the removed participant photo upload page.
 */
const RETIRED_PHOTO_UPLOAD = '{photo_upload_url}';

/**
 * Remove the retired photo upload link, as the server does when sending.
 *
 * A link pointing at the placeholder is dropped together with its text, and a
 * bare placeholder is removed. Mirrors `RetiredPlaceholders::strip()`.
 *
 * @param {string} html Email body HTML.
 * @return {string} HTML without the retired placeholder.
 */
export function stripRetiredPlaceholders( html ) {
	if ( ! html || ! html.includes( RETIRED_PHOTO_UPLOAD ) ) {
		return html;
	}
	return html
		.replace( /<a\b[^>]*\{photo_upload_url\}[^>]*>[\s\S]*?<\/a>/gi, '' )
		.split( RETIRED_PHOTO_UPLOAD )
		.join( '' );
}

/**
 * Whether an HTML body has anything a recipient would see.
 *
 * The editor leaves markup such as `<p>&nbsp;</p>` behind when it is emptied,
 * so an empty check on the string alone is not enough.
 *
 * @param {string} html Email body HTML.
 * @return {boolean} True when the body shows text or an image.
 */
export function hasVisibleContent( html ) {
	if ( ! html ) {
		return false;
	}
	if ( /<img/i.test( html ) ) {
		return true;
	}
	const container = document.createElement( 'div' );
	container.innerHTML = html;
	return container.textContent.replace( /\u00a0/g, ' ' ).trim() !== '';
}

/**
 * Whether sending an email definitely did not happen.
 *
 * A 4xx answer means the server refused the request before sending anything.
 * Anything else (timeout, dropped connection, server error) leaves it unknown
 * how many emails went out.
 *
 * @param {Object} error Error thrown by apiFetch.
 * @return {boolean} True when nothing was sent.
 */
export function isRejectedBeforeSending( error ) {
	const status = error?.data?.status;
	return status >= 400 && status < 500;
}
