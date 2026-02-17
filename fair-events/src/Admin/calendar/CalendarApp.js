/**
 * Calendar App - Main Component
 *
 * @package FairEvents
 */

import { useState, useEffect, useCallback, useRef } from '@wordpress/element';
import { Spinner, Notice } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { formatLocalDate, calculateLeadingDays } from 'fair-events-shared';
import CalendarHeader from './components/CalendarHeader.js';
import CalendarGrid from './components/CalendarGrid.js';
import QuickEventModal from './components/QuickEventModal.js';

function getInitialDate() {
	const params = new URLSearchParams(window.location.search);
	const month = params.get('month');
	if (month) {
		const [year, mon] = month.split('-').map(Number);
		if (year && mon) {
			return new Date(year, mon - 1, 1);
		}
	}
	return new Date();
}

function updateUrlMonth(date) {
	const params = new URLSearchParams(window.location.search);
	const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
		2,
		'0'
	)}`;
	params.set('month', month);
	const newUrl = `${window.location.pathname}?${params.toString()}`;
	window.history.pushState({ month }, '', newUrl);
}

export default function CalendarApp() {
	const [currentDate, setCurrentDate] = useState(getInitialDate);
	const isPopState = useRef(false);
	const [events, setEvents] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [modalDate, setModalDate] = useState(null);
	const [successNotice, setSuccessNotice] = useState(null);

	const fetchEvents = useCallback(async () => {
		setLoading(true);
		setError(null);

		const year = currentDate.getFullYear();
		const month = currentDate.getMonth();

		// Calculate date range for the visible calendar (including adjacent month days)
		const firstDayOfMonth = new Date(year, month, 1);
		const lastDayOfMonth = new Date(year, month + 1, 0);

		// Get start_of_week setting (0 = Sunday, 1 = Monday)
		const startOfWeek = window.fairEventsCalendarData?.startOfWeek ?? 1;

		// Calculate leading days (how many days from previous month to show)
		const leadingDays = calculateLeadingDays(firstDayOfMonth, startOfWeek);

		// Calculate trailing days
		const totalCells = leadingDays + lastDayOfMonth.getDate();
		const trailingDays = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);

		// Extend query range
		const startDate = new Date(firstDayOfMonth);
		startDate.setDate(startDate.getDate() - leadingDays);

		const endDate = new Date(lastDayOfMonth);
		endDate.setDate(endDate.getDate() + trailingDays);

		try {
			const response = await apiFetch({
				path: `/fair-events/v1/events?start_date=${formatLocalDate(
					startDate
				)}&end_date=${formatLocalDate(endDate)}`,
			});

			setEvents(response.events || []);
		} catch (err) {
			setError(
				err.message || __('Failed to load events.', 'fair-events')
			);
			setEvents([]);
		} finally {
			setLoading(false);
		}
	}, [currentDate]);

	useEffect(() => {
		fetchEvents();
	}, [fetchEvents]);

	// Sync URL when currentDate changes (skip for popstate-triggered changes)
	useEffect(() => {
		if (isPopState.current) {
			isPopState.current = false;
			return;
		}
		updateUrlMonth(currentDate);
	}, [currentDate]);

	// Listen for browser back/forward
	useEffect(() => {
		const handlePopState = () => {
			isPopState.current = true;
			setCurrentDate(getInitialDate());
		};
		window.addEventListener('popstate', handlePopState);
		return () => window.removeEventListener('popstate', handlePopState);
	}, []);

	const handlePrevMonth = () => {
		setCurrentDate(
			new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1)
		);
	};

	const handleNextMonth = () => {
		setCurrentDate(
			new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1)
		);
	};

	const handleToday = () => {
		setCurrentDate(new Date());
	};

	const handleAddEvent = (date) => {
		setModalDate(date);
	};

	const handleModalClose = () => {
		setModalDate(null);
	};

	const handleModalSuccess = (eventDate) => {
		setModalDate(null);
		fetchEvents();

		const manageEventUrl = window.fairEventsCalendarData?.manageEventUrl;
		setSuccessNotice({
			title: eventDate.title,
			id: eventDate.id,
			manageUrl: manageEventUrl
				? `${manageEventUrl}&event_date_id=${eventDate.id}`
				: null,
		});
	};

	const handleEditEvent = (eventId) => {
		// Handle standalone events (format: standalone_123@domain.com)
		const standaloneMatch = eventId.match(/standalone_(\d+)@/);
		if (standaloneMatch) {
			const eventDateId = standaloneMatch[1];
			const manageEventUrl =
				window.fairEventsCalendarData?.manageEventUrl;
			if (manageEventUrl) {
				window.location.href = `${manageEventUrl}&event_date_id=${eventDateId}`;
			}
			return;
		}

		// Extract numeric ID from uid (format: fair_event_123_456@domain.com or fair_event_123@domain.com)
		// The first number is the event_id, the second (optional) is the occurrence_id
		const match = eventId.match(/fair_event_(\d+)(?:_\d+)?@/);
		if (match) {
			const numericId = match[1];
			const editEventUrl = window.fairEventsCalendarData?.editEventUrl;
			if (editEventUrl) {
				window.location.href = `${editEventUrl}${numericId}`;
			}
		}
	};

	return (
		<div className="wrap fair-events-calendar-wrap">
			<h1>{__('Events Calendar', 'fair-events')}</h1>

			<CalendarHeader
				currentDate={currentDate}
				onPrevMonth={handlePrevMonth}
				onNextMonth={handleNextMonth}
				onToday={handleToday}
			/>

			{successNotice && (
				<Notice
					status="success"
					isDismissible
					onRemove={() => setSuccessNotice(null)}
				>
					{sprintf(
						/* translators: %s: event title */
						__('Event "%s" created.', 'fair-events'),
						successNotice.title
					)}{' '}
					{successNotice.manageUrl && (
						<a href={successNotice.manageUrl}>
							{__('Manage Event', 'fair-events')}
						</a>
					)}
				</Notice>
			)}

			{error && (
				<div className="notice notice-error">
					<p>{error}</p>
				</div>
			)}

			{loading ? (
				<div className="fair-events-calendar-loading">
					<Spinner />
				</div>
			) : (
				<CalendarGrid
					currentDate={currentDate}
					events={events}
					onAddEvent={handleAddEvent}
					onEditEvent={handleEditEvent}
					participantsUrl={
						window.fairEventsCalendarData?.participantsUrl
					}
				/>
			)}

			{modalDate && (
				<QuickEventModal
					date={modalDate}
					onClose={handleModalClose}
					onSuccess={handleModalSuccess}
				/>
			)}
		</div>
	);
}
