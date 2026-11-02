/**
 * Source View App - Main Component
 *
 * @package FairEvents
 */

import { useState, useEffect, useCallback, useRef } from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Modal,
	Spinner,
	Notice,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { formatLocalDate } from 'fair-events-shared/src/calendarUtils.js';
import {
	CalendarHeader,
	CalendarGrid,
	addMonths,
	startOfMonth,
	formatMonthParam,
	parseMonthParam,
	getVisibleRange,
} from 'fair-events-shared/src/calendar/index.js';
import { getCalendarLabels } from './calendarLabels.js';
import FeedHeader from './FeedHeader.js';
import WeeklySummarySection from './WeeklySummarySection.js';
import IntegrationsSection from './IntegrationsSection.js';
import SourceForm from '../sources/components/SourceForm.js';

const {
	sourceId,
	startOfWeek,
	sourcesListUrl,
	icalUrlTemplate,
	jsonUrlTemplate,
} = window.fairEventsSourceViewData || {};

function currentUrlMonth() {
	const params = new URLSearchParams( window.location.search );
	return (
		parseMonthParam( params.get( 'month' ) ) || startOfMonth( new Date() )
	);
}

// The month URL for a view, preserving unrelated query parameters.
function monthUrl( month ) {
	const params = new URLSearchParams( window.location.search );
	params.set( 'month', formatMonthParam( month ) );
	return `${ window.location.pathname }?${ params.toString() }`;
}

