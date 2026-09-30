/**
 * WordPress dependencies
 */
import { useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

/**
 * Internal dependencies
 */
import { startRun, finishRun, errorMessage } from './runs-api.js';

export const MOLLIE_FEES_ACTION = 'load_missing_mollie_fees';

export const FEE_SYNC_BATCH_SIZE = 10;

/**
 * Split an array into consecutive chunks of at most `size` items.
 *
 * @param {Array}  items Items.
 * @param {number} size  Chunk size.
 * @return {Array[]} Chunks.
 */
const chunk = ( items, size ) => {
	const chunks = [];
	for ( let i = 0; i < items.length; i += size ) {
		chunks.push( items.slice( i, i + size ) );
	}
	return chunks;
};

/**
 * Load Mollie fee data for paid transactions that lack it, in batches.
 *
 * Shared by External Updates and Transactions so both start the same
 * server-owned, logged run. The run's counts and outcome are recorded by the
 * server; `progress` is only for display while the batches run.
 *
 * @param {Object}   callbacks
 * @param {Function} callbacks.onBegin Claims the busy state; returns false when busy.
 * @param {Function} callbacks.onEnd   Releases the busy state once the run ends.
 * @return {Object} `{ load( mode ), progress, result, clearResult }`.
 */
const useMollieFeeLoad = ( { onBegin, onEnd } ) => {
	const [ progress, setProgress ] = useState( null );
	const [ result, setResult ] = useState( null );

	/**
	 * @param {string} mode 'live', 'test', or '' for all modes.
	 */
	const load = async ( mode ) => {
		if ( ! onBegin( MOLLIE_FEES_ACTION ) ) {
			return;
		}
		setResult( null );

		try {
			const { run, ids = [] } = await startRun(
				MOLLIE_FEES_ACTION,
				mode || 'all'
			);

			if ( ids.length === 0 ) {
				setResult( {
					run: null,
					info: __(
						'No paid transactions are missing Mollie fee data.',
						'fair-payments-connector'
					),
				} );
				return;
			}

			let processed = 0;
			let updated = 0;
			let failed = 0;
			setProgress( { processed, total: ids.length, updated, failed } );

			for ( const batch of chunk( ids, FEE_SYNC_BATCH_SIZE ) ) {
				try {
					const response = await apiFetch( {
						path: '/fair-payments-connector/v1/transactions/sync-mollie-batch',
						method: 'POST',
						data: { ids: batch, run_id: run.id },
					} );
					updated += response?.updated ?? 0;
					failed += response?.failed ?? 0;
				} catch ( err ) {
					// The server never saw this batch; it counts it as failed
					// when the run is finished. Keep going with the rest.
					failed += batch.length;
				}
				processed += batch.length;
				setProgress( {
					processed,
					total: ids.length,
					updated,
					failed,
				} );
			}

			const { run: finished } = await finishRun( run.id );
			setResult( { run: finished } );
		} catch ( err ) {
			setResult( {
				run: err?.data?.run || null,
				error: errorMessage(
					err,
					__(
						'Loading missing Mollie fees did not complete. Check the operation log for its outcome.',
						'fair-payments-connector'
					)
				),
			} );
		} finally {
			setProgress( null );
			onEnd();
		}
	};

	return { load, progress, result, clearResult: () => setResult( null ) };
};

export default useMollieFeeLoad;
