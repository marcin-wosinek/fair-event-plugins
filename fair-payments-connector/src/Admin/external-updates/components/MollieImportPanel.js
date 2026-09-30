/**
 * WordPress dependencies
 */
import { useState, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Card,
	CardHeader,
	CardBody,
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
import RunResultNotice from './RunResultNotice.js';
import { startRun, errorMessage } from '../runs-api.js';
import { loadConnectionSettings } from '../../settings/settings-api.js';

const ACTION = 'import_mollie_payments';

const dateValue = ( date ) => date.toISOString().slice( 0, 10 );

/**
 * Find paid Mollie payments in a bounded period and import the selected ones.
 *
 * @param {Object}   props
 * @param {string}   props.activeAction Key of the action running on the page, or null.
 * @param {Function} props.onBegin      Claims the page-wide busy state; returns false when busy.
 * @param {Function} props.onEnd        Releases the busy state and refreshes the log.
 * @return {JSX.Element} Panel.
 */
const MollieImportPanel = ( { activeAction, onBegin, onEnd } ) => {
	const settings = window.fairPaymentsExternalUpdates || {};
	const today = new Date();
	const thirtyDaysAgo = new Date( today );
	thirtyDaysAgo.setDate( today.getDate() - 30 );

	const [ connected, setConnected ] = useState(
		settings.mollieConnected !== false
	);
	const [ mode, setMode ] = useState(
		settings.testMode === false ? 'live' : 'test'
	);
	const [ checkingConnection, setCheckingConnection ] = useState( true );
	const [ startDate, setStartDate ] = useState( dateValue( thirtyDaysAgo ) );
	const [ endDate, setEndDate ] = useState( dateValue( today ) );
	const [ payments, setPayments ] = useState( [] );
	const [ searched, setSearched ] = useState( false );
	const [ cursor, setCursor ] = useState( null );
	const [ limitReached, setLimitReached ] = useState( false );
	const [ loadingPayments, setLoadingPayments ] = useState( false );
	const [ loadError, setLoadError ] = useState( null );
	const [ selectedIds, setSelectedIds ] = useState( [] );
	const [ importing, setImporting ] = useState( false );
	const [ result, setResult ] = useState( null );

	// The localized mode goes stale if the site's Mollie mode changes after
	// the page loaded, so refresh it once from the server.
	useEffect( () => {
		let isCurrent = true;

		loadConnectionSettings()
			.then( ( connection ) => {
				if ( ! isCurrent ) {
					return;
				}
				setConnected( connection.connected );
				setMode( connection.mode === 'live' ? 'live' : 'test' );
			} )
			.catch( () => {
				// Keep the page-load value when the fresh check fails.
			} )
			.finally( () => {
				if ( isCurrent ) {
					setCheckingConnection( false );
				}
			} );

		return () => {
			isCurrent = false;
		};
	}, [] );

	const findPayments = async ( append = false ) => {
		setLoadingPayments( true );
		setLoadError( null );
		if ( ! append ) {
			setResult( null );
		}

		try {
			const query = new URLSearchParams( {
				mode,
				start_date: startDate,
				end_date: endDate,
				limit: '25',
			} );
			if ( append && cursor ) {
				query.set( 'from', cursor );
			}
			const response = await apiFetch( {
				path: `/fair-payments-connector/v1/transactions/mollie?${ query.toString() }`,
			} );
			setConnected( response.connected !== false );
			setPayments( ( current ) =>
				append
					? [ ...current, ...( response.payments || [] ) ]
					: response.payments || []
			);
			if ( ! append ) {
				setSelectedIds( [] );
			}
			setCursor( response.next || null );
			setLimitReached( !! response.limit_reached );
			setSearched( true );
		} catch ( err ) {
			setLoadError(
				errorMessage(
					err,
					__(
						'Mollie payments could not be loaded. Please try again.',
						'fair-payments-connector'
					)
				)
			);
		} finally {
			setLoadingPayments( false );
		}
	};

	const importSelected = async () => {
		if ( ! onBegin( ACTION ) ) {
			return;
		}
		setImporting( true );
		setResult( null );

		const requestedIds = selectedIds;

		try {
			const { run } = await startRun( ACTION, mode );
			try {
				const response = await apiFetch( {
					path: '/fair-payments-connector/v1/transactions/mollie',
					method: 'POST',
					data: {
						mode,
						start_date: startDate,
						end_date: endDate,
						payment_ids: requestedIds,
						run_id: run.id,
					},
				} );
				const failedIds = ( response.failures || [] ).map(
					( failure ) => failure.payment_id
				);
				// Failed payments stay selected so they can be retried.
				setSelectedIds( failedIds );
				setPayments( ( current ) =>
					current.map( ( payment ) =>
						requestedIds.includes( payment.mollie_payment_id ) &&
						! failedIds.includes( payment.mollie_payment_id )
							? { ...payment, already_imported: true }
							: payment
					)
				);
				setResult( { run: response.run, error: null } );
			} catch ( err ) {
				setResult( {
					run: err?.data?.run || null,
					error: errorMessage(
						err,
						__(
							'The import request did not complete. Check the operation log for its outcome.',
							'fair-payments-connector'
						)
					),
				} );
			}
		} catch ( err ) {
			setResult( {
				run: null,
				error: errorMessage(
					err,
					__(
						'The import could not be started.',
						'fair-payments-connector'
					)
				),
			} );
		} finally {
			setImporting( false );
			onEnd();
		}
	};

	const toggle = ( id, checked ) =>
		setSelectedIds( ( ids ) =>
			checked ? [ ...ids, id ] : ids.filter( ( other ) => other !== id )
		);

	const pageBusy = activeAction !== null;

	const renderDisconnected = () => (
		<Notice status="warning" isDismissible={ false }>
			{ __(
				'Connect Mollie before importing payments.',
				'fair-payments-connector'
			) }{ ' ' }
			<a href={ settings.mollieSettingsUrl }>
				{ __( 'Open Mollie settings', 'fair-payments-connector' ) }
			</a>
		</Notice>
	);

	const renderPayments = () => (
		<>
			{ payments.map( ( payment ) => (
				<div
					key={ payment.mollie_payment_id }
					className="fair-external-updates__payment"
				>
					<CheckboxControl
						label={
							payment.description || payment.mollie_payment_id
						}
						checked={ selectedIds.includes(
							payment.mollie_payment_id
						) }
						disabled={ payment.already_imported || importing }
						onChange={ ( checked ) =>
							toggle( payment.mollie_payment_id, checked )
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
		</>
	);

	return (
		<Card>
			<CardHeader>
				<h2 className="fair-external-updates__title">
					{ __( 'Mollie payments', 'fair-payments-connector' ) }
				</h2>
			</CardHeader>
			<CardBody>
				<VStack spacing={ 3 }>
					<p className="fair-external-updates__intro">
						{ __(
							'Find paid Mollie payments created during a period of up to 90 days and import the ones missing here. Payments already imported are left unchanged.',
							'fair-payments-connector'
						) }
					</p>
					<RunResultNotice
						run={ result?.run }
						error={ result?.error }
						onClose={ () => setResult( null ) }
					/>
					{ ! connected ? (
						renderDisconnected()
					) : (
						<>
							<div className="fair-external-updates__fields">
								<SelectControl
									label={ __(
										'Mode',
										'fair-payments-connector'
									) }
									value={ mode }
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
									onChange={ setMode }
									disabled={ checkingConnection || importing }
									help={
										checkingConnection
											? __(
													'Checking the current mode…',
													'fair-payments-connector'
											  )
											: undefined
									}
									__nextHasNoMarginBottom
								/>
								<TextControl
									label={ __(
										'Start date',
										'fair-payments-connector'
									) }
									type="date"
									value={ startDate }
									onChange={ setStartDate }
									disabled={ importing }
									__nextHasNoMarginBottom
								/>
								<TextControl
									label={ __(
										'End date',
										'fair-payments-connector'
									) }
									type="date"
									value={ endDate }
									onChange={ setEndDate }
									disabled={ importing }
									__nextHasNoMarginBottom
								/>
							</div>
							<HStack justify="flex-start">
								<Button
									variant="secondary"
									onClick={ () => findPayments() }
									disabled={ loadingPayments || importing }
								>
									{ __(
										'Find payments',
										'fair-payments-connector'
									) }
								</Button>
							</HStack>
							{ loadError && (
								<Notice
									status="error"
									onRemove={ () => setLoadError( null ) }
								>
									{ loadError }
								</Notice>
							) }
							{ loadingPayments && (
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
							{ searched &&
								! loadingPayments &&
								payments.length === 0 && (
									<p>
										{ __(
											'No paid Mollie payments match these filters.',
											'fair-payments-connector'
										) }
									</p>
								) }
							{ renderPayments() }
							{ cursor && (
								<HStack justify="flex-start">
									<Button
										variant="tertiary"
										onClick={ () => findPayments( true ) }
										disabled={ loadingPayments }
									>
										{ __(
											'Load more',
											'fair-payments-connector'
										) }
									</Button>
								</HStack>
							) }
							{ limitReached && (
								<p className="fair-external-updates__muted">
									{ __(
										'More payments are available. Load another bounded page to continue.',
										'fair-payments-connector'
									) }
								</p>
							) }
							{ payments.length > 0 && (
								<VStack spacing={ 1 }>
									<HStack justify="flex-start">
										<Button
											variant="primary"
											isBusy={ importing }
											disabled={
												selectedIds.length === 0 ||
												pageBusy
											}
											onClick={ importSelected }
										>
											{ importing
												? __(
														'Importing…',
														'fair-payments-connector'
												  )
												: __(
														'Import selected payments',
														'fair-payments-connector'
												  ) }
										</Button>
									</HStack>
									{ selectedIds.length === 0 &&
										! importing && (
											<span className="fair-external-updates__muted">
												{ __(
													'Select at least one payment to import.',
													'fair-payments-connector'
												) }
											</span>
										) }
								</VStack>
							) }
						</>
					) }
				</VStack>
			</CardBody>
		</Card>
	);
};

export default MollieImportPanel;
