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
 * Store an access token, entered by hand or returned by the OAuth proxy.
 *
 * @param {Object}      data             Token and account.
 * @param {string}      data.accessToken Access token.
 * @param {string}      data.userId      Instagram user ID, '' when unknown.
 * @param {string}      data.username    Instagram username, '' when unknown.
 * @param {number|null} data.expiresIn   Seconds until expiry, null when unknown.
 * @return {Promise<Object>} Connection details.
 */
export function connect( {
	accessToken,
	userId = '',
	username = '',
	expiresIn = null,
} ) {
	return apiFetch( {
		path: PATH,
		method: 'POST',
		data: {
			access_token: accessToken,
			user_id: userId,
			username,
			expires_in: expiresIn,
		},
	} );
}

/**
 * Set the Instagram user ID.
 *
 * @param {string} userId Numeric user ID, or '' to clear it.
 * @return {Promise<Object>} Connection details.
 */
export function saveUserId( userId ) {
	return apiFetch( {
		path: `${ PATH }/user-id`,
		method: 'POST',
		data: { user_id: userId },
	} );
}

/**
 * Check the connection with Instagram.
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
