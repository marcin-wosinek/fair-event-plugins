/**
 * Records the migration reported, filtered by run, status, reason, event
 * and their payment's status and test/live mode, each opening its
 * reconciliation dialog.
 *
 * @package FairEvents
 */

import { __, _n, sprintf } from '@wordpress/i18n';
import {
	createInterpolateElement,
	useEffect,
	useState,
} from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	Notice,
	SelectControl,
	Spinner,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import FindingModal from './FindingModal.js';
import {
	findingStatusLabels,
	reasonLabel,
	reasonLabels,
	transactionStatusLabels,
} from './labels.js';
import {
	formatAmount,
	formatEventDate,
	formatUtcDateTime,
	transactionUrl,
} from './format.js';

const PER_PAGE = 20;

/**
 * Payment status filter options: one per label, so statuses shown the same
 * way (open and pending_payment are both "Awaiting payment") are one choice.
 * Each value lists its statuses, comma-separated.
 *
 * @return {Array<{value: string, label: string}>} Options after "All".
 */
export function paymentStatusOptions() {
	const byLabel = new Map();
	Object.entries( transactionStatusLabels() ).forEach(
		( [ status, label ] ) => {
			byLabel.set( label, [ ...( byLabel.get( label ) || [] ), status ] );
		}
	);
	return Array.from( byLabel, ( [ label, statuses ] ) => ( {
		value: statuses.join( ',' ),
		label,
	} ) );
}

/**
 * What a finding is about, in a few words.
 *
 * @param {Object} finding Finding.
 * @return {string} Source.
 */
export function describeSource( finding ) {
	const detail = finding.detail || {};
	switch ( finding.source_type ) {
		case 'transaction':
			return detail.amount !== undefined
				? sprintf(
						/* translators: 1: payment number, 2: amount */
						__( 'Payment #%1$d, %2$s', 'fair-events' ),
						finding.source_id,
						formatAmount( detail.amount, detail.currency )
					)
				: sprintf(
						/* translators: %d: payment number */
						__( 'Payment #%d', 'fair-events' ),
						finding.source_id
					);
		case 'relationship':
			return sprintf(
				/* translators: %d: registration number */
				__( 'Registration #%d', 'fair-events' ),
				finding.source_id
			);
		case 'ledger_row':
			return sprintf(
				/* translators: 1: payment record number, 2: payment number */
				__( 'Payment record #%1$d (payment #%2$d)', 'fair-events' ),
				finding.source_id,
				detail.transaction_id || 0
			);
		case 'signup':
			return sprintf(
				/* translators: %d: purchase number */
				__( 'Purchase #%d', 'fair-events' ),
				finding.source_id
			);
		case 'link':
			return sprintf(
				/* translators: %d: payment number */
				__( 'Link to payment #%d', 'fair-events' ),
				detail.transaction_id || 0
			);
		default:
			return `${ finding.source_type } #${ finding.source_id }`;
	}
}

/**
 * What a finding is about, with its payment number linked to the payment's
 * page in Fair Payments Connector. Plain text when the payment can't be
 * opened: Connector's payments can't be read, the finding names no payment,
 * or the payment no longer exists.
 *
 * @param {Object}  props
 * @param {Object}  props.finding  Finding.
 * @param {boolean} props.linkable Whether Connector's payments can be read.
 * @return {JSX.Element|string} Source.
 */
