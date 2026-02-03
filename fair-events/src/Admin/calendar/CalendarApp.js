/**
 * Calendar App - Main Component
 *
 * @package FairEvents
 */

import { useState, useEffect, useCallback } from '@wordpress/element';
import { Spinner } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { formatLocalDate, calculateLeadingDays } from 'fair-events-shared';
import CalendarHeader from './components/CalendarHeader.js';
import CalendarGrid from './components/CalendarGrid.js';

export default function CalendarApp() {
	const [ currentDate, setCurrentDate ] = useState( new Date() );
	const [ events, setEvents ] = useState( [] );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );

	const fetchEvents = useCallback( async () => {
		setLoading( true );
		setError( null );

		const year = currentDate.getFullYear();
		const month = currentDate.getMonth();

		// Calculate date range for the visible calendar (including adjacent month days)
		const firstDayOfMonth = new Date( year, month, 1 );
		const lastDayOfMonth = new Date( year, month + 1, 0 );

		// Get start_of_week setting (0 = Sunday, 1 = Monday)
		const startOfWeek = window.fairEventsCalendarData?.startOfWeek ?? 1;

		// Calculate leading days (how many days from previous month to show)
		const leadingDays = calculateLeadingDays(
			firstDayOfMonth,
			startOfWeek
		);

		// Calculate trailing days
		const totalCells = leadingDays + lastDayOfMonth.getDate();
		const trailingDays = totalCells % 7 === 0 ? 0 : 7 - ( totalCells % 7 );

		// Extend query range
		const startDate = new Date( firstDayOfMonth );
		startDate.setDate( startDate.getDate() - leadingDays );

		const endDate = new Date( lastDayOfMonth );
		endDate.setDate( endDate.getDate() + trailingDays );

		try {
			const response = await apiFetch( {
				path: `/fair-events/v1/events?start_date=${ formatLocalDate(
					startDate
				) }&end_date=${ formatLocalDate( endDate ) }`,
			} );

			setEvents( response.events || [] );
		} catch ( err ) {
			setError(
				err.message || __( 'Failed to load events.', 'fair-events' )
			);
			setEvents( [] );
		} finally {
			setLoading( false );
		}
	}, [ currentDate ] );

	useEffect( () => {
		fetchEvents();
	}, [ fetchEvents ] );

	const handlePrevMonth = () => {
		setCurrentDate(
			new Date( currentDate.getFullYear(), currentDate.getMonth() - 1, 1 )
		);
	};

	const handleNextMonth = () => {
		setCurrentDate(
			new Date( currentDate.getFullYear(), currentDate.getMonth() + 1, 1 )
		);
	};

	const handleToday = () => {
		setCurrentDate( new Date() );
	};

	const handleAddEvent = ( date ) => {
		const dateStr = formatLocalDate( date );
		const newEventUrl = window.fairEventsCalendarData?.newEventUrl;
		if ( newEventUrl ) {
			window.location.href = `${ newEventUrl }&event_date=${ dateStr }`;
		}
	};

	const handleEditEvent = ( eventId ) => {
		// Extract numeric ID from uid (format: fair_event_123_456@domain.com or fair_event_123@domain.com)
		// The first number is the event_id, the second (optional) is the occurrence_id
		const match = eventId.match( /fair_event_(\d+)(?:_\d+)?@/ );
		if ( match ) {
			const numericId = match[ 1 ];
			const editEventUrl = window.fairEventsCalendarData?.editEventUrl;
			if ( editEventUrl ) {
				window.location.href = `${ editEventUrl }${ numericId }`;
			}
		}
	};

	return (
		<div className="wrap fair-events-calendar-wrap">
			<h1>{ __( 'Events Calendar', 'fair-events' ) }</h1>

			<CalendarHeader
				currentDate={ currentDate }
				onPrevMonth={ handlePrevMonth }
				onNextMonth={ handleNextMonth }
				onToday={ handleToday }
			/>

			{ error && (
				<div className="notice notice-error">
					<p>{ error }</p>
				</div>
			) }

			{ loading ? (
				<div className="fair-events-calendar-loading">
					<Spinner />
				</div>
			) : (
				<CalendarGrid
					currentDate={ currentDate }
					events={ events }
					onAddEvent={ handleAddEvent }
					onEditEvent={ handleEditEvent }
				/>
			) }
		</div>
	);
}
