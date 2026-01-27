import { __ } from '@wordpress/i18n';
import { useState, useEffect, useCallback, useMemo } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardBody,
	Modal,
	TextControl,
	SelectControl,
} from '@wordpress/components';
import { DataViews, filterSortAndPaginate } from '@wordpress/dataviews';

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
		'instagram',
		'email_profile',
		'status',
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
	const [formData, setFormData] = useState({
		name: '',
		surname: '',
		email: '',
		instagram: '',
		email_profile: 'minimal',
	});

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
						in_the_loop: __('In the Loop', 'fair-audience'),
					};
					return labels[item.email_profile] || item.email_profile;
				},
				elements: [
					{ value: 'minimal', label: __('Minimal', 'fair-audience') },
					{
						value: 'in_the_loop',
						label: __('In the Loop', 'fair-audience'),
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
					{ value: 'pending', label: __('Pending', 'fair-audience') },
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
				id: 'events_signed_up',
				label: __('Events Signed Up', 'fair-audience'),
				render: ({ item }) => (
					<div style={{ textAlign: 'right' }}>
						{item.events_signed_up || 0}
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
						{item.events_collaborated || 0}
					</div>
				),
				enableSorting: true,
				getValue: ({ item }) => item.events_collaborated || 0,
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

		const path = `/fair-audience/v1/participants${queryArgs ? '?' + queryArgs : ''}`;

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
		setFormData({
			name: '',
			surname: '',
			email: '',
			instagram: '',
			email_profile: 'minimal',
		});
		setIsModalOpen(true);
	};

	const openEditModal = (participant) => {
		setEditingParticipant(participant);
		setFormData({
			name: participant.name,
			surname: participant.surname,
			email: participant.email || '',
			instagram: participant.instagram || '',
			email_profile: participant.email_profile,
		});
		setIsModalOpen(true);
	};

	const handleSubmit = () => {
		const method = editingParticipant ? 'PUT' : 'POST';
		const path = editingParticipant
			? `/fair-audience/v1/participants/${editingParticipant.id}`
			: '/fair-audience/v1/participants';

		apiFetch({
			path,
			method,
			data: formData,
		})
			.then(() => {
				setIsModalOpen(false);
				loadParticipants();
			})
			.catch((err) => {
				alert(__('Error: ', 'fair-audience') + err.message);
			});
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

			{isModalOpen && (
				<Modal
					title={
						editingParticipant
							? __('Edit Participant', 'fair-audience')
							: __('Add Participant', 'fair-audience')
					}
					onRequestClose={() => setIsModalOpen(false)}
				>
					<Card>
						<CardBody>
							<TextControl
								label={__('Name *', 'fair-audience')}
								value={formData.name}
								onChange={(value) =>
									setFormData({ ...formData, name: value })
								}
								required
							/>
							<TextControl
								label={__('Surname *', 'fair-audience')}
								value={formData.surname}
								onChange={(value) =>
									setFormData({
										...formData,
										surname: value,
									})
								}
								required
							/>
							<TextControl
								label={__('Email', 'fair-audience')}
								type="email"
								value={formData.email}
								onChange={(value) =>
									setFormData({ ...formData, email: value })
								}
							/>
							<TextControl
								label={__('Instagram Handle', 'fair-audience')}
								value={formData.instagram}
								onChange={(value) =>
									setFormData({
										...formData,
										instagram: value,
									})
								}
								help={__(
									'Enter handle only (without @)',
									'fair-audience'
								)}
							/>
							<SelectControl
								label={__('Email Profile', 'fair-audience')}
								value={formData.email_profile}
								options={[
									{
										label: __('Minimal', 'fair-audience'),
										value: 'minimal',
									},
									{
										label: __(
											'In the Loop',
											'fair-audience'
										),
										value: 'in_the_loop',
									},
								]}
								onChange={(value) =>
									setFormData({
										...formData,
										email_profile: value,
									})
								}
							/>
							<Button variant="primary" onClick={handleSubmit}>
								{editingParticipant
									? __('Update', 'fair-audience')
									: __('Add', 'fair-audience')}
							</Button>
						</CardBody>
					</Card>
				</Modal>
			)}
		</div>
	);
}
