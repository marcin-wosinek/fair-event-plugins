/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';

/**
 * Start a server-owned External Updates run before any work begins.
 *
 * @param {string} action   Run action key.
 * @param {string} sourceId Stable source ID (mode or connected site ID).
 * @return {Promise<{run: Object, ids?: number[]}>} The started run.
 */
export const startRun = ( action, sourceId ) =>
	apiFetch( {
		path: '/fair-payments-connector/v1/external-updates/runs',
		method: 'POST',
		data: { action, source_id: String( sourceId ) },
	} );

/**
 * Close a multi-request run; the server derives its outcome.
 *
 * @param {number} runId Run ID.
 * @return {Promise<{run: Object}>} The finished run.
 */
export const finishRun = ( runId ) =>
	apiFetch( {
		path: `/fair-payments-connector/v1/external-updates/runs/${ runId }/finish`,
		method: 'POST',
	} );

/**
 * Load one page of the operation log, newest first.
 *
 * @param {number} page Page number.
 * @return {Promise<Object>} `{ items, total, pages, page }`.
 */
export const loadRuns = ( page ) =>
	apiFetch( {
		path: `/fair-payments-connector/v1/external-updates/runs?page=${ page }&per_page=20`,
	} );

/**
 * Message from an apiFetch rejection.
 *
 * @param {Object} error    Rejection value.
 * @param {string} fallback Message when the error carries none.
 * @return {string} Message.
 */
export const errorMessage = ( error, fallback ) =>
	error?.message || error?.data?.message || fallback;
