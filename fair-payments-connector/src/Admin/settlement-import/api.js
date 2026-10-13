/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * Load the import that is running or can be continued.
 *
 * @return {Promise<Object>} `{ run }`, with `run` null when there is none.
 */
export const fetchOpenImport = () =>
	apiFetch( { path: '/fair-payments-connector/v1/settlements/imports' } );

/**
 * Load one import as the server has it now.
 *
 * @param {number} runId Import run ID.
 * @return {Promise<Object>} `{ run }`.
 */
export const fetchImport = ( runId ) =>
	apiFetch( {
		path: `/fair-payments-connector/v1/settlements/imports/${ runId }`,
	} );

/**
 * Start loading from Mollie.
 *
 * @param {string} kind         `new`, `history` or `refresh`.
 * @param {number} settlementId Settlement to refresh.
 * @return {Promise<Object>} `{ run }`.
 */
export const startImport = ( kind, settlementId = 0 ) =>
	apiFetch( {
		path: '/fair-payments-connector/v1/settlements/imports',
		method: 'POST',
		data: { kind, settlement_id: settlementId },
	} );

/**
 * Make the next Mollie request of an import.
 *
 * @param {number} runId Import run ID.
 * @return {Promise<Object>} `{ run }`.
 */
export const stepImport = ( runId ) =>
	apiFetch( {
		path: `/fair-payments-connector/v1/settlements/imports/${ runId }/step`,
		method: 'POST',
	} );
