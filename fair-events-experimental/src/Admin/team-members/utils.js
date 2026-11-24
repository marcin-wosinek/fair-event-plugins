/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';

/**
 * Profile fields the editor changes, with their empty values.
 */
export const EMPTY_TEAM_MEMBER = {
	name: '',
	surname: '',
	instagram: '',
	email: '',
	facebook_url: '',
	phone: '',
	website_url: '',
	bio: '',
	portrait_attachment_id: 0,
	gender: '',
};

/**
 * Editor state for a profile: only the edited fields, an unset gender as ''
 * and no portrait as 0.
 *
 * @param {Object|null} profile Profile from the API, or null for a new one.
 * @return {Object} Form state.
 */
export function toFormState( profile ) {
	const state = {};
	Object.keys( EMPTY_TEAM_MEMBER ).forEach( ( key ) => {
		const value = profile ? profile[ key ] : undefined;
		state[ key ] =
			null === value || undefined === value
				? EMPTY_TEAM_MEMBER[ key ]
				: value;
	} );
	return state;
}

/**
 * Save payload for a form state: every field, an unset gender and a removed
 * portrait as null so clearing them is saved too.
 *
 * @param {Object} state Form state.
 * @return {Object} Request body.
 */
export function toSavePayload( state ) {
	return {
		...state,
		gender: state.gender ? state.gender : null,
		portrait_attachment_id: state.portrait_attachment_id
			? state.portrait_attachment_id
			: null,
	};
}

/**
 * Display name of a member: name and surname.
 *
 * @param {Object} member Member with `name` and `surname`.
 * @return {string} Name, or a fallback when both are blank.
 */
export function memberName( member ) {
	const full = [ member?.name, member?.surname ]
		.map( ( part ) => ( part || '' ).trim() )
		.filter( Boolean )
		.join( ' ' );
	return full || __( '(unnamed team member)', 'fair-events-experimental' );
}

/**
 * Per-field messages from a failed save, keyed by field.
 *
 * @param {Object} error apiFetch rejection.
 * @return {Object} Field messages; empty when the error is not per field.
 */
export function fieldErrors( error ) {
	const params = error?.data?.params;
	return params && 'object' === typeof params ? params : {};
}

/**
 * Manage Event URL of an event date, opened on Event Details.
 *
 * @param {string} baseUrl     Manage Event page URL.
 * @param {number} eventDateId Event date ID.
 * @return {string} URL.
 */
export function manageEventUrl( baseUrl, eventDateId ) {
	const url = new URL( baseUrl, window.location.href );
	url.searchParams.set( 'event_date_id', String( eventDateId ) );
	return url.toString();
}
