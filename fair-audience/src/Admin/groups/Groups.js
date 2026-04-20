import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect, useCallback, useMemo } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardBody,
	Modal,
	TextControl,
	TextareaControl,
} from '@wordpress/components';
import { DataViews } from '@wordpress/dataviews';

const GROUP_DETAIL_URL =
	// eslint-disable-next-line no-undef
	typeof fairAudienceGroupsData !== 'undefined'
		? // eslint-disable-next-line no-undef
		  fairAudienceGroupsData.groupDetailUrl
		: 'admin.php?page=fair-audience-group-detail&group_id=';

const DEFAULT_VIEW = {
	type: 'table',
	perPage: 25,
	page: 1,
	sort: {
		field: 'name',
		direction: 'asc',
	},
	search: '',
	filters: [],
	fields: ['name', 'description', 'member_count'],
};

const DEFAULT_LAYOUTS = {
	table: {},
};

export default function Groups() {
	const [groups, setGroups] = useState([]);
	const [totalItems, setTotalItems] = useState(0);
	const [isLoading, setIsLoading] = useState(true);
	const [view, setView] = useState(DEFAULT_VIEW);

	// Create/Edit modal state.
	const [isEditModalOpen, setIsEditModalOpen] = useState(false);
	const [editingGroup, setEditingGroup] = useState(null);
	const [groupName, setGroupName] = useState('');
	const [groupDescription, setGroupDescription] = useState('');
	const [isSaving, setIsSaving] = useState(false);

	// Duplicate modal state.
	const [isDuplicateModalOpen, setIsDuplicateModalOpen] = useState(false);
	const [duplicatingGroup, setDuplicatingGroup] = useState(null);
	const [duplicateName, setDuplicateName] = useState('');
	const [isDuplicating, setIsDuplicating] = useState(false);

	// Define fields configuration for DataViews.
	const fields = useMemo(
		() => [
			{
				id: 'name',
				label: __('Name', 'fair-audience'),
				render: ({ item }) => (
					<a href={`${GROUP_DETAIL_URL}${item.id}`}>{item.name}</a>
				),
				enableSorting: true,
				enableHiding: false,
			},
			{
				id: 'description',
				label: __('Description', 'fair-audience'),
				render: ({ item }) => item.description || '—',
				enableSorting: false,
			},
			{
				id: 'member_count',
				label: __('Members', 'fair-audience'),
				render: ({ item }) => (
					<div style={{ textAlign: 'right' }}>
						{item.member_count}
					</div>
				),
				enableSorting: true,
				getValue: ({ item }) => item.member_count,
			},
		],
		[]
	);

	// Convert view state to API query params.
	const queryArgs = useMemo(() => {
		const params = new URLSearchParams();

		if (view.sort?.field) {
			params.append('orderby', view.sort.field);
			params.append('order', view.sort.direction || 'asc');
		}

		return params.toString();
	}, [view]);

	const loadGroups = useCallback(() => {
		setIsLoading(true);

		const path = `/fair-audience/v1/groups${
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
				setGroups(data);
				setIsLoading(false);
			})
			.catch((err) => {
				// eslint-disable-next-line no-console
				console.error('Error loading groups:', err);
				setIsLoading(false);
			});
	}, [queryArgs]);

	useEffect(() => {
		loadGroups();
	}, [loadGroups]);

	// Open create modal.
	const openCreateModal = () => {
		setEditingGroup(null);
		setGroupName('');
		setGroupDescription('');
		setIsEditModalOpen(true);
	};

	// Open edit modal.
	const openEditModal = (group) => {
		setEditingGroup(group);
		setGroupName(group.name);
		setGroupDescription(group.description || '');
		setIsEditModalOpen(true);
	};

	// Handle save group.
	const handleSaveGroup = () => {
		if (!groupName.trim()) {
			return;
		}

		setIsSaving(true);

		const request = editingGroup
			? apiFetch({
					path: `/fair-audience/v1/groups/${editingGroup.id}`,
					method: 'PUT',
					data: {
						name: groupName.trim(),
						description: groupDescription.trim(),
					},
			  })
			: apiFetch({
					path: '/fair-audience/v1/groups',
					method: 'POST',
					data: {
						name: groupName.trim(),
						description: groupDescription.trim(),
					},
			  });

		request
			.then(() => {
				setIsEditModalOpen(false);
				loadGroups();
			})
			.catch((err) => {
				// eslint-disable-next-line no-undef
				alert(
					__('Error: ', 'fair-audience') +
						(err.message ||
							__('Failed to save group.', 'fair-audience'))
				);
			})
			.finally(() => {
				setIsSaving(false);
			});
	};

	// Open duplicate modal.
	const openDuplicateModal = (group) => {
		setDuplicatingGroup(group);
		setDuplicateName(
			sprintf(
				/* translators: %s: original group name */
				__('%s (copy)', 'fair-audience'),
				group.name
			)
		);
		setIsDuplicateModalOpen(true);
	};

	// Handle duplicate group submission.
	const handleDuplicateGroup = () => {
		if (!duplicateName.trim()) {
			return;
		}

		setIsDuplicating(true);

		apiFetch({
			path: `/fair-audience/v1/groups/${duplicatingGroup.id}/duplicate`,
			method: 'POST',
			data: { name: duplicateName.trim() },
		})
			.then(() => {
				setIsDuplicateModalOpen(false);
				loadGroups();
			})
			.catch((err) => {
				// eslint-disable-next-line no-undef
				alert(
					__('Error: ', 'fair-audience') +
						(err.message ||
							__('Failed to duplicate group.', 'fair-audience'))
				);
			})
			.finally(() => {
				setIsDuplicating(false);
			});
	};

	// Handle delete group.
	const handleDeleteGroup = (group) => {
		// eslint-disable-next-line no-undef
		if (
			!confirm(
				__(
					'Are you sure you want to delete this group?',
					'fair-audience'
				)
			)
		) {
			return;
		}

		apiFetch({
			path: `/fair-audience/v1/groups/${group.id}`,
			method: 'DELETE',
		})
			.then(() => {
				loadGroups();
			})
			.catch((err) => {
				// eslint-disable-next-line no-undef
				alert(
					__('Error: ', 'fair-audience') +
						(err.message ||
							__('Failed to delete group.', 'fair-audience'))
				);
			});
	};

	// Define actions for DataViews.
	const actions = useMemo(
		() => [
			{
				id: 'view',
				label: __('View', 'fair-audience'),
				icon: 'visibility',
				callback: ([item]) => {
					window.location.href = `${GROUP_DETAIL_URL}${item.id}`;
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
				id: 'duplicate',
				label: __('Duplicate', 'fair-audience'),
				icon: 'admin-page',
				callback: ([item]) => openDuplicateModal(item),
				supportsBulk: false,
			},
			{
				id: 'delete',
				label: __('Delete', 'fair-audience'),
				icon: 'trash',
				callback: ([item]) => handleDeleteGroup(item),
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

	return (
		<div className="wrap">
			<h1>{__('Groups', 'fair-audience')}</h1>

			<Card>
				<CardBody>
					<div style={{ marginBottom: '16px' }}>
						<Button variant="primary" onClick={openCreateModal}>
							{__('Create Group', 'fair-audience')}
						</Button>
					</div>

					<DataViews
						data={groups}
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

			{/* Create/Edit Group Modal */}
			{isEditModalOpen && (
				<Modal
					title={
						editingGroup
							? __('Edit Group', 'fair-audience')
							: __('Create Group', 'fair-audience')
					}
					onRequestClose={() => setIsEditModalOpen(false)}
					style={{ maxWidth: '500px', width: '100%' }}
				>
					<TextControl
						label={__('Name', 'fair-audience')}
						value={groupName}
						onChange={setGroupName}
						placeholder={__('Enter group name...', 'fair-audience')}
					/>

					<TextareaControl
						label={__('Description', 'fair-audience')}
						value={groupDescription}
						onChange={setGroupDescription}
						placeholder={__(
							'Enter group description (optional)...',
							'fair-audience'
						)}
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
							onClick={() => setIsEditModalOpen(false)}
						>
							{__('Cancel', 'fair-audience')}
						</Button>
						<Button
							variant="primary"
							onClick={handleSaveGroup}
							disabled={!groupName.trim() || isSaving}
							isBusy={isSaving}
						>
							{editingGroup
								? __('Update', 'fair-audience')
								: __('Create', 'fair-audience')}
						</Button>
					</div>
				</Modal>
			)}

			{/* Duplicate Group Modal */}
			{isDuplicateModalOpen && (
				<Modal
					title={__('Duplicate Group', 'fair-audience')}
					onRequestClose={() => setIsDuplicateModalOpen(false)}
					style={{ maxWidth: '500px', width: '100%' }}
				>
					<TextControl
						label={__('New group name', 'fair-audience')}
						value={duplicateName}
						onChange={setDuplicateName}
						placeholder={__('Enter group name...', 'fair-audience')}
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
							onClick={() => setIsDuplicateModalOpen(false)}
						>
							{__('Cancel', 'fair-audience')}
						</Button>
						<Button
							variant="primary"
							onClick={handleDuplicateGroup}
							disabled={!duplicateName.trim() || isDuplicating}
							isBusy={isDuplicating}
						>
							{__('Duplicate', 'fair-audience')}
						</Button>
					</div>
				</Modal>
			)}
		</div>
	);
}
