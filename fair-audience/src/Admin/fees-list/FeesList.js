import { __ } from '@wordpress/i18n';
import { useState, useEffect, useCallback, useMemo } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardBody,
	Modal,
	TextControl,
	TextareaControl,
	SelectControl,
} from '@wordpress/components';
import { DataViews } from '@wordpress/dataviews';

const DEFAULT_VIEW = {
	type: 'table',
	perPage: 25,
	page: 1,
	sort: {
		field: 'created_at',
		direction: 'desc',
	},
	search: '',
	filters: [],
	fields: [
		'name',
		'group_name',
		'amount',
		'due_date',
		'status',
		'pending_count',
		'paid_count',
	],
};

const DEFAULT_LAYOUTS = {
	table: {},
};

export default function FeesList() {
	const [fees, setFees] = useState([]);
	const [totalItems, setTotalItems] = useState(0);
	const [isLoading, setIsLoading] = useState(true);
	const [view, setView] = useState(DEFAULT_VIEW);

	// Create modal state.
	const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
	const [feeName, setFeeName] = useState('');
	const [feeDescription, setFeeDescription] = useState('');
	const [feeGroupId, setFeeGroupId] = useState('');
	const [feeAmount, setFeeAmount] = useState('');
	const [feeDueDate, setFeeDueDate] = useState('');
	const [isSaving, setIsSaving] = useState(false);

	// Edit modal state.
	const [isEditModalOpen, setIsEditModalOpen] = useState(false);
	const [editingFee, setEditingFee] = useState(null);

	// Groups for select.
	const [groups, setGroups] = useState([]);

	// Define fields configuration for DataViews.
	const fields = useMemo(
		() => [
			{
				id: 'name',
				label: __('Name', 'fair-audience'),
				render: ({ item }) => (
					<a
						href={`admin.php?page=fair-audience-fee-detail&fee_id=${item.id}`}
					>
						{item.name}
					</a>
				),
				enableSorting: true,
				enableHiding: false,
			},
			{
				id: 'group_name',
				label: __('Group', 'fair-audience'),
				render: ({ item }) => item.group_name || '—',
				enableSorting: false,
			},
			{
				id: 'amount',
				label: __('Amount', 'fair-audience'),
				render: ({ item }) =>
					`${parseFloat(item.amount).toFixed(2)} ${item.currency}`,
				enableSorting: true,
				getValue: ({ item }) => parseFloat(item.amount),
			},
			{
				id: 'due_date',
				label: __('Due Date', 'fair-audience'),
				render: ({ item }) => item.due_date || '—',
				enableSorting: true,
			},
			{
				id: 'status',
				label: __('Status', 'fair-audience'),
				render: ({ item }) => {
					const colors = {
						draft: '#888',
						active: '#00a32a',
						closed: '#d63638',
					};
					return (
						<span style={{ color: colors[item.status] || '#333' }}>
							{item.status}
						</span>
					);
				},
				enableSorting: true,
			},
			{
				id: 'pending_count',
				label: __('Pending', 'fair-audience'),
				render: ({ item }) => (
					<div style={{ textAlign: 'right' }}>
						{item.pending_count}
					</div>
				),
				enableSorting: false,
				getValue: ({ item }) => parseInt(item.pending_count),
			},
			{
				id: 'paid_count',
				label: __('Paid', 'fair-audience'),
				render: ({ item }) => (
					<div style={{ textAlign: 'right' }}>{item.paid_count}</div>
				),
				enableSorting: false,
				getValue: ({ item }) => parseInt(item.paid_count),
			},
		],
		[]
	);

	// Convert view state to API query params.
	const queryArgs = useMemo(() => {
		const params = new URLSearchParams();

		if (view.sort?.field) {
			params.append('orderby', view.sort.field);
			params.append('order', view.sort.direction || 'desc');
		}

		return params.toString();
	}, [view]);

	const loadFees = useCallback(() => {
		setIsLoading(true);

		const path = `/fair-audience/v1/fees${
			queryArgs ? '?' + queryArgs : ''
		}`;

		apiFetch({ path, parse: false })
			.then((response) => {
				const total = parseInt(
					response.headers.get('X-WP-Total') || '0',
					10
				);
				setTotalItems(total);
				return response.json();
			})
			.then((data) => {
				setFees(data);
				setIsLoading(false);
			})
			.catch((err) => {
				// eslint-disable-next-line no-console
				console.error('Error loading fees:', err);
				setIsLoading(false);
			});
	}, [queryArgs]);

	const loadGroups = useCallback(() => {
		apiFetch({ path: '/fair-audience/v1/groups' })
			.then((data) => {
				setGroups(data);
			})
			.catch((err) => {
				// eslint-disable-next-line no-console
				console.error('Error loading groups:', err);
			});
	}, []);

	useEffect(() => {
		loadFees();
	}, [loadFees]);

	useEffect(() => {
		loadGroups();
	}, [loadGroups]);

	// Open create modal.
	const openCreateModal = () => {
		setFeeName('');
		setFeeDescription('');
		setFeeGroupId('');
		setFeeAmount('');
		setFeeDueDate('');
		setIsCreateModalOpen(true);
	};

	// Handle create fee.
	const handleCreateFee = () => {
		if (!feeName.trim() || !feeGroupId || !feeAmount) {
			return;
		}

		setIsSaving(true);

		apiFetch({
			path: '/fair-audience/v1/fees',
			method: 'POST',
			data: {
				name: feeName.trim(),
				description: feeDescription.trim(),
				group_id: parseInt(feeGroupId),
				amount: parseFloat(feeAmount),
				due_date: feeDueDate || null,
			},
		})
			.then(() => {
				setIsCreateModalOpen(false);
				loadFees();
			})
			.catch((err) => {
				// eslint-disable-next-line no-undef
				alert(
					__('Error: ', 'fair-audience') +
						(err.message ||
							__('Failed to create fee.', 'fair-audience'))
				);
			})
			.finally(() => {
				setIsSaving(false);
			});
	};

	// Open edit modal.
	const openEditModal = (fee) => {
		setEditingFee(fee);
		setFeeName(fee.name);
		setFeeDescription(fee.description || '');
		setFeeDueDate(fee.due_date || '');
		setIsEditModalOpen(true);
	};

	// Handle update fee.
	const handleUpdateFee = () => {
		if (!feeName.trim() || !editingFee) {
			return;
		}

		setIsSaving(true);

		apiFetch({
			path: `/fair-audience/v1/fees/${editingFee.id}`,
			method: 'PUT',
			data: {
				name: feeName.trim(),
				description: feeDescription.trim(),
				due_date: feeDueDate || null,
				status: editingFee.status,
			},
		})
			.then(() => {
				setIsEditModalOpen(false);
				setEditingFee(null);
				loadFees();
			})
			.catch((err) => {
				// eslint-disable-next-line no-undef
				alert(
					__('Error: ', 'fair-audience') +
						(err.message ||
							__('Failed to update fee.', 'fair-audience'))
				);
			})
			.finally(() => {
				setIsSaving(false);
			});
	};

	// Handle delete fee.
	const handleDeleteFee = (fee) => {
		// eslint-disable-next-line no-undef
		if (
			!confirm(
				__(
					'Are you sure you want to delete this fee? All payment records will also be deleted.',
					'fair-audience'
				)
			)
		) {
			return;
		}

		apiFetch({
			path: `/fair-audience/v1/fees/${fee.id}`,
			method: 'DELETE',
		})
			.then(() => {
				loadFees();
			})
			.catch((err) => {
				// eslint-disable-next-line no-undef
				alert(
					__('Error: ', 'fair-audience') +
						(err.message ||
							__('Failed to delete fee.', 'fair-audience'))
				);
			});
	};

	// Define actions for DataViews.
	const actions = useMemo(
		() => [
			{
				id: 'view-details',
				label: __('View Details', 'fair-audience'),
				icon: 'visibility',
				callback: ([item]) => {
					window.location.href = `admin.php?page=fair-audience-fee-detail&fee_id=${item.id}`;
				},
				supportsBulk: false,
			},
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
				callback: ([item]) => handleDeleteFee(item),
				supportsBulk: false,
				isDestructive: true,
			},
		],
		[]
	);

	const paginationInfo = useMemo(
		() => ({
			totalItems,
			totalPages: 1,
		}),
		[totalItems]
	);

	const groupOptions = [
		{ label: __('Select a group...', 'fair-audience'), value: '' },
		...groups.map((g) => ({ label: g.name, value: String(g.id) })),
	];

	return (
		<div className="wrap">
			<h1>{__('Membership Fees', 'fair-audience')}</h1>

			<Card>
				<CardBody>
					<div style={{ marginBottom: '16px' }}>
						<Button variant="primary" onClick={openCreateModal}>
							{__('Create Fee', 'fair-audience')}
						</Button>
					</div>

					<DataViews
						data={fees}
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

			{/* Create Fee Modal */}
			{isCreateModalOpen && (
				<Modal
					title={__('Create Fee', 'fair-audience')}
					onRequestClose={() => setIsCreateModalOpen(false)}
				>
					<TextControl
						label={__('Name', 'fair-audience')}
						value={feeName}
						onChange={setFeeName}
						placeholder={__('Enter fee name...', 'fair-audience')}
					/>

					<TextareaControl
						label={__('Description', 'fair-audience')}
						value={feeDescription}
						onChange={setFeeDescription}
						placeholder={__(
							'Enter description (optional)...',
							'fair-audience'
						)}
					/>

					<SelectControl
						label={__('Group', 'fair-audience')}
						value={feeGroupId}
						options={groupOptions}
						onChange={setFeeGroupId}
					/>

					<TextControl
						label={__('Amount', 'fair-audience')}
						type="number"
						value={feeAmount}
						onChange={setFeeAmount}
						min="0"
						step="0.01"
						placeholder="0.00"
					/>

					<TextControl
						label={__('Due Date', 'fair-audience')}
						type="date"
						value={feeDueDate}
						onChange={setFeeDueDate}
					/>

					<div
						style={{
							display: 'flex',
							justifyContent: 'flex-end',
							gap: '8px',
							marginTop: '16px',
						}}
					>
						<Button
							variant="secondary"
							onClick={() => setIsCreateModalOpen(false)}
						>
							{__('Cancel', 'fair-audience')}
						</Button>
						<Button
							variant="primary"
							onClick={handleCreateFee}
							disabled={
								!feeName.trim() ||
								!feeGroupId ||
								!feeAmount ||
								isSaving
							}
							isBusy={isSaving}
						>
							{__('Create', 'fair-audience')}
						</Button>
					</div>
				</Modal>
			)}

			{/* Edit Fee Modal */}
			{isEditModalOpen && editingFee && (
				<Modal
					title={__('Edit Fee', 'fair-audience')}
					onRequestClose={() => {
						setIsEditModalOpen(false);
						setEditingFee(null);
					}}
				>
					<TextControl
						label={__('Name', 'fair-audience')}
						value={feeName}
						onChange={setFeeName}
					/>

					<TextareaControl
						label={__('Description', 'fair-audience')}
						value={feeDescription}
						onChange={setFeeDescription}
					/>

					<TextControl
						label={__('Due Date', 'fair-audience')}
						type="date"
						value={feeDueDate}
						onChange={setFeeDueDate}
					/>

					<SelectControl
						label={__('Status', 'fair-audience')}
						value={editingFee.status}
						options={[
							{
								label: __('Draft', 'fair-audience'),
								value: 'draft',
							},
							{
								label: __('Active', 'fair-audience'),
								value: 'active',
							},
							{
								label: __('Closed', 'fair-audience'),
								value: 'closed',
							},
						]}
						onChange={(value) =>
							setEditingFee({ ...editingFee, status: value })
						}
					/>

					<div
						style={{
							display: 'flex',
							justifyContent: 'flex-end',
							gap: '8px',
							marginTop: '16px',
						}}
					>
						<Button
							variant="secondary"
							onClick={() => {
								setIsEditModalOpen(false);
								setEditingFee(null);
							}}
						>
							{__('Cancel', 'fair-audience')}
						</Button>
						<Button
							variant="primary"
							onClick={handleUpdateFee}
							disabled={!feeName.trim() || isSaving}
							isBusy={isSaving}
						>
							{__('Update', 'fair-audience')}
						</Button>
					</div>
				</Modal>
			)}
		</div>
	);
}
