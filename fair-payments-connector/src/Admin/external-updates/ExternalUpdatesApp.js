/**
 * WordPress dependencies
 */
import { useState, useRef, useCallback } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { __experimentalVStack as VStack } from '@wordpress/components';

/**
 * Internal dependencies
 */
import ConnectedSitesPanel from './components/ConnectedSitesPanel.js';
import MollieImportPanel from './components/MollieImportPanel.js';
import MollieFeesPanel from './components/MollieFeesPanel.js';
import OperationLog from './components/OperationLog.js';

/**
 * External Updates admin page: manual fetches from connected sites and
 * Mollie, with a persistent log of every run.
 *
 * Only one action runs at a time, matching the server's overlap guard.
 *
 * @return {JSX.Element} Page.
 */
const ExternalUpdatesApp = () => {
	const settings = window.fairPaymentsExternalUpdates || {};
	const [ activeAction, setActiveAction ] = useState( null );
	const [ refreshKey, setRefreshKey ] = useState( 0 );
	// A ref closes the gap before re-render, so a double click can't start
	// the same action twice.
	const busyRef = useRef( false );

	const onBegin = useCallback( ( key ) => {
		if ( busyRef.current ) {
			return false;
		}
		busyRef.current = true;
		setActiveAction( key );
		return true;
	}, [] );

	const onEnd = useCallback( () => {
		busyRef.current = false;
		setActiveAction( null );
		setRefreshKey( ( key ) => key + 1 );
	}, [] );

	const panelProps = { activeAction, onBegin, onEnd };

	return (
		<div className="wrap fair-external-updates">
			<h1>{ __( 'External Updates', 'fair-payments-connector' ) }</h1>
			<p className="fair-external-updates__lead">
				{ __(
					'Fetch transactions and fees from connected sites and Mollie. Every run is recorded in the operation log. Only one update runs at a time.',
					'fair-payments-connector'
				) }{ ' ' }
				<a href={ settings.transactionsUrl }>
					{ __(
						'Import a file on the Transactions page.',
						'fair-payments-connector'
					) }
				</a>
			</p>
			<VStack spacing={ 4 }>
				<ConnectedSitesPanel { ...panelProps } />
				<MollieImportPanel { ...panelProps } />
				<MollieFeesPanel { ...panelProps } />
				<OperationLog refreshKey={ refreshKey } />
			</VStack>
		</div>
	);
};

export default ExternalUpdatesApp;
