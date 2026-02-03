import { __ } from '@wordpress/i18n';
import { useState, useEffect, useCallback, useMemo } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardBody,
	Modal,
	CheckboxControl,
	SearchControl,
	Spinner,
} from '@wordpress/components';
import { DataViews } from '@wordpress/dataviews';

const DEFAULT_VIEW = {
	type: 'table',
	perPage: 25,
	page: 1,
	sort: {
		field: 'surname',
		direction: 'asc',
	},
	search: '',
	filters: [],
	fields: ['name', 'email', 'photo_count', 'event_count'],
};

const DEFAULT_LAYOUTS = {
	table: {},
};

export default function Collaborators() {
	const [collaborators, setCollaborators] = useState([]);
	const [totalItems, setTotalItems] = useState(0);
	const [totalPages, setTotalPages] = useState(0);
	const [isLoading, setIsLoading] = useState(true);
	const [view, setView] = useState(DEFAULT_VIEW);

	// Add to event modal state.
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [selectedCollaborator, setSelectedCollaborator] = useState(null);
	const [events, setEvents] = useState([]);
	const [eventsLoading, setEventsLoading] = useState(false);
	const [eventSearch, setEventSearch] = useState('');
	const [selectedEvents, setSelectedEvents] = useState([]);
	const [collaboratorEvents, setCollaboratorEvents] = useState([]);
	const [isSubmitting, setIsSubmitting] = useState(false);

	// Define fields configuration for DataViews.
	const fields = useMemo(
		() => [
			{
				id: 'name',
				label: __('Name', 'fair-audience'),
				render: ({ item }) => `${item.name} ${item.surname}`,
				enableSorting: true,
				enableHiding: false,
				getValue: ({ item }) =>
					`${item.surname}, ${item.name}`.toLowerCase(),
			},
			{
				id: 'email',
				label: __('Email', 'fair-audience'),
				render: ({ item }) => item.email || '—',
				enableSorting: true,
			},
			{
				id: 'photo_count',
				label: __('Photos', 'fair-audience'),
				render: ({ item }) => (
					<div style={{ textAlign: 'right' }}>
						{item.photo_count > 0 ? (
							<a href={item.media_library_url}>
								{item.photo_count}
							</a>
						) : (
							'0'
						)}
					</div>
				),
				enableSorting: true,
				getValue: ({ item }) => item.photo_count,
			},
			{
				id: 'event_count',
				label: __('Events', 'fair-audience'),
				render: ({ item }) => (
					<div style={{ textAlign: 'right' }}>{item.event_count}</div>
				),
				enableSorting: true,
				getValue: ({ item }) => item.event_count,
			},
		],
		[]
	);

	// Convert view state to API query params.
	const queryArgs = useMemo(() => {
		const params = new URLSearchParams();

		if (view.search) {
			params.append('search', view.search);
		}

		if (view.sort?.field) {
			// Map 'name' field to 'surname' for backend sorting.
			const orderby =
				view.sort.field === 'name' ? 'surname' : view.sort.field;
			params.append('orderby', orderby);
			params.append('order', view.sort.direction || 'asc');
		}

		// Pagination.
		if (view.perPage) {
			params.append('per_page', view.perPage);
		}
		if (view.page) {
			params.append('page', view.page);
		}

		return params.toString();
	}, [view]);

	const loadCollaborators = useCallback(() => {
		setIsLoading(true);

		const path = `/fair-audience/v1/collaborators${
			queryArgs ? '?' + queryArgs : ''
		}`;

		apiFetch({ path, parse: false })
			.then((response) => {
				const total = parseInt(
					response.headers.get('X-WP-Total') || '0',
					10
				);
				const pages = parseInt(
					response.headers.get('X-WP-TotalPages') || '1',
					10
				);
				setTotalItems(total);
				setTotalPages(pages);
				return response.json();
			})
			.then((data) => {
				setCollaborators(data);
				setIsLoading(false);
			})
			.catch((err) => {
				// eslint-disable-next-line no-console
				console.error('Error loading collaborators:', err);
				setIsLoading(false);
			});
	}, [queryArgs]);

	useEffect(() => {
		loadCollaborators();
	}, [loadCollaborators]);

	// Load events for the modal.
	const loadEvents = useCallback((search = '') => {
		setEventsLoading(true);

		const params = new URLSearchParams();
		params.append('per_page', '100');
		params.append('orderby', 'event_date');
		params.append('order', 'desc');
		if (search) {
			params.append('search', search);
		}

		apiFetch({ path: `/fair-audience/v1/events?${params.toString()}` })
			.then((data) => {
				setEvents(data);
				setEventsLoading(false);
			})
			.catch((err) => {
				// eslint-disable-next-line no-console
				console.error('Error loading events:', err);
				setEventsLoading(false);
			});
	}, []);

	// Load events the collaborator is already part of.
	const loadCollaboratorEvents = useCallback((collaboratorId) => {
		apiFetch({
			path: `/fair-audience/v1/participants/${collaboratorId}`,
		})
			.then(() => {
				// Get all event-participant relationships for this participant.
				return apiFetch({
					path: `/fair-audience/v1/events?per_page=100`,
				});
			})
			.then((allEvents) => {
				// Filter to find events where this participant is a collaborator.
				const promises = allEvents.map((event) =>
					apiFetch({
						path: `/fair-audience/v1/events/${event.event_id}/participants`,
					}).then((participants) => {
						const isCollaborator = participants.some(
							(p) =>
								p.participant_id === collaboratorId &&
								p.label === 'collaborator'
						);
						return isCollaborator ? event.event_id : null;
					})
				);

				return Promise.all(promises);
			})
			.then((results) => {
				const eventIds = results.filter((id) => id !== null);
				setCollaboratorEvents(eventIds);
			})
			.catch((err) => {
				// eslint-disable-next-line no-console
				console.error('Error loading collaborator events:', err);
			});
	}, []);

	const openAddToEventModal = (collaborator) => {
		setSelectedCollaborator(collaborator);
		setSelectedEvents([]);
		setEventSearch('');
		setIsModalOpen(true);
		loadEvents();
		loadCollaboratorEvents(collaborator.id);
	};

	const handleEventSearchChange = (value) => {
		setEventSearch(value);
		loadEvents(value);
	};

	const toggleEventSelection = (eventId) => {
		setSelectedEvents((prev) => {
			if (prev.includes(eventId)) {
				return prev.filter((id) => id !== eventId);
			}
			return [...prev, eventId];
		});
	};

	const handleAddToEvents = () => {
		if (!selectedCollaborator || selectedEvents.length === 0) {
			return;
		}

		setIsSubmitting(true);

		// Add collaborator to each selected event.
		const promises = selectedEvents.map((eventId) =>
			apiFetch({
				path: `/fair-audience/v1/events/${eventId}/participants`,
				method: 'POST',
				data: {
					participant_id: selectedCollaborator.id,
					label: 'collaborator',
				},
			}).catch((err) => {
				// Ignore "already exists" errors.
				if (!err.message?.includes('already exist')) {
					throw err;
				}
			})
		);

		Promise.all(promises)
			.then(() => {
				setIsModalOpen(false);
				loadCollaborators();
			})
			.catch((err) => {
				// eslint-disable-next-line no-undef
				alert(__('Error: ', 'fair-audience') + err.message);
			})
			.finally(() => {
				setIsSubmitting(false);
			});
	};

	// Define actions for DataViews.
	const actions = useMemo(
		() => [
			{
				id: 'add-to-event',
				label: __('Add to event', 'fair-audience'),
				icon: 'calendar-alt',
				callback: ([item]) => openAddToEventModal(item),
				supportsBulk: false,
			},
		],
		[]
	);

	const paginationInfo = useMemo(
		() => ({
			totalItems,
			totalPages,
		}),
		[totalItems, totalPages]
	);

	// Filter out events the collaborator is already part of.
	const availableEvents = events.filter(
		(event) => !collaboratorEvents.includes(event.event_id)
	);

	return (
		<div className="wrap">
			<h1>{__('Collaborators', 'fair-audience')}</h1>

			<Card>
				<CardBody>
					<DataViews
						data={collaborators}
						fields={fields}
						view={view}
						onChangeView={setView}
						actions={actions}
						paginationInfo={paginationInfo}
						defaultLayouts={DEFAULT_LAYOUTS}
						isLoading={isLoading}
						getItemId={(item) => item.id}
					/>
				</CardBody>
			</Card>

			{isModalOpen && selectedCollaborator && (
				<Modal
					title={__('Add to Event', 'fair-audience')}
					onRequestClose={() => setIsModalOpen(false)}
				>
					<p>
						{__(
							'Select events to add this collaborator to:',
							'fair-audience'
						)}
					</p>
					<p>
						<strong>
							{selectedCollaborator.name}{' '}
							{selectedCollaborator.surname}
						</strong>
					</p>

					<SearchControl
						value={eventSearch}
						onChange={handleEventSearchChange}
						placeholder={__('Search events...', 'fair-audience')}
					/>

					<div
						style={{
							maxHeight: '300px',
							overflowY: 'auto',
							marginTop: '16px',
							marginBottom: '16px',
							padding: '4px',
						}}
					>
						{eventsLoading ? (
							<Spinner />
						) : availableEvents.length === 0 ? (
							<p>
								{__(
									'No available events found.',
									'fair-audience'
								)}
							</p>
						) : (
							availableEvents.map((event) => (
								<CheckboxControl
									key={event.event_id}
									label={`${event.title}${
										event.event_date
											? ` (${event.event_date})`
											: ''
									}`}
									checked={selectedEvents.includes(
										event.event_id
									)}
									onChange={() =>
										toggleEventSelection(event.event_id)
									}
								/>
							))
						)}
					</div>

					<div
						style={{
							display: 'flex',
							justifyContent: 'flex-end',
							gap: '8px',
						}}
					>
						<Button
							variant="secondary"
							onClick={() => setIsModalOpen(false)}
						>
							{__('Cancel', 'fair-audience')}
						</Button>
						<Button
							variant="primary"
							onClick={handleAddToEvents}
							disabled={
								selectedEvents.length === 0 || isSubmitting
							}
							isBusy={isSubmitting}
						>
							{__('Add to Events', 'fair-audience')}
						</Button>
					</div>
				</Modal>
			)}
		</div>
	);
}
