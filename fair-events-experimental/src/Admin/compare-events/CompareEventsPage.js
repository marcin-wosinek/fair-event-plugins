/**
 * Compare events page
 *
 * Overlays the cumulative sales of two event occurrences. Each occurrence's
 * figures come from Fair Events' Statistics endpoint, so the charts match the
 * individual Statistics tabs. Both selections live in the URL.
 *
 * @package FairEventsExperimental
 */

import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { Button, Card, CardBody, Notice, Spinner } from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';
import { downloadElementAsPng } from 'fair-events/src/Admin/event-statistics/exportChartImage.js';
import ComparisonChart, { SERIES_COLORS } from './ComparisonChart.js';
import EventSelector, { getEventListPath } from './EventSelector.js';
import {
	SLOTS,
	alignSeries,
	buildComparisonFilename,
	getEventLabel,
	readSelection,
	writeSelection,
} from './comparison.js';
import useRequest from './useRequest.js';
import './compare-events.css';

function getSlotLabels() {
	return {
		current: __( 'Current event', 'fair-events-experimental' ),
		comparison: __( 'Comparison event', 'fair-events-experimental' ),
	};
}

function isNotFound( error ) {
	return (
		error?.data?.status === 404 ||
		error?.code === 'rest_event_date_not_found'
	);
}

/**
 * Resolve one selection to its occurrence and Statistics.
 *
 * @param {{id: number|null, invalid: boolean}} selection Parsed URL selection.
 * @return {Object} `state` is `empty`, `invalid`, `loading`, `missing`,
 *                  `cancelled`, `error`, or `ready`.
 */
function useSelectedEvent( selection ) {
	const { id, invalid } = selection;
	const lookup = useRequest(
		id ? `/fair-events/v1/event-dates/${ id }` : null
	);
	const event = lookup.status === 'ready' ? lookup.data : null;
	const isCancelled = event?.status === 'cancelled';
	const statistics = useRequest(
		event && ! isCancelled
			? `/fair-events/v1/event-dates/${ id }/statistics`
			: null
	);

	let state = 'ready';
	let retry = null;
	let error = null;
	if ( invalid ) {
		state = 'invalid';
	} else if ( ! id ) {
		state = 'empty';
	} else if ( lookup.status === 'error' ) {
		state = isNotFound( lookup.error ) ? 'missing' : 'error';
		error = lookup.error;
		retry = lookup.retry;
	} else if ( isCancelled ) {
		state = 'cancelled';
	} else if ( statistics.status === 'error' ) {
		state = 'error';
		error = statistics.error;
		retry = statistics.retry;
	} else if ( statistics.status !== 'ready' ) {
		state = 'loading';
	}

	return {
		id,
		state,
		event,
		statistics: state === 'ready' ? statistics.data : null,
		error,
		retry,
	};
}

// Why a selection restored from the URL cannot be compared.
function SelectionNotice( { slot, selected } ) {
	const slotLabel = getSlotLabels()[ slot ];
	let message = '';
	if ( selected.state === 'invalid' ) {
		message = sprintf(
			/* translators: %s: which selection, "Current event" or "Comparison event". */
			__(
				'%s: this link does not point to a valid event. Choose an event from the list.',
				'fair-events-experimental'
			),
			slotLabel
		);
	} else if ( selected.state === 'missing' ) {
		message = sprintf(
			/* translators: %s: which selection, "Current event" or "Comparison event". */
			__(
				'%s: the event in this link no longer exists. Choose another event.',
				'fair-events-experimental'
			),
			slotLabel
		);
	} else if ( selected.state === 'cancelled' ) {
		message = sprintf(
			/* translators: 1: which selection, "Current event" or "Comparison event". 2: event name and date. */
			__(
				'%1$s: %2$s was cancelled, so it cannot be compared. Choose another event.',
				'fair-events-experimental'
			),
			slotLabel,
			getEventLabel( selected.event )
		);
	} else if ( selected.state === 'error' ) {
		message = sprintf(
			/* translators: 1: which selection, "Current event" or "Comparison event". 2: error message. */
			__( '%1$s: %2$s', 'fair-events-experimental' ),
			slotLabel,
			selected.error?.message ||
				__(
					'Event sales statistics could not be loaded.',
					'fair-events-experimental'
				)
		);
	}
	if ( ! message ) {
		return null;
	}
	return (
		<Notice
			status={ selected.state === 'error' ? 'error' : 'warning' }
			isDismissible={ false }
			actions={
				selected.state === 'error' && selected.retry
					? [
							{
								label: __(
									'Try again',
									'fair-events-experimental'
								),
								onClick: selected.retry,
							},
					  ]
					: []
			}
		>
			{ message }
		</Notice>
	);
}

