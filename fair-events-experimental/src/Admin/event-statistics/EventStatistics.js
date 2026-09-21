import {
	useState,
	useEffect,
	useMemo,
	useRef,
	useId,
} from '@wordpress/element';
import {
	Button,
	Card,
	CardHeader,
	CardBody,
	Notice,
	Spinner,
} from '@wordpress/components';
import { download } from '@wordpress/icons';
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { getEventDisplayTitle } from 'fair-events-shared';
import {
	EXPORT_IGNORE_ATTRIBUTE,
	buildChartFilename,
	downloadElementAsPng,
} from './exportChartImage.js';
import './style.css';
import {
	ResponsiveContainer,
	BarChart,
	Bar,
	AreaChart,
	Area,
	XAxis,
	YAxis,
	Tooltip,
	CartesianGrid,
	ReferenceLine,
} from 'recharts';

const BAR_COLOR = '#3858e9'; // WordPress admin blue.

// People per activity: one row per distinct ticket option, counting how many
// confirmed participants picked it. ticket_option_ids / ticket_option_names are
// parallel arrays on each participant row. Sorted by count descending.
export function peoplePerActivity( participants ) {
	const counts = new Map();
	participants.forEach( ( p ) => {
		const ids = Array.isArray( p.ticket_option_ids )
			? p.ticket_option_ids
			: [];
		const names = Array.isArray( p.ticket_option_names )
			? p.ticket_option_names
			: [];
		ids.forEach( ( id, i ) => {
			const name = names[ i ] || `#${ id }`;
			counts.set( name, ( counts.get( name ) || 0 ) + 1 );
		} );
	} );
	return Array.from( counts.entries() )
		.map( ( [ name, count ] ) => ( { name, count } ) )
		.sort( ( a, b ) => b.count - a.count );
}

// Activities-per-person histogram: how many people picked 0 activities, 1, 2, …
// The range is filled continuously from the smallest to the largest observed
// count so the histogram has no gaps.
export function activityCountDistribution( participants ) {
	const buckets = new Map();
	participants.forEach( ( p ) => {
		const n = Array.isArray( p.ticket_option_ids )
			? p.ticket_option_ids.length
			: 0;
		buckets.set( n, ( buckets.get( n ) || 0 ) + 1 );
	} );
	if ( ! buckets.size ) return [];
	const keys = Array.from( buckets.keys() );
	const min = Math.min( ...keys );
	const max = Math.max( ...keys );
	const result = [];
	for ( let i = min; i <= max; i++ ) {
		result.push( { activities: i, people: buckets.get( i ) || 0 } );
	}
	return result;
}

// A chart card. Passing `onDownload` adds the "Download PNG" action and the
// event-name subtitle, so the exported image stays self-explanatory outside the
// admin screen.
function ChartCard( {
	title,
	eventName,
	onDownload,
	isDownloadDisabled,
	isDownloading,
	children,
} ) {
	const cardRef = useRef( null );
	const headingId = useId();
	return (
		<Card ref={ cardRef } className="fair-event-statistics__chart-card">
			<CardHeader className="fair-event-statistics__chart-header">
				<div className="fair-event-statistics__chart-heading">
					<h3 id={ headingId } style={ { margin: 0 } }>
						{ title }
					</h3>
					{ onDownload && eventName && (
						<p className="fair-event-statistics__chart-subtitle">
							{ eventName }
						</p>
					) }
				</div>
				{ onDownload && (
					<Button
						{ ...{ [ EXPORT_IGNORE_ATTRIBUTE ]: 'true' } }
						className="fair-event-statistics__download"
						variant="secondary"
						size="compact"
						icon={ download }
						isBusy={ isDownloading }
						accessibleWhenDisabled
						disabled={ isDownloadDisabled }
						aria-describedby={ headingId }
						onClick={ () => onDownload( cardRef.current ) }
					>
						{ __( 'Download PNG', 'fair-events-experimental' ) }
					</Button>
				) }
			</CardHeader>
			<CardBody>{ children }</CardBody>
		</Card>
	);
}

function getFutureHorizon( series, dataKey ) {
	if ( ! Array.isArray( series ) || series.length < 2 ) return null;
	let recordedIndex = series.length - 1;
	while (
		recordedIndex >= 0 &&
		typeof series[ recordedIndex ][ dataKey ] !== 'number'
	) {
		recordedIndex--;
	}
	if ( recordedIndex < 0 || recordedIndex === series.length - 1 ) return null;
	return [
		{
			x: series[ recordedIndex ].label,
			y: series[ recordedIndex ][ dataKey ],
		},
		{
			x: series.at( -1 ).label,
			y: series[ recordedIndex ][ dataKey ],
		},
	];
}

