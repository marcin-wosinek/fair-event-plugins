/**
 * Calendar App - Main Component
 *
 * @package FairEvents
 */

import { useState, useEffect, useRef } from '@wordpress/element';
import {
	Spinner,
	Notice,
	Card,
	CardHeader,
	CardBody,
	SelectControl,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { formatLocalDate, calculateLeadingDays } from 'fair-events-shared';
import CalendarHeader from './components/CalendarHeader.js';
import CalendarGrid from './components/CalendarGrid.js';
import CalendarLegend from './components/CalendarLegend.js';
import QuickEventModal from './components/QuickEventModal.js';
import {
	parseView,
	buildViewUrl,
	isSameView,
	startOfMonth,
	formatMonthParam,
} from './calendarView.js';

// The events endpoint caps per_page at 500 and reports only the returned
// page's size in meta.total, so a short page is the only end-of-results signal.
export const EVENTS_PER_PAGE = 500;

function currentUrlView() {
	return parseView( window.location.search );
}

function viewUrl( view ) {
	return buildViewUrl(
		window.location.pathname,
		window.location.search,
		view
	);
}

/**
 * Date range of the visible grid, including adjacent-month days.
 *
 * @param {Date} month Any date in the displayed month.
 * @return {{startDate: Date, endDate: Date}} Inclusive range.
 */
function getVisibleRange( month ) {
	const year = month.getFullYear();
	const monthIndex = month.getMonth();
	const firstDayOfMonth = new Date( year, monthIndex, 1 );
	const lastDayOfMonth = new Date( year, monthIndex + 1, 0 );

	// Get start_of_week setting (0 = Sunday, 1 = Monday)
	const startOfWeek = window.fairEventsCalendarData?.startOfWeek ?? 1;

	const leadingDays = calculateLeadingDays( firstDayOfMonth, startOfWeek );
	const totalCells = leadingDays + lastDayOfMonth.getDate();
	const trailingDays = totalCells % 7 === 0 ? 0 : 7 - ( totalCells % 7 );

	const startDate = new Date( firstDayOfMonth );
	startDate.setDate( startDate.getDate() - leadingDays );

	const endDate = new Date( lastDayOfMonth );
	endDate.setDate( endDate.getDate() + trailingDays );

	return { startDate, endDate };
}

/**
 * Fetch every event in the range, following pages until a short one.
 *
 * @param {Date}        startDate    Range start.
 * @param {Date}        endDate      Range end.
 * @param {string|null} categorySlug Category slug to filter by, or null.
 * @return {Promise<Object[]>} All events.
 */
async function fetchAllEvents( startDate, endDate, categorySlug ) {
	const events = [];
	for ( let page = 1; ; page++ ) {
		const params = new URLSearchParams( {
			start_date: formatLocalDate( startDate ),
			end_date: formatLocalDate( endDate ),
			context: 'edit',
			per_page: String( EVENTS_PER_PAGE ),
			page: String( page ),
		} );
		if ( categorySlug ) {
			params.set( 'categories', categorySlug );
		}
		const response = await apiFetch( {
			path: `/fair-events/v1/events?${ params.toString() }`,
		} );
		const batch = response.events || [];
		events.push( ...batch );
		if ( batch.length < EVENTS_PER_PAGE ) {
			return events;
		}
	}
}

function getCategoryLabel( category ) {
	return category.language
		? sprintf(
				/* translators: 1: category name, 2: language name */
				__( '%1$s — %2$s', 'fair-events' ),
				category.name,
				category.language
			)
		: category.name;
}

export default function CalendarApp() {
	const [ view, setView ] = useState( currentUrlView );
	const [ categories, setCategories ] = useState( {
		status: 'loading',
		items: [],
		error: null,
	} );
	const [ eventsState, setEventsState ] = useState( {
		status: 'loading',
		events: [],
		error: null,
	} );
	const [ refreshKey, setRefreshKey ] = useState( 0 );
	const latestRequest = useRef( 0 );
	const [ modalDate, setModalDate ] = useState( null );
	const [ successNotice, setSuccessNotice ] = useState( null );

	const currentDate = view.month;
	const monthKey = formatMonthParam( view.month );
	const selectedCategory =
		view.categoryId && categories.status === 'ready'
			? categories.items.find( ( cat ) => cat.id === view.categoryId ) ||
				null
			: null;
	const selectedSlug = selectedCategory?.slug ?? null;
	// What the events request filters by. Without a category the categories
	// request is irrelevant, so its completion must not trigger a refetch.
	let categoryFilter = 'all';
	if ( selectedSlug ) {
		categoryFilter = `slug:${ selectedSlug }`;
	} else if ( view.categoryId ) {
		categoryFilter =
			categories.status === 'error' ? 'unavailable' : 'pending';
	}

	// Normalize the initial URL (missing month, malformed category) in place.
	useEffect( () => {
		window.history.replaceState(
			window.history.state,
			'',
			viewUrl( currentUrlView() )
		);
	}, [] );

	// Browser back/forward restores month and category without a new entry.
	useEffect( () => {
		const handlePopState = () => {
			const restored = currentUrlView();
			window.history.replaceState(
				window.history.state,
				'',
				viewUrl( restored )
			);
			setView( restored );
		};
		window.addEventListener( 'popstate', handlePopState );
		return () => window.removeEventListener( 'popstate', handlePopState );
	}, [] );

	useEffect( () => {
		apiFetch( {
			path: '/fair-events/v1/sources/categories?all_languages=true',
		} )
			.then( ( items ) => {
				setCategories( {
					status: 'ready',
					items: items || [],
					error: null,
				} );
			} )
			.catch( ( err ) => {
				setCategories( {
					status: 'error',
					items: [],
					error:
						err.message ||
						__( 'Failed to load categories.', 'fair-events' ),
				} );
			} );
	}, [] );

	// A category that no longer exists falls back to All categories. A failed
	// categories request proves nothing, so it keeps the selection.
	useEffect( () => {
		if (
			categories.status !== 'ready' ||
			! view.categoryId ||
			categories.items.some( ( cat ) => cat.id === view.categoryId )
		) {
			return;
		}
		const fallback = { ...view, categoryId: null };
		window.history.replaceState(
			window.history.state,
			'',
			viewUrl( fallback )
		);
		setView( fallback );
	}, [ categories, view ] );

	useEffect( () => {
		// Every run supersedes earlier requests, including runs that don't
		// fetch, so a late response can't overwrite the current view.
		const requestId = ++latestRequest.current;

		if (
			'pending' === categoryFilter ||
			'unavailable' === categoryFilter
		) {
			// Waiting for categories, about to fall back, or unable to
			// resolve the category's slug after a failed categories request.
			setEventsState( {
				status:
					'pending' === categoryFilter ? 'loading' : 'unavailable',
				events: [],
				error: null,
			} );
			return;
		}

		setEventsState( { status: 'loading', events: [], error: null } );
		const { startDate, endDate } = getVisibleRange( currentDate );

		fetchAllEvents( startDate, endDate, selectedSlug )
			.then( ( events ) => {
				if ( requestId === latestRequest.current ) {
					setEventsState( {
						status: 'success',
						events,
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
							__( 'Failed to load events.', 'fair-events' ),
					} );
				}
			} );
		// currentDate and selectedSlug are represented by monthKey and
		// categoryFilter.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ monthKey, categoryFilter, refreshKey ] );

	const navigate = ( next ) => {
		if ( isSameView( next, view ) ) {
			return;
		}
		window.history.pushState( null, '', viewUrl( next ) );
		setView( next );
	};

	const handlePrevMonth = () => {
		navigate( {
			...view,
			month: new Date(
				currentDate.getFullYear(),
				currentDate.getMonth() - 1,
				1
			),
		} );
	};

	const handleNextMonth = () => {
		navigate( {
			...view,
			month: new Date(
				currentDate.getFullYear(),
				currentDate.getMonth() + 1,
				1
			),
		} );
	};

	const handleToday = () => {
		navigate( { ...view, month: startOfMonth( new Date() ) } );
	};

	const handleCategoryChange = ( value ) => {
		navigate( { ...view, categoryId: value ? Number( value ) : null } );
	};

	const handleAddEvent = ( date ) => {
		setModalDate( date );
	};

	const handleHeaderAddEvent = () => {
		const today = new Date();
		const sameMonth =
			today.getFullYear() === currentDate.getFullYear() &&
			today.getMonth() === currentDate.getMonth();
		handleAddEvent(
			sameMonth
				? today
				: new Date(
						currentDate.getFullYear(),
						currentDate.getMonth(),
						1
					)
		);
	};

	const handleModalClose = () => {
		setModalDate( null );
	};

	const handleModalSuccess = ( eventDate ) => {
		setModalDate( null );
		setRefreshKey( ( key ) => key + 1 );

		const manageEventUrl = window.fairEventsCalendarData?.manageEventUrl;
		setSuccessNotice( {
			title: eventDate.title,
			id: eventDate.id,
			manageUrl: manageEventUrl
				? `${ manageEventUrl }&event_date_id=${ eventDate.id }`
				: null,
		} );
	};

	const categoryOptions = [
		{ label: __( 'All categories', 'fair-events' ), value: '' },
		...categories.items.map( ( cat ) => ( {
			label: getCategoryLabel( cat ),
			value: String( cat.id ),
		} ) ),
	];
	if ( view.categoryId && categories.status === 'error' ) {
		// Keep the unresolved selection visible so the select doesn't claim
		// All categories while nothing is shown.
		categoryOptions.push( {
			label: __( 'Selected category', 'fair-events' ),
			value: String( view.categoryId ),
		} );
	}

	const hasNoMatches =
		eventsState.status === 'success' &&
		!! selectedCategory &&
		eventsState.events.length === 0;

	return (
		<div className="wrap fair-events-calendar-wrap">
			<h1>{ __( 'Events Calendar', 'fair-events' ) }</h1>

			<div className="fair-events-calendar-filter">
				<SelectControl
					__nextHasNoMarginBottom
					__next40pxDefaultSize
					label={ __( 'Category', 'fair-events' ) }
					value={ view.categoryId ? String( view.categoryId ) : '' }
					options={ categoryOptions }
					onChange={ handleCategoryChange }
					disabled={ categories.status === 'loading' }
				/>
			</div>

			{ successNotice && (
				<Notice
					status="success"
					isDismissible
					onRemove={ () => setSuccessNotice( null ) }
				>
					{ sprintf(
						/* translators: %s: event title */
						__( 'Event "%s" created.', 'fair-events' ),
						successNotice.title
					) }{ ' ' }
					{ successNotice.manageUrl && (
						<a href={ successNotice.manageUrl }>
							{ __( 'Manage Event', 'fair-events' ) }
						</a>
					) }
				</Notice>
			) }

			{ categories.error && (
				<div className="notice notice-error">
					<p>{ categories.error }</p>
				</div>
			) }

			{ eventsState.error && (
				<div className="notice notice-error">
					<p>{ eventsState.error }</p>
				</div>
			) }

			<Card style={ { marginTop: '16px' } }>
				<CardHeader>
					<CalendarHeader
						currentDate={ currentDate }
						onPrevMonth={ handlePrevMonth }
						onNextMonth={ handleNextMonth }
						onToday={ handleToday }
						onAddEvent={ handleHeaderAddEvent }
					/>
				</CardHeader>
				<CardBody className="fair-events-calendar-card-body">
					{ eventsState.status === 'loading' ? (
						<div className="fair-events-calendar-loading">
							<Spinner />
						</div>
					) : (
						<>
							{ hasNoMatches && (
								<p
									className="fair-events-calendar-no-matches"
									role="status"
								>
									{ __(
										'No events match this category.',
										'fair-events'
									) }
								</p>
							) }
							<CalendarGrid
								currentDate={ currentDate }
								events={ eventsState.events }
								onAddEvent={ handleAddEvent }
								manageEventUrl={
									window.fairEventsCalendarData
										?.manageEventUrl
								}
								forceGrid={ hasNoMatches }
							/>
							<CalendarLegend />
						</>
					) }
				</CardBody>
			</Card>

			{ modalDate && (
				<QuickEventModal
					date={ modalDate }
					onClose={ handleModalClose }
					onSuccess={ handleModalSuccess }
				/>
			) }
		</div>
	);
}