// Warnings the individual Statistics tab shows, named per event.
function StatisticsWarnings( { label, statistics } ) {
	const backfills = statistics.incomplete_ticket_backfills || 0;
	return (
		<>
			{ statistics.excluded_currencies?.length > 0 && (
				<Notice status="warning" isDismissible={ false }>
					{ sprintf(
						/* translators: 1: event name and date. 2: comma-separated currency codes excluded from event revenue. */
						__(
							'%1$s: some payments were excluded because they use different currencies: %2$s.',
							'fair-events-experimental'
						),
						label,
						statistics.excluded_currencies.join( ', ' )
					) }
				</Notice>
			) }
			{ backfills > 0 && (
				<Notice status="warning" isDismissible={ false }>
					{ sprintf(
						/* translators: 1: event name and date. 2: number of purchases with missing ticket records. */
						_n(
							'%1$s: %2$d purchase has fewer ticket records than tickets bought. Its missing tickets are not counted until their records are created.',
							'%1$s: %2$d purchases have fewer ticket records than tickets bought. Their missing tickets are not counted until their records are created.',
							backfills,
							'fair-events-experimental'
						),
						label,
						backfills
					) }
				</Notice>
			) }
		</>
	);
}

function getTotalTickets( statistics ) {
	return statistics.total_tickets ?? statistics.total_sales ?? 0;
}

// One event's totals, as its own Statistics tab reports them.
function EventSummary( { slot, selected, label, formatCurrency } ) {
	const { statistics } = selected;
	const totalTickets = getTotalTickets( statistics );
	const { manageEventUrl } = window.fairEventsCompareEventsData || {};
	const hasSales = totalTickets > 0 || statistics.total_sales_amount !== 0;
	return (
		<Card className="fair-compare-events__summary-card">
			<CardBody>
				<p className="fair-compare-events__summary-role">
					<span
						className="fair-compare-events__swatch"
						style={ { borderTopColor: SERIES_COLORS[ slot ] } }
						aria-hidden="true"
					/>
					{ getSlotLabels()[ slot ] }
				</p>
				<p className="fair-compare-events__summary-name">
					<strong>{ label }</strong>
				</p>
				<p className="fair-compare-events__summary-figures">
					<strong>
						{ sprintf(
							/* translators: %d: number of confirmed tickets. */
							_n(
								'%d ticket',
								'%d tickets',
								totalTickets,
								'fair-events-experimental'
							),
							totalTickets
						) }
					</strong>
					<strong>
						{ formatCurrency( statistics.total_sales_amount ) }
					</strong>
					{ statistics.days_until_start !== null &&
						statistics.days_until_start !== undefined && (
							<span>
								{ sprintf(
									/* translators: %d: calendar days until the event. */
									_n(
										'%d day until the event',
										'%d days until the event',
										statistics.days_until_start,
										'fair-events-experimental'
									),
									statistics.days_until_start
								) }
							</span>
						) }
				</p>
				{ ! hasSales && (
					<p className="fair-compare-events__summary-empty">
						{ __(
							'No sales recorded for this event yet.',
							'fair-events-experimental'
						) }
					</p>
				) }
				{ manageEventUrl && (
					<p className="fair-compare-events__summary-link">
						<a
							href={ `${ manageEventUrl }&event_date_id=${ selected.id }&tab=statistics` }
						>
							{ __(
								'Open event statistics',
								'fair-events-experimental'
							) }
						</a>
					</p>
				) }
			</CardBody>
		</Card>
	);
}

