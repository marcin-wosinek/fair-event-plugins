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
	__experimentalNumberControl as NumberControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { applyFilters } from '@wordpress/hooks';
import apiFetch from '@wordpress/api-fetch';
import {
	DurationOptions,
	calculateDuration,
	isLinkOnlyEvent,
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

	// Recurrence state
	const [recurrenceEnabled, setRecurrenceEnabled] = useState(false);
	const [recurrenceFrequency, setRecurrenceFrequency] = useState('weekly');
	const [recurrenceEndType, setRecurrenceEndType] = useState('count');
	const [recurrenceCount, setRecurrenceCount] = useState(10);
	const [recurrenceUntil, setRecurrenceUntil] = useState('');

	// Post creation state
	const [creatingPost, setCreatingPost] = useState(false);
	const [selectedPostType, setSelectedPostType] = useState(
		enabledPostTypes[0]?.slug || 'fair_event'
	);

	// Link additional post state
	const [linkingPost, setLinkingPost] = useState(false);
	const [linkPostId, setLinkPostId] = useState('');
	const [searchResults, setSearchResults] = useState([]);
	const [activeTab, setActiveTab] = useState(
		() =>
			new URLSearchParams(window.location.search).get('tab') ||
			'event-details'
	);
	const ticketSaveRef = useRef(null);
	const [togglingExdate, setTogglingExdate] = useState(null);
	const [recurrenceImpact, setRecurrenceImpact] = useState(null);

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

	const populateForm = (data) => {
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
			setRecurrenceEnabled(true);
			parseRRule(data.rrule);
		} else {
			setRecurrenceEnabled(false);
		}
	};

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

	// Recurrence helpers
	const parseRRule = (rrule) => {
		const parts = {};
		rrule.split(';').forEach((part) => {
			const [key, val] = part.split('=');
			parts[key] = val;
		});

		const freq = parts.FREQ || 'WEEKLY';
		const interval = parseInt(parts.INTERVAL || '1', 10);

		if (freq === 'DAILY') {
			setRecurrenceFrequency('daily');
		} else if (freq === 'WEEKLY' && interval === 2) {
			setRecurrenceFrequency('biweekly');
		} else if (freq === 'WEEKLY') {
			setRecurrenceFrequency('weekly');
		} else if (freq === 'MONTHLY') {
			setRecurrenceFrequency('monthly');
		}

		if (parts.COUNT) {
			setRecurrenceEndType('count');
			setRecurrenceCount(parseInt(parts.COUNT, 10));
		} else if (parts.UNTIL) {
			setRecurrenceEndType('until');
			const u = parts.UNTIL;
			setRecurrenceUntil(
				`${u.substring(0, 4)}-${u.substring(4, 6)}-${u.substring(6, 8)}`
			);
		} else {
			setRecurrenceEndType('count');
			setRecurrenceCount(10);
		}
	};

	const buildRRule = () => {
		if (!recurrenceEnabled) return null;

		let freq = 'WEEKLY';
		let interval = 1;

		switch (recurrenceFrequency) {
			case 'daily':
				freq = 'DAILY';
				break;
			case 'weekly':
				freq = 'WEEKLY';
				break;
			case 'biweekly':
				freq = 'WEEKLY';
				interval = 2;
				break;
			case 'monthly':
				freq = 'MONTHLY';
				break;
		}

		const ruleParts = [`FREQ=${freq}`];
		if (interval > 1) {
			ruleParts.push(`INTERVAL=${interval}`);
		}
		if (recurrenceEndType === 'count' && recurrenceCount) {
			ruleParts.push(`COUNT=${recurrenceCount}`);
		} else if (recurrenceEndType === 'until' && recurrenceUntil) {
			ruleParts.push(`UNTIL=${recurrenceUntil.replace(/-/g, '')}`);
		}

		return ruleParts.join(';');
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
					rrule: buildRRule(),
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

	const handleDelete = async () => {
		if (
			!window.confirm(
				__('Are you sure you want to delete this event?', 'fair-events')
			)
		) {
			return;
		}

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
		}
	};

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
		setActiveTab(tabName);
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
					onSaveRef={ticketSaveRef}
					startDatetime={eventDate.start_datetime}
					endDatetime={eventDate.end_datetime}
					isRecurring={recurrenceEnabled}
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
										onClick={handleDelete}
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

	// Shape TabPanel expects: { name, title, disabled? }.
	const tabs = tabDescriptors.map(({ name, title: tabTitle, disabled }) => ({
		name,
		title: tabTitle,
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
									value={categories.map((id) => {
										const cat = availableCategories.find(
											(c) => c.id === id
										);
										return cat ? cat.name : '';
									})}
									suggestions={availableCategories.map(
										(c) => c.name
									)}
									onChange={(tokens) => {
										const ids = tokens
											.map((token) => {
												const cat =
													availableCategories.find(
														(c) => c.name === token
													);
												return cat ? cat.id : null;
											})
											.filter(Boolean);
										setCategories(ids);
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
								<CheckboxControl
									label={__(
										'Repeat this event',
										'fair-events'
									)}
									checked={recurrenceEnabled}
									onChange={setRecurrenceEnabled}
								/>

								{recurrenceEnabled && (
									<VStack spacing={3}>
										<SelectControl
											label={__(
												'Frequency',
												'fair-events'
											)}
											value={recurrenceFrequency}
											options={[
												{
													label: __(
														'Daily',
														'fair-events'
													),
													value: 'daily',
												},
												{
													label: __(
														'Weekly',
														'fair-events'
													),
													value: 'weekly',
												},
												{
													label: __(
														'Biweekly',
														'fair-events'
													),
													value: 'biweekly',
												},
												{
													label: __(
														'Monthly',
														'fair-events'
													),
													value: 'monthly',
												},
											]}
											onChange={setRecurrenceFrequency}
										/>
										<SelectControl
											label={__('Ends', 'fair-events')}
											value={recurrenceEndType}
											options={[
												{
													label: __(
														'After number of occurrences',
														'fair-events'
													),
													value: 'count',
												},
												{
													label: __(
														'On a specific date',
														'fair-events'
													),
													value: 'until',
												},
											]}
											onChange={setRecurrenceEndType}
										/>
										{recurrenceEndType === 'count' && (
											<NumberControl
												label={__(
													'Number of occurrences',
													'fair-events'
												)}
												value={recurrenceCount}
												onChange={(val) =>
													setRecurrenceCount(
														parseInt(val, 10) || 1
													)
												}
												min={1}
												max={365}
											/>
										)}
										{recurrenceEndType === 'until' && (
											<TextControl
												label={__(
													'End date',
													'fair-events'
												)}
												type="date"
												value={recurrenceUntil}
												onChange={setRecurrenceUntil}
											/>
										)}
									</VStack>
								)}

								{eventDate.occurrence_type === 'master' &&
									(eventDate.generated_occurrences?.length >
										0 ||
										eventDate.exdates?.length > 0) && (
										<RecurrenceCalendar
											generatedOccurrences={
												eventDate.generated_occurrences
											}
											exdates={eventDate.exdates}
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
		</>
	);

	const renderLinksTab = () => (
		<Card className="fair-events-event-details-card">
			<CardHeader>
				<h2>{__('Link Options', 'fair-events')}</h2>
			</CardHeader>
			<CardBody>
				<VStack spacing={4}>
					{linkedPosts.length > 0 && (
						<>
							<Notice status="info" isDismissible={false}>
								{linkedPosts.length === 1
									? __(
											'This event is linked to 1 post.',
											'fair-events'
									  )
									: `${__(
											'This event is linked to',
											'fair-events'
									  )} ${linkedPosts.length} ${__(
											'posts.',
											'fair-events'
									  )}`}
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
								selected={linkType}
								options={[
									{
										label: __(
											'WordPress Post (entry)',
											'fair-events'
										),
										value: 'post',
									},
									{
										label: __(
											'External URL',
											'fair-events'
										),
										value: 'external',
									},
									{
										label: __(
											'Event placeholder',
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
				{title && (
					<>
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
								{title}
							</a>
						) : (
							title
						)}
					</>
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
				<Button
					variant="primary"
					onClick={
						activeTab === 'tickets'
							? () => ticketSaveRef.current?.()
							: handleSave
					}
					isBusy={saving}
					disabled={
						activeTab === 'event-details'
							? saving || !title
							: saving
					}
				>
					{__('Save Changes', 'fair-events')}
				</Button>
				<Button variant="secondary" href={calendarUrl}>
					{__('Back to Calendar', 'fair-events')}
				</Button>
			</HStack>
		</div>
	);
}
