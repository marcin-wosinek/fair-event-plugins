/**
 * WordPress dependencies
 */
import { useState, useEffect, useRef } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardHeader,
	CardBody,
	Spinner,
	Notice,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const formatMoney = ( amount, currency ) =>
	new Intl.NumberFormat( 'de-DE', {
		style: 'currency',
		currency,
	} ).format( amount ?? 0 );

/**
 * Current month as YYYY-MM in UTC, matching the REST default.
 *
 * @return {string} Month key.
 */
export const currentMonth = () => new Date().toISOString().slice( 0, 7 );

/**
 * Move a YYYY-MM month key by a number of months.
 *
 * @param {string} month YYYY-MM month key.
 * @param {number} delta Months to move (negative for earlier).
 * @return {string} Shifted month key.
 */
export const shiftMonth = ( month, delta ) => {
	const [ year, monthNumber ] = month.split( '-' ).map( Number );
	const date = new Date( Date.UTC( year, monthNumber - 1 + delta, 1 ) );
	return date.toISOString().slice( 0, 7 );
};

const formatMonthLabel = ( month ) => {
	const [ year, monthNumber ] = month.split( '-' ).map( Number );
	return new Date( Date.UTC( year, monthNumber - 1, 1 ) ).toLocaleString(
		'default',
		{ month: 'long', year: 'numeric', timeZone: 'UTC' }
	);
};

const IncompleteBadge = () => (
	<span
		className="fair-payments-connector-fee-dashboard__incomplete"
		style={ {
			display: 'inline-block',
			marginLeft: '8px',
			padding: '0 6px',
			borderRadius: '2px',
			background: '#fcf9e8',
			border: '1px solid #dba617',
			fontSize: '12px',
			fontWeight: 'normal',
			verticalAlign: 'middle',
		} }
	>
		{ __( 'Incomplete', 'fair-payments-connector' ) }
	</span>
);

const StatTile = ( { label, value, incomplete, note } ) => (
	<Card size="small">
		<CardHeader>
			<h3 style={ { margin: 0, fontSize: '14px' } }>
				{ label }
				{ incomplete && <IncompleteBadge /> }
			</h3>
		</CardHeader>
		<CardBody>
			<p style={ { fontSize: '1.5em', margin: 0 } }>{ value }</p>
			{ note && (
				<p style={ { margin: '8px 0 0', color: '#757575' } }>
					{ note }
				</p>
			) }
		</CardBody>
	</Card>
);

const CurrencyFigures = ( { figures, showCurrencyHeading } ) => {
	const {
		currency,
		transaction_count: transactionCount,
		paid_total: paidTotal,
		fair_event_commission: fairEventCommission,
		mollie_commission: mollieCommission,
		amount_after_fees: amountAfterFees,
		missing_fair_event_commission_count: missingFairEvent,
		missing_mollie_commission_count: missingMollie,
	} = figures;

	const fairEventIncomplete = missingFairEvent > 0;
	const mollieIncomplete = missingMollie > 0;
	const knownSubtotalNote = __(
		'Known subtotal so far.',
		'fair-payments-connector'
	);

	return (
		<VStack spacing={ 3 } data-currency={ currency }>
			{ showCurrencyHeading && (
				<h2 style={ { margin: 0 } }>{ currency }</h2>
			) }

			{ mollieIncomplete && (
				<Notice status="warning" isDismissible={ false }>
					{ sprintf(
						/* translators: %d: number of paid transactions without Mollie fee data */
						_n(
							'%d paid transaction is still awaiting Mollie fee data. The Mollie commission and the amount after fees are incomplete until it arrives.',
							'%d paid transactions are still awaiting Mollie fee data. The Mollie commission and the amount after fees are incomplete until it arrives.',
							missingMollie,
							'fair-payments-connector'
						),
						missingMollie
					) }
				</Notice>
			) }

			{ fairEventIncomplete && (
				<Notice status="warning" isDismissible={ false }>
					{ sprintf(
						/* translators: %d: number of paid transactions without a recorded Fair Event commission */
						_n(
							'%d paid transaction has no recorded Fair Event commission. The Fair Event commission and the amount after fees are incomplete.',
							'%d paid transactions have no recorded Fair Event commission. The Fair Event commission and the amount after fees are incomplete.',
							missingFairEvent,
							'fair-payments-connector'
						),
						missingFairEvent
					) }
				</Notice>
			) }

			<div
				className="fair-payments-connector-fee-dashboard__grid"
				style={ {
					display: 'grid',
					gridTemplateColumns:
						'repeat(auto-fill, minmax(min(100%, 220px), 1fr))',
					gap: '16px',
				} }
			>
				<StatTile
					label={ __(
						'Paid transactions',
						'fair-payments-connector'
					) }
					value={ transactionCount }
				/>
				<StatTile
					label={ __( 'Total paid', 'fair-payments-connector' ) }
					value={ formatMoney( paidTotal, currency ) }
				/>
				<StatTile
					label={ __(
						'Calculated amount after fees',
						'fair-payments-connector'
					) }
					value={ formatMoney( amountAfterFees, currency ) }
					incomplete={ fairEventIncomplete || mollieIncomplete }
					note={ __(
						'An estimate, not a confirmed Mollie payout.',
						'fair-payments-connector'
					) }
				/>
				<StatTile
					label={ __(
						'Fair Event commission',
						'fair-payments-connector'
					) }
					value={ formatMoney( fairEventCommission, currency ) }
					incomplete={ fairEventIncomplete }
					note={ fairEventIncomplete ? knownSubtotalNote : null }
				/>
				<StatTile
					label={ __(
						'Mollie commission',
						'fair-payments-connector'
					) }
					value={ formatMoney( mollieCommission, currency ) }
					incomplete={ mollieIncomplete }
					note={ mollieIncomplete ? knownSubtotalNote : null }
				/>
			</div>
		</VStack>
	);
};

