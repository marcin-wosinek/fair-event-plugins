/**
 * WordPress dependencies
 */
import { useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Notice,
	SelectControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import RunResultNotice from './RunResultNotice.js';
import { startRun, finishRun, errorMessage } from '../runs-api.js';

const ACTION = 'load_missing_mollie_fees';

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
 * The run's counts and outcome are recorded by the server; the progress shown
 * here is only for display while the batches run.
 *
 * @param {Object}   props
 * @param {string}   props.activeAction Key of the action running on the page, or null.
 * @param {Function} props.onBegin      Claims the page-wide busy state; returns false when busy.
 * @param {Function} props.onEnd        Releases the busy state and refreshes the log.
 * @return {JSX.Element} Panel.
 */
const MollieFeesPanel = ( { activeAction, onBegin, onEnd } ) => {
	const [ mode, setMode ] = useState( 'live' );
	const [ progress, setProgress ] = useState( null );
	const [ result, setResult ] = useState( null );

	const running = activeAction === ACTION;

	const handleLoad = async () => {
		if ( ! onBegin( ACTION ) ) {
			return;
		}
		setResult( null );

		try {
			const { run, ids = [] } = await startRun( ACTION, mode || 'all' );

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

	return (
		<Card>
			<CardHeader>
				<h2 className="fair-external-updates__title">
					{ __( 'Mollie fees', 'fair-payments-connector' ) }
				</h2>
			</CardHeader>
			<CardBody>
				<VStack spacing={ 3 }>
					<p className="fair-external-updates__intro">
						{ __(
							'Fetch the Mollie processing fee for paid transactions that do not have one yet.',
							'fair-payments-connector'
						) }
					</p>
					<RunResultNotice
						run={ result?.run }
						error={ result?.error }
						onClose={ () => setResult( null ) }
					/>
					{ result?.info && (
						<Notice
							status="info"
							onRemove={ () => setResult( null ) }
						>
							{ result.info }
						</Notice>
					) }
					{ progress && (
						<Notice status="info" isDismissible={ false }>
							{ sprintf(
								/* translators: 1: processed count, 2: total count, 3: updated count, 4: failed count */
								__(
									'Loading Mollie fees: %1$d of %2$d (updated: %3$d, failed: %4$d)',
									'fair-payments-connector'
								),
								progress.processed,
								progress.total,
								progress.updated,
								progress.failed
							) }
						</Notice>
					) }
					<div className="fair-external-updates__fields">
						<SelectControl
							label={ __(
								'Transactions',
								'fair-payments-connector'
							) }
							value={ mode }
							options={ [
								{
									label: __(
										'Live mode',
										'fair-payments-connector'
									),
									value: 'live',
								},
								{
									label: __(
										'Test mode',
										'fair-payments-connector'
									),
									value: 'test',
								},
								{
									label: __(
										'All modes',
										'fair-payments-connector'
									),
									value: '',
								},
							] }
							onChange={ setMode }
							disabled={ running }
							__nextHasNoMarginBottom
						/>
					</div>
					<HStack justify="flex-start">
						<Button
							variant="primary"
							onClick={ handleLoad }
							isBusy={ running }
							disabled={ activeAction !== null }
						>
							{ running
								? __(
										'Loading fees…',
										'fair-payments-connector'
								  )
								: __(
										'Load missing Mollie fees',
										'fair-payments-connector'
								  ) }
						</Button>
					</HStack>
				</VStack>
			</CardBody>
		</Card>
	);
};

export default MollieFeesPanel;
