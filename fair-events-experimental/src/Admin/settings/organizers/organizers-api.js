/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * Reserved ID of the sitewide default organizer.
 */
export const DEFAULT_ORGANIZER_ID = 'default';

/**
 * List every organizer, the sitewide default first.
 *
 * @return {Promise<Object[]>} Organizer records.
 */
export function loadOrganizers() {
	return apiFetch( { path: '/fair-events/v1/organizers' } );
}

/**
 * Load the site values the default organizer falls back to when its fields
 * are blank (title, URL, logo).
 *
 * @return {Promise<Object>} `{ name, website, logoId }`.
 */
export function loadSiteDefaults() {
	return apiFetch( { path: '/wp/v2/settings' } ).then( ( settings ) => ( {
		name: settings.title || '',
		website: settings.url || '',
		logoId: settings.site_logo || 0,
	} ) );
}

/**
 * Create an additional organizer.
 *
 * @param {Object} data Complete organizer fields.
 * @return {Promise<Object>} The created, normalized record.
 */
export function createOrganizer( data ) {
	return apiFetch( {
		path: '/fair-events/v1/organizers',
		method: 'POST',
		data,
	} );
}

/**
 * Replace an organizer's fields.
 *
 * @param {string} id   Organizer ID.
 * @param {Object} data Complete organizer fields.
 * @return {Promise<Object>} The updated, normalized record.
 */
export function updateOrganizer( id, data ) {
	return apiFetch( {
		path: `/fair-events/v1/organizers/${ encodeURIComponent( id ) }`,
		method: 'PUT',
		data,
	} );
}
