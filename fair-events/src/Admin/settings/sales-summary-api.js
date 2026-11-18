/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * REST path of one sales summary report.
 *
 * @param {string} report `central`, `default` or an organizer UUID.
 * @return {string} Path.
 */
function reportPath( report ) {
	return `/fair-events/v1/sales-summary/${ encodeURIComponent( report ) }`;
}

/**
 * Load a report's settings and status.
 *
 * @param {string} report Report key.
 * @return {Promise<Object>} Report payload.
 */
export function loadSalesSummary( report ) {
	return apiFetch( { path: reportPath( report ) } );
}

/**
 * Save a report's settings.
 *
 * @param {string} report   Report key.
 * @param {Object} settings frequency, time_of_day, day_of_week, fallback_email.
 * @return {Promise<Object>} Report payload after the save.
 */
export function saveSalesSummary( report, settings ) {
	return apiFetch( {
		path: reportPath( report ),
		method: 'PUT',
		data: settings,
	} );
}

/**
 * Preview a report as its next send would build it now.
 *
 * @param {string} report    Report key.
 * @param {string} frequency `daily` or `weekly`.
 * @return {Promise<Object>} subject, html, period, empty, recipients.
 */
export function previewSalesSummary( report, frequency ) {
	return apiFetch( {
		path: `${ reportPath( report ) }/preview`,
		method: 'POST',
		data: { frequency },
	} );
}

/**
 * Send a report to the current administrator, labelled as a test.
 *
 * @param {string} report    Report key.
 * @param {string} frequency `daily` or `weekly`.
 * @return {Promise<Object>} sent_to, empty.
 */
export function testSalesSummary( report, frequency ) {
	return apiFetch( {
		path: `${ reportPath( report ) }/test`,
		method: 'POST',
		data: { frequency },
	} );
}
