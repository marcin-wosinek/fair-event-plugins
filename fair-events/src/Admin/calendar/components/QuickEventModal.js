/**
 * Quick Event Modal Component
 *
 * Modal for creating standalone events from the calendar.
 *
 * @package FairEvents
 */

import { useState, useEffect } from '@wordpress/element';
import {
	Modal,
	TextControl,
	CheckboxControl,
	SelectControl,
	RadioControl,
	FormTokenField,
	PanelBody,
	Button,
	Notice,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalToggleGroupControl as ToggleGroupControl,
	__experimentalToggleGroupControlOption as ToggleGroupControlOption,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	formatLocalDate,
	RecurrenceControl,
	buildRRule,
} from 'fair-events-shared';

export default function QuickEventModal({ date, onClose, onSuccess }) {
	const dateStr = formatLocalDate(date);

	const [title, setTitle] = useState('');
	const [allDay, setAllDay] = useState(false);
	const [startDate, setStartDate] = useState(dateStr);
	const [startTime, setStartTime] = useState('10:00');
	const [endDate, setEndDate] = useState(dateStr);
	const [endTime, setEndTime] = useState('12:00');
	const [venueId, setVenueId] = useState('');
	const [venues, setVenues] = useState([]);
	const [isSaving, setIsSaving] = useState(false);
	const [error, setError] = useState(null);

	// From-URL tab.
	const [activeTab, setActiveTab] = useState('manual');
	const [lookupUrl, setLookupUrl] = useState('');
	const [isLookingUp, setIsLookingUp] = useState(false);
	const [lookupError, setLookupError] = useState(null);
	const [fetchedLocation, setFetchedLocation] = useState(null);
	const [missingFields, setMissingFields] = useState([]);

	// Categories.
	const [categories, setCategories] = useState([]);
	const [availableCategories, setAvailableCategories] = useState([]);

	// Link type: 'none' | 'external' | 'post'.
	const [linkType, setLinkType] = useState('none');
	const [externalUrl, setExternalUrl] = useState('');
	const [searchResults, setSearchResults] = useState([]);
	const [linkPostId, setLinkPostId] = useState('');

	// Recurrence.
	const [recurrence, setRecurrence] = useState({
		enabled: false,
		frequency: 'weekly',
		endType: 'count',
		count: 10,
		until: '',
	});

	useEffect(() => {
		apiFetch({ path: '/fair-events/v1/venues' })
			.then((data) => setVenues(data))
			.catch(() => {
				// Venues are optional, ignore errors.
			});

		apiFetch({ path: '/fair-events/v1/sources/categories' })
			.then((data) => setAvailableCategories(data))
			.catch(() => {
				// Categories are optional, ignore errors.
			});
	}, []);

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

	const handleLookup = async () => {
		if (!lookupUrl.trim()) {
			setLookupError(__('Enter a URL to look up.', 'fair-events'));
			return;
		}

		setIsLookingUp(true);
		setLookupError(null);

		// The pasted URL becomes the external link regardless of outcome.
		setLinkType('external');
		setExternalUrl(lookupUrl);

		try {
			const metadata = await apiFetch({
				path: '/fair-events/v1/lookup-url',
				method: 'POST',
				data: { url: lookupUrl },
			});

			if (metadata.title) {
				setTitle(metadata.title);
			}

			if (metadata.start_datetime) {
				setAllDay(Boolean(metadata.all_day));
				setStartDate(metadata.start_datetime.slice(0, 10));
				setStartTime(metadata.start_datetime.slice(11, 16));
			}

			if (metadata.end_datetime) {
				setEndDate(metadata.end_datetime.slice(0, 10));
				setEndTime(metadata.end_datetime.slice(11, 16));
			}

			setFetchedLocation(metadata.location || null);

			if (metadata.location) {
				const match = venues.find(
					(v) =>
						v.name.toLowerCase() === metadata.location.toLowerCase()
				);
				if (match) {
					setVenueId(String(match.id));
				}
			}

			const found = metadata.found || [];
			setMissingFields(
				['start', 'end', 'location'].filter(
					(field) => !found.includes(field)
				)
			);

			setActiveTab('manual');
		} catch (err) {
			setLookupError(
				err.message || __('Could not look up that page.', 'fair-events')
			);
		} finally {
			setIsLookingUp(false);
		}
	};

	const handleSubmit = async (e) => {
		e.preventDefault();

		if (!title.trim()) {
			setError(__('Title is required.', 'fair-events'));
			return;
		}

		setIsSaving(true);
		setError(null);

		const startDatetime = allDay
			? `${startDate} 00:00:00`
			: `${startDate} ${startTime}:00`;

		const endDatetime = allDay
			? `${endDate} 00:00:00`
			: `${endDate} ${endTime}:00`;

		try {
			const eventDate = await apiFetch({
				path: '/fair-events/v1/event-dates',
				method: 'POST',
				data: {
					title,
					start_datetime: startDatetime,
					end_datetime: endDatetime,
					all_day: allDay,
					venue_id: venueId ? parseInt(venueId, 10) : undefined,
					link_type: linkType === 'post' ? 'none' : linkType,
					external_url:
						linkType === 'external' ? externalUrl : undefined,
					categories,
					rrule: buildRRule(recurrence),
				},
			});

			if (linkType === 'post' && linkPostId) {
				try {
					await apiFetch({
						path: `/fair-events/v1/event-dates/${eventDate.id}/link-post`,
						method: 'POST',
						data: {
							post_id: parseInt(linkPostId, 10),
						},
					});
				} catch (linkErr) {
					onSuccess(eventDate);
					setError(
						linkErr.message ||
							__(
								'Event created, but linking the post failed.',
								'fair-events'
							)
					);
					setIsSaving(false);
					return;
				}
			}

			onSuccess(eventDate);
		} catch (err) {
			setError(
				err.message || __('Failed to create event.', 'fair-events')
			);
		} finally {
			setIsSaving(false);
		}
	};

	const venueOptions = [
		{ label: __('— No venue —', 'fair-events'), value: '' },
		...venues.map((v) => ({ label: v.name, value: String(v.id) })),
	];

	return (
		<Modal
			title={__('Quick Add Event', 'fair-events')}
			onRequestClose={onClose}
			style={{ maxWidth: '600px', width: '100%' }}
		>
			<form onSubmit={handleSubmit}>
				<VStack spacing={4}>
					{error && (
						<div className="notice notice-error inline">
							<p>{error}</p>
						</div>
					)}

					<ToggleGroupControl
						label={__('Add event', 'fair-events')}
						hideLabelFromVision
						value={activeTab}
						onChange={setActiveTab}
						isBlock
					>
						<ToggleGroupControlOption
							value="manual"
							label={__('Manual', 'fair-events')}
						/>
						<ToggleGroupControlOption
							value="url"
							label={__('From URL', 'fair-events')}
						/>
					</ToggleGroupControl>

					{'url' === activeTab && (
						<VStack spacing={4}>
							{lookupError && (
								<div className="notice notice-error inline">
									<p>{lookupError}</p>
								</div>
							)}

							<TextControl
								label={__('Event page URL', 'fair-events')}
								type="url"
								value={lookupUrl}
								onChange={setLookupUrl}
								placeholder="https://"
								autoFocus
							/>

							<HStack justify="flex-start">
								<Button
									variant="secondary"
									isBusy={isLookingUp}
									disabled={isLookingUp || !lookupUrl.trim()}
									onClick={handleLookup}
								>
									{__('Look up', 'fair-events')}
								</Button>
							</HStack>
						</VStack>
					)}

					{'manual' === activeTab && missingFields.length > 0 && (
						<Notice status="info" isDismissible={false}>
							{sprintf(
								/* translators: %s: comma-separated list of missing field names */
								__(
									"This page didn't specify: %s. Fill these in manually.",
									'fair-events'
								),
								missingFields
									.map((field) => {
										if ('start' === field) {
											return __(
												'start date',
												'fair-events'
											);
										}
										if ('end' === field) {
											return __(
												'end date',
												'fair-events'
											);
										}
										return __('location', 'fair-events');
									})
									.join(', ')
							)}
						</Notice>
					)}

					{'manual' === activeTab && (
						<>
							<TextControl
								label={__('Title', 'fair-events')}
								value={title}
								onChange={setTitle}
								required
								autoFocus
							/>

							<CheckboxControl
								label={__('All day', 'fair-events')}
								checked={allDay}
								onChange={setAllDay}
							/>

							{allDay ? (
								<HStack spacing={4} alignment="top">
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
								<>
									<HStack spacing={4} alignment="top">
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
									</HStack>
									<HStack spacing={4} alignment="top">
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
								</>
							)}

							<SelectControl
								label={__('Venue', 'fair-events')}
								value={venueId}
								options={venueOptions}
								onChange={setVenueId}
								help={
									fetchedLocation
										? sprintf(
												/* translators: %s: location name found on the source page */
												__(
													'From the page: %s',
													'fair-events'
												),
												fetchedLocation
										  )
										: undefined
								}
							/>

							<PanelBody
								title={__('More options', 'fair-events')}
								initialOpen={false}
							>
								<VStack spacing={4}>
									<FormTokenField
										label={__('Categories', 'fair-events')}
										value={categories
											.map((id) => {
												const cat =
													availableCategories.find(
														(c) => c.id === id
													);
												return cat ? cat.name : '';
											})
											.filter(Boolean)}
										suggestions={availableCategories.map(
											(c) => c.name
										)}
										onChange={(tokens) => {
											const ids = tokens
												.map((token) => {
													const cat =
														availableCategories.find(
															(c) =>
																c.name === token
														);
													return cat ? cat.id : null;
												})
												.filter((id) => id !== null);
											setCategories(ids);
										}}
									/>

									<RadioControl
										label={__('Link to', 'fair-events')}
										selected={linkType}
										options={[
											{
												label: __(
													'Nowhere — show details only',
													'fair-events'
												),
												value: 'none',
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
													'A page on this site',
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
										<VStack spacing={2}>
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
																value: String(
																	r.id
																),
															})
														),
													]}
													onChange={setLinkPostId}
												/>
											)}
										</VStack>
									)}

									<RecurrenceControl
										value={recurrence}
										onChange={setRecurrence}
									/>
								</VStack>
							</PanelBody>
						</>
					)}

					<HStack justify="flex-end" spacing={2}>
						<Button
							variant="tertiary"
							onClick={onClose}
							disabled={isSaving}
						>
							{__('Cancel', 'fair-events')}
						</Button>
						{'manual' === activeTab && (
							<Button
								variant="primary"
								type="submit"
								isBusy={isSaving}
								disabled={isSaving || !title.trim()}
							>
								{__('Create Event', 'fair-events')}
							</Button>
						)}
					</HStack>
				</VStack>
			</form>
		</Modal>
	);
}
