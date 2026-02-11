/**
 * Manage Event App - Main Component
 *
 * Stage 2: Manage event details and link options.
 *
 * @package FairEvents
 */

import { useState, useEffect, useMemo } from '@wordpress/element';
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
	__experimentalNumberControl as NumberControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { DurationOptions, calculateDuration } from 'fair-events-shared';
import ImageExports from './ImageExports.js';

export default function ManageEventApp() {
	const eventDateId = window.fairEventsManageEventData?.eventDateId;
	const calendarUrl = window.fairEventsManageEventData?.calendarUrl;
	const enabledPostTypes =
		window.fairEventsManageEventData?.enabledPostTypes || [];
	const audienceUrl = window.fairEventsManageEventData?.audienceUrl || '';

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
	const [linkType, setLinkType] = useState('none');
	const [externalUrl, setExternalUrl] = useState('');
	const [themeImageId, setThemeImageId] = useState(null);
	const [themeImageUrl, setThemeImageUrl] = useState(null);
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

	useEffect(() => {
		if (!eventDateId) {
			setLoading(false);
			setError(__('No event date ID specified.', 'fair-events'));
			return;
		}
		loadEventDate();
		loadVenues();
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
		setThemeImageId(data.theme_image_id || null);
		setThemeImageUrl(data.theme_image_url || null);
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
					venue_id: venueId ? parseInt(venueId, 10) : null,
					link_type: linkType,
					external_url: linkType === 'external' ? externalUrl : null,
					theme_image_id: themeImageId,
					rrule: buildRRule(),
					categories,
				},
			});
			setEventDate(updated);
			setSuccess(__('Event updated successfully.', 'fair-events'));
		} catch (err) {
			setError(
				err.message || __('Failed to update event.', 'fair-events')
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

	const handleUnlinkPost = async () => {
		setSaving(true);
		setError(null);

		try {
			const updated = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}`,
				method: 'PUT',
				data: {
					link_type: 'none',
				},
			});
			setEventDate(updated);
			setLinkType('none');
			setSuccess(__('Post unlinked successfully.', 'fair-events'));
		} catch (err) {
			setError(
				err.message || __('Failed to unlink post.', 'fair-events')
			);
		} finally {
			setSaving(false);
		}
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

	const venueOptions = [
		{ label: __('— No venue —', 'fair-events'), value: '' },
		...venues.map((v) => ({ label: v.name, value: String(v.id) })),
	];

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

	const isLinkedToPost = eventDate.link_type === 'post' && eventDate.event_id;

	return (
		<div className="wrap fair-events-manage-event">
			<style>
				{`.fair-events-manage-event .components-card > div:first-child { height: auto; }
.fair-events-manage-event .components-card__body > * { max-width: 600px; }`}
			</style>
			<h1>
				{__('Manage Event', 'fair-events')}
				{title && `: ${title}`}
			</h1>

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

			<Card>
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

			<ImageExports
				eventDateId={eventDateId}
				themeImageId={themeImageId}
				themeImageUrl={themeImageUrl}
				initialExports={eventDate?.image_exports || []}
			/>

			{eventDate.gallery && (
				<Card style={{ marginTop: '16px' }}>
					<CardHeader>
						<h2>{__('Photo Gallery', 'fair-events')}</h2>
					</CardHeader>
					<CardBody>
						<VStack spacing={3}>
							<p>
								{__('Photos:', 'fair-events')}{' '}
								<strong>{eventDate.gallery.photo_count}</strong>
							</p>
							<p>
								{__('Total likes:', 'fair-events')}{' '}
								<strong>{eventDate.gallery.total_likes}</strong>
							</p>
							<Button
								variant="secondary"
								href={eventDate.gallery.gallery_url}
								target="_blank"
							>
								{__('View Gallery', 'fair-events')}
							</Button>
						</VStack>
					</CardBody>
				</Card>
			)}

			{audienceUrl && isLinkedToPost && (
				<Card style={{ marginTop: '16px' }}>
					<CardHeader>
						<h2>{__('Audience', 'fair-events')}</h2>
					</CardHeader>
					<CardBody>
						<Button
							variant="secondary"
							href={audienceUrl + eventDate.event_id}
						>
							{__('View Participants', 'fair-events')}
						</Button>
					</CardBody>
				</Card>
			)}

			<Card style={{ marginTop: '16px' }}>
				<CardHeader>
					<h2>{__('Link Options', 'fair-events')}</h2>
				</CardHeader>
				<CardBody>
					<VStack spacing={4}>
						{isLinkedToPost ? (
							<>
								<Notice status="info" isDismissible={false}>
									{__(
										'This event is linked to a WordPress post.',
										'fair-events'
									)}
								</Notice>
								{eventDate.post && (
									<HStack spacing={4}>
										<span>
											<strong>
												{eventDate.post.title}
											</strong>{' '}
											({eventDate.post.status})
										</span>
										{eventDate.post.edit_url && (
											<Button
												variant="secondary"
												href={eventDate.post.edit_url}
												size="small"
											>
												{__('Edit Post', 'fair-events')}
											</Button>
										)}
										<Button
											variant="tertiary"
											size="small"
											isDestructive
											onClick={handleUnlinkPost}
										>
											{__('Unlink Post', 'fair-events')}
										</Button>
									</HStack>
								)}
							</>
						) : (
							<>
								<RadioControl
									label={__('Link type', 'fair-events')}
									selected={linkType}
									options={[
										{
											label: __(
												'No link (standalone event)',
												'fair-events'
											),
											value: 'none',
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
												'WordPress Post',
												'fair-events'
											),
											value: 'post',
										},
									]}
									onChange={setLinkType}
								/>

								{linkType === 'external' && (
									<TextControl
										label={__(
											'External URL',
											'fair-events'
										)}
										type="url"
										value={externalUrl}
										onChange={setExternalUrl}
										placeholder="https://"
									/>
								)}

								{linkType === 'post' && (
									<>
										<SelectControl
											label={__(
												'Post type',
												'fair-events'
											)}
											value={selectedPostType}
											options={enabledPostTypes.map(
												(pt) => ({
													label: pt.label,
													value: pt.slug,
												})
											)}
											onChange={setSelectedPostType}
										/>
										<Button
											variant="primary"
											onClick={handleCreatePost}
											isBusy={creatingPost}
											disabled={creatingPost}
										>
											{__(
												'Create New Post',
												'fair-events'
											)}
										</Button>
									</>
								)}
							</>
						)}
					</VStack>
				</CardBody>
			</Card>

			<HStack
				spacing={4}
				justify="space-between"
				style={{ marginTop: '16px' }}
			>
				<HStack spacing={2}>
					<Button
						variant="primary"
						onClick={handleSave}
						isBusy={saving}
						disabled={saving || !title}
					>
						{__('Save Changes', 'fair-events')}
					</Button>
					<Button variant="secondary" href={calendarUrl}>
						{__('Back to Calendar', 'fair-events')}
					</Button>
				</HStack>
				<Button variant="tertiary" isDestructive onClick={handleDelete}>
					{__('Delete Event', 'fair-events')}
				</Button>
			</HStack>
		</div>
	);
}
