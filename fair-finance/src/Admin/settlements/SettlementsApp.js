/**
 * WordPress dependencies
 */
import { useCallback, useEffect, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import {
	Button,
	Notice,
	Spinner,
	__experimentalConfirmDialog as ConfirmDialog,
	__experimentalHStack as HStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import CsvImportModal from './components/CsvImportModal.js';
import MollieImportPanel from './components/MollieImportPanel.js';
import SettlementDetail from './components/SettlementDetail.js';
import SettlementList from './components/SettlementList.js';
import {
	confirmAccount,
	fetchAccounts,
	fetchOpenImport,
	fetchSettlement,
	fetchSettlements,
	isConnectorMissing,
} from './settlements-api.js';
import { LIST_URL } from './format.js';

const RECONCILIATION_URL = 'admin.php?page=fair-finance-reconciliation';

/**
 * Settlement the address asks for, if any.
 *
 * @return {number} Settlement ID, or 0 for the list.
 */
const requestedSettlement = () => {
	const id = new URLSearchParams( window.location.search ).get(
		'settlement'
	);
	return /^\d+$/.test( id || '' ) ? Number( id ) : 0;
};

/**
 * Saved Mollie settlements: a list with import controls, or one settlement
 * when the address names it.
 *
 * @return {JSX.Element} Page.
 */
export default function SettlementsApp() {
	const [ settlementId ] = useState( requestedSettlement );

	// What the page shows comes from this one model.
	const [ view, setView ] = useState( { phase: 'loading' } );
	const [ context, setContext ] = useState( {
		accounts: [],
		connection: null,
		openRun: null,
	} );
	const [ page, setPage ] = useState( 1 );
	const [ accountId, setAccountId ] = useState( 0 );
	const [ showCsvModal, setShowCsvModal ] = useState( false );
	const [ confirming, setConfirming ] = useState( null );
	const [ message, setMessage ] = useState( null );

	const load = useCallback( async () => {
		try {
			const [ data, accounts ] = await Promise.all( [
				settlementId
					? fetchSettlement( settlementId )
					: fetchSettlements( page, accountId ),
				fetchAccounts(),
			] );
			setContext( ( current ) => ( { ...current, ...accounts } ) );
			setView( { phase: 'ready', data } );
		} catch ( error ) {
			if ( isConnectorMissing( error ) ) {
				setView( { phase: 'connector-missing' } );
			} else if (
				settlementId &&
				error?.code === 'settlement_not_found'
			) {
				setView( { phase: 'not-found' } );
			} else {
				setView( {
					phase: 'error',
					message:
						error?.message ||
						__(
							'Settlements could not be loaded.',
							'fair-finance'
						),
				} );
			}
		}
	}, [ settlementId, page, accountId ] );

	useEffect( () => {
		load();
	}, [ load ] );

	// A run left unfinished is offered again when the page is reopened.
	useEffect( () => {
		if ( settlementId ) {
			return;
		}
		fetchOpenImport()
			.then( ( { run } ) =>
				setContext( ( current ) => ( { ...current, openRun: run } ) )
			)
			.catch( () => {} );
	}, [ settlementId ] );

	const confirm = async () => {
		const account = confirming;
		setConfirming( null );
		try {
			await confirmAccount(
				account.id,
				context.connection.organization_id
			);
			setMessage( {
				status: 'success',
				text: sprintf(
					/* translators: %s: account name */
					__(
						'%s is now confirmed. Its settlements were matched with those loaded from Mollie.',
						'fair-finance'
					),
					account.label
				),
			} );
			setAccountId( 0 );
			setPage( 1 );
			load();
		} catch ( error ) {
			setMessage( {
				status: 'error',
				text:
					error?.message ||
					__( 'The account could not be confirmed.', 'fair-finance' ),
			} );
		}
	};

	if ( view.phase === 'loading' ) {
		return (
			<div className="wrap fair-finance-settlements-page">
				<h1>{ __( 'Settlements', 'fair-finance' ) }</h1>
				<div className="fair-finance-settlements-loading">
					<Spinner />
				</div>
			</div>
		);
	}

	if ( view.phase === 'connector-missing' ) {
		return (
			<div className="wrap fair-finance-settlements-page">
				<h1>{ __( 'Settlements', 'fair-finance' ) }</h1>
				<Notice status="warning" isDismissible={ false }>
					{ __(
						'Saved settlements are kept by Fair Payments Connector. Install and activate it, or update it to a version that saves settlements, then reload this page.',
						'fair-finance'
					) }
				</Notice>
			</div>
		);
	}

	if ( view.phase === 'not-found' || view.phase === 'error' ) {
		return (
			<div className="wrap fair-finance-settlements-page">
				<h1>{ __( 'Settlements', 'fair-finance' ) }</h1>
				<Notice status="error" isDismissible={ false }>
					{ view.phase === 'not-found'
						? __(
								'This settlement is not saved on this site.',
								'fair-finance'
						  )
						: view.message }
				</Notice>
				{ settlementId > 0 && (
					<p>
						<a href={ LIST_URL }>
							{ __( '← All settlements', 'fair-finance' ) }
						</a>
					</p>
				) }
			</div>
		);
	}

	if ( settlementId ) {
		return (
			<div className="wrap fair-finance-settlements-page">
				<SettlementDetail
					settlement={ view.data }
					connection={ context.connection }
					onChanged={ load }
				/>
			</div>
		);
	}

	const connection = context.connection;
	const unconfirmed = context.accounts.filter(
		( account ) => ! account.verified
	);

	return (
		<div className="wrap fair-finance-settlements-page">
			<HStack justify="space-between" alignment="center" wrap>
				<h1>{ __( 'Settlements', 'fair-finance' ) }</h1>
				<HStack justify="flex-end" expanded={ false } wrap>
					<Button variant="tertiary" href={ RECONCILIATION_URL }>
						{ __( 'Reconciliation', 'fair-finance' ) }
					</Button>
					<Button
						variant="secondary"
						onClick={ () => setShowCsvModal( true ) }
					>
						{ __( 'Import settlement CSV', 'fair-finance' ) }
					</Button>
				</HStack>
			</HStack>
			<p className="description">
				{ __(
					'Mollie payouts saved on this site, from Mollie itself or from a CSV export. Saved settlements stay available without a Mollie connection. Matching them with bank entries happens on the Reconciliation page.',
					'fair-finance'
				) }
			</p>

			{ message && (
				<Notice
					status={ message.status }
					onRemove={ () => setMessage( null ) }
				>
					{ message.text }
				</Notice>
			) }

			<MollieImportPanel
				connection={ connection }
				openRun={ context.openRun }
				onChanged={ load }
			/>

			{ unconfirmed.map( ( account ) => (
				<Notice
					key={ account.id }
					status="info"
					isDismissible={ false }
					actions={
						connection?.connected && connection.organization_id
							? [
									{
										label: sprintf(
											/* translators: %s: Mollie organization ID */
											__(
												'Confirm it is %s',
												'fair-finance'
											),
											connection.organization_id
										),
										onClick: () => setConfirming( account ),
									},
							  ]
							: []
					}
				>
					{ sprintf(
						/* translators: %s: account name */
						__(
							'Settlements imported from files into “%s” are kept apart from those loaded from Mollie, because a file does not say which Mollie organization it came from.',
							'fair-finance'
						),
						account.label
					) }
				</Notice>
			) ) }

			<SettlementList
				result={ view.data }
				accounts={ context.accounts }
				accountId={ accountId }
				onAccountChange={ ( value ) => {
					setAccountId( value );
					setPage( 1 );
				} }
				onPageChange={ setPage }
			/>

			{ showCsvModal && (
				<CsvImportModal
					accounts={ context.accounts }
					onImported={ load }
					onClose={ () => setShowCsvModal( false ) }
				/>
			) }

			{ confirming && (
				<ConfirmDialog
					isOpen
					onConfirm={ confirm }
					onCancel={ () => setConfirming( null ) }
					confirmButtonText={ __(
						'Confirm account',
						'fair-finance'
					) }
				>
					{ sprintf(
						/* translators: 1: account name, 2: Mollie organization ID */
						__(
							'Confirm that every file imported into “%1$s” was exported from the connected Mollie organization %2$s? Its settlements will be matched with those loaded from Mollie by payout reference. This cannot be undone.',
							'fair-finance'
						),
						confirming.label,
						context.connection.organization_id
					) }
				</ConfirmDialog>
			) }
		</div>
	);
}
