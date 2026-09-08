import { useState, useEffect, useMemo } from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Notice,
	Spinner,
} from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
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

function ChartCard( { title, children } ) {
	return (
		<Card style={ { marginTop: '16px' } }>
			<CardHeader>
				<h3 style={ { margin: 0 } }>{ title }</h3>
			</CardHeader>
			<CardBody>{ children }</CardBody>
		</Card>
	);
}

export default function EventStatistics( { eventDateId } ) {
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
					<Card>
						<CardBody>
							<div
								style={ {
									display: 'flex',
									flexWrap: 'wrap',
									gap: '24px',
									alignItems: 'baseline',
								} }
							>
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

					<ChartCard
						title={ __(
							'Cumulative sales',
							'fair-events-experimental'
						) }
					>
						<ResponsiveContainer width="100%" height={ 280 }>
							<AreaChart
								data={ statistics.series }
								margin={ { left: 8, right: 24 } }
							>
								<CartesianGrid strokeDasharray="3 3" />
								<XAxis
									dataKey="label"
									interval="preserveStartEnd"
									minTickGap={ 48 }
								/>
								<YAxis allowDecimals={ false } />
								<Tooltip />
								<Area
									type="monotone"
									dataKey="total"
									name={ __(
										'Sales',
										'fair-events-experimental'
									) }
									stroke={ BAR_COLOR }
									fill={ BAR_COLOR }
									fillOpacity={ 0.18 }
								/>
							</AreaChart>
						</ResponsiveContainer>
					</ChartCard>
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
