/**
 * Payment history page: the migration of historical registrations and
 * payments into Fair Events, its verification, the reconciliation of what
 * it couldn't link, the switch of payment records to Fair Events, and the
 * switch of statistics to Fair Events records
 * (PAYMENT_HISTORY_MIGRATION.md §6.3, §8.9, §8.10, §8.13, §8.14).
 *
 * @package FairEvents
 */

import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Notice,
	Spinner,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import MigrationPanel from './MigrationPanel.js';
import CutoverPanel from './CutoverPanel.js';
import ReadersPanel from './ReadersPanel.js';
import VerificationPanel from './VerificationPanel.js';
import FindingsPanel from './FindingsPanel.js';

const POLL_MS = 5000;

/**
 * Whether a run is in progress, so the page keeps polling.
 *
 * @param {Object|null} status Status.
 * @return {boolean} Running.
 */
export function isRunning( status ) {
	return (
		status?.dry_run?.status === 'running' ||
		status?.backfill?.status === 'running'
	);
}

export default function PaymentHistoryPage() {
	const [ status, setStatus ] = useState( null );
	const [ error, setError ] = useState( null );
	const [ refreshKey, setRefreshKey ] = useState( 0 );
	const wasRunning = useRef( false );

	const loadStatus = useCallback(
		() =>
			apiFetch( { path: '/fair-events/v1/payment-history' } )
				.then( ( data ) => {
					setStatus( data );
					setError( null );
					// Reload the lists when a run finishes.
					if ( wasRunning.current && ! isRunning( data ) ) {
						setRefreshKey( ( key ) => key + 1 );
					}
					wasRunning.current = isRunning( data );
				} )
				.catch( ( e ) =>
					setError(
						e?.message ||
							__(
								'The payment history couldn’t be loaded.',
								'fair-events'
							)
					)
				),
		[]
	);

	useEffect( () => {
		loadStatus();
	}, [ loadStatus ] );

	useEffect( () => {
		if ( ! isRunning( status ) ) {
			return undefined;
		}
		const timer = setTimeout( loadStatus, POLL_MS );
		return () => clearTimeout( timer );
	}, [ status, loadStatus ] );

	const runAction = async ( path, data ) => {
		await apiFetch( {
			path: `/fair-events/v1/payment-history${ path }`,
			method: 'POST',
			data,
		} );
		await loadStatus();
		setRefreshKey( ( key ) => key + 1 );
	};

	const changed = () => {
		loadStatus();
		setRefreshKey( ( key ) => key + 1 );
	};

	return (
		<div className="wrap fair-events-payment-history">
			<h1>{ __( 'Payment history', 'fair-events' ) }</h1>
			<p className="fair-events-payment-history__intro">
				{ __(
					'Moves past registrations and payments recorded by Fair Audience into Fair Events, so every purchase keeps its own payment history. Old records are kept; nothing is charged, refunded or emailed.',
					'fair-events'
				) }
			</p>
			{ error && (
				<Notice status="error" isDismissible={ false }>
					<p>{ error }</p>
					<Button variant="secondary" onClick={ loadStatus }>
						{ __( 'Try again', 'fair-events' ) }
					</Button>
				</Notice>
			) }
			{ ! status && ! error && <Spinner /> }
			{ status && (
				<VStack spacing={ 6 }>
					<MigrationPanel status={ status } onAction={ runAction } />
					{ status.cutover &&
						( status.backfill || status.cutover.activation ) && (
							<CutoverPanel
								cutover={ status.cutover }
								onAction={ runAction }
							/>
						) }
					{ status.readers &&
						( status.cutover?.activation ||
							status.readers.activation ) && (
							<ReadersPanel
								readers={ status.readers }
								onAction={ runAction }
							/>
						) }
					{ status.backfill && (
						<VerificationPanel
							summary={ status.comparisons }
							refreshKey={ refreshKey }
						/>
					) }
					{ ( status.dry_run || status.backfill ) && (
						<FindingsPanel
							status={ status }
							refreshKey={ refreshKey }
							onChanged={ changed }
						/>
					) }
				</VStack>
			) }
		</div>
	);
}
