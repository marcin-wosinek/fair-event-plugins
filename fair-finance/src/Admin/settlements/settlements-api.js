/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * Saved settlements live in Fair Payments Connector; these are its routes.
 */

/**
 * Load a page of saved settlements.
 *
 * @param {number} page      1-based page number.
 * @param {number} accountId Account to limit the list to, or 0 for all.
 * @return {Promise<Object>} `{ items, total, pages, page }`.
 */
export const fetchSettlements = ( page, accountId ) =>
	apiFetch( {
		path: accountId
			? `/fair-payments-connector/v1/settlements?per_page=20&page=${ page }&account_id=${ accountId }`
			: `/fair-payments-connector/v1/settlements?per_page=20&page=${ page }`,
	} );

/**
 * Load one saved settlement with its movements.
 *
 * @param {number} id Settlement ID.
 * @return {Promise<Object>} Settlement.
 */
export const fetchSettlement = ( id ) =>
	apiFetch( { path: `/fair-payments-connector/v1/settlements/${ id }` } );

/**
 * Load the accounts and what the Mollie connection allows.
 *
 * @return {Promise<Object>} `{ accounts, connection }`.
 */
export const fetchAccounts = () =>
	apiFetch( { path: '/fair-payments-connector/v1/settlements/accounts' } );

/**
 * Confirm that a local account is the connected Mollie organization.
 *
 * @param {number} accountId      Account ID.
 * @param {string} organizationId Connected Mollie organization ID.
 * @return {Promise<Object>} `{ account }`.
 */
export const confirmAccount = ( accountId, organizationId ) =>
	apiFetch( {
		path: `/fair-payments-connector/v1/settlements/accounts/${ accountId }/confirm`,
		method: 'POST',
		data: { organization_id: organizationId },
	} );

/**
 * Build the upload body for a settlement CSV.
 *
 * @param {File}   file    Chosen file.
 * @param {Object} account `{ accountId, accountLabel, confirmAccount }`.
 * @return {FormData} Request body.
 */
const csvBody = (
	file,
	{ accountId, accountLabel, confirmAccount: confirm }
) => {
	const body = new window.FormData();
	body.append( 'file', file );
	if ( accountId ) {
		body.append( 'account_id', String( accountId ) );
		if ( confirm ) {
			body.append( 'confirm_account', 'true' );
		}
	} else if ( accountLabel ) {
		body.append( 'account_label', accountLabel );
	}
	return body;
};

/**
 * Check a settlement CSV without saving it.
 *
 * @param {File}   file    Chosen file.
 * @param {Object} account Account the file belongs to.
 * @return {Promise<Object>} Preview.
 */
export const validateCsv = ( file, account ) =>
	apiFetch( {
		path: '/fair-payments-connector/v1/settlements/csv/validate',
		method: 'POST',
		body: csvBody( file, account ),
	} );

/**
 * Import a settlement CSV.
 *
 * @param {File}   file    Chosen file.
 * @param {Object} account Account the file belongs to.
 * @return {Promise<Object>} Result.
 */
export const importCsv = ( file, account ) =>
	apiFetch( {
		path: '/fair-payments-connector/v1/settlements/csv/import',
		method: 'POST',
		body: csvBody( file, account ),
	} );

/**
 * Whether an error means Fair Payments Connector does not offer saved
 * settlements: it is inactive, or older than this feature.
 *
 * @param {Object} error apiFetch error.
 * @return {boolean} True when the route does not exist.
 */
export const isConnectorMissing = ( error ) => error?.code === 'rest_no_route';
