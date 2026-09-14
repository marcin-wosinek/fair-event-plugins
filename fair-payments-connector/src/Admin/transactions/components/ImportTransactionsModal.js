/**
 * WordPress dependencies
 */
import { useState, useEffect, useRef } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Modal,
	Button,
	Notice,
	Spinner,
	CheckboxControl,
	SelectControl,
	TextControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import { parseMollieCsv } from '../parseMollieCsv.js';

const STATUS_COLORS = {
	connected: '#007017',
	error: '#d63638',
	unverified: '#946800',
};

const ImportTransactionsModal = ( { onClose, onImported } ) => {
	const today = new Date();
	const thirtyDaysAgo = new Date( today );
	thirtyDaysAgo.setDate( today.getDate() - 30 );
	const dateValue = ( date ) => date.toISOString().slice( 0, 10 );
	const [ view, setView ] = useState( 'choose' );
	const [ error, setError ] = useState( null );
	const [ isImporting, setIsImporting ] = useState( false );
	const [ sites, setSites ] = useState( [] );
	const [ loadingSites, setLoadingSites ] = useState( false );
	const [ busySiteId, setBusySiteId ] = useState( null );
	const [ mollieState, setMollieState ] = useState( {
		connected: window.fairPaymentTransactions?.mollieConnected !== false,
		settings_url: window.fairPaymentTransactions?.mollieSettingsUrl,
	} );
	const [ molliePayments, setMolliePayments ] = useState( [] );
	const [ selectedIds, setSelectedIds ] = useState( [] );
	const [ mollieMode, setMollieMode ] = useState(
		window.fairPaymentTransactions?.testMode === false ? 'live' : 'test'
	);
	const [ startDate, setStartDate ] = useState( dateValue( thirtyDaysAgo ) );
	const [ endDate, setEndDate ] = useState( dateValue( today ) );
	const [ mollieCursor, setMollieCursor ] = useState( null );
	const [ loadingMollie, setLoadingMollie ] = useState( false );
	const [ mollieResult, setMollieResult ] = useState( null );
	const fileInputRef = useRef( null );

	useEffect( () => {
		if ( view !== 'sites' ) {
			return;
		}

		const loadSites = async () => {
			setLoadingSites( true );
			setError( null );

			try {
				const data = await apiFetch( {
					path: '/fair-payments-connector/v1/admin/connected-sites',
				} );
				setSites( data );
			} catch ( err ) {
				setError(
					err.message ||
						__(
							'Failed to load connected sites.',
							'fair-payments-connector'
						)
				);
			} finally {
				setLoadingSites( false );
			}
		};

		loadSites();
	}, [ view ] );

	const handleFileChange = async ( e ) => {
		const file = e.target.files[ 0 ];
		if ( ! file ) {
			return;
		}

		// Reset the input so the same file can be re-selected.
		e.target.value = '';

		setIsImporting( true );
		setError( null );

		try {
			const text = await file.text();
			let toImport;

			if ( file.name.endsWith( '.csv' ) ) {
				toImport = parseMollieCsv( text );
			} else {
				const imported = JSON.parse( text );

				if ( ! Array.isArray( imported ) ) {
					throw new Error(
						__(
							'Invalid file format. Expected a JSON array.',
							'fair-payments-connector'
						)
					);
				}

				toImport = imported.filter( ( t ) => t.mollie_payment_id );
			}

			if ( toImport.length === 0 ) {
				throw new Error(
					__(
						'No valid transactions found in the file.',
						'fair-payments-connector'
					)
				);
			}

			const response = await apiFetch( {
				path: '/fair-payments-connector/v1/transactions/import',
				method: 'POST',
				data: { transactions: toImport },
			} );

			onImported( response.message );
		} catch ( err ) {
			setError(
				err.message ||
					__(
						'Failed to import transactions.',
						'fair-payments-connector'
					)
			);
		} finally {
			setIsImporting( false );
		}
	};

	const handleSiteImport = async ( site ) => {
		setBusySiteId( site.id );
		setError( null );

		try {
			const response = await apiFetch( {
				path: `/fair-payments-connector/v1/admin/connected-sites/${ site.id }/import-transactions`,
				method: 'POST',
			} );

			onImported( response.message );
		} catch ( err ) {
			setError(
				err.message ||
					__(
						'Failed to import transactions from the connected site.',
						'fair-payments-connector'
					)
			);
		} finally {
			setBusySiteId( null );
		}
	};

	const loadMolliePayments = async ( append = false ) => {
		setLoadingMollie( true );
		setError( null );
		setMollieResult( null );
		try {
			const query = new URLSearchParams( {
				mode: mollieMode,
				start_date: startDate,
				end_date: endDate,
				limit: '25',
			} );
			if ( append && mollieCursor ) {
				query.set( 'from', mollieCursor );
			}
			const response = await apiFetch( {
				path: `/fair-payments-connector/v1/transactions/mollie?${ query.toString() }`,
			} );
			setMollieState( response );
			setMollieMode( response.default_mode || mollieMode );
			setMolliePayments( ( current ) =>
				append
					? [ ...current, ...( response.payments || [] ) ]
					: response.payments || []
			);
			setMollieCursor( response.next || null );
		} catch ( err ) {
			setError(
				err.message ||
					__(
						'Mollie payments could not be loaded. Please try again.',
						'fair-payments-connector'
					)
			);
		} finally {
			setLoadingMollie( false );
		}
	};

	const importMolliePayments = async () => {
		setIsImporting( true );
		setError( null );
		try {
			const response = await apiFetch( {
				path: '/fair-payments-connector/v1/transactions/mollie',
				method: 'POST',
				data: {
					mode: mollieMode,
					start_date: startDate,
					end_date: endDate,
					payment_ids: selectedIds,
				},
			} );
			const failedIds = response.failures.map(
				( failure ) => failure.payment_id
			);
			setSelectedIds( failedIds );
			setMolliePayments( ( payments ) =>
				payments.map( ( payment ) =>
					selectedIds.includes( payment.mollie_payment_id ) &&
					! failedIds.includes( payment.mollie_payment_id )
						? { ...payment, already_imported: true }
						: payment
				)
			);
			setMollieResult( response );
			onImported( response.message );
		} catch ( err ) {
			setError(
				err.message ||
					__(
						'The selected Mollie payments could not be imported.',
						'fair-payments-connector'
					)
			);
		} finally {
			setIsImporting( false );
		}
	};

	const renderChoose = () => (
		<VStack spacing={ 4 }>
			<p style={ { margin: 0 } }>
				{ __(
					'Where do you want to import transactions from?',
					'fair-payments-connector'
				) }
			</p>
			<HStack spacing={ 3 } justify="flex-start">
				<Button
					variant="secondary"
					onClick={ () => {
						setError( null );
						setView( 'mollie' );
					} }
				>
					{ __( 'Import from Mollie', 'fair-payments-connector' ) }
				</Button>
				<Button
					variant="secondary"
					onClick={ () => {
						setError( null );
						setView( 'sites' );
					} }
				>
					{ __( 'Connected Sites', 'fair-payments-connector' ) }
				</Button>
				<Button
					variant="secondary"
					onClick={ () => {
						setError( null );
						setView( 'file' );
					} }
				>
					{ __( 'From File', 'fair-payments-connector' ) }
				</Button>
			</HStack>
		</VStack>
	);

	const renderMollie = () => (
		<VStack spacing={ 4 }>
			{ mollieState && ! mollieState.connected ? (
				<Notice status="warning" isDismissible={ false }>
					{ __(
						'Connect Mollie before importing payments.',
						'fair-payments-connector'
					) }{ ' ' }
					<a href={ mollieState.settings_url }>
						{ __(
							'Open Mollie settings',
							'fair-payments-connector'
						) }
					</a>
				</Notice>
			) : (
				<>
					<p style={ { margin: 0 } }>
						{ __(
							'Show paid Mollie payments created during this period. A search can cover up to 90 days.',
							'fair-payments-connector'
						) }
					</p>
					<div
						style={ {
							display: 'grid',
							gridTemplateColumns:
								'repeat(auto-fit, minmax(150px, 1fr))',
							gap: '12px',
						} }
					>
						<SelectControl
							label={ __( 'Mode', 'fair-payments-connector' ) }
							value={ mollieMode }
							options={ [
								{
									label: __(
										'Test',
										'fair-payments-connector'
									),
									value: 'test',
								},
								{
									label: __(
										'Live',
										'fair-payments-connector'
									),
									value: 'live',
								},
							] }
							onChange={ setMollieMode }
						/>
						<TextControl
							label={ __(
								'Start date',
								'fair-payments-connector'
							) }
							type="date"
							value={ startDate }
							onChange={ setStartDate }
						/>
						<TextControl
							label={ __(
								'End date',
								'fair-payments-connector'
							) }
							type="date"
							value={ endDate }
							onChange={ setEndDate }
						/>
					</div>
					<Button
						variant="primary"
						onClick={ () => loadMolliePayments() }
						disabled={ loadingMollie || isImporting }
					>
						{ __( 'Find payments', 'fair-payments-connector' ) }
					</Button>
					{ loadingMollie && (
						<HStack justify="flex-start">
							<Spinner />
							<span>
								{ __(
									'Loading Mollie payments…',
									'fair-payments-connector'
								) }
							</span>
						</HStack>
					) }
					{ mollieState &&
						mollieState.connected &&
						! loadingMollie &&
						molliePayments.length === 0 && (
							<p>
								{ __(
									'No paid Mollie payments match these filters.',
									'fair-payments-connector'
								) }
							</p>
						) }
					{ molliePayments.map( ( payment ) => (
						<div
							key={ payment.mollie_payment_id }
							style={ {
								border: '1px solid #c3c4c7',
								borderRadius: '4px',
								padding: '12px',
							} }
						>
							<CheckboxControl
								label={
									payment.description ||
									payment.mollie_payment_id
								}
								checked={ selectedIds.includes(
									payment.mollie_payment_id
								) }
								disabled={
									payment.already_imported || isImporting
								}
								onChange={ ( checked ) =>
									setSelectedIds( ( ids ) =>
										checked
											? [
													...ids,
													payment.mollie_payment_id,
											  ]
											: ids.filter(
													( id ) =>
														id !==
														payment.mollie_payment_id
											  )
									)
								}
							/>
							<div>
								<code>{ payment.mollie_payment_id }</code> ·{ ' ' }
								{ Number( payment.amount ).toFixed( 2 ) }{ ' ' }
								{ payment.currency }
							</div>
							<div>
								{ payment.created_at } ·{ ' ' }
								{ payment.testmode
									? __( 'Test', 'fair-payments-connector' )
									: __( 'Live', 'fair-payments-connector' ) }
							</div>
							{ payment.already_imported && (
								<strong>
									{ __(
										'Already imported',
										'fair-payments-connector'
									) }
								</strong>
							) }
						</div>
					) ) }
					{ mollieCursor && (
						<Button
							variant="secondary"
							onClick={ () => loadMolliePayments( true ) }
							disabled={ loadingMollie }
						>
							{ __( 'Load more', 'fair-payments-connector' ) }
						</Button>
					) }
					{ mollieState?.limit_reached && (
						<p>
							{ __(
								'More payments are available. Load another bounded page to continue.',
								'fair-payments-connector'
							) }
						</p>
					) }
					{ mollieResult && (
						<Notice
							status={
								mollieResult.failed ? 'warning' : 'success'
							}
							isDismissible={ false }
						>
							{ mollieResult.message }
						</Notice>
					) }
					<Button
						variant="primary"
						isBusy={ isImporting }
						disabled={ selectedIds.length === 0 || isImporting }
						onClick={ importMolliePayments }
					>
						{ __(
							'Import selected payments',
							'fair-payments-connector'
						) }
					</Button>
				</>
			) }
			<Button
				variant="tertiary"
				onClick={ () => setView( 'choose' ) }
				disabled={ isImporting }
			>
				{ __( 'Back', 'fair-payments-connector' ) }
			</Button>
		</VStack>
	);

	const renderFile = () => (
		<VStack spacing={ 4 }>
			<p style={ { margin: 0 } }>
				{ __(
					'Select a JSON file exported from another site, or a Mollie payments CSV export.',
					'fair-payments-connector'
				) }
			</p>
			<input
				ref={ fileInputRef }
				type="file"
				accept=".json,.csv"
				onChange={ handleFileChange }
				disabled={ isImporting }
			/>
			{ isImporting && (
				<HStack justify="flex-start" spacing={ 2 }>
					<Spinner />
					<span>
						{ __( 'Importing…', 'fair-payments-connector' ) }
					</span>
				</HStack>
			) }
			<HStack justify="flex-start">
				<Button
					variant="tertiary"
					onClick={ () => setView( 'choose' ) }
					disabled={ isImporting }
				>
					{ __( 'Back', 'fair-payments-connector' ) }
				</Button>
			</HStack>
		</VStack>
	);

	const renderSites = () => (
		<VStack spacing={ 4 }>
			<p style={ { margin: 0 } }>
				{ __(
					'Pull transactions from a registered connected site. Existing transactions are matched by payment ID and updated rather than duplicated.',
					'fair-payments-connector'
				) }
			</p>

			{ loadingSites && (
				<HStack justify="flex-start" spacing={ 2 }>
					<Spinner />
					<span>
						{ __( 'Loading sites…', 'fair-payments-connector' ) }
					</span>
				</HStack>
			) }

			{ ! loadingSites && sites.length === 0 && (
				<p>
					{ __(
						'No connected sites yet. Add one on the Connected Sites page first.',
						'fair-payments-connector'
					) }
				</p>
			) }

			{ ! loadingSites && sites.length > 0 && (
				<table className="wp-list-table widefat fixed striped">
					<thead>
						<tr>
							<th>
								{ __( 'Label', 'fair-payments-connector' ) }
							</th>
							<th>
								{ __( 'Status', 'fair-payments-connector' ) }
							</th>
							<th style={ { width: '120px' } }>
								{ __( 'Actions', 'fair-payments-connector' ) }
							</th>
						</tr>
					</thead>
					<tbody>
						{ sites.map( ( site ) => (
							<tr key={ site.id }>
								<td>
									<strong>{ site.label }</strong>
									<br />
									<span style={ { color: '#666' } }>
										{ site.base_url }
									</span>
								</td>
								<td>
									<span
										style={ {
											color:
												STATUS_COLORS[ site.status ] ||
												STATUS_COLORS.unverified,
											fontWeight: 'bold',
										} }
									>
										{ site.status }
									</span>
								</td>
								<td>
									<Button
										variant="primary"
										size="small"
										isBusy={ busySiteId === site.id }
										disabled={ busySiteId !== null }
										onClick={ () =>
											handleSiteImport( site )
										}
									>
										{ __(
											'Import',
											'fair-payments-connector'
										) }
									</Button>
								</td>
							</tr>
						) ) }
					</tbody>
				</table>
			) }

			<HStack justify="flex-start">
				<Button
					variant="tertiary"
					onClick={ () => setView( 'choose' ) }
					disabled={ busySiteId !== null }
				>
					{ __( 'Back', 'fair-payments-connector' ) }
				</Button>
			</HStack>
		</VStack>
	);

	return (
		<Modal
			title={ __( 'Import Transactions', 'fair-payments-connector' ) }
			onRequestClose={ onClose }
			style={ { maxWidth: '640px', width: '100%' } }
		>
			<VStack spacing={ 4 }>
				{ error && (
					<Notice
						status="error"
						isDismissible
						onRemove={ () => setError( null ) }
					>
						{ error }
					</Notice>
				) }

				{ view === 'choose' && renderChoose() }
				{ view === 'file' && renderFile() }
				{ view === 'sites' && renderSites() }
				{ view === 'mollie' && renderMollie() }
			</VStack>
		</Modal>
	);
};

export default ImportTransactionsModal;
