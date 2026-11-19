/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

const PATH = '/fair-events-experimental/v1/instagram/connection';

/**
 * Connection details. The access token is never part of a response.
 *
 * @return {Promise<Object>} Connection details.
 */
export function loadConnection() {
	return apiFetch( { path: PATH } );
}

/**
 * Start connecting: where to send the administrator to authorize.
 *
 * @return {Promise<{authorize_url: string}>} Authorize URL.
 */
export function startAuthorization() {
	return apiFetch( { path: `${ PATH }/authorize`, method: 'POST' } );
}

/**
 * Complete connecting from the OAuth service's return parameters. The
 * server redeems the handoff code; no credential reaches the browser.
 *
 * @param {Object} data         Return parameters.
 * @param {string} data.state   Returned state.
 * @param {string} data.handoff Handoff code, '' on failure.
 * @param {string} data.error   Failure code, '' on success.
 * @return {Promise<Object>} Connection details.
 */
export function completeAuthorization( { state, handoff = '', error = '' } ) {
	return apiFetch( {
		path: `${ PATH }/complete`,
		method: 'POST',
		data: { state, handoff, error },
	} );
}

/**
 * Check the connection with Meta.
 *
 * @return {Promise<Object>} Result with connection details.
 */
export function testConnection() {
	return apiFetch( { path: `${ PATH }/test`, method: 'POST' } );
}

/**
 * Remove the token and connection details.
 *
 * @return {Promise<Object>} Connection details.
 */
export function disconnect() {
	return apiFetch( { path: PATH, method: 'DELETE' } );
}
