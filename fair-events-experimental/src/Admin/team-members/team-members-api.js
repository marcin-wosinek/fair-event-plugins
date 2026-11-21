/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * List every team member profile, by name.
 *
 * @return {Promise<Object[]>} Profiles.
 */
export function loadTeamMembers() {
	return apiFetch( { path: '/fair-events/v1/team-members' } );
}

/**
 * Read one profile with the events it is linked to.
 *
 * @param {number} id Profile ID.
 * @return {Promise<Object>} Profile with `events`.
 */
export function loadTeamMember( id ) {
	return apiFetch( { path: `/fair-events/v1/team-members/${ id }` } );
}

/**
 * Create a profile.
 *
 * @param {Object} data Profile fields.
 * @return {Promise<Object>} The created profile.
 */
export function createTeamMember( data ) {
	return apiFetch( {
		path: '/fair-events/v1/team-members',
		method: 'POST',
		data,
	} );
}

/**
 * Update a profile's fields.
 *
 * @param {number} id   Profile ID.
 * @param {Object} data Profile fields.
 * @return {Promise<Object>} The updated profile.
 */
export function updateTeamMember( id, data ) {
	return apiFetch( {
		path: `/fair-events/v1/team-members/${ id }`,
		method: 'PUT',
		data,
	} );
}

/**
 * Delete a profile that no event links to.
 *
 * @param {number} id Profile ID.
 * @return {Promise<Object>} `{ deleted, id }`.
 */
export function deleteTeamMember( id ) {
	return apiFetch( {
		path: `/fair-events/v1/team-members/${ id }`,
		method: 'DELETE',
	} );
}
