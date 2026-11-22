/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * Load general settings from WordPress REST API
 *
 * @return {Promise<Object>} Promise resolving to general settings
 */
export function loadGeneralSettings() {
	return apiFetch( { path: '/wp/v2/settings' } ).then( ( settings ) => {
		return {
			slug: settings.fair_events_slug || 'fair-events',
			enabledPostTypes: settings.fair_events_enabled_post_types || [],
			registerPostType: settings.fair_events_register_post_type ?? true,
			poweredByBranding:
				settings.fair_events_powered_by_branding ?? false,
		};
	} );
}

/**
 * Load organizer settings from WordPress REST API, alongside the site's own
 * defaults (title, URL, logo) that the organizer identity falls back to when
 * left blank.
 *
 * @return {Promise<Object>} Promise resolving to the organizer identity, with a `defaults` key.
 */
export function loadOrganizerSettings() {
	return apiFetch( { path: '/wp/v2/settings' } ).then( ( settings ) => {
		return {
			name: '',
			type: 'Organization',
			street_address: '',
			address_locality: '',
			address_region: '',
			postal_code: '',
			address_country: '',
			same_as: [],
			logo_id: 0,
			website: '',
			contact_email: '',
			contact_phone: '',
			notification_emails: [],
			...settings.fair_events_organizer,
			defaults: {
				name: settings.title || '',
				website: settings.url || '',
				logoId: settings.site_logo || 0,
			},
		};
	} );
}

/**
 * Save settings to WordPress REST API
 *
 * @param {Object} data Settings data to save
 * @return {Promise<Object>} Promise resolving to saved settings
 */
export function saveSettings( data ) {
	return apiFetch( {
		path: '/wp/v2/settings',
		method: 'POST',
		data,
	} );
}

/**
 * Resolve an attachment's URL from its ID, for logo preview.
 *
 * @param {number} attachmentId Attachment ID (0 = none).
 * @return {Promise<string>} Promise resolving to the attachment's URL, or an empty string.
 */
export function loadAttachmentUrl( attachmentId ) {
	if ( ! attachmentId ) {
		return Promise.resolve( '' );
	}

	return apiFetch( { path: `/wp/v2/media/${ attachmentId }` } )
		.then( ( media ) => media.source_url || '' )
		.catch( () => '' );
}

/**
 * Load the stored Ticketing value from the `fair_events_features` option.
 *
 * @return {Promise<boolean|null>} Stored value, or null when none is saved.
 */
export function loadStoredTicketing() {
	return apiFetch( { path: '/wp/v2/settings' } ).then( ( settings ) => {
		const stored = settings.fair_events_features?.ticketing;
		return typeof stored === 'boolean' ? stored : null;
	} );
}

/**
 * Save only the Ticketing key of the `fair_events_features` option. The
 * server-side sanitizer keeps every key left out of the payload.
 *
 * @param {boolean} enabled Whether ticketing is enabled.
 * @return {Promise<boolean|null>} Value stored after the save, or null when the response omits it.
 */
export function saveTicketing( enabled ) {
	return apiFetch( {
		path: '/wp/v2/settings',
		method: 'POST',
		data: { fair_events_features: { ticketing: enabled } },
	} ).then( ( settings ) => {
		const stored = settings?.fair_events_features?.ticketing;
		return typeof stored === 'boolean' ? stored : null;
	} );
}