export default function SourceViewApp() {
	const [ source, setSource ] = useState( null );
	const [ currentDate, setCurrentDate ] = useState( currentUrlMonth );
	const [ eventsState, setEventsState ] = useState( {
		status: 'loading',
		events: [],
		error: null,
	} );
	const [ refreshKey, setRefreshKey ] = useState( 0 );
	const latestRequest = useRef( 0 );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	const [ isEditOpen, setIsEditOpen ] = useState( false );

	const monthKey = formatMonthParam( currentDate );
	const sourceSlug = source?.slug;

	const fetchSource = useCallback( async () => {
		try {
			const data = await apiFetch( {
				path: `/fair-events/v1/sources/${ sourceId }`,
			} );
			setSource( data );
		} catch ( err ) {
			setError(
				err.message ||
					__(
						'Failed to load event feed.',
						'fair-events-experimental'
					)
			);
		} finally {
			setLoading( false );
		}
	}, [] );

	// Fetch source details on mount.
	useEffect( () => {
		if ( ! sourceId ) {
			setError(
				__( 'No event feed ID provided.', 'fair-events-experimental' )
			);
			setLoading( false );
			return;
		}

		fetchSource();
	}, [ fetchSource ] );

	// Normalize the initial URL (missing or malformed month) in place.
	useEffect( () => {
		window.history.replaceState(
			window.history.state,
			'',
			monthUrl( currentUrlMonth() )
		);
	}, [] );

	// Browser back/forward restores the month without a new entry.
	useEffect( () => {
		const handlePopState = () => {
			const restored = currentUrlMonth();
			window.history.replaceState(
				window.history.state,
				'',
				monthUrl( restored )
			);
			setCurrentDate( restored );
		};
		window.addEventListener( 'popstate', handlePopState );
		return () => window.removeEventListener( 'popstate', handlePopState );
	}, [] );

	useEffect( () => {
		if ( ! sourceSlug ) {
			return;
		}

		// Every run supersedes earlier requests, so a late response can't
		// overwrite the current month.
		const requestId = ++latestRequest.current;
		setEventsState( { status: 'loading', events: [], error: null } );

		const { startDate, endDate } = getVisibleRange(
			currentDate,
			startOfWeek ?? 1
		);
		const params = new URLSearchParams( {
			start_date: formatLocalDate( startDate ),
			end_date: formatLocalDate( endDate ),
		} );

		apiFetch( {
			path: `/fair-events/v1/sources/${ sourceSlug }/json?${ params.toString() }`,
		} )
			.then( ( response ) => {
				if ( requestId === latestRequest.current ) {
					setEventsState( {
						status: 'success',
						events: response.events || [],
						error: null,
					} );
				}
			} )
			.catch( ( err ) => {
				if ( requestId === latestRequest.current ) {
					setEventsState( {
						status: 'error',
						events: [],
						error:
							err.message ||
							__(
								'Failed to load events.',
								'fair-events-experimental'
							),
					} );
				}
			} );
		// currentDate is represented by monthKey.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ sourceSlug, monthKey, refreshKey ] );

	const navigate = ( month ) => {
		if ( formatMonthParam( month ) === monthKey ) {
			return;
		}
		window.history.pushState( null, '', monthUrl( month ) );
		setCurrentDate( month );
	};

	const handlePrevMonth = () => {
		navigate( addMonths( currentDate, -1 ) );
	};

	const handleNextMonth = () => {
		navigate( addMonths( currentDate, 1 ) );
	};

	const handleToday = () => {
		navigate( startOfMonth( new Date() ) );
	};

	const getIcalUrl = ( slug ) => {
		const template =
			icalUrlTemplate || '/wp-json/fair-events/v1/sources/{slug}/ical';
		return template.replace( '{slug}', slug );
	};

	const getJsonUrl = ( slug ) => {
		const template =
			jsonUrlTemplate || '/wp-json/fair-events/v1/sources/{slug}/json';
		return template.replace( '{slug}', slug );
	};

	const handleEditSuccess = () => {
		setIsEditOpen( false );
		fetchSource();
		setRefreshKey( ( key ) => key + 1 );
	};

	const calendarLabels = getCalendarLabels();

	if ( loading ) {
		return (
			<div className="wrap">
				<Spinner />
			</div>
		);
	}

	if ( error ) {
		return (
			<div className="wrap">
				<p>
					<a href={ sourcesListUrl }>
						&larr;{ ' ' }
						{ __(
							'Back to Event Feeds',
							'fair-events-experimental'
						) }
					</a>
				</p>
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			</div>
		);
	}

	return (
		<div className="wrap fair-events-calendar-wrap fair-events-feed-view">
			<p>
				<a href={ sourcesListUrl }>
					&larr;{ ' ' }
					{ __( 'Back to Event Feeds', 'fair-events-experimental' ) }
				</a>
			</p>

			<FeedHeader
				source={ source }
				onEdit={ () => setIsEditOpen( true ) }
			/>

			<WeeklySummarySection source={ source } />

			<IntegrationsSection
				source={ source }
				icalUrl={ getIcalUrl( source.slug ) }
				jsonUrl={ getJsonUrl( source.slug ) }
			/>

			{ eventsState.error && (
				<Notice status="error" isDismissible={ false }>
					{ eventsState.error }
				</Notice>
			) }

			<Card className="fair-events-feed-calendar">
				<CardHeader>
					<CalendarHeader
						currentDate={ currentDate }
						onPrevMonth={ handlePrevMonth }
						onNextMonth={ handleNextMonth }
						onToday={ handleToday }
						labels={ calendarLabels }
					/>
				</CardHeader>
				<CardBody className="fair-events-calendar-card-body">
					{ eventsState.status === 'loading' ? (
						<div className="fair-events-calendar-loading">
							<Spinner />
						</div>
					) : (
						<CalendarGrid
							currentDate={ currentDate }
							events={ eventsState.events }
							startOfWeek={ startOfWeek ?? 1 }
							showEmptyMessage={
								eventsState.status === 'success'
							}
							labels={ calendarLabels }
						/>
					) }
				</CardBody>
			</Card>

			{ isEditOpen && (
				<Modal
					title={ __(
						'Edit Event Feed',
						'fair-events-experimental'
					) }
					onRequestClose={ () => setIsEditOpen( false ) }
					style={ { maxWidth: '800px', width: '100%' } }
				>
					<SourceForm
						source={ source }
						onSuccess={ handleEditSuccess }
						onCancel={ () => setIsEditOpen( false ) }
					/>
				</Modal>
			) }
		</div>
	);
}
