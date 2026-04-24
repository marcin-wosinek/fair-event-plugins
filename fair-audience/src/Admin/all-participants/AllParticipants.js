import { __ } from '@wordpress/i18n';
import { useState, useEffect, useCallback, useMemo } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardBody,
	Spinner,
	Popover,
} from '@wordpress/components';
import { DataViews, filterSortAndPaginate } from '@wordpress/dataviews';
import { Icon, caution } from '@wordpress/icons';
import ParticipantEditModal from '../components/ParticipantEditModal.js';

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
	fields: [
		'name',
		'email',
		'phone',
		'instagram',
		'email_profile',
		'status',
		'groups',
		'wp_user',
		'events_signed_up',
		'events_collaborated',
	],
};

const DEFAULT_LAYOUTS = {
	table: {},
	grid: {},
};

export default function AllParticipants() {
	const [participants, setParticipants] = useState([]);
	const [totalItems, setTotalItems] = useState(0);
	const [totalPages, setTotalPages] = useState(0);
	const [isLoading, setIsLoading] = useState(true);
	const [view, setView] = useState(DEFAULT_VIEW);
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [editingParticipant, setEditingParticipant] = useState(null);

	// Events popover state.
	const [eventsPopover, setEventsPopover] = useState(null);
	const [popoverEvents, setPopoverEvents] = useState([]);
	const [popoverLoading, setPopoverLoading] = useState(false);

	const showEventsPopover = useCallback((participantId, label, anchorRef) => {
		setEventsPopover({ participantId, label, anchorRef });
		setPopoverLoading(true);
		setPopoverEvents([]);

		apiFetch({
			path: `/fair-audience/v1/participants/${participantId}/events?label=${label}`,
		})
			.then((data) => {
				setPopoverEvents(data);
				setPopoverLoading(false);
			})
			.catch(() => {
				setPopoverLoading(false);
			});
	}, []);

	// Define fields configuration for DataViews.
	const fields = useMemo(
		() => [
			{
				id: 'name',
				label: __('Name', 'fair-audience'),
				render: ({ item }) => (
					<a
						href={`admin.php?page=fair-audience-participant-detail&participant_id=${item.id}`}
					>
						{`${item.name} ${item.surname}`}
					</a>
				),
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
				id: 'phone',
				label: __('Phone', 'fair-audience'),
				render: ({ item }) => item.phone || '—',
				enableSorting: false,
			},
			{
				id: 'instagram',
				label: __('Instagram', 'fair-audience'),
				render: ({ item }) =>
					item.instagram ? (
						<a
							href={`https://instagram.com/${item.instagram}`}
							target="_blank"
							rel="noopener noreferrer"
						>
							@{item.instagram}
						</a>
					) : (
						'—'
					),
				enableSorting: false,
			},
			{
				id: 'email_profile',
				label: __('Email Profile', 'fair-audience'),
				render: ({ item }) => {
					const labels = {
						minimal: __('Minimal', 'fair-audience'),
						marketing: __('Marketing', 'fair-audience'),
					};
					return labels[item.email_profile] || item.email_profile;
				},
				elements: [
					{
						value: 'minimal',
						label: __('Minimal', 'fair-audience'),
					},
					{
						value: 'marketing',
						label: __('Marketing', 'fair-audience'),
					},
				],
				filterBy: {
					operators: ['is'],
				},
				enableSorting: true,
			},
			{
				id: 'status',
				label: __('Status', 'fair-audience'),
				render: ({ item }) => {
					const labels = {
						pending: __('Pending', 'fair-audience'),
						confirmed: __('Confirmed', 'fair-audience'),
					};
					return labels[item.status] || item.status;
				},
				elements: [
					{
						value: 'pending',
						label: __('Pending', 'fair-audience'),
					},
					{
						value: 'confirmed',
						label: __('Confirmed', 'fair-audience'),
					},
				],
				filterBy: {
					operators: ['is'],
				},
				enableSorting: true,
			},
			{
				id: 'groups',
				label: __('Groups', 'fair-audience'),
				render: ({ item }) => {
					if (!item.groups || item.groups.length === 0) {
						return '—';
					}
					return item.groups.map((g) => g.name).join(', ');
				},
				enableSorting: true,
				getValue: ({ item }) => (item.groups ? item.groups.length : 0),
			},
			{
				id: 'wp_user',
				label: __('WordPress User', 'fair-audience'),
				render: ({ item }) => {
					if (!item.wp_user) {
						return '—';
					}
					const hasEmailMismatch =
						item.email &&
						item.wp_user.email &&
						item.email.toLowerCase() !==
							item.wp_user.email.toLowerCase();
					return (
						<span
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: '4px',
							}}
						>
							{item.wp_user.display_name}
							{hasEmailMismatch && (
								<span
									title={__(
										'Email addresses do not match',
										'fair-audience'
									)}
									style={{ color: '#d63638' }}
								>
									<Icon icon={caution} size={16} />
								</span>
							)}
						</span>
					);
				},
				enableSorting: false,
			},
			{
				id: 'events_signed_up',
				label: __('Events Signed Up', 'fair-audience'),
				render: ({ item }) => (
					<div style={{ textAlign: 'right' }}>
						{item.events_signed_up > 0 ? (
							<Button
								variant="link"
								onClick={(e) =>
									showEventsPopover(
										item.id,
										'signed_up',
										e.currentTarget
									)
								}
							>
								{item.events_signed_up}
							</Button>
						) : (
							'0'
						)}
					</div>
				),
				enableSorting: true,
				getValue: ({ item }) => item.events_signed_up || 0,
			},
			{
				id: 'events_collaborated',
				label: __('Events Collaborated', 'fair-audience'),
				render: ({ item }) => (
					<div style={{ textAlign: 'right' }}>
						{item.events_collaborated > 0 ? (
							<Button
								variant="link"
								onClick={(e) =>
									showEventsPopover(
										item.id,
										'collaborator',
										e.currentTarget
									)
								}
							>
								{item.events_collaborated}
							</Button>
						) : (
							'0'
						)}
					</div>
				),
				enableSorting: true,
				getValue: ({ item }) => item.events_collaborated || 0,
			},
		],
		[showEventsPopover]
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

		// Process filters.
		view.filters?.forEach((filter) => {
			if (filter.operator === 'is' && filter.value) {
				params.append(filter.field, filter.value);
			}
		});

		// Pagination.
		if (view.perPage) {
			params.append('per_page', view.perPage);
		}
		if (view.page) {
			params.append('page', view.page);
		}

		return params.toString();
	}, [view]);

	const loadParticipants = useCallback(() => {
		setIsLoading(true);

		const path = `/fair-audience/v1/participants${
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
				setParticipants(data);
				setIsLoading(false);
			})
			.catch((err) => {
				// eslint-disable-next-line no-console
				console.error('Error loading participants:', err);
				setIsLoading(false);
			});
	}, [queryArgs]);

	useEffect(() => {
		loadParticipants();
	}, [loadParticipants]);

	const openAddModal = () => {
		setEditingParticipant(null);
		setIsModalOpen(true);
	};

	const openEditModal = (participant) => {
		setEditingParticipant(participant);
		setIsModalOpen(true);
	};

	const handleDelete = (items) => {
		const count = items.length;
		const message =
			count === 1
				? __(
						'Are you sure you want to delete this participant?',
						'fair-audience'
				  )
				: __(
						'Are you sure you want to delete these participants?',
						'fair-audience'
				  );

		if (!confirm(message)) {
			return;
		}

		// Delete all selected items.
		Promise.all(
			items.map((item) =>
				apiFetch({
					path: `/fair-audience/v1/participants/${item.id}`,
					method: 'DELETE',
				})
			)
		)
			.then(() => {
				loadParticipants();
			})
			.catch((err) => {
				alert(__('Error: ', 'fair-audience') + err.message);
			});
	};

	// Define actions for DataViews.
	const actions = useMemo(
		() => [
			{
				id: 'edit',
				label: __('Edit', 'fair-audience'),
				icon: 'edit',
				callback: ([item]) => openEditModal(item),
				supportsBulk: false,
			},
			{
				id: 'delete',
				label: __('Delete', 'fair-audience'),
				icon: 'trash',
				isDestructive: true,
				callback: handleDelete,
				supportsBulk: true,
			},
		],
		[loadParticipants]
	);

	const paginationInfo = useMemo(
		() => ({
			totalItems,
			totalPages,
		}),
		[totalItems, totalPages]
	);

	return (
		<div className="wrap">
			<h1>{__('All Participants', 'fair-audience')}</h1>

			<Card>
				<CardBody>
					<div style={{ marginBottom: '16px' }}>
						<Button variant="primary" onClick={openAddModal}>
							{__('Add Participant', 'fair-audience')}
						</Button>
					</div>

					<DataViews
						data={participants}
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

			{eventsPopover && (
				<Popover
					anchor={eventsPopover.anchorRef}
					onClose={() => setEventsPopover(null)}
					placement="bottom-start"
				>
					<div
						style={{
							padding: '12px',
							minWidth: '200px',
							maxWidth: '300px',
						}}
					>
						{popoverLoading ? (
							<Spinner />
						) : popoverEvents.length === 0 ? (
							<p style={{ margin: 0 }}>
								{__('No events found.', 'fair-audience')}
							</p>
						) : (
							<ul
								style={{
									margin: 0,
									padding: 0,
									listStyle: 'none',
								}}
							>
								{popoverEvents.map((event) => (
									<li
										key={event.event_id}
										style={{
											padding: '4px 0',
										}}
									>
										<a
											href={`${window.fairAudienceAllParticipantsData?.participantsUrl}${event.event_date_id}`}
										>
											{event.title}
										</a>
									</li>
								))}
							</ul>
						)}
					</div>
				</Popover>
			)}

			<ParticipantEditModal
				isOpen={isModalOpen}
				participant={editingParticipant}
				onClose={() => setIsModalOpen(false)}
				onSaved={loadParticipants}
			/>
		</div>
	);
}
