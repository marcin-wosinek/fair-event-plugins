import { useState, useEffect } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Spinner,
	Notice,
	Modal,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import GroupsList from './GroupsList.js';
import GroupForm from './GroupForm.js';

const GroupsPage = () => {
	const [groups, setGroups] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [success, setSuccess] = useState(null);
	const [page, setPage] = useState(1);
	const [totalPages, setTotalPages] = useState(1);
	const [total, setTotal] = useState(0);

	// Modal state
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [editingGroup, setEditingGroup] = useState(null);

	// Load groups on mount and when page changes
	useEffect(() => {
		loadGroups();
	}, [page]);

	const loadGroups = async () => {
		setLoading(true);
		setError(null);

		try {
			const params = new URLSearchParams({
				page: page.toString(),
				per_page: '20',
				orderby: 'name',
				order: 'ASC',
			});

			const response = await apiFetch({
				path: `/fair-membership/v1/groups?${params.toString()}`,
			});

			setGroups(response.items || []);
			setTotalPages(response.total_pages || 1);
			setTotal(response.total || 0);
		} catch (err) {
			const errorMessage =
				err.message || __('Failed to load groups.', 'fair-membership');
			setError(errorMessage);
		} finally {
			setLoading(false);
		}
	};

	const handleAddNew = () => {
		setEditingGroup(null);
		setIsModalOpen(true);
		setError(null);
		setSuccess(null);
	};

	const handleEdit = (group) => {
		setEditingGroup(group);
		setIsModalOpen(true);
		setError(null);
		setSuccess(null);
	};

	const handleDelete = async (group) => {
		if (
			!confirm(
				sprintf(
					/* translators: %s: group name */
					__(
						'Are you sure you want to delete the group "%s"?',
						'fair-membership'
					),
					group.name
				)
			)
		) {
			return;
		}

		try {
			await apiFetch({
				path: `/fair-membership/v1/groups/${group.id}`,
				method: 'DELETE',
			});

			// Remove from local state
			setGroups((prev) => prev.filter((g) => g.id !== group.id));
			setTotal((prev) => prev - 1);

			setSuccess(__('Group deleted successfully.', 'fair-membership'));
			setError(null);
		} catch (err) {
			setError(
				err.message || __('Failed to delete group.', 'fair-membership')
			);
			setSuccess(null);
		}
	};

	const handleSave = async (groupData) => {
		try {
			if (editingGroup) {
				// Update existing group
				const response = await apiFetch({
					path: `/fair-membership/v1/groups/${editingGroup.id}`,
					method: 'PUT',
					data: groupData,
				});

				// Update in local state
				setGroups((prev) =>
					prev.map((g) =>
						g.id === editingGroup.id ? response.group : g
					)
				);

				setSuccess(
					__('Group updated successfully.', 'fair-membership')
				);
			} else {
				// Create new group
				const response = await apiFetch({
					path: '/fair-membership/v1/groups',
					method: 'POST',
					data: groupData,
				});

				// Add to local state (or reload to get proper order)
				loadGroups();

				setSuccess(
					__('Group created successfully.', 'fair-membership')
				);
			}

			setIsModalOpen(false);
			setEditingGroup(null);
			setError(null);
		} catch (err) {
			throw new Error(
				err.message || __('Failed to save group.', 'fair-membership')
			);
		}
	};

	const handleCancel = () => {
		setIsModalOpen(false);
		setEditingGroup(null);
	};

	if (loading) {
		return (
			<div className="wrap">
				<h1>{__('Groups', 'fair-membership')}</h1>
				<Spinner />
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1 className="wp-heading-inline">
				{__('Groups', 'fair-membership')}
			</h1>
			<Button
				variant="primary"
				onClick={handleAddNew}
				style={{ marginLeft: '10px' }}
			>
				{__('Add New', 'fair-membership')}
			</Button>
			<hr className="wp-header-end" />

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
					<HStack>
						<h2>{__('All Groups', 'fair-membership')}</h2>
						<span style={{ marginLeft: 'auto', color: '#757575' }}>
							{sprintf(__('%d total', 'fair-membership'), total)}
						</span>
					</HStack>
				</CardHeader>

				<CardBody>
					<GroupsList
						groups={groups}
						onEdit={handleEdit}
						onDelete={handleDelete}
					/>

					{totalPages > 1 && (
						<HStack
							style={{
								marginTop: '20px',
								justifyContent: 'center',
							}}
						>
							<Button
								variant="secondary"
								disabled={page === 1}
								onClick={() => setPage(page - 1)}
							>
								{__('Previous', 'fair-membership')}
							</Button>
							<span>
								{sprintf(
									__('Page %1$d of %2$d', 'fair-membership'),
									page,
									totalPages
								)}
							</span>
							<Button
								variant="secondary"
								disabled={page === totalPages}
								onClick={() => setPage(page + 1)}
							>
								{__('Next', 'fair-membership')}
							</Button>
						</HStack>
					)}
				</CardBody>
			</Card>

			{isModalOpen && (
				<Modal
					title={
						editingGroup
							? __('Edit Group', 'fair-membership')
							: __('Add New Group', 'fair-membership')
					}
					onRequestClose={handleCancel}
					style={{ maxWidth: '600px' }}
				>
					<GroupForm
						group={editingGroup}
						onSave={handleSave}
						onCancel={handleCancel}
					/>
				</Modal>
			)}
		</div>
	);
};

export default GroupsPage;