function CumulativeChart( { series, dataKey, name, valueFormatter } ) {
	const futureHorizon = getFutureHorizon( series, dataKey );
	return (
		<ResponsiveContainer width="100%" height={ 280 }>
			<AreaChart data={ series } margin={ { left: 8, right: 24 } }>
				<CartesianGrid strokeDasharray="3 3" />
				<XAxis
					dataKey="label"
					interval="preserveStartEnd"
					minTickGap={ 48 }
				/>
				<YAxis
					allowDecimals={ dataKey !== 'total' }
					tickFormatter={ valueFormatter }
				/>
				<Tooltip formatter={ valueFormatter } filterNull />
				<Area
					type="monotone"
					dataKey={ dataKey }
					name={ name }
					stroke={ BAR_COLOR }
					fill={ BAR_COLOR }
					fillOpacity={ 0.18 }
					connectNulls={ false }
				/>
				{ futureHorizon && (
					<ReferenceLine
						segment={ futureHorizon }
						stroke={ BAR_COLOR }
						strokeDasharray="5 5"
					/>
				) }
			</AreaChart>
		</ResponsiveContainer>
	);
}

export default function EventStatistics( { eventDateId, eventTitle } ) {
	const [ exportingChart, setExportingChart ] = useState( null );
	const [ exportError, setExportError ] = useState( '' );
	// Guards against a second activation landing before the busy state renders.
	const exportInFlight = useRef( false );
	const [ participants, setParticipants ] = useState( [] );
	const [ participantLoading, setParticipantLoading ] = useState( true );
	const [ statistics, setStatistics ] = useState( null );
	const [ statisticsLoading, setStatisticsLoading ] = useState( true );
	const [ statisticsError, setStatisticsError ] = useState( '' );

	useEffect( () => {
		if ( ! eventDateId ) {
			setParticipantLoading( false );
			setStatisticsLoading( false );
			return;
		}
		setParticipantLoading( true );
		setStatisticsLoading( true );
		setStatisticsError( '' );
		apiFetch( {
			path: `/fair-audience/v1/event-dates/${ eventDateId }/participants`,
		} )
			.then( ( participantData ) => {
				setParticipants(
					Array.isArray( participantData ) ? participantData : []
				);
			} )
			.catch( () => setParticipants( [] ) )
			.finally( () => setParticipantLoading( false ) );

		apiFetch( {
			path: `/fair-audience/v1/event-dates/${ eventDateId }/statistics`,
		} )
			.then( setStatistics )
			.catch( ( error ) =>
				setStatisticsError(
					error?.message ||
						__(
							'Event sales statistics could not be loaded.',
							'fair-events-experimental'
						)
				)
			)
			.finally( () => setStatisticsLoading( false ) );
	}, [ eventDateId ] );

	const confirmed = useMemo(
		() => participants.filter( ( p ) => p.label === 'signed_up' ),
		[ participants ]
	);
	const excludedCount = participants.length - confirmed.length;

	const activityData = useMemo(
		() => peoplePerActivity( confirmed ),
		[ confirmed ]
	);
	const distributionData = useMemo(
		() => activityCountDistribution( confirmed ),
		[ confirmed ]
	);
	const currencyFormatter = useMemo(
		() =>
			new Intl.NumberFormat( undefined, {
				style: 'currency',
				currency: statistics?.currency || 'EUR',
			} ),
		[ statistics?.currency ]
	);
	const formatCurrency = ( value ) => currencyFormatter.format( value );

	// Prefer the live Manage Event title; the standalone Statistics page has
	// only the value the API returned.
	const eventName = getEventDisplayTitle(
		eventTitle?.trim() || statistics?.event_name
	);
	const salesChartTitle = __(
		'Cumulative sales',
		'fair-events-experimental'
	);
	const salesAmountChartTitle = __(
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
				buildChartFilename( eventName, chartTitle )
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

	if ( participantLoading && statisticsLoading ) {
		return (
			<div style={ { padding: '24px', textAlign: 'center' } }>
				<Spinner />
			</div>
		);
	}

	return (
		<div>
			{ statisticsLoading && <Spinner /> }
			{ statisticsError && (
				<Notice status="error" isDismissible={ false }>
					{ statisticsError }
				</Notice>
			) }
			{ statistics && (
				<>
					{ statistics.excluded_currencies?.length > 0 && (
						<Notice status="warning" isDismissible={ false }>
							{ sprintf(
								/* translators: %s: comma-separated currency codes excluded from event revenue. */
								__(
									'Some payments were excluded because they use different currencies: %s.',
									'fair-events-experimental'
								),
								statistics.excluded_currencies.join( ', ' )
							) }
						</Notice>
					) }
					<Card>
						<CardBody>
							<div className="fair-event-statistics__summary">
								<strong style={ { fontSize: '24px' } }>
									{ sprintf(
										/* translators: %d: confirmed sales total. */
										_n(
											'%d sale',
											'%d sales',
											statistics.total_sales,
											'fair-events-experimental'
										),
										statistics.total_sales
									) }
								</strong>
								<strong style={ { fontSize: '24px' } }>
									{ formatCurrency(
										statistics.total_sales_amount
									) }
								</strong>
								{ statistics.days_until_start !== null && (
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
							</div>
						</CardBody>
					</Card>

					{ exportError && (
						<Notice
							status="error"
							onRemove={ () => setExportError( '' ) }
						>
							{ exportError }
						</Notice>
					) }
					<div className="fair-event-statistics__sales-charts">
						<ChartCard
							title={ salesChartTitle }
							eventName={ eventName }
							onDownload={ ( card ) =>
								downloadChart( salesChartTitle, card )
							}
							isDownloadDisabled={ exportingChart !== null }
							isDownloading={ exportingChart === salesChartTitle }
						>
							<CumulativeChart
								series={ statistics.series }
								dataKey="total"
								name={ __(
									'Sales',
									'fair-events-experimental'
								) }
							/>
						</ChartCard>
						<ChartCard
							title={ salesAmountChartTitle }
							eventName={ eventName }
							onDownload={ ( card ) =>
								downloadChart( salesAmountChartTitle, card )
							}
							isDownloadDisabled={ exportingChart !== null }
							isDownloading={
								exportingChart === salesAmountChartTitle
							}
						>
							<CumulativeChart
								series={ statistics.amount_series }
								dataKey="amount"
								name={ __(
									'Net sales amount',
									'fair-events-experimental'
								) }
								valueFormatter={ formatCurrency }
							/>
						</ChartCard>
					</div>
				</>
			) }

			{ participantLoading && <Spinner /> }
			<Notice status="info" isDismissible={ false }>
				{ sprintf(
					/* translators: %d: number of excluded participant rows. */
					__(
						'Confirmed participants only (signed up). %d excluded (pending payment, interested, collaborators).',
						'fair-events-experimental'
					),
					excludedCount
				) }
			</Notice>

			<ChartCard
				title={ __(
					'People per activity',
					'fair-events-experimental'
				) }
			>
				{ activityData.length === 0 ? (
					<p>
						{ __(
							'No activities recorded for confirmed participants.',
							'fair-events-experimental'
						) }
					</p>
				) : (
					<ResponsiveContainer
						width="100%"
						height={ Math.max( 120, activityData.length * 44 ) }
					>
						<BarChart
							data={ activityData }
							layout="vertical"
							margin={ { left: 24, right: 24 } }
						>
							<CartesianGrid strokeDasharray="3 3" />
							<XAxis type="number" allowDecimals={ false } />
							<YAxis
								type="category"
								dataKey="name"
								width={ 160 }
							/>
							<Tooltip />
							<Bar
								dataKey="count"
								name={ __(
									'People',
									'fair-events-experimental'
								) }
								fill={ BAR_COLOR }
							/>
						</BarChart>
					</ResponsiveContainer>
				) }
			</ChartCard>

			<ChartCard
				title={ __(
					'Activities per person',
					'fair-events-experimental'
				) }
			>
				<ResponsiveContainer width="100%" height={ 280 }>
					<BarChart
						data={ distributionData }
						margin={ { left: 8, right: 24 } }
					>
						<CartesianGrid strokeDasharray="3 3" />
						<XAxis
							dataKey="activities"
							allowDecimals={ false }
							label={ {
								value: __(
									'Activities',
									'fair-events-experimental'
								),
								position: 'insideBottom',
								offset: -4,
							} }
						/>
						<YAxis allowDecimals={ false } />
						<Tooltip />
						<Bar
							dataKey="people"
							name={ __( 'People', 'fair-events-experimental' ) }
							fill={ BAR_COLOR }
						/>
					</BarChart>
				</ResponsiveContainer>
			</ChartCard>
		</div>
	);
}