const FeeDashboardApp = () => {
	const [ month, setMonth ] = useState( currentMonth );
	const [ summary, setSummary ] = useState( null );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	const [ reloadKey, setReloadKey ] = useState( 0 );
	const latestRequest = useRef( 0 );

	useEffect( () => {
		if ( ! MONTH_PATTERN.test( month ) ) {
			return;
		}

		const requestId = ++latestRequest.current;
		setLoading( true );
		setError( null );
		setSummary( null );

		apiFetch( {
			path: `/fair-payments-connector/v1/dashboard/monthly-summary?month=${ month }`,
		} )
			.then( ( data ) => {
				if ( requestId === latestRequest.current ) {
					setSummary( data );
				}
			} )
			.catch( ( err ) => {
				if ( requestId === latestRequest.current ) {
					setError(
						err.message ||
							__(
								'Failed to load dashboard data.',
								'fair-payments-connector'
							)
					);
				}
			} )
			.finally( () => {
				if ( requestId === latestRequest.current ) {
					setLoading( false );
				}
			} );
	}, [ month, reloadKey ] );

	const isCurrentMonth = month === currentMonth();
	const currencies = summary?.currencies ?? [];
	const isEmptyMonth =
		currencies.length > 0 &&
		currencies.every( ( figures ) => figures.transaction_count === 0 );

	return (
		<div className="wrap fair-payments-connector-fee-dashboard-page">
			<VStack spacing={ 4 }>
				<h1 style={ { margin: 0 } }>
					{ __( 'Fee Dashboard', 'fair-payments-connector' ) }
				</h1>

				<p style={ { margin: 0 } }>
					{ sprintf(
						/* translators: %d: integration fee percentage */
						__(
							'The integration fee is %d%% of ticket sales, with no monthly cap. It is waived through 31 December 2026. Mollie processing fees apply separately.',
							'fair-payments-connector'
						),
						2
					) }
				</p>

				<HStack
					justify="space-between"
					align="center"
					wrap
					style={ { rowGap: '8px' } }
				>
					<h2
						style={ { margin: 0 } }
						aria-live="polite"
						data-testid="fee-dashboard-month"
					>
						{ formatMonthLabel( month ) }
					</h2>
					<HStack
						spacing={ 2 }
						justify="flex-start"
						expanded={ false }
					>
						<Button
							variant="secondary"
							onClick={ () =>
								setMonth( ( value ) => shiftMonth( value, -1 ) )
							}
						>
							{ __(
								'Previous month',
								'fair-payments-connector'
							) }
						</Button>
						{ ! isCurrentMonth && (
							<Button
								variant="tertiary"
								onClick={ () => setMonth( currentMonth() ) }
							>
								{ __(
									'Current month',
									'fair-payments-connector'
								) }
							</Button>
						) }
						<Button
							variant="secondary"
							onClick={ () =>
								setMonth( ( value ) => shiftMonth( value, 1 ) )
							}
						>
							{ __( 'Next month', 'fair-payments-connector' ) }
						</Button>
					</HStack>
				</HStack>

				<p style={ { margin: 0, color: '#757575' } }>
					{ __(
						'Only paid transactions are counted, in the month they were created (UTC). The calculated amount after fees is the total paid minus the recorded Fair Event and Mollie commissions.',
						'fair-payments-connector'
					) }
				</p>

				{ summary?.testmode && (
					<Notice status="warning" isDismissible={ false }>
						{ __(
							'Test mode — these figures reflect test transactions only.',
							'fair-payments-connector'
						) }
					</Notice>
				) }

				{ error && (
					<Notice status="error" isDismissible={ false }>
						<p style={ { margin: 0 } }>{ error }</p>
						<Button
							variant="link"
							onClick={ () => setReloadKey( ( key ) => key + 1 ) }
						>
							{ __( 'Try again', 'fair-payments-connector' ) }
						</Button>
					</Notice>
				) }

				{ loading && (
					<div>
						<Spinner />
					</div>
				) }

				{ ! loading && summary && (
					<VStack spacing={ 6 }>
						{ isEmptyMonth && (
							<p style={ { margin: 0 } }>
								{ __(
									'No paid transactions in this month.',
									'fair-payments-connector'
								) }
							</p>
						) }
						{ currencies.map( ( figures ) => (
							<CurrencyFigures
								key={ figures.currency }
								figures={ figures }
								showCurrencyHeading={ currencies.length > 1 }
							/>
						) ) }
					</VStack>
				) }
			</VStack>
		</div>
	);
};

export default FeeDashboardApp;