function Comparison( { selected } ) {
	const [ exportingChart, setExportingChart ] = useState( null );
	const [ exportError, setExportError ] = useState( '' );
	// Guards against a second activation landing before the busy state renders.
	const exportInFlight = useRef( false );

	const statistics = useMemo(
		() => ( {
			current: selected.current.statistics,
			comparison: selected.comparison.statistics,
		} ),
		[ selected.current.statistics, selected.comparison.statistics ]
	);
	const events = {
		current: selected.current.event,
		comparison: selected.comparison.event,
	};
	const labels = {
		current: getEventLabel( events.current ),
		comparison: getEventLabel( events.comparison ),
	};

	const ticketRows = useMemo(
		() => alignSeries( statistics, 'series', 'total' ),
		[ statistics ]
	);
	const amountRows = useMemo(
		() => alignSeries( statistics, 'amount_series', 'amount' ),
		[ statistics ]
	);

	// Statistics reports every event in the site currency.
	const currency = statistics.current.currency || 'EUR';
	const currencyFormatter = useMemo(
		() =>
			new Intl.NumberFormat( undefined, {
				style: 'currency',
				currency,
			} ),
		[ currency ]
	);
	const formatCurrency = ( value ) => currencyFormatter.format( value );

	const ticketsTitle = __(
		'Cumulative tickets sold',
		'fair-events-experimental'
	);
	const amountTitle = __(
		'Cumulative sales amount',
		'fair-events-experimental'
	);

	const downloadChart = async ( chartTitle, cardElement ) => {
		if ( exportInFlight.current || ! cardElement ) {
			return;
		}
		exportInFlight.current = true;
		setExportingChart( chartTitle );
		setExportError( '' );
		try {
			await downloadElementAsPng(
				cardElement,
				buildComparisonFilename( events, statistics, chartTitle )
			);
		} catch ( error ) {
			setExportError(
				__(
					'The chart image could not be downloaded. Please try again.',
					'fair-events-experimental'
				)
			);
		} finally {
			exportInFlight.current = false;
			setExportingChart( null );
		}
	};

	return (
		<>
			{ SLOTS.map( ( slot ) => (
				<StatisticsWarnings
					key={ slot }
					label={ labels[ slot ] }
					statistics={ statistics[ slot ] }
				/>
			) ) }
			<div className="fair-compare-events__summary">
				{ SLOTS.map( ( slot ) => (
					<EventSummary
						key={ slot }
						slot={ slot }
						selected={ selected[ slot ] }
						label={ labels[ slot ] }
						formatCurrency={ formatCurrency }
					/>
				) ) }
			</div>
			{ exportError && (
				<Notice status="error" onRemove={ () => setExportError( '' ) }>
					{ exportError }
				</Notice>
			) }
			<div className="fair-compare-events__charts">
				<ComparisonChart
					title={ ticketsTitle }
					rows={ ticketRows }
					labels={ labels }
					allowDecimals={ false }
					onDownload={ ( card ) =>
						downloadChart( ticketsTitle, card )
					}
					isDownloadDisabled={ exportingChart !== null }
					isDownloading={ exportingChart === ticketsTitle }
				/>
				<ComparisonChart
					title={ amountTitle }
					rows={ amountRows }
					labels={ labels }
					allowDecimals
					valueFormatter={ formatCurrency }
					onDownload={ ( card ) =>
						downloadChart( amountTitle, card )
					}
					isDownloadDisabled={ exportingChart !== null }
					isDownloading={ exportingChart === amountTitle }
				/>
			</div>
			<Notice status="info" isDismissible={ false }>
				{ __(
					'Each event is lined up by the days before and during its own start. Counts confirmed tickets only: pending, failed, expired, cancelled, and refunded tickets are not included.',
					'fair-events-experimental'
				) }
			</Notice>
		</>
	);
}

// What to show below the selectors when there is nothing to compare yet.
function getPrompt( selected ) {
	const isEmpty = ( slot ) => selected[ slot ].state === 'empty';
	if ( isEmpty( 'current' ) && isEmpty( 'comparison' ) ) {
		return __(
			'Choose a current event and a comparison event to compare their sales.',
			'fair-events-experimental'
		);
	}
	if ( isEmpty( 'current' ) ) {
		return __(
			'Choose a current event to compare with the comparison event.',
			'fair-events-experimental'
		);
	}
	if ( isEmpty( 'comparison' ) ) {
		return __(
			'Choose a comparison event to compare with the current event.',
			'fair-events-experimental'
		);
	}
	return '';
}

