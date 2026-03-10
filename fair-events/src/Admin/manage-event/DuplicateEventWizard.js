/**
 * Duplicate Event Wizard
 *
 * Multi-step wizard for duplicating an event with customizable options.
 *
 * @package FairEvents
 */

import { useState, useEffect, useMemo, useCallback } from '@wordpress/element';
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
import apiFetch from '@wordpress/api-fetch';
import { DurationOptions, calculateDuration } from 'fair-events-shared';
import { adjustTicketDates } from './adjustTicketDates.js';
import EventTickets from './EventTickets.js';

export default function DuplicateEventWizard({
	sourceEventDate,
	sourceEventDateId,
	audienceUrl,
	onCancel,
	manageEventUrl,
}) {
	// Event details state - pre-populated from source
	const [title, setTitle] = useState(
		(sourceEventDate.title || '') + ' (Copy)'
	);
	const [allDay, setAllDay] = useState(sourceEventDate.all_day || false);
	const [startDate, setStartDate] = useState('');
	const [startTime, setStartTime] = useState('');
	const [endDate, setEndDate] = useState('');
	const [endTime, setEndTime] = useState('');
	const [venueId, setVenueId] = useState(
		sourceEventDate.venue_id ? String(sourceEventDate.venue_id) : ''
	);
	const [categories, setCategories] = useState(
		sourceEventDate.categories?.map((c) => c.id) || []
	);
	const [recurrenceEnabled, setRecurrenceEnabled] = useState(false);
	const [recurrenceFrequency, setRecurrenceFrequency] = useState('weekly');
	const [recurrenceEndType, setRecurrenceEndType] = useState('count');
	const [recurrenceCount, setRecurrenceCount] = useState(10);
	const [recurrenceUntil, setRecurrenceUntil] = useState('');

	// Image state
	const [themeImageId, setThemeImageId] = useState(
		sourceEventDate.theme_image_id || null
	);
	const [themeImageUrl, setThemeImageUrl] = useState(
		sourceEventDate.theme_image_url || null
	);

	// Links state
	const [linksOption, setLinksOption] = useState('clone');

	// Tickets state
	const [ticketData, setTicketData] = useState(null);
	const [loadingTickets, setLoadingTickets] = useState(true);

	// Audience state
	const [collaborators, setCollaborators] = useState([]);
	const [selectedCollaborators, setSelectedCollaborators] = useState({});
	const [loadingCollaborators, setLoadingCollaborators] = useState(false);

	// UI state
	const [venues, setVenues] = useState([]);
	const [availableCategories, setAvailableCategories] = useState([]);
	const [creating, setCreating] = useState(false);
	const [progress, setProgress] = useState('');
	const [error, setError] = useState(null);
	const [completedSteps, setCompletedSteps] = useState([]);
	const [failedStep, setFailedStep] = useState(null);
	const [newEventDateId, setNewEventDateId] = useState(null);

	// Initialize dates shifted +7 days
	useEffect(() => {
		if (sourceEventDate.start_datetime) {
			const [sDate, sTime] = sourceEventDate.start_datetime.split(' ');
			const shiftedStart = shiftDate(sDate, 7);
			setStartDate(shiftedStart);
			setStartTime(sTime ? sTime.substring(0, 5) : '');
		}
		if (sourceEventDate.end_datetime) {
			const [eDate, eTime] = sourceEventDate.end_datetime.split(' ');
			const shiftedEnd = shiftDate(eDate, 7);
			setEndDate(shiftedEnd);
			setEndTime(eTime ? eTime.substring(0, 5) : '');
		}

		// Parse recurrence from source
		if (sourceEventDate.rrule) {
			setRecurrenceEnabled(true);
			parseRRule(sourceEventDate.rrule);
		}
	}, [sourceEventDate]);

	// Load venues and categories
	useEffect(() => {
		apiFetch({ path: '/fair-events/v1/venues' })
			.then(setVenues)
			.catch(() => {});
		apiFetch({ path: '/fair-events/v1/sources/categories' })
			.then(setAvailableCategories)
			.catch(() => {});
	}, []);

	// Load tickets from source
	useEffect(() => {
		setLoadingTickets(true);
		apiFetch({
			path: `/fair-events/v1/event-dates/${sourceEventDateId}/tickets`,
		})
			.then((data) => {
				setTicketData(data);
			})
			.catch(() => {
				setTicketData(null);
			})
			.finally(() => setLoadingTickets(false));
	}, [sourceEventDateId]);

	// Load collaborators from source
	useEffect(() => {
		if (!audienceUrl || !sourceEventDate.event_id) return;
		setLoadingCollaborators(true);
		apiFetch({
			path: `/fair-audience/v1/events/${sourceEventDate.event_id}/participants`,
		})
			.then((data) => {
				const collabs = (Array.isArray(data) ? data : []).filter(
					(p) => p.label === 'collaborator'
				);
				setCollaborators(collabs);
				const selected = {};
				collabs.forEach((c) => {
					selected[c.id] = true;
				});
				setSelectedCollaborators(selected);
			})
			.catch(() => {
				setCollaborators([]);
			})
			.finally(() => setLoadingCollaborators(false));
	}, [audienceUrl, sourceEventDate.event_id]);

	// Duration helpers
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
			setEndDate(formatDate(end));
		} else {
			if (!startTime) return;
			const minutes = parseInt(value, 10);
			const start = new Date(`${startDate}T${startTime}`);
			const end = new Date(start.getTime() + minutes * 60000);
			setEndDate(formatDate(end));
			setEndTime(
				`${String(end.getHours()).padStart(2, '0')}:${String(
					end.getMinutes()
				).padStart(2, '0')}`
			);
		}
	};

	const venueOptions = [
		{ label: __('— No venue —', 'fair-events'), value: '' },
		...venues.map((v) => ({ label: v.name, value: String(v.id) })),
	];

	// Recurrence helpers
	const parseRRule = (rrule) => {
		const parts = {};
		rrule.split(';').forEach((part) => {
			const [key, val] = part.split('=');
			parts[key] = val;
		});

		const freq = parts.FREQ || 'WEEKLY';
		const interval = parseInt(parts.INTERVAL || '1', 10);

		if (freq === 'DAILY') setRecurrenceFrequency('daily');
		else if (freq === 'WEEKLY' && interval === 2)
			setRecurrenceFrequency('biweekly');
		else if (freq === 'WEEKLY') setRecurrenceFrequency('weekly');
		else if (freq === 'MONTHLY') setRecurrenceFrequency('monthly');

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
		if (interval > 1) ruleParts.push(`INTERVAL=${interval}`);
		if (recurrenceEndType === 'count' && recurrenceCount)
			ruleParts.push(`COUNT=${recurrenceCount}`);
		else if (recurrenceEndType === 'until' && recurrenceUntil)
			ruleParts.push(`UNTIL=${recurrenceUntil.replace(/-/g, '')}`);

		return ruleParts.join(';');
	};

	const handleSelectImage = () => {
		const frame = window.wp.media({
			title: __('Select Theme Image', 'fair-events'),
			button: { text: __('Use this image', 'fair-events') },
			multiple: false,
			library: { type: 'image' },
		});

		frame.on('select', () => {
			const attachment = frame.state().get('selection').first().toJSON();
			setThemeImageId(attachment.id);
			setThemeImageUrl(attachment.url);
		});

		frame.open();
	};

	const handleRemoveImage = () => {
		setThemeImageId(null);
		setThemeImageUrl(null);
	};

	// Build new start datetime string
	const getNewStartDatetime = () => {
		if (allDay) return `${startDate} 00:00:00`;
		return `${startDate} ${startTime}:00`;
	};

	const getNewEndDatetime = () => {
		if (allDay) return `${endDate} 00:00:00`;
		return `${endDate} ${endTime}:00`;
	};

	// Adjust ticket sale periods based on date shift
	const getAdjustedTicketData = useCallback(() => {
		if (!ticketData) return null;

		const adjustedPeriods = adjustTicketDates(
			ticketData.sale_periods || [],
			sourceEventDate.start_datetime,
			getNewStartDatetime()
		);

		return {
			...ticketData,
			sale_periods: adjustedPeriods,
		};
	}, [ticketData, startDate, startTime, allDay, sourceEventDate]);

	// Creation sequence
	const handleCreate = async () => {
		setCreating(true);
		setError(null);
		setCompletedSteps([]);
		setFailedStep(null);

		let createdEventDateId = null;
		let createdEventId = null;

		try {
			// Step 1: Create event
			setProgress(__('Creating event…', 'fair-events'));
			const newEvent = await apiFetch({
				path: '/fair-events/v1/event-dates',
				method: 'POST',
				data: {
					title,
					start_datetime: getNewStartDatetime(),
					end_datetime: getNewEndDatetime(),
					all_day: allDay,
					venue_id: venueId ? parseInt(venueId, 10) : null,
					rrule: buildRRule(),
					categories,
				},
			});
			createdEventDateId = newEvent.id;
			setNewEventDateId(createdEventDateId);
			setCompletedSteps((prev) => [...prev, 'create']);

			// Step 2: Set theme image
			if (themeImageId) {
				setProgress(__('Setting theme image…', 'fair-events'));
				await apiFetch({
					path: `/fair-events/v1/event-dates/${createdEventDateId}`,
					method: 'PUT',
					data: { theme_image_id: themeImageId },
				});
			}
			setCompletedSteps((prev) => [...prev, 'image']);

			// Step 3: Handle links
			const linkedPosts = sourceEventDate.linked_posts || [];
			if (linksOption === 'clone' && linkedPosts.length > 0) {
				setProgress(__('Cloning posts…', 'fair-events'));
				const cloneResult = await apiFetch({
					path: `/fair-events/v1/event-dates/${createdEventDateId}/clone-posts`,
					method: 'POST',
					data: {
						source_event_date_id: sourceEventDateId,
					},
				});
				createdEventId = cloneResult.event_id;
			}
			setCompletedSteps((prev) => [...prev, 'links']);

			// Step 4: Save tickets
			const adjusted = getAdjustedTicketData();
			if (adjusted && hasTicketData(adjusted)) {
				setProgress(__('Saving tickets…', 'fair-events'));
				// Build prices array from the ticket data
				const prices = (adjusted.prices || []).map((p) => ({
					ticket_type_id: p.ticket_type_id,
					sale_period_id: p.sale_period_id,
					price: p.price,
					capacity: p.capacity,
				}));
				await apiFetch({
					path: `/fair-events/v1/event-dates/${createdEventDateId}/tickets`,
					method: 'PUT',
					data: {
						capacity: adjusted.capacity,
						ticket_types: (adjusted.ticket_types || []).map(
							(t, i) => ({
								name: t.name,
								capacity: t.capacity,
								sort_order: i,
							})
						),
						sale_periods: (adjusted.sale_periods || []).map(
							(p, i) => ({
								name: p.name,
								sale_start: p.sale_start,
								sale_end: p.sale_end,
								sort_order: i,
							})
						),
						prices,
					},
				});
			}
			setCompletedSteps((prev) => [...prev, 'tickets']);

			// Step 5: Add collaborators
			const selectedIds = Object.entries(selectedCollaborators)
				.filter(([, checked]) => checked)
				.map(([id]) => parseInt(id, 10));

			if (audienceUrl && selectedIds.length > 0) {
				setProgress(__('Adding collaborators…', 'fair-events'));

				// We need an event_id (WP post) to add participants.
				// If links option was "reuse" or "clone", we should have one.
				// If "empty", create a draft post and link it first.
				let eventId = createdEventId;
				if (!eventId) {
					// Fetch the created event to check if it has an event_id
					const freshEvent = await apiFetch({
						path: `/fair-events/v1/event-dates/${createdEventDateId}`,
					});
					eventId = freshEvent.event_id;
				}

				if (!eventId) {
					// Create a minimal draft post
					const newPost = await apiFetch({
						path: '/wp/v2/fair_event',
						method: 'POST',
						data: {
							title,
							status: 'draft',
						},
					});
					eventId = newPost.id;
					// Link it to the event date
					await apiFetch({
						path: `/fair-events/v1/event-dates/${createdEventDateId}/link-post`,
						method: 'POST',
						data: { post_id: eventId },
					});
				}

				await apiFetch({
					path: `/fair-audience/v1/events/${eventId}/participants/batch`,
					method: 'POST',
					data: {
						participant_ids: selectedIds,
						label: 'collaborator',
					},
				});
			}
			setCompletedSteps((prev) => [...prev, 'collaborators']);

			// Success - redirect
			setProgress(__('Done! Redirecting…', 'fair-events'));
			window.location.href = `${manageEventUrl}&event_date_id=${createdEventDateId}`;
		} catch (err) {
			const currentStep = getNextStep(completedSteps);
			setFailedStep(currentStep);
			setError(
				err.message ||
					__('Failed to create duplicate event.', 'fair-events')
			);
			setCreating(false);
		}
	};

	const linkedPosts = sourceEventDate.linked_posts || [];

	const tabs = useMemo(
		() => [
			{
				name: 'event-details',
				title: __('Event Details', 'fair-events'),
			},
			{
				name: 'images',
				title: __('Images', 'fair-events'),
			},
			...(linkedPosts.length > 0
				? [
						{
							name: 'links',
							title: __('Links', 'fair-events'),
						},
				  ]
				: []),
			{
				name: 'tickets',
				title: __('Tickets', 'fair-events'),
			},
			...(audienceUrl && sourceEventDate.event_id
				? [
						{
							name: 'audience',
							title: __('Audience', 'fair-events'),
						},
				  ]
				: []),
		],
		[audienceUrl, linkedPosts.length, sourceEventDate.event_id]
	);

	return (
		<div className="wrap fair-events-manage-event">
			<style>
				{`.fair-events-manage-event .components-card > div:first-child { height: auto; }
.fair-events-manage-event .components-card__body > * { max-width: 600px; }
.fair-events-manage-event .fair-events-tickets .components-card__body > * { max-width: none; }`}
			</style>
			<h1>
				{__('Duplicate Event', 'fair-events')}
				{sourceEventDate.title && `: ${sourceEventDate.title}`}
			</h1>

			{error && (
				<Notice
					status="error"
					isDismissible
					onRemove={() => setError(null)}
				>
					{error}
					{newEventDateId && (
						<p>
							<a
								href={`${manageEventUrl}&event_date_id=${newEventDateId}`}
							>
								{__(
									'View partially created event',
									'fair-events'
								)}
							</a>
						</p>
					)}
				</Notice>
			)}

			{creating && (
				<Notice status="info" isDismissible={false}>
					<HStack spacing={2}>
						<Spinner />
						<span>{progress}</span>
					</HStack>
				</Notice>
			)}

			{!creating && (
				<TabPanel tabs={tabs}>
					{(tab) => {
						if (tab.name === 'event-details') {
							return renderEventDetailsTab();
						}
						if (tab.name === 'images') {
							return renderImagesTab();
						}
						if (tab.name === 'links') {
							return renderLinksTab();
						}
						if (tab.name === 'tickets') {
							return renderTicketsTab();
						}
						if (tab.name === 'audience') {
							return renderAudienceTab();
						}
						return null;
					}}
				</TabPanel>
			)}

			{!creating && (
				<HStack spacing={2} style={{ marginTop: '16px' }}>
					<Button
						variant="primary"
						onClick={handleCreate}
						disabled={!title || !startDate}
					>
						{__('Create Duplicate', 'fair-events')}
					</Button>
					<Button variant="secondary" onClick={onCancel}>
						{__('Cancel', 'fair-events')}
					</Button>
				</HStack>
			)}
		</div>
	);

	function renderEventDetailsTab() {
		return (
			<Card style={{ marginTop: '16px' }}>
				<CardHeader>
					<h2>{__('Event Details', 'fair-events')}</h2>
				</CardHeader>
				<CardBody>
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
									label={__('Start date', 'fair-events')}
									type="date"
									value={startDate}
									onChange={setStartDate}
									required
								/>
								<TextControl
									label={__('End date', 'fair-events')}
									type="date"
									value={endDate}
									onChange={setEndDate}
									required
								/>
							</HStack>
						) : (
							<HStack spacing={4} alignment="top" wrap>
								<TextControl
									label={__('Start date', 'fair-events')}
									type="date"
									value={startDate}
									onChange={setStartDate}
									required
								/>
								<TextControl
									label={__('Start time', 'fair-events')}
									type="time"
									value={startTime}
									onChange={setStartTime}
									required
								/>
								<TextControl
									label={__('End date', 'fair-events')}
									type="date"
									value={endDate}
									onChange={setEndDate}
									required
								/>
								<TextControl
									label={__('End time', 'fair-events')}
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

						<SelectControl
							label={__('Venue', 'fair-events')}
							value={venueId}
							options={venueOptions}
							onChange={setVenueId}
						/>

						<FormTokenField
							label={__('Categories', 'fair-events')}
							value={categories.map((id) => {
								const cat = availableCategories.find(
									(c) => c.id === id
								);
								return cat ? cat.name : '';
							})}
							suggestions={availableCategories.map((c) => c.name)}
							onChange={(tokens) => {
								const ids = tokens
									.map((token) => {
										const cat = availableCategories.find(
											(c) => c.name === token
										);
										return cat ? cat.id : null;
									})
									.filter(Boolean);
								setCategories(ids);
							}}
							__experimentalExpandOnFocus
						/>

						<CheckboxControl
							label={__('Repeat this event', 'fair-events')}
							checked={recurrenceEnabled}
							onChange={setRecurrenceEnabled}
						/>

						{recurrenceEnabled && (
							<VStack spacing={3}>
								<SelectControl
									label={__('Frequency', 'fair-events')}
									value={recurrenceFrequency}
									options={[
										{
											label: __('Daily', 'fair-events'),
											value: 'daily',
										},
										{
											label: __('Weekly', 'fair-events'),
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
											label: __('Monthly', 'fair-events'),
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
										label={__('End date', 'fair-events')}
										type="date"
										value={recurrenceUntil}
										onChange={setRecurrenceUntil}
									/>
								)}
							</VStack>
						)}
					</VStack>
				</CardBody>
			</Card>
		);
	}

	function renderImagesTab() {
		return (
			<Card style={{ marginTop: '16px' }}>
				<CardHeader>
					<h2>{__('Theme Image', 'fair-events')}</h2>
				</CardHeader>
				<CardBody>
					<VStack spacing={4}>
						{themeImageUrl && (
							<img
								src={themeImageUrl}
								alt={__('Theme image preview', 'fair-events')}
								style={{
									maxWidth: '300px',
									height: 'auto',
								}}
							/>
						)}
						<HStack spacing={2}>
							<Button
								variant="secondary"
								onClick={handleSelectImage}
							>
								{themeImageId
									? __('Change Image', 'fair-events')
									: __('Select Image', 'fair-events')}
							</Button>
							{themeImageId && (
								<Button
									variant="tertiary"
									isDestructive
									onClick={handleRemoveImage}
								>
									{__('Remove Image', 'fair-events')}
								</Button>
							)}
						</HStack>
					</VStack>
				</CardBody>
			</Card>
		);
	}

	function renderLinksTab() {
		return (
			<Card style={{ marginTop: '16px' }}>
				<CardHeader>
					<h2>{__('Linked Posts', 'fair-events')}</h2>
				</CardHeader>
				<CardBody>
					<VStack spacing={4}>
						<RadioControl
							label={__(
								'How to handle linked posts',
								'fair-events'
							)}
							selected={linksOption}
							options={[
								{
									label: __(
										'Clone linked posts — create draft copies',
										'fair-events'
									),
									value: 'clone',
								},
								{
									label: __(
										'Leave empty — no links',
										'fair-events'
									),
									value: 'empty',
								},
							]}
							onChange={setLinksOption}
						/>

						{linkedPosts.length > 0 && (
							<VStack spacing={2}>
								<h3 style={{ margin: 0 }}>
									{__(
										'Source event linked posts:',
										'fair-events'
									)}
								</h3>
								{linkedPosts.map((lp) => (
									<HStack key={lp.id} spacing={3}>
										<span>
											<strong>{lp.title}</strong> (
											{lp.status})
											{lp.is_primary && (
												<span
													style={{
														marginLeft: '4px',
														color: '#007cba',
														fontSize: '12px',
													}}
												>
													{__(
														'Primary',
														'fair-events'
													)}
												</span>
											)}
										</span>
									</HStack>
								))}
							</VStack>
						)}
					</VStack>
				</CardBody>
			</Card>
		);
	}

	function renderTicketsTab() {
		if (loadingTickets) {
			return <Spinner />;
		}

		if (!ticketData || !hasTicketData(ticketData)) {
			return (
				<Card style={{ marginTop: '16px' }}>
					<CardBody>
						<p>
							{__(
								'No ticket data to copy from source event.',
								'fair-events'
							)}
						</p>
					</CardBody>
				</Card>
			);
		}

		const adjusted = getAdjustedTicketData();

		return (
			<Card style={{ marginTop: '16px' }}>
				<CardHeader>
					<h2>{__('Tickets', 'fair-events')}</h2>
				</CardHeader>
				<CardBody>
					<VStack spacing={4}>
						<Notice status="info" isDismissible={false}>
							{__(
								'Ticket data will be copied from the source event. Sale period dates are automatically adjusted based on the date shift.',
								'fair-events'
							)}
						</Notice>

						{adjusted && (
							<VStack spacing={3}>
								<p>
									<strong>
										{__('Capacity:', 'fair-events')}
									</strong>{' '}
									{adjusted.capacity ?? '—'}
								</p>

								{(adjusted.ticket_types || []).length > 0 && (
									<>
										<h3 style={{ margin: 0 }}>
											{__('Ticket Types', 'fair-events')}
										</h3>
										{adjusted.ticket_types.map((t) => (
											<span key={t.id || t.name}>
												{t.name}
												{t.capacity
													? ` (${__(
															'capacity:',
															'fair-events'
													  )} ${t.capacity})`
													: ''}
											</span>
										))}
									</>
								)}

								{(adjusted.sale_periods || []).length > 0 && (
									<>
										<h3 style={{ margin: 0 }}>
											{__('Sale Periods', 'fair-events')}
										</h3>
										{adjusted.sale_periods.map((p) => (
											<span key={p.id || p.name}>
												{p.name}: {p.sale_start} →{' '}
												{p.sale_end}
											</span>
										))}
									</>
								)}
							</VStack>
						)}
					</VStack>
				</CardBody>
			</Card>
		);
	}

	function renderAudienceTab() {
		if (loadingCollaborators) {
			return <Spinner />;
		}

		if (collaborators.length === 0) {
			return (
				<Card style={{ marginTop: '16px' }}>
					<CardBody>
						<p>
							{__(
								'No collaborators found on source event.',
								'fair-events'
							)}
						</p>
					</CardBody>
				</Card>
			);
		}

		return (
			<Card style={{ marginTop: '16px' }}>
				<CardHeader>
					<h2>{__('Collaborators', 'fair-events')}</h2>
				</CardHeader>
				<CardBody>
					<VStack spacing={3}>
						<p style={{ color: '#666' }}>
							{__(
								'Select which collaborators to copy to the new event.',
								'fair-events'
							)}
						</p>
						{collaborators.map((collab) => (
							<CheckboxControl
								key={collab.id}
								label={collab.name || collab.email || collab.id}
								checked={
									selectedCollaborators[collab.id] || false
								}
								onChange={(checked) => {
									setSelectedCollaborators((prev) => ({
										...prev,
										[collab.id]: checked,
									}));
								}}
							/>
						))}
					</VStack>
				</CardBody>
			</Card>
		);
	}
}

function shiftDate(dateStr, days) {
	const date = new Date(dateStr);
	date.setDate(date.getDate() + days);
	return formatDate(date);
}

function formatDate(date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

function hasTicketData(data) {
	return (
		(data.ticket_types && data.ticket_types.length > 0) ||
		(data.sale_periods && data.sale_periods.length > 0)
	);
}

function getNextStep(completedSteps) {
	const allSteps = ['create', 'image', 'links', 'tickets', 'collaborators'];
	for (const step of allSteps) {
		if (!completedSteps.includes(step)) return step;
	}
	return 'unknown';
}
