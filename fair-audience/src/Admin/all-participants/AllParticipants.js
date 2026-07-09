import { __, _n, sprintf } from '@wordpress/i18n';
import { useState, useEffect, useCallback, useMemo } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardBody,
	Flex,
	FlexItem,
	Spinner,
	Popover,
	Notice,
	Snackbar,
	__experimentalText as Text,
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';
import { DataViews, filterSortAndPaginate } from '@wordpress/dataviews';
import { Icon, caution, link, send } from '@wordpress/icons';
import ParticipantEditModal from '../components/ParticipantEditModal.js';
import EmailSendResultNotice from '../components/EmailSendResultNotice.js';

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
		'mailing',
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
	const [stats, setStats] = useState(null);
	const [view, setView] = useState(DEFAULT_VIEW);
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [editingParticipant, setEditingParticipant] = useState(null);

	// Feedback state.
	const [deleteItems, setDeleteItems] = useState(null);
	const [resendResult, setResendResult] = useState(null);
	const [snackbar, setSnackbar] = useState(null);
	const [errorMessage, setErrorMessage] = useState(null);

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
				id: 'mailing',
				label: __('Mailing', 'fair-audience'),
				render: ({ item }) => {
					if ('marketing' === item.email_profile) {
						return 'pending' === item.status
							? __(
									'Marketing — pending confirmation',
									'fair-audience'
							  )
							: __('Marketing', 'fair-audience');
					}
					if ('minimal' === item.email_profile) {
						return __('Minimal', 'fair-audience');
					}
					if ('declined' === item.email_profile) {
						return __('No', 'fair-audience');
					}
					return item.email_profile || '—';
				},
				enableSorting: false,
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
						declined: __('No', 'fair-audience'),
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
					{
						value: 'declined',
						label: __('No', 'fair-audience'),
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

	const loadStats = useCallback(() => {
		apiFetch({ path: '/fair-audience/v1/participants/stats' })
			.then(setStats)
			.catch((err) => {
				// eslint-disable-next-line no-console
				console.error('Error loading participant stats:', err);
			});
	}, []);

	const refresh = useCallback(() => {
		loadParticipants();
		loadStats();
	}, [loadParticipants, loadStats]);

	useEffect(() => {
		refresh();
	}, [refresh]);

	const openAddModal = () => {
		setEditingParticipant(null);
		setIsModalOpen(true);
	};

	const openEditModal = (participant) => {
		setEditingParticipant(participant);
		setIsModalOpen(true);
	};

	const handleDelete = (items) => {
		setDeleteItems(items);
	};

	const confirmDelete = () => {
		const items = deleteItems;

		Promise.all(
			items.map((item) =>
				apiFetch({
					path: `/fair-audience/v1/participants/${item.id}`,
					method: 'DELETE',
				})
			)
		)
			.then(() => {
				refresh();
			})
			.catch((err) => {
				setErrorMessage(__('Error: ', 'fair-audience') + err.message);
			})
			.finally(() => {
				setDeleteItems(null);
			});
	};

	const deleteConfirmMessage = useMemo(() => {
		if (!deleteItems) {
			return '';
		}

		if (deleteItems.length === 1) {
			return sprintf(
				/* translators: %s: participant name and surname */
				__('Delete %s? This cannot be undone.', 'fair-audience'),
				`${deleteItems[0].name} ${deleteItems[0].surname}`
			);
		}

		return sprintf(
			/* translators: %d: number of participants */
			_n(
				'Delete %d participant? This cannot be undone.',
				'Delete %d participants? This cannot be undone.',
				deleteItems.length,
				'fair-audience'
			),
			deleteItems.length
		);
	}, [deleteItems]);

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
				id: 'copy-subscription-link',
				label: __('Copy subscription link', 'fair-audience'),
				icon: link,
				callback: async ([item]) => {
					try {
						const response = await apiFetch({
							path: `/fair-audience/v1/participants/${item.id}/subscription-url`,
						});
						await navigator.clipboard.writeText(response.url);
						setSnackbar(__('Link copied.', 'fair-audience'));
					} catch (err) {
						setErrorMessage(
							__('Error: ', 'fair-audience') + err.message
						);
					}
				},
				supportsBulk: false,
			},
			{
				id: 'resend-mailing-confirmation',
				label: __('Resend mailing confirmation email', 'fair-audience'),
				icon: send,
				isEligible: (item) => 'pending' === item.status,
				callback: async (items) => {
					const results = await Promise.all(
						items.map((item) =>
							apiFetch({
								path: `/fair-audience/v1/participants/${item.id}/resend-mailing-confirmation`,
								method: 'POST',
							})
								.then(() => ({ ok: true, item }))
								.catch((err) => ({ ok: false, item, err }))
						)
					);

					const failures = results.filter((r) => !r.ok);
					setResendResult({
						sent_count: results.length - failures.length,
						failed: failures.map((r) => ({
							name: `${r.item.name} ${r.item.surname}`,
							reason: r.err?.message,
						})),
					});
				},
				supportsBulk: true,
			},
			{
				id: 'delete',
				label: __('Delete', 'fair-audience'),
				icon: 'trash',
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

	const statTiles = useMemo(
		() => [
			{
				id: 'total',
				label: __('Audience total', 'fair-audience'),
				value: stats?.total,
				filters: [],
			},
			{
				id: 'mailing',
				label: __('In the mailing', 'fair-audience'),
				value: stats?.mailing,
				filters: [
					{
						field: 'email_profile',
						operator: 'is',
						value: 'marketing',
					},
					{ field: 'status', operator: 'is', value: 'confirmed' },
				],
			},
			{
				id: 'pending',
				label: __('Pending confirmation', 'fair-audience'),
				value: stats?.pending,
				filters: [
					{ field: 'status', operator: 'is', value: 'pending' },
				],
			},
			{
				id: 'declined',
				label: __('Declined', 'fair-audience'),
				value: stats?.declined,
				filters: [
					{
						field: 'email_profile',
						operator: 'is',
						value: 'declined',
					},
				],
			},
		],
		[stats]
	);

	const filterByTile = useCallback((filters) => {
		setView((v) => ({ ...v, filters, page: 1 }));
	}, []);

	const resendResultTitle = useMemo(() => {
		if (!resendResult) {
			return '';
		}

		return sprintf(
			/* translators: %d: number of confirmation emails sent */
			_n(
				'Sent %d confirmation email',
				'Sent %d confirmation emails',
				resendResult.sent_count,
				'fair-audience'
			),
			resendResult.sent_count
		);
	}, [resendResult]);

	return (
		<div className="wrap">
			<h1 className="wp-heading-inline">
				{__('All Participants', 'fair-audience')}
			</h1>
			<button
				type="button"
				className="page-title-action"
				onClick={openAddModal}
			>
				{__('Add Participant', 'fair-audience')}
			</button>
			<hr className="wp-header-end" />

			<Flex wrap>
				{statTiles.map((tile) => (
					<FlexItem key={tile.id} style={{ minWidth: '160px' }}>
						<Card>
							<CardBody
								as="button"
								type="button"
								onClick={() => filterByTile(tile.filters)}
								style={{
									cursor: 'pointer',
									textAlign: 'left',
									width: '100%',
									border: 'none',
									background: 'none',
								}}
							>
								<Text size={24} weight={600} as="div">
									{stats ? tile.value : '—'}
								</Text>
								<Text as="div">{tile.label}</Text>
							</CardBody>
						</Card>
					</FlexItem>
				))}
			</Flex>

			{errorMessage && (
				<Notice
					status="error"
					isDismissible={true}
					onRemove={() => setErrorMessage(null)}
				>
					{errorMessage}
				</Notice>
			)}

			<EmailSendResultNotice
				result={resendResult}
				title={resendResultTitle}
				onDismiss={() => setResendResult(null)}
			/>

			<Card>
				<CardBody style={{ overflowX: 'auto' }}>
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
				onSaved={refresh}
			/>

			<ConfirmDialog
				isOpen={deleteItems !== null}
				onConfirm={confirmDelete}
				onCancel={() => setDeleteItems(null)}
				confirmButtonText={_n(
					'Delete participant',
					'Delete participants',
					deleteItems?.length || 0,
					'fair-audience'
				)}
				cancelButtonText={__('Cancel', 'fair-audience')}
			>
				{deleteConfirmMessage}
			</ConfirmDialog>

			{snackbar && (
				<div
					style={{
						position: 'fixed',
						bottom: '16px',
						left: '16px',
						zIndex: 100000,
					}}
				>
					<Snackbar onRemove={() => setSnackbar(null)}>
						{snackbar}
					</Snackbar>
				</div>
			)}
		</div>
	);
}
