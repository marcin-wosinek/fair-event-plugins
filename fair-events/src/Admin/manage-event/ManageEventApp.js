/**
 * Manage Event App - Main Component
 *
 * Stage 2: Manage event details and link options.
 *
 * @package FairEvents
 */

import {
	useState,
	useEffect,
	useMemo,
	useCallback,
	useRef,
} from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Spinner,
	Notice,
	TextControl,
	CheckboxControl,
	SelectControl,
	RadioControl,
	FormTokenField,
	TabPanel,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';
import { applyFilters } from '@wordpress/hooks';
import apiFetch from '@wordpress/api-fetch';
import {
	DurationOptions,
	calculateDuration,
	isLinkOnlyEvent,
	formatSiteLocalDatetime,
	getEventDisplayTitle,
	parseRRule,
	buildRRule,
	RecurrenceControl,
} from 'fair-events-shared';
import EventFinance from './EventFinance.js';
import EventTickets from './EventTickets.js';
import EventPhotos from './EventPhotos.js';
import RecurrenceCalendar from './RecurrenceCalendar.js';
import RecurrenceImpactSummary from './RecurrenceImpactSummary.js';
import EventSignups from './EventSignups.js';
import EventContextHeader from './EventContextHeader.js';

export default function ManageEventApp() {
	const eventDateId = window.fairEventsManageEventData?.eventDateId;
	const calendarUrl = window.fairEventsManageEventData?.calendarUrl;
	const manageEventUrl =
		window.fairEventsManageEventData?.manageEventUrl || '';
	const enabledPostTypes =
		window.fairEventsManageEventData?.enabledPostTypes || [];
	const audienceUrl = window.fairEventsManageEventData?.audienceUrl || '';
	const paymentEntriesUrl =
		window.fairEventsManageEventData?.paymentEntriesUrl || '';
	// Per-bundle feature gates from the PHP registry. Empty object → treat
	// every bundle as off (fail-closed) on a misconfigured page.
	const enabledFeatures =
		window.fairEventsManageEventData?.enabledFeatures || {};
	const galleriesEnabled = !!enabledFeatures.galleries;
	const ticketingEnabled = !!enabledFeatures.ticketing;
	const venuesEnabled = !!enabledFeatures.venues;

	const [eventDate, setEventDate] = useState(null);
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState(null);
	const [success, setSuccess] = useState(null);
	const [venues, setVenues] = useState([]);

	// Form state
	const [title, setTitle] = useState('');
	const [allDay, setAllDay] = useState(false);
	const [startDate, setStartDate] = useState('');
	const [startTime, setStartTime] = useState('');
	const [endDate, setEndDate] = useState('');
	const [endTime, setEndTime] = useState('');
	const [venueId, setVenueId] = useState('');
	const [address, setAddress] = useState('');
	const [linkType, setLinkType] = useState('none');
	const [externalUrl, setExternalUrl] = useState('');
	const [categories, setCategories] = useState([]);
	const [availableCategories, setAvailableCategories] = useState([]);
	const [creatingCategories, setCreatingCategories] = useState([]);

	// Recurrence state
	const [recurrence, setRecurrence] = useState({
		enabled: false,
		frequency: 'weekly',
		endType: 'count',
		count: 10,
		until: '',
	});

	// Post creation state
	const [creatingPost, setCreatingPost] = useState(false);
	const [selectedPostType, setSelectedPostType] = useState(
		enabledPostTypes[0]?.slug || 'fair_event'
	);

	// Link additional post state
	const [linkingPost, setLinkingPost] = useState(false);
	const [linkPostId, setLinkPostId] = useState('');
	const [searchResults, setSearchResults] = useState([]);
	const [togglingExdate, setTogglingExdate] = useState(null);
	const [recurrenceImpact, setRecurrenceImpact] = useState(null);
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

	// Dirty-state tracking (#987): snapshot the saved form/ticket state so we
	// can warn before losing edits and mark which tab holds them.
	const [detailsSnapshot, setDetailsSnapshot] = useState(null);
	const detailsJustLoadedRef = useRef(false);
	const [ticketsDirty, setTicketsDirty] = useState(false);
	const handleTicketsDirtyChange = useCallback(
		(isDirty) => setTicketsDirty(isDirty),
		[]
	);

	useEffect(() => {
		if (!eventDateId) {
			setLoading(false);
			setError(__('No event date ID specified.', 'fair-events'));
			return;
		}
		loadEventDate();
		if (venuesEnabled) {
			loadVenues();
		}
		loadCategories();
	}, []);

	const loadEventDate = async () => {
		setLoading(true);
		try {
			const data = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}`,
			});
			setEventDate(data);
			populateForm(data);
		} catch (err) {
			setError(
				err.message || __('Failed to load event date.', 'fair-events')
			);
		} finally {
			setLoading(false);
		}
	};

	const loadVenues = async () => {
		try {
			const data = await apiFetch({ path: '/fair-events/v1/venues' });
			setVenues(data);
		} catch {
			// Venues are optional, ignore errors.
		}
	};

	const loadCategories = async () => {
		try {
			const data = await apiFetch({
				path: '/fair-events/v1/sources/categories',
			});
			setAvailableCategories(data);
		} catch {
			// Categories are optional, ignore errors.
		}
	};

	const createCategory = async (name) => {
		try {
			const newCategory = await apiFetch({
				path: '/fair-events/v1/sources/categories',
				method: 'POST',
				data: { name },
			});
			setAvailableCategories((prev) => [...prev, newCategory]);
			setCategories((prev) => [...prev, newCategory.id]);
		} catch (err) {
			setError(
				err.message || __('Failed to create category.', 'fair-events')
			);
		} finally {
			setCreatingCategories((prev) =>
				prev.filter((pending) => pending !== name)
			);
		}
	};

	const populateForm = (data) => {
		detailsJustLoadedRef.current = true;
		setTitle(data.title || '');
		setAllDay(data.all_day || false);
		setLinkType(data.link_type || 'none');
		setExternalUrl(data.external_url || '');
		setVenueId(data.venue_id ? String(data.venue_id) : '');
		setAddress(data.address || '');
		setCategories(data.categories?.map((c) => c.id) || []);

		if (data.start_datetime) {
			const [sDate, sTime] = data.start_datetime.split(' ');
			setStartDate(sDate || '');
			setStartTime(sTime ? sTime.substring(0, 5) : '');
		}
		if (data.end_datetime) {
			const [eDate, eTime] = data.end_datetime.split(' ');
			setEndDate(eDate || '');
			setEndTime(eTime ? eTime.substring(0, 5) : '');
		}

		// Populate recurrence from rrule
		if (data.rrule) {
			setRecurrence({ enabled: true, ...parseRRule(data.rrule) });
		} else {
			setRecurrence((prev) => ({ ...prev, enabled: false }));
		}
	};

	// Plain-object snapshot of every Event Details field, used to detect
	// unsaved edits (#987). Keep in sync with the fields populateForm() sets.
	const buildDetailsSnapshot = () =>
		JSON.stringify({
			title,
			allDay,
			startDate,
			startTime,
			endDate,
			endTime,
			venueId,
			address,
			linkType,
			externalUrl,
			categories: [...categories].sort(),
			recurrence,
		});

	// Runs after every render; only commits a new snapshot right after
	// populateForm() flagged one (initial load or a fresh save/link/unlink),
	// once all its setState calls have been applied.
	useEffect(() => {
		if (detailsJustLoadedRef.current) {
			setDetailsSnapshot(buildDetailsSnapshot());
			detailsJustLoadedRef.current = false;
		}
	});

	const detailsDirty =
		detailsSnapshot !== null && detailsSnapshot !== buildDetailsSnapshot();

	// Warn before losing unsaved edits on either tab that can be dirty.
	useEffect(() => {
		if (!detailsDirty && !ticketsDirty) {
			return;
		}
		const handleBeforeUnload = (event) => {
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener('beforeunload', handleBeforeUnload);
		return () =>
			window.removeEventListener('beforeunload', handleBeforeUnload);
	}, [detailsDirty, ticketsDirty]);

	// Duration options
	const timedDurationOptions = useMemo(
		() =>
			new DurationOptions({
				values: [30, 60, 90, 120, 150, 180, 240, 360, 480],
				unit: 'minutes',
				textDomain: 'fair-events',
			}),
		[]
	);

	const allDayDurationOptions = useMemo(
		() =>
			new DurationOptions({
				values: [1, 2, 3, 4, 5, 6, 7],
				unit: 'days',
				textDomain: 'fair-events',
			}),
		[]
	);

	const getCurrentDuration = () => {
		if (allDay) {
			if (!startDate || !endDate) return 'other';
			const start = new Date(startDate);
			const end = new Date(endDate);
			const diffDays =
				Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
			return allDayDurationOptions.getCurrentSelection(diffDays);
		}
		if (!startDate || !startTime || !endDate || !endTime) return 'other';
		const startIso = `${startDate}T${startTime}`;
		const endIso = `${endDate}T${endTime}`;
		const minutes = calculateDuration(startIso, endIso);
		if (minutes === null) return 'other';
		return timedDurationOptions.getCurrentSelection(minutes);
	};

	const durationValue = getCurrentDuration();

	const durationOptions = allDay
		? allDayDurationOptions.getDurationOptions()
		: timedDurationOptions.getDurationOptions();

	const handleDurationChange = (value) => {
		if (value === 'other' || !startDate) return;
		if (allDay) {
			const days = parseInt(value, 10);
			const start = new Date(startDate);
			const end = new Date(start);
			end.setDate(start.getDate() + days - 1);
			const year = end.getFullYear();
			const month = String(end.getMonth() + 1).padStart(2, '0');
			const day = String(end.getDate()).padStart(2, '0');
			setEndDate(`${year}-${month}-${day}`);
		} else {
			if (!startTime) return;
			const minutes = parseInt(value, 10);
			const start = new Date(`${startDate}T${startTime}`);
			const end = new Date(start.getTime() + minutes * 60000);
			const year = end.getFullYear();
			const month = String(end.getMonth() + 1).padStart(2, '0');
			const day = String(end.getDate()).padStart(2, '0');
			const hours = String(end.getHours()).padStart(2, '0');
			const mins = String(end.getMinutes()).padStart(2, '0');
			setEndDate(`${year}-${month}-${day}`);
			setEndTime(`${hours}:${mins}`);
		}
	};

	const handleSave = async () => {
		setSaving(true);
		setError(null);
		setSuccess(null);

		const startDatetime = allDay
			? `${startDate} 00:00:00`
			: `${startDate} ${startTime}:00`;

		const endDatetime = allDay
			? `${endDate} 00:00:00`
			: `${endDate} ${endTime}:00`;

		try {
			const updated = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}`,
				method: 'PUT',
				data: {
					title,
					start_datetime: startDatetime,
					end_datetime: endDatetime,
					all_day: allDay,
					venue_id: venuesEnabled
						? venueId
							? parseInt(venueId, 10)
							: null
						: undefined,
					address: venuesEnabled ? undefined : address,
					link_type: linkType,
					external_url: linkType === 'external' ? externalUrl : null,
					rrule: buildRRule(recurrence),
					categories,
				},
			});
			setEventDate(updated);
			setRecurrenceImpact(
				updated.recurrence_impact
					? { impact: updated.recurrence_impact, blocked: false }
					: null
			);
			setSuccess(__('Event updated successfully.', 'fair-events'));
			setDetailsSnapshot(buildDetailsSnapshot());
		} catch (err) {
			setError(
				err.message || __('Failed to update event.', 'fair-events')
			);
			setRecurrenceImpact(
				err.data?.impact
					? { impact: err.data.impact, blocked: true }
					: null
			);
		} finally {
			setSaving(false);
		}
	};

	const confirmDelete = async () => {
		try {
			await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}`,
				method: 'DELETE',
			});
			window.location.href = calendarUrl;
		} catch (err) {
			setError(
				err.message || __('Failed to delete event.', 'fair-events')
			);
		} finally {
			setDeleteDialogOpen(false);
		}
	};

	const deleteConfirmMessage = useMemo(() => {
		const eventTitle = getEventDisplayTitle(title);

		if (eventDate?.occurrence_type === 'master') {
			const count = eventDate.generated_occurrences?.length || 0;
			return sprintf(
				/* translators: 1: event title, 2: number of occurrences */
				_n(
					'Delete %1$s and its %2$d occurrence? This cannot be undone.',
					'Delete %1$s and its %2$d occurrences? This cannot be undone.',
					count,
					'fair-events'
				),
				eventTitle,
				count
			);
		}

		return sprintf(
			/* translators: 1: event title, 2: event date */
			__('Delete %1$s on %2$s? This cannot be undone.', 'fair-events'),
			eventTitle,
			eventDate?.start_datetime
				? formatSiteLocalDatetime(eventDate.start_datetime)
				: ''
		);
	}, [title, eventDate]);

	const handleCreatePost = async () => {
		setCreatingPost(true);
		setError(null);

		try {
			const result = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}/create-post`,
				method: 'POST',
				data: {
					post_type: selectedPostType,
					post_status: 'draft',
				},
			});

			if (result.edit_url) {
				window.location.href = result.edit_url;
			}
		} catch (err) {
			setError(
				err.message || __('Failed to create post.', 'fair-events')
			);
		} finally {
			setCreatingPost(false);
		}
	};

	const handleUnlinkPost = async (postId) => {
		setSaving(true);
		setError(null);

		try {
			const updated = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}/link-post`,
				method: 'DELETE',
				data: {
					post_id: postId,
				},
			});
			setEventDate(updated);
			populateForm(updated);
			setSuccess(__('Post unlinked successfully.', 'fair-events'));
		} catch (err) {
			setError(
				err.message || __('Failed to unlink post.', 'fair-events')
			);
		} finally {
			setSaving(false);
		}
	};

	const handleLinkPost = async () => {
		if (!linkPostId) return;
		setLinkingPost(true);
		setError(null);

		try {
			const updated = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}/link-post`,
				method: 'POST',
				data: {
					post_id: parseInt(linkPostId, 10),
				},
			});
			setEventDate(updated);
			populateForm(updated);
			setLinkPostId('');
			setSearchResults([]);
			setSuccess(__('Post linked successfully.', 'fair-events'));
		} catch (err) {
			setError(err.message || __('Failed to link post.', 'fair-events'));
		} finally {
			setLinkingPost(false);
		}
	};

	const handleSearchPosts = async (searchTerm) => {
		if (!searchTerm || searchTerm.length < 2) {
			setSearchResults([]);
			return;
		}

		try {
			const results = await apiFetch({
				path: `/wp/v2/search?search=${encodeURIComponent(
					searchTerm
				)}&type=post&subtype=any&per_page=10`,
			});
			setSearchResults(results);
		} catch {
			// Ignore search errors.
		}
	};

	const handleToggleExdate = async (date) => {
		setTogglingExdate(date);
		setError(null);

		try {
			const updated = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}/toggle-exdate`,
				method: 'POST',
				data: { date },
			});
			setEventDate(updated);
			setRecurrenceImpact(
				updated.recurrence_impact
					? { impact: updated.recurrence_impact, blocked: false }
					: null
			);
		} catch (err) {
			setError(
				err.message || __('Failed to toggle occurrence.', 'fair-events')
			);
			setRecurrenceImpact(
				err.data?.impact
					? { impact: err.data.impact, blocked: true }
					: null
			);
		} finally {
			setTogglingExdate(null);
		}
	};

	const venueOptions = [
		{ label: __('— No venue —', 'fair-events'), value: '' },
		...venues.map((v) => ({ label: v.name, value: String(v.id) })),
	];

	const isLinkedToPost =
		eventDate?.link_type === 'post' && eventDate?.event_id;

	const urlTab = useMemo(() => {
		const urlParams = new URLSearchParams(window.location.search);
		return urlParams.get('tab') || 'event-details';
	}, []);

	const handleTabSelect = useCallback((tabName) => {
		const url = new URL(window.location.href);
		if (tabName === 'event-details') {
			url.searchParams.delete('tab');
		} else {
			url.searchParams.set('tab', tabName);
		}
		window.history.replaceState(null, '', url.toString());
	}, []);

	const isGeneratedOccurrence = eventDate?.occurrence_type === 'generated';

	// Build the tab descriptor list fresh on every render so render functions
	// always close over current state. Each descriptor: { name, title, order,
	// isVisible, disabled?, render: (ctx) => ReactNode }.
	const ctx = {
		eventDate,
		eventDateId,
		eventTitle: title,
		enabledFeatures,
	};

	const builtInTabs = [
		{
			name: 'event-details',
			title: __('Event Details', 'fair-events'),
			order: 10,
			isVisible: true,
			render: () => renderEventDetailsTab(),
		},
		{
			name: 'tickets',
			title: __('Tickets', 'fair-events'),
			order: 20,
			isVisible: ticketingEnabled,
			disabled: isGeneratedOccurrence || isLinkOnlyEvent(eventDate),
			render: () => (
				<EventTickets
					eventDateId={eventDateId}
					startDatetime={eventDate.start_datetime}
					endDatetime={eventDate.end_datetime}
					isRecurring={recurrence.enabled}
					onDirtyChange={handleTicketsDirtyChange}
				/>
			),
		},
		{
			name: 'signups',
			title: __('Signups', 'fair-events'),
			order: 25,
			isVisible: !!(ticketingEnabled && !audienceUrl),
			disabled: isLinkOnlyEvent(eventDate),
			render: () => <EventSignups eventDateId={eventDateId} />,
		},
		{
			name: 'photos',
			title: __('Photos', 'fair-events'),
			order: 40,
			isVisible: galleriesEnabled,
			render: () => <EventPhotos eventDateId={eventDateId} />,
		},
		{
			name: 'finance',
			title: __('Finance', 'fair-events'),
			order: 70,
			isVisible: !!paymentEntriesUrl,
			disabled: isLinkOnlyEvent(eventDate),
			render: () => (
				<EventFinance
					eventDateId={eventDateId}
					entriesUrl={paymentEntriesUrl}
				/>
			),
		},
		{
			name: 'admin',
			title: __('Admin', 'fair-events'),
			order: 100,
			isVisible: true,
			render: (renderCtx) => (
				<Card style={{ marginTop: '16px' }}>
					<CardHeader>
						<h2>{__('Event Administration', 'fair-events')}</h2>
					</CardHeader>
					<CardBody>
						<VStack spacing={6}>
							{applyFilters(
								'fairEvents.manageEvent.adminActions',
								[],
								renderCtx
							)}

							<VStack spacing={2}>
								<p style={{ color: '#666' }}>
									{__(
										'Permanently delete this event and all associated data. This action cannot be undone.',
										'fair-events'
									)}
								</p>
								<div>
									<Button
										variant="tertiary"
										isDestructive
										onClick={() =>
											setDeleteDialogOpen(true)
										}
									>
										{__('Delete Event', 'fair-events')}
									</Button>
								</div>
							</VStack>
						</VStack>
					</CardBody>
				</Card>
			),
		},
	];

	const tabDescriptors = applyFilters(
		'fairEvents.manageEvent.tabs',
		builtInTabs,
		ctx
	)
		.filter((t) => t.isVisible)
		.sort((a, b) => a.order - b.order);

	// Tabs whose section currently holds unsaved edits get a " •" marker.
	const dirtyTabNames = {
		'event-details': detailsDirty,
		tickets: ticketsDirty,
	};

	// Shape TabPanel expects: { name, title, disabled? }.
	const tabs = tabDescriptors.map(({ name, title: tabTitle, disabled }) => ({
		name,
		title: dirtyTabNames[name] ? `${tabTitle} •` : tabTitle,
		...(disabled ? { disabled } : {}),
	}));

	const initialTab = useMemo(() => {
		if (tabDescriptors.some((t) => t.name === urlTab && !t.disabled)) {
			return urlTab;
		}
		return 'event-details';
	}, [tabDescriptors, urlTab]);

	if (loading) {
		return (
			<div className="wrap">
				<Spinner />
			</div>
		);
	}

	if (!eventDate) {
		return (
			<div className="wrap">
				<h1>{__('Manage Event', 'fair-events')}</h1>
				{error && (
					<Notice status="error" isDismissible={false}>
						{error}
					</Notice>
				)}
				<p>
					<a href={calendarUrl}>
						{__('Back to Calendar', 'fair-events')}
					</a>
				</p>
			</div>
		);
	}

	const linkedPosts = eventDate.linked_posts || [];

	const renderEventDetailsTab = () => (
		<>
			<div className="fair-events-event-details-grid">
				<Card className="fair-events-event-details-card">
					<CardHeader>
						<h2>{__('Details', 'fair-events')}</h2>
					</CardHeader>
					<CardBody>
						<div className="fair-events-event-details-columns">
							<VStack spacing={4}>
								<TextControl
									label={__('Title', 'fair-events')}
									value={title}
									onChange={setTitle}
									required
								/>

								<CheckboxControl
									label={__('All day', 'fair-events')}
									checked={allDay}
									onChange={setAllDay}
								/>

								{allDay ? (
									<HStack spacing={4} alignment="top" wrap>
										<TextControl
											label={__(
												'Start date',
												'fair-events'
											)}
											type="date"
											value={startDate}
											onChange={setStartDate}
											required
										/>
										<TextControl
											label={__(
												'End date',
												'fair-events'
											)}
											type="date"
											value={endDate}
											onChange={setEndDate}
											required
										/>
									</HStack>
								) : (
									<HStack spacing={4} alignment="top" wrap>
										<TextControl
											label={__(
												'Start date',
												'fair-events'
											)}
											type="date"
											value={startDate}
											onChange={setStartDate}
											required
										/>
										<TextControl
											label={__(
												'Start time',
												'fair-events'
											)}
											type="time"
											value={startTime}
											onChange={setStartTime}
											required
										/>
										<TextControl
											label={__(
												'End date',
												'fair-events'
											)}
											type="date"
											value={endDate}
											onChange={setEndDate}
											required
										/>
										<TextControl
											label={__(
												'End time',
												'fair-events'
											)}
											type="time"
											value={endTime}
											onChange={setEndTime}
											required
										/>
									</HStack>
								)}

								<SelectControl
									label={__('Event length', 'fair-events')}
									value={String(durationValue)}
									options={durationOptions.map((opt) => ({
										label: opt.label,
										value: String(opt.value),
									}))}
									onChange={handleDurationChange}
								/>
							</VStack>

							<VStack spacing={4}>
								<FormTokenField
									label={__('Categories', 'fair-events')}
									value={[
										...categories
											.map((id) => {
												const cat =
													availableCategories.find(
														(c) => c.id === id
													);
												return cat ? cat.name : '';
											})
											.filter(Boolean),
										...creatingCategories,
									]}
									suggestions={availableCategories.map(
										(c) => c.name
									)}
									onChange={(tokens) => {
										const ids = [];
										const pending = [];

										tokens.forEach((token) => {
											const cat =
												availableCategories.find(
													(c) => c.name === token
												);
											if (cat) {
												ids.push(cat.id);
											} else {
												pending.push(token);
											}
										});

										setCategories(ids);
										setCreatingCategories(pending);

										pending
											.filter(
												(name) =>
													!creatingCategories.includes(
														name
													)
											)
											.forEach((name) =>
												createCategory(name)
											);
									}}
									__experimentalExpandOnFocus
								/>

								{venuesEnabled ? (
									<SelectControl
										label={__('Venue', 'fair-events')}
										value={venueId}
										options={venueOptions}
										onChange={setVenueId}
									/>
								) : (
									<TextControl
										label={__('Address', 'fair-events')}
										value={address}
										onChange={setAddress}
									/>
								)}
							</VStack>
						</div>
					</CardBody>
				</Card>

				{eventDate.occurrence_type !== 'generated' && (
					<Card className="fair-events-event-details-card">
						<CardHeader>
							<h2>{__('Recurrence', 'fair-events')}</h2>
						</CardHeader>
						<CardBody>
							<VStack spacing={4}>
								<RecurrenceControl
									value={recurrence}
									onChange={setRecurrence}
								/>

								{eventDate.occurrence_type === 'master' &&
									(eventDate.generated_occurrences?.length >
										0 ||
										eventDate.cancelled_dates?.length >
											0) && (
										<RecurrenceCalendar
											generatedOccurrences={
												eventDate.generated_occurrences
											}
											cancelledDates={
												eventDate.cancelled_dates
											}
											masterDate={
												eventDate.start_datetime?.split(
													' '
												)[0]
											}
											manageEventUrl={`${manageEventUrl}&event_date_id=${eventDateId}`}
											onToggleExdate={handleToggleExdate}
											togglingExdate={togglingExdate}
											embedded
										/>
									)}
							</VStack>
						</CardBody>
					</Card>
				)}

				{renderLinksTab()}
			</div>

			<HStack
				spacing={2}
				style={{ marginTop: '16px' }}
				justify="flex-start"
			>
				<Button
					variant="primary"
					onClick={handleSave}
					isBusy={saving}
					disabled={saving || !title.trim()}
				>
					{__('Save event details', 'fair-events')}
				</Button>
				{!title.trim() && (
					<span style={{ color: '#d63638' }}>
						{__('Title is required', 'fair-events')}
					</span>
				)}
			</HStack>
		</>
	);

	const renderLinksTab = () => (
		<Card className="fair-events-event-details-card">
			<CardHeader>
				<h2>{__('Where does this event link to?', 'fair-events')}</h2>
			</CardHeader>
			<CardBody>
				<VStack spacing={4}>
					{linkedPosts.length > 0 && (
						<>
							<Notice status="info" isDismissible={false}>
								{sprintf(
									/* translators: %d: number of linked posts */
									_n(
										'This event is linked to %d post.',
										'This event is linked to %d posts.',
										linkedPosts.length,
										'fair-events'
									),
									linkedPosts.length
								)}
							</Notice>
							{linkedPosts.map((lp) => (
								<HStack key={lp.id} spacing={3} wrap>
									<span>
										<strong>{lp.title}</strong> ({lp.status}
										)
										{lp.is_primary && (
											<span
												style={{
													marginLeft: '4px',
													color: '#007cba',
													fontSize: '12px',
												}}
											>
												{__('Primary', 'fair-events')}
											</span>
										)}
									</span>
									{lp.view_url && (
										<Button
											variant="secondary"
											href={lp.view_url}
											target="_blank"
											size="small"
										>
											{__('View Entry', 'fair-events')}
										</Button>
									)}
									{lp.edit_url && (
										<Button
											variant="secondary"
											href={lp.edit_url}
											size="small"
										>
											{__('Edit Post', 'fair-events')}
										</Button>
									)}
									<Button
										variant="tertiary"
										size="small"
										isDestructive
										onClick={() => handleUnlinkPost(lp.id)}
									>
										{__('Unlink', 'fair-events')}
									</Button>
								</HStack>
							))}
						</>
					)}

					{!isLinkedToPost && linkedPosts.length === 0 && (
						<>
							<RadioControl
								label={__('Link type', 'fair-events')}
								hideLabelFromVision
								selected={linkType}
								options={[
									{
										label: __(
											'A page on this site',
											'fair-events'
										),
										value: 'post',
									},
									{
										label: __(
											'An external website',
											'fair-events'
										),
										value: 'external',
									},
									{
										label: __(
											'Nowhere — show details only',
											'fair-events'
										),
										value: 'none',
									},
								]}
								onChange={setLinkType}
							/>

							{linkType === 'external' && (
								<TextControl
									label={__('External URL', 'fair-events')}
									type="url"
									value={externalUrl}
									onChange={setExternalUrl}
									placeholder="https://"
								/>
							)}

							{linkType === 'post' && (
								<>
									<SelectControl
										label={__('Post type', 'fair-events')}
										value={selectedPostType}
										options={enabledPostTypes.map((pt) => ({
											label: pt.label,
											value: pt.slug,
										}))}
										onChange={setSelectedPostType}
									/>
									<Button
										variant="primary"
										onClick={handleCreatePost}
										isBusy={creatingPost}
										disabled={creatingPost}
									>
										{__('Create New Post', 'fair-events')}
									</Button>

									<VStack spacing={2}>
										<h3 style={{ margin: 0 }}>
											{__(
												'Link Additional Post',
												'fair-events'
											)}
										</h3>
										<TextControl
											label={__(
												'Search posts by title',
												'fair-events'
											)}
											onChange={handleSearchPosts}
											placeholder={__(
												'Start typing to search...',
												'fair-events'
											)}
										/>
										{searchResults.length > 0 && (
											<SelectControl
												label={__(
													'Select a post',
													'fair-events'
												)}
												value={linkPostId}
												options={[
													{
														label: __(
															'Select...',
															'fair-events'
														),
														value: '',
													},
													...searchResults.map(
														(r) => ({
															label: r.title,
															value: String(r.id),
														})
													),
												]}
												onChange={setLinkPostId}
											/>
										)}
										{linkPostId && (
											<Button
												variant="primary"
												onClick={handleLinkPost}
												isBusy={linkingPost}
												disabled={linkingPost}
											>
												{__('Link Post', 'fair-events')}
											</Button>
										)}
									</VStack>
								</>
							)}
						</>
					)}
				</VStack>
			</CardBody>
		</Card>
	);

	return (
		<div className="wrap fair-events-manage-event">
			<style>
				{`.fair-events-manage-event .components-card > div:first-child { height: auto; }
.fair-events-manage-event .components-card__body > * { max-width: 600px; }
.fair-events-manage-event .fair-events-tickets .components-card__body > * { max-width: none; }
.fair-events-manage-event .fair-events-photos .components-card__body > * { max-width: none; }
.fair-events-manage-event .fair-events-event-details-card .components-card__body > * { max-width: none; }
/* Stack the event-details cards vertically, each spanning the full
   available width — matches the Audience tab idiom. */
.fair-events-manage-event .fair-events-event-details-grid {
	display: flex;
	flex-direction: column;
	gap: 16px;
	margin-top: 16px;
}
.fair-events-manage-event .fair-events-event-details-columns {
	display: grid;
	grid-template-columns: 1fr;
	gap: 24px;
	align-items: start;
}
@media (min-width: 960px) {
	.fair-events-manage-event .fair-events-event-details-columns {
		grid-template-columns: 1fr 1fr;
	}
}
/* Let the tab bar wrap onto multiple rows instead of overflowing the
   viewport on narrow screens. Harmless on desktop, where the tabs fit on
   one row. */
.fair-events-manage-event .components-tab-panel__tabs { flex-wrap: wrap; row-gap: 4px; }
/* The 1.5px height of the active-tab indicator anti-aliases to a thin
   darker top edge at 1x DPI. Round to 2px so the bar renders crisp. */
.fair-events-manage-event .components-tab-panel__tabs-item.is-active::after { height: 2px; outline: none; }
.fair-events-manage-event .fair-events-context-badge { margin-left: 8px; padding: 2px 8px; border-radius: 12px; background: #f0f0f1; font-size: 12px; }`}
			</style>
			<h1>
				{__('Manage Event', 'fair-events')}
				{': '}
				{eventDate.display_url ? (
					<a
						href={eventDate.display_url}
						target="_blank"
						rel="noreferrer"
						style={{
							color: 'inherit',
							textDecoration: 'none',
							borderBottom: '1px dotted currentColor',
						}}
					>
						{getEventDisplayTitle(title)}
					</a>
				) : (
					getEventDisplayTitle(title)
				)}
			</h1>

			<EventContextHeader
				eventDate={eventDate}
				manageEventUrl={manageEventUrl}
			/>

			{error && (
				<Notice
					status="error"
					isDismissible
					onRemove={() => setError(null)}
				>
					{error}
				</Notice>
			)}

			{success && (
				<Notice
					status="success"
					isDismissible
					onRemove={() => setSuccess(null)}
				>
					{success}
				</Notice>
			)}

			{recurrenceImpact && (
				<RecurrenceImpactSummary
					impact={recurrenceImpact.impact}
					blocked={recurrenceImpact.blocked}
					onDismiss={() => setRecurrenceImpact(null)}
				/>
			)}

			<TabPanel
				tabs={tabs}
				initialTabName={initialTab}
				onSelect={handleTabSelect}
			>
				{(tab) => {
					const descriptor = tabDescriptors.find(
						(d) => d.name === tab.name
					);
					return descriptor ? descriptor.render(ctx) : null;
				}}
			</TabPanel>

			<HStack spacing={2} style={{ marginTop: '16px' }}>
				<Button variant="secondary" href={calendarUrl}>
					{__('Back to Calendar', 'fair-events')}
				</Button>
			</HStack>

			<ConfirmDialog
				isOpen={deleteDialogOpen}
				onConfirm={confirmDelete}
				onCancel={() => setDeleteDialogOpen(false)}
				confirmButtonText={__('Delete event', 'fair-events')}
				cancelButtonText={__('Cancel', 'fair-events')}
			>
				{deleteConfirmMessage}
			</ConfirmDialog>
		</div>
	);
}
