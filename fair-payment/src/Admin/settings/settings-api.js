/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * Load connection settings from WordPress REST API
 *
 * @return {Promise<Object>} Promise resolving to connection settings
 */
export function loadConnectionSettings() {
	console.log( '[Fair Payment] Loading connection settings...' );

	return apiFetch( { path: '/wp/v2/settings' } ).then( ( settings ) => {
		console.log( '[Fair Payment] Connection settings loaded' );
		return {
			connected: settings.fair_payment_mollie_connected || false,
			mode: settings.fair_payment_mode || 'test',
			organizationId: settings.fair_payment_organization_id || '',
			profileId: settings.fair_payment_mollie_profile_id || '',
			tokenExpires: settings.fair_payment_mollie_token_expires || null,
		};
	} );
}

/**
 * Load all advanced settings from WordPress REST API
 *
 * @return {Promise<Object>} Promise resolving to all Mollie-related settings
 */
export function loadAdvancedSettings() {
	console.log( '[Fair Payment] Loading advanced settings...' );

	return apiFetch( { path: '/wp/v2/settings' } ).then( ( settings ) => {
		console.log( '[Fair Payment] Advanced settings loaded' );
		return {
			fair_payment_mollie_access_token:
				settings.fair_payment_mollie_access_token || '',
			fair_payment_mollie_refresh_token:
				settings.fair_payment_mollie_refresh_token || '',
			fair_payment_mollie_token_expires:
				settings.fair_payment_mollie_token_expires || null,
			fair_payment_mollie_site_id:
				settings.fair_payment_mollie_site_id || '',
			fair_payment_mollie_connected:
				settings.fair_payment_mollie_connected || false,
			fair_payment_mollie_profile_id:
				settings.fair_payment_mollie_profile_id || '',
			fair_payment_test_api_key: settings.fair_payment_test_api_key || '',
			fair_payment_live_api_key: settings.fair_payment_live_api_key || '',
			fair_payment_mode: settings.fair_payment_mode || 'test',
			fair_payment_organization_id:
				settings.fair_payment_organization_id || '',
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
	console.log( '[Fair Payment] Saving settings:', Object.keys( data ) );

	return apiFetch( {
		path: '/wp/v2/settings',
		method: 'POST',
		data,
	} ).then( ( response ) => {
		console.log( '[Fair Payment] Settings saved successfully' );
		return response;
	} );
}

/**
 * Test Mollie connection and trigger token refresh if needed
 *
 * @return {Promise<Object>} Promise resolving to connection test result
 */
export function testConnection() {
	console.log( '[Fair Payment] Testing connection...' );

	return apiFetch( {
		path: '/fair-payment/v1/test-connection',
		method: 'POST',
	} ).then( ( response ) => {
		console.log( '[Fair Payment] Connection test successful:', response );
		return response;
	} );
}

/**
 * Format a setting value for display in Advanced tab
 *
 * @param {string} key   Setting key
 * @param {*}      value Setting value
 * @return {string|JSX.Element} Formatted value
 */
export function formatSettingValue( key, value ) {
	// Mask sensitive values
	const isSensitive = key.includes( 'token' ) || key.includes( 'api_key' );

	if ( isSensitive && value ) {
		return '•'.repeat( Math.min( value.length, 40 ) );
	}

	if ( value === null || value === '' ) {
		return '';
	}

	if ( typeof value === 'boolean' ) {
		return value ? 'true' : 'false';
	}

	if ( key === 'fair_payment_mollie_token_expires' && value ) {
		return `${ value } (${ new Date( value * 1000 ).toLocaleString() })`;
	}

	return value;
}