export default function CompareEventsPage( { statisticsAvailable } ) {
	const [ selection, setSelection ] = useState( () =>
		readSelection( window.location.search )
	);

	// Follow the browser's back and forward buttons.
	useEffect( () => {
		const onPopState = () =>
			setSelection( readSelection( window.location.search ) );
		window.addEventListener( 'popstate', onPopState );
		return () => window.removeEventListener( 'popstate', onPopState );
	}, [] );

	const changeSelection = useCallback( ( slot, id ) => {
		const search = writeSelection( window.location.search, slot, id );
		window.history.pushState(
			null,
			'',
			`${ window.location.pathname }${ search }`
		);
		setSelection( readSelection( search ) );
	}, [] );

	const latestEvents = useRequest(
		statisticsAvailable ? getEventListPath() : null
	);
	const disabledSelection = { id: null, invalid: false };
	const selected = {
		current: useSelectedEvent(
			statisticsAvailable ? selection.current : disabledSelection
		),
		comparison: useSelectedEvent(
			statisticsAvailable ? selection.comparison : disabledSelection
		),
	};

	const title = (
		<h1>{ __( 'Compare events', 'fair-events-experimental' ) }</h1>
	);

	if ( ! statisticsAvailable ) {
		return (
			<div className="wrap fair-compare-events">
				{ title }
				<Notice status="warning" isDismissible={ false }>
					{ __(
						'Comparing events needs the Fair Audience plugin, which records tickets and payments. Activate Fair Audience to compare event sales.',
						'fair-events-experimental'
					) }
				</Notice>
			</div>
		);
	}

	const slotLabels = getSlotLabels();
	const prompt = getPrompt( selected );
	const isSameEvent =
		selected.current.id !== null &&
		selected.current.id === selected.comparison.id;
	const isLoading = SLOTS.some(
		( slot ) => selected[ slot ].state === 'loading'
	);
	const isReady = SLOTS.every(
		( slot ) => selected[ slot ].state === 'ready'
	);

	let content = null;
	if ( prompt ) {
		content = (
			<Notice status="info" isDismissible={ false }>
				{ prompt }
			</Notice>
		);
	} else if ( isSameEvent ) {
		content = (
			<Notice status="warning" isDismissible={ false }>
				{ __(
					'Both selections are the same event. Choose a different comparison event.',
					'fair-events-experimental'
				) }
			</Notice>
		);
	} else if ( isReady ) {
		content = <Comparison selected={ selected } />;
	} else if ( isLoading ) {
		content = (
			<div className="fair-compare-events__loading">
				<Spinner />
				<span>
					{ __( 'Loading event sales…', 'fair-events-experimental' ) }
				</span>
			</div>
		);
	}

	return (
		<div className="wrap fair-compare-events">
			{ title }
			<p className="fair-compare-events__intro">
				{ __(
					'See how ticket sales of two events progressed in the days before each one.',
					'fair-events-experimental'
				) }
			</p>
			{ latestEvents.status === 'error' && (
				<Notice
					status="error"
					isDismissible={ false }
					actions={ [
						{
							label: __(
								'Try again',
								'fair-events-experimental'
							),
							onClick: latestEvents.retry,
						},
					] }
				>
					{ latestEvents.error?.message ||
						__(
							'The list of events could not be loaded.',
							'fair-events-experimental'
						) }
				</Notice>
			) }
			<div className="fair-compare-events__selectors">
				{ SLOTS.map( ( slot ) => (
					<EventSelector
						key={ slot }
						label={ slotLabels[ slot ] }
						value={ selected[ slot ].id }
						selectedEvent={ selected[ slot ].event }
						latestEvents={ latestEvents }
						onChange={ ( id ) => changeSelection( slot, id ) }
					/>
				) ) }
			</div>
			{ SLOTS.map( ( slot ) => (
				<SelectionNotice
					key={ slot }
					slot={ slot }
					selected={ selected[ slot ] }
				/>
			) ) }
			{ content }
		</div>
	);
}
