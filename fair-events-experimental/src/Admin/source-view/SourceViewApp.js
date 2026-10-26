/**
 * Source View App - Main Component
 *
 * @package FairEvents
 */

import { useState, useEffect, useCallback, useRef } from '@wordpress/element';
import {
	Button,
	Card,
	CardHeader,
	CardBody,
	Modal,
	Spinner,
	Notice,
	__experimentalHStack as HStack,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';
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
import CopyUrlButton from '../components/CopyUrlButton.js';
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
	const [ linkCopyFailed, setLinkCopyFailed ] = useState( false );

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
		<div className="wrap fair-events-calendar-wrap">
			<p>
				<a href={ sourcesListUrl }>
					&larr;{ ' ' }
					{ __( 'Back to Event Feeds', 'fair-events-experimental' ) }
				</a>
			</p>

			<h1>
				{ sprintf(
					/* translators: %s: event feed name */
					__( 'Event feed: %s', 'fair-events-experimental' ),
					source.name
				) }
			</h1>

			<div
				className="fair-events-source-info"
				style={ {
					background: '#fff',
					border: '1px solid #c3c4c7',
					padding: '16px',
					marginBottom: '20px',
				} }
			>
				<HStack spacing={ 6 } wrap>
					<VStack spacing={ 1 }>
						<strong>
							{ __( 'Slug', 'fair-events-experimental' ) }
						</strong>
						<code>{ source.slug }</code>
					</VStack>
					<VStack spacing={ 1 }>
						<strong>
							{ __( 'Status', 'fair-events-experimental' ) }
						</strong>
						<span>
							{ source.enabled
								? __( 'Enabled', 'fair-events-experimental' )
								: __( 'Disabled', 'fair-events-experimental' ) }
						</span>
					</VStack>
					<VStack spacing={ 1 }>
						<strong>
							{ __( 'Feed inputs', 'fair-events-experimental' ) }
						</strong>
						<span>
							{ sprintf(
								/* translators: %d: number of feed inputs */
								_n(
									'%d feed input',
									'%d feed inputs',
									source.data_sources?.length || 0,
									'fair-events-experimental'
								),
								source.data_sources?.length || 0
							) }
						</span>
					</VStack>
					{ source.page_url && (
						<VStack spacing={ 1 }>
							<strong>
								{ __( 'Page', 'fair-events-experimental' ) }
							</strong>
							<a
								href={ source.page_url }
								target="_blank"
								rel="noopener noreferrer"
							>
								{ source.page_title ||
									__(
										'View page',
										'fair-events-experimental'
									) }{ ' ' }
								&#8599;
							</a>
						</VStack>
					) }
					<VStack spacing={ 1 }>
						<strong>
							{ __( 'Feed URLs', 'fair-events-experimental' ) }
						</strong>
						<HStack spacing={ 2 }>
							<CopyUrlButton
								url={ getIcalUrl( source.slug ) }
								label={ __(
									'iCal',
									'fair-events-experimental'
								) }
								tooltip={ __(
									'Copy iCal feed URL',
									'fair-events-experimental'
								) }
							/>
							<CopyUrlButton
								url={ getJsonUrl( source.slug ) }
								label={ __(
									'JSON',
									'fair-events-experimental'
								) }
								tooltip={ __(
									'Copy JSON API URL',
									'fair-events-experimental'
								) }
							/>
						</HStack>
					</VStack>
					<VStack spacing={ 1 } style={ { minWidth: 0 } }>
						<strong>
							{ __(
								'WhatsApp summary link',
								'fair-events-experimental'
							) }
						</strong>
						{ source.weekly_summary_url ? (
							<>
								<code style={ { overflowWrap: 'anywhere' } }>
									{ source.weekly_summary_url }
								</code>
								<HStack spacing={ 2 } justify="flex-start">
									<CopyUrlButton
										url={ source.weekly_summary_url }
										label={ __(
											'Copy link',
											'fair-events-experimental'
										) }
										tooltip={ __(
											'Copy the WhatsApp summary link to share with the person who posts it',
											'fair-events-experimental'
										) }
										onSuccess={ () =>
											setLinkCopyFailed( false )
										}
										onError={ () =>
											setLinkCopyFailed( true )
										}
									/>
								</HStack>
								{ linkCopyFailed && (
									<span role="alert">
										{ __(
											'Couldn’t copy the link. Select it above and copy it by hand.',
											'fair-events-experimental'
										) }
									</span>
								) }
								{ ! source.enabled && (
									<span>
										{ __(
											'The link works once this feed is enabled.',
											'fair-events-experimental'
										) }
									</span>
								) }
							</>
						) : (
							<span>
								{ __(
									'Choose a page for this feed to get a WhatsApp summary link. The page gives the message its title and link.',
									'fair-events-experimental'
								) }
							</span>
						) }
					</VStack>
					<VStack spacing={ 1 }>
						<Button
							variant="secondary"
							onClick={ () => setIsEditOpen( true ) }
						>
							{ __(
								'Edit event feed',
								'fair-events-experimental'
							) }
						</Button>
					</VStack>
				</HStack>
				<Button
					variant="secondary"
					size="small"
					onClick={ () => setIsEditOpen( true ) }
					style={ { alignSelf: 'flex-start', marginTop: '8px' } }
				>
					{ __( 'Edit event feed', 'fair-events-experimental' ) }
				</Button>
			</div>

			{ eventsState.error && (
				<Notice status="error" isDismissible={ false }>
					{ eventsState.error }
				</Notice>
			) }

			<Card style={ { marginTop: '16px' } }>
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
