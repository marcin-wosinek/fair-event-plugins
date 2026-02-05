/**
 * Manage Event App - Main Component
 *
 * Stage 2: Manage event details and link options.
 *
 * @package FairEvents
 */

import { useState, useEffect } from '@wordpress/element';
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
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

export default function ManageEventApp() {
	const eventDateId = window.fairEventsManageEventData?.eventDateId;
	const calendarUrl = window.fairEventsManageEventData?.calendarUrl;
	const enabledPostTypes =
		window.fairEventsManageEventData?.enabledPostTypes || [];

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

	const populateForm = (data) => {
		setTitle(data.title || '');
		setAllDay(data.all_day || false);
		setLinkType(data.link_type || 'none');
		setExternalUrl(data.external_url || '');
		setVenueId(data.venue_id ? String(data.venue_id) : '');

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
							label={__('Venue', 'fair-events')}
							value={venueId}
							options={venueOptions}
							onChange={setVenueId}
						/>
					</VStack>
				</CardBody>
			</Card>

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