export function SourceDescription( { finding, linkable } ) {
	const detail = finding.detail || {};
	const transactionId =
		finding.source_type === 'transaction'
			? finding.source_id
			: Number( detail.transaction_id || 0 );
	if (
		! linkable ||
		! transactionId ||
		finding.reason === 'missing_transaction'
	) {
		return describeSource( finding );
	}

	let text;
	switch ( finding.source_type ) {
		case 'transaction':
			text =
				detail.amount !== undefined
					? sprintf(
							/* translators: 1: payment number, 2: amount. Keep <a></a>: it links to the payment. */
							__( '<a>Payment #%1$d</a>, %2$s', 'fair-events' ),
							transactionId,
							formatAmount( detail.amount, detail.currency )
						)
					: sprintf(
							/* translators: %d: payment number. Keep <a></a>: it links to the payment. */
							__( '<a>Payment #%d</a>', 'fair-events' ),
							transactionId
						);
			break;
		case 'ledger_row':
			text = sprintf(
				/* translators: 1: payment record number, 2: payment number. Keep <a></a>: it links to the payment. */
				__(
					'Payment record #%1$d (<a>payment #%2$d</a>)',
					'fair-events'
				),
				finding.source_id,
				transactionId
			);
			break;
		case 'link':
			text = sprintf(
				/* translators: %d: payment number. Keep <a></a>: it links to the payment. */
				__( 'Link to <a>payment #%d</a>', 'fair-events' ),
				transactionId
			);
			break;
		default:
			return describeSource( finding );
	}
	return createInterpolateElement( text, {
		// eslint-disable-next-line jsx-a11y/anchor-has-content -- content comes from the translated string.
		a: <a href={ transactionUrl( transactionId ) } />,
	} );
}

/**
 * The findings card.
 *
 * @param {Object}   props
 * @param {Object}   props.status     Status from the API.
 * @param {number}   props.refreshKey Changes when the list should reload.
 * @param {Function} props.onChanged  Called after a decision.
 * @return {JSX.Element} Card.
 */
