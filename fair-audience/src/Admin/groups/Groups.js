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
	SearchControl,
	CheckboxControl,
	Spinner,
} from '@wordpress/components';
import { DataViews } from '@wordpress/dataviews';

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

	// Manage Members modal state.
	const [isMembersModalOpen, setIsMembersModalOpen] = useState(false);
	const [selectedGroup, setSelectedGroup] = useState(null);
	const [members, setMembers] = useState([]);
	const [membersLoading, setMembersLoading] = useState(false);
	const [allParticipants, setAllParticipants] = useState([]);
	const [participantsLoading, setParticipantsLoading] = useState(false);
	const [participantSearch, setParticipantSearch] = useState('');
	const [selectedParticipants, setSelectedParticipants] = useState([]);
	const [isAddingMembers, setIsAddingMembers] = useState(false);

	// Define fields configuration for DataViews.
	const fields = useMemo(
		() => [
			{
				id: 'name',
				label: __('Name', 'fair-audience'),
				render: ({ item }) => item.name,
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

	// Load members for a group.
	const loadMembers = useCallback((groupId) => {
		setMembersLoading(true);

		apiFetch({
			path: `/fair-audience/v1/groups/${groupId}/participants`,
		})
			.then((data) => {
				setMembers(data);
				setMembersLoading(false);
			})
			.catch((err) => {
				// eslint-disable-next-line no-console
				console.error('Error loading members:', err);
				setMembersLoading(false);
			});
	}, []);

	// Load all participants for adding to group.
	const loadParticipants = useCallback((search = '') => {
		setParticipantsLoading(true);

		const params = new URLSearchParams();
		params.append('per_page', '100');
		params.append('orderby', 'surname');
		params.append('order', 'asc');
		if (search) {
			params.append('search', search);
		}

		apiFetch({
			path: `/fair-audience/v1/participants?${params.toString()}`,
		})
			.then((data) => {
				setAllParticipants(data);
				setParticipantsLoading(false);
			})
			.catch((err) => {
				// eslint-disable-next-line no-console
				console.error('Error loading participants:', err);
				setParticipantsLoading(false);
			});
	}, []);

	// Open manage members modal.
	const openMembersModal = (group) => {
		setSelectedGroup(group);
		setSelectedParticipants([]);
		setParticipantSearch('');
		setIsMembersModalOpen(true);
		loadMembers(group.id);
		loadParticipants();
	};

	// Handle participant search.
	const handleParticipantSearch = (value) => {
		setParticipantSearch(value);
		loadParticipants(value);
	};

	// Toggle participant selection.
	const toggleParticipantSelection = (participantId) => {
		setSelectedParticipants((prev) => {
			if (prev.includes(participantId)) {
				return prev.filter((id) => id !== participantId);
			}
			return [...prev, participantId];
		});
	};

	// Add selected participants to group.
	const handleAddMembers = () => {
		if (!selectedGroup || selectedParticipants.length === 0) {
			return;
		}

		setIsAddingMembers(true);

		const promises = selectedParticipants.map((participantId) =>
			apiFetch({
				path: `/fair-audience/v1/groups/${selectedGroup.id}/participants`,
				method: 'POST',
				data: { participant_id: participantId },
			}).catch((err) => {
				// Ignore "already member" errors.
				if (!err.message?.includes('already')) {
					throw err;
				}
			})
		);

		Promise.all(promises)
			.then(() => {
				setSelectedParticipants([]);
				loadMembers(selectedGroup.id);
				loadGroups();
			})
			.catch((err) => {
				// eslint-disable-next-line no-undef
				alert(__('Error: ', 'fair-audience') + err.message);
			})
			.finally(() => {
				setIsAddingMembers(false);
			});
	};

	// Remove member from group.
	const handleRemoveMember = (participantId) => {
		if (!selectedGroup) {
			return;
		}

		apiFetch({
			path: `/fair-audience/v1/groups/${selectedGroup.id}/participants/${participantId}`,
			method: 'DELETE',
		})
			.then(() => {
				loadMembers(selectedGroup.id);
				loadGroups();
			})
			.catch((err) => {
				// eslint-disable-next-line no-undef
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
				id: 'manage-members',
				label: __('Manage Members', 'fair-audience'),
				icon: 'groups',
				callback: ([item]) => openMembersModal(item),
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

	// Filter out participants who are already members.
	const memberIds = members.map((m) => m.id);
	const availableParticipants = allParticipants.filter(
		(p) => !memberIds.includes(p.id)
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

			{/* Manage Members Modal */}
			{isMembersModalOpen && selectedGroup && (
				<Modal
					title={
						__('Manage Members', 'fair-audience') +
						': ' +
						selectedGroup.name
					}
					onRequestClose={() => setIsMembersModalOpen(false)}
					style={{ width: '600px', maxWidth: '90vw' }}
				>
					{/* Current Members */}
					<h3>{__('Current Members', 'fair-audience')}</h3>
					{membersLoading ? (
						<Spinner />
					) : members.length === 0 ? (
						<p>
							{__('No members in this group.', 'fair-audience')}
						</p>
					) : (
						<div
							style={{
								maxHeight: '200px',
								overflowY: 'auto',
								border: '1px solid #ddd',
								padding: '8px',
								marginBottom: '16px',
							}}
						>
							{members.map((member) => (
								<div
									key={member.id}
									style={{
										display: 'flex',
										justifyContent: 'space-between',
										alignItems: 'center',
										padding: '4px 0',
										borderBottom: '1px solid #eee',
									}}
								>
									<span>
										{member.name} {member.surname}
										{member.email && (
											<span
												style={{
													color: '#666',
													marginLeft: '8px',
												}}
											>
												({member.email})
											</span>
										)}
									</span>
									<Button
										variant="link"
										isDestructive
										onClick={() =>
											handleRemoveMember(member.id)
										}
									>
										{__('Remove', 'fair-audience')}
									</Button>
								</div>
							))}
						</div>
					)}

					{/* Add Members */}
					<h3>{__('Add Members', 'fair-audience')}</h3>
					<SearchControl
						value={participantSearch}
						onChange={handleParticipantSearch}
						placeholder={__(
							'Search participants...',
							'fair-audience'
						)}
					/>

					<div
						style={{
							maxHeight: '200px',
							overflowY: 'auto',
							marginTop: '8px',
							marginBottom: '16px',
							padding: '4px',
						}}
					>
						{participantsLoading ? (
							<Spinner />
						) : availableParticipants.length === 0 ? (
							<p>
								{__(
									'No participants available to add.',
									'fair-audience'
								)}
							</p>
						) : (
							availableParticipants.map((participant) => (
								<CheckboxControl
									key={participant.id}
									label={`${participant.name} ${
										participant.surname
									}${
										participant.email
											? ` (${participant.email})`
											: ''
									}`}
									checked={selectedParticipants.includes(
										participant.id
									)}
									onChange={() =>
										toggleParticipantSelection(
											participant.id
										)
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
							onClick={() => setIsMembersModalOpen(false)}
						>
							{__('Close', 'fair-audience')}
						</Button>
						<Button
							variant="primary"
							onClick={handleAddMembers}
							disabled={
								selectedParticipants.length === 0 ||
								isAddingMembers
							}
							isBusy={isAddingMembers}
						>
							{__('Add Selected', 'fair-audience')}
						</Button>
					</div>
				</Modal>
			)}
		</div>
	);
}
