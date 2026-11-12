/**
 * Payment history page: the payment records that need an administrator's
 * decision, their reconciliation and its audit trail, and whether the site
 * is ready for the releases after the migration
 * (PAYMENT_HISTORY_MIGRATION.md §6.3, §8.10, §8.17). The one-time
 * migration's controls are retired (#2252).
 *
 * @package FairEvents
 */

import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useState } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Notice,
	Spinner,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import FindingsPanel from './FindingsPanel.js';
import UpgradePanel from './UpgradePanel.js';

export default function PaymentHistoryPage() {
	const [ status, setStatus ] = useState( null );
	const [ error, setError ] = useState( null );
	const [ refreshKey, setRefreshKey ] = useState( 0 );

	const loadStatus = useCallback(
		() =>
			apiFetch( { path: '/fair-events/v1/payment-history' } )
				.then( ( data ) => {
					setStatus( data );
					setError( null );
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

	const changed = () => {
		loadStatus();
		setRefreshKey( ( key ) => key + 1 );
	};

	return (
		<div className="wrap fair-events-payment-history">
			<h1>{ __( 'Payment history', 'fair-events' ) }</h1>
			<p className="fair-events-payment-history__intro">
				{ __(
					'Payment records that need a decision: link a payment to its purchase, split a shared one, or mark it as reviewed. Nothing is charged, refunded or emailed.',
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
					<UpgradePanel refreshKey={ refreshKey } />
					<FindingsPanel
						status={ status }
						refreshKey={ refreshKey }
						onChanged={ changed }
					/>
				</VStack>
			) }
		</div>
	);
}