export default function FindingsPanel( { status, refreshKey, onChanged } ) {
	const hasBackfill = !! status.backfill;
	const [ mode, setMode ] = useState( hasBackfill ? 'backfill' : 'dry_run' );
	const [ findingStatus, setFindingStatus ] = useState( 'open' );
	const [ reason, setReason ] = useState( '' );
	const [ eventDate, setEventDate ] = useState( '-1' );
	const [ paymentStatus, setPaymentStatus ] = useState( '' );
	const [ paymentMode, setPaymentMode ] = useState( 'all' );
	const [ page, setPage ] = useState( 1 );
	const [ openId, setOpenId ] = useState( null );
	const [ notice, setNotice ] = useState( null );
	const [ data, setData ] = useState( {
		loading: true,
		items: [],
		total: 0,
		totalPages: 1,
		eventDates: [],
		reasons: {},
		error: null,
	} );

	// Follow the migration once it starts: its findings replace the dry run's.
	useEffect( () => {
		if ( hasBackfill ) {
			setMode( 'backfill' );
		}
	}, [ hasBackfill ] );

	useEffect( () => {
		let active = true;
		setData( ( previous ) => ( {
			...previous,
			loading: true,
			error: null,
		} ) );
		const query = new URLSearchParams( {
			mode,
			status: findingStatus,
			reason,
			event_date_id: eventDate,
			transaction_status: paymentStatus,
			payment_mode: paymentMode,
			page: String( page ),
			per_page: String( PER_PAGE ),
		} );
		apiFetch( {
			path: `/fair-events/v1/payment-history/findings?${ query }`,
			parse: false,
		} )
			.then( async ( response ) => {
				const body = await response.json();
				if ( active ) {
					setData( {
						loading: false,
						items: body.items,
						total: Number( response.headers.get( 'X-WP-Total' ) ),
						totalPages:
							Number(
								response.headers.get( 'X-WP-TotalPages' )
							) || 1,
						eventDates: body.event_dates,
						reasons: body.reasons,
						error: null,
					} );
				}
			} )
			.catch( ( e ) => {
				if ( active ) {
					setData( ( previous ) => ( {
						...previous,
						loading: false,
						items: [],
						error:
							e?.message ||
							__(
								'The reported records couldn’t be loaded.',
								'fair-events'
							),
					} ) );
				}
			} );
		return () => {
			active = false;
		};
	}, [
		mode,
		findingStatus,
		reason,
		eventDate,
		paymentStatus,
		paymentMode,
		page,
		refreshKey,
	] );

	const labels = reasonLabels();
	const statuses = findingStatusLabels();
	const filter = ( setter ) => ( value ) => {
		setter( value );
		setPage( 1 );
	};
	const narrowed =
		reason !== '' ||
		eventDate !== '-1' ||
		paymentStatus !== '' ||
		paymentMode !== 'all';
	const clearFilters = () => {
		setReason( '' );
		setEventDate( '-1' );
		setPaymentStatus( '' );
		setPaymentMode( 'all' );
		setPage( 1 );
	};

	const reasonOptions = [
		{ value: '', label: __( 'All reasons', 'fair-events' ) },
		...Object.keys( labels )
			.filter( ( code ) => data.reasons[ code ] || code === reason )
			.map( ( code ) => ( {
				value: code,
				label: sprintf(
					/* translators: 1: reason, 2: number of records */
					__( '%1$s (%2$d)', 'fair-events' ),
					labels[ code ].label,
					data.reasons[ code ] || 0
				),
			} ) ),
	];
	const eventOptions = [
		{ value: '-1', label: __( 'All events', 'fair-events' ) },
		...data.eventDates.map( ( item ) => ( {
			value: String( item.id ),
			label: sprintf(
				/* translators: 1: event and date, 2: number of records */
				__( '%1$s (%2$d)', 'fair-events' ),
				item.id
					? formatEventDate( item.event_date )
					: __( 'No event date', 'fair-events' ),
				item.count
			),
		} ) ),
	];

	return (
		<Card className="fair-events-payment-history__card">
			<CardHeader>
				<h2>{ __( 'Records to review', 'fair-events' ) }</h2>
			</CardHeader>
			<CardBody>
				<p>
					{ __(
						'These are the records the migration couldn’t link automatically, or linked with a note. Nothing is guessed: open a record to link its payment, split a shared one, or mark it as reviewed.',
						'fair-events'
					) }
				</p>
				{ notice && (
					<Notice
						status="success"
						onRemove={ () => setNotice( null ) }
					>
						{ notice }
					</Notice>
				) }
				<div className="fair-events-payment-history__filters">
					<SelectControl
						__nextHasNoMarginBottom
						__next40pxDefaultSize
						label={ __( 'Run', 'fair-events' ) }
						value={ mode }
						options={ [
							{
								value: 'backfill',
								label: __( 'Migration', 'fair-events' ),
							},
							{
								value: 'dry_run',
								label: __(
									'Dry run (preview only)',
									'fair-events'
								),
							},
						] }
						onChange={ filter( setMode ) }
					/>
					<SelectControl
						__nextHasNoMarginBottom
						__next40pxDefaultSize
						label={ __( 'Status', 'fair-events' ) }
						value={ findingStatus }
						options={ [
							{ value: 'open', label: statuses.open },
							{
								value: 'decided',
								label: __(
									'Decided by an administrator',
									'fair-events'
								),
							},
							{ value: 'resolved', label: statuses.resolved },
							{ value: 'all', label: __( 'All', 'fair-events' ) },
						] }
						onChange={ filter( setFindingStatus ) }
					/>
					<SelectControl
						__nextHasNoMarginBottom
						__next40pxDefaultSize
						label={ __( 'Reason', 'fair-events' ) }
						value={ reason }
						options={ reasonOptions }
						onChange={ filter( setReason ) }
					/>
					<SelectControl
						__nextHasNoMarginBottom
						__next40pxDefaultSize
						label={ __( 'Event', 'fair-events' ) }
						value={ eventDate }
						options={ eventOptions }
						onChange={ filter( setEventDate ) }
					/>
					<SelectControl
						__nextHasNoMarginBottom
						__next40pxDefaultSize
						label={ __( 'Payment status', 'fair-events' ) }
						value={ paymentStatus }
						options={ [
							{
								value: '',
								label: __( 'All statuses', 'fair-events' ),
							},
							...paymentStatusOptions(),
						] }
						onChange={ filter( setPaymentStatus ) }
					/>
					<SelectControl
						__nextHasNoMarginBottom
						__next40pxDefaultSize
						label={ __( 'Payment mode', 'fair-events' ) }
						value={ paymentMode }
						options={ [
							{ value: 'all', label: __( 'All', 'fair-events' ) },
							{
								value: 'test',
								label: __( 'Test only', 'fair-events' ),
							},
							{
								value: 'live',
								label: __( 'Live only', 'fair-events' ),
							},
						] }
						onChange={ filter( setPaymentMode ) }
					/>
				</div>

				{ mode === 'dry_run' && (
					<Notice status="info" isDismissible={ false }>
						{ __(
							'Dry run records show what the migration would report. They’re replaced by the next dry run and can’t be reconciled; decide on them once the migration has run.',
							'fair-events'
						) }
					</Notice>
				) }
				{ data.error && (
					<Notice status="error" isDismissible={ false }>
						{ data.error }
					</Notice>
				) }
				{ data.loading && <Spinner /> }
				{ ! data.loading && ! data.error && (
					<p aria-live="polite">
						{ sprintf(
							/* translators: %d: number of records */
							_n(
								'%d record',
								'%d records',
								data.total,
								'fair-events'
							),
							data.total
						) }
					</p>
				) }
				{ ! data.loading &&
					! data.error &&
					data.total === 0 &&
					narrowed && (
						<div className="fair-events-payment-history__empty">
							<p>
								{ __(
									'No records match these filters.',
									'fair-events'
								) }
							</p>
							<Button
								variant="secondary"
								onClick={ clearFilters }
							>
								{ __( 'Clear filters', 'fair-events' ) }
							</Button>
						</div>
					) }

				<ul className="fair-events-payment-history__findings">
					{ data.items.map( ( finding ) => (
						<li key={ finding.id }>
							<div>
								<strong>
									{ reasonLabel( finding.reason ) }
								</strong>
								{ finding.informational && (
									<span className="fair-events-payment-history__badge">
										{ __(
											'For review only',
											'fair-events'
										) }
									</span>
								) }
								<div>
									<SourceDescription
										finding={ finding }
										linkable={
											status.payment_information ===
											'available'
										}
									/>
								</div>
								<div className="fair-events-payment-history__hint">
									{ sprintf(
										/* translators: 1: event and date, 2: status, 3: date and time it was last seen */
										__(
											'%1$s · %2$s · last seen %3$s',
											'fair-events'
										),
										formatEventDate( finding.event_date ),
										statuses[ finding.status ] ??
											finding.status,
										formatUtcDateTime(
											finding.last_seen_at
										)
									) }
								</div>
							</div>
							<Button
								variant={
									finding.status === 'open' &&
									mode === 'backfill'
										? 'primary'
										: 'secondary'
								}
								onClick={ () => setOpenId( finding.id ) }
								aria-label={ sprintf(
									/* translators: 1: reason, 2: what the record is about */
									__( 'Open %1$s — %2$s', 'fair-events' ),
									reasonLabel( finding.reason ),
									describeSource( finding )
								) }
							>
								{ finding.status === 'open' &&
								mode === 'backfill'
									? __( 'Decide', 'fair-events' )
									: __( 'View', 'fair-events' ) }
							</Button>
						</li>
					) ) }
				</ul>

				{ data.totalPages > 1 && (
					<HStack justify="flex-start" spacing={ 3 } wrap>
						<Button
							variant="secondary"
							disabled={ page <= 1 }
							onClick={ () => setPage( page - 1 ) }
						>
							{ __( 'Previous page', 'fair-events' ) }
						</Button>
						<span>
							{ sprintf(
								/* translators: 1: current page number, 2: number of pages */
								__( 'Page %1$d of %2$d', 'fair-events' ),
								page,
								data.totalPages
							) }
						</span>
						<Button
							variant="secondary"
							disabled={ page >= data.totalPages }
							onClick={ () => setPage( page + 1 ) }
						>
							{ __( 'Next page', 'fair-events' ) }
						</Button>
					</HStack>
				) }
			</CardBody>

			{ openId && (
				<FindingModal
					findingId={ openId }
					onClose={ () => setOpenId( null ) }
					onDecided={ ( message ) => {
						if ( message ) {
							setOpenId( null );
							setNotice( message );
						}
						onChanged();
					} }
				/>
			) }
		</Card>
	);
}
