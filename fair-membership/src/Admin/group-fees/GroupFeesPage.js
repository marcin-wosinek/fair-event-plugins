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
import GroupFeesList from './GroupFeesList.js';
import GroupFeeForm from './GroupFeeForm.js';

const GroupFeesPage = () => {
	const [groupFees, setGroupFees] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [success, setSuccess] = useState(null);
	const [page, setPage] = useState(1);
	const [totalPages, setTotalPages] = useState(1);
	const [total, setTotal] = useState(0);

	// Modal state
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [editingGroupFee, setEditingGroupFee] = useState(null);

	// Load group fees on mount and when page changes
	useEffect(() => {
		loadGroupFees();
	}, [page]);

	const loadGroupFees = async () => {
		setLoading(true);
		setError(null);

		try {
			const params = new URLSearchParams({
				page: page.toString(),
				per_page: '20',
			});

			const response = await apiFetch({
				path: `/fair-membership/v1/group-fees?${params.toString()}`,
			});

			// Response is an array, headers contain pagination info
			setGroupFees(response || []);

			// Note: You might need to adjust this based on how the API returns pagination
			// For now, assuming headers are accessible via response headers
			setTotal(response.length);
		} catch (err) {
			const errorMessage =
				err.message ||
				__('Failed to load group fees.', 'fair-membership');
			setError(errorMessage);
		} finally {
			setLoading(false);
		}
	};

	const handleAddNew = () => {
		setEditingGroupFee(null);
		setIsModalOpen(true);
		setError(null);
		setSuccess(null);
	};

	const handleEdit = (groupFee) => {
		setEditingGroupFee(groupFee);
		setIsModalOpen(true);
		setError(null);
		setSuccess(null);
	};

	const handleDelete = async (groupFee) => {
		if (
			!confirm(
				sprintf(
					__(
						'Are you sure you want to delete the group fee "%s"? This will also delete all associated user fees.',
						'fair-membership'
					),
					groupFee.title
				)
			)
		) {
			return;
		}

		try {
			await apiFetch({
				path: `/fair-membership/v1/group-fees/${groupFee.id}`,
				method: 'DELETE',
			});

			// Remove from local state
			setGroupFees((prev) => prev.filter((gf) => gf.id !== groupFee.id));
			setTotal((prev) => prev - 1);

			setSuccess(
				__('Group fee deleted successfully.', 'fair-membership')
			);
			setError(null);
		} catch (err) {
			setError(
				err.message ||
					__('Failed to delete group fee.', 'fair-membership')
			);
			setSuccess(null);
		}
	};

	const handleSave = async (groupFeeData) => {
		try {
			if (editingGroupFee) {
				// Update existing group fee
				const response = await apiFetch({
					path: `/fair-membership/v1/group-fees/${editingGroupFee.id}`,
					method: 'PUT',
					data: groupFeeData,
				});

				// Update in local state
				setGroupFees((prev) =>
					prev.map((gf) =>
						gf.id === editingGroupFee.id ? response : gf
					)
				);

				setSuccess(
					__('Group fee updated successfully.', 'fair-membership')
				);
			} else {
				// Create new group fee
				const response = await apiFetch({
					path: '/fair-membership/v1/group-fees',
					method: 'POST',
					data: groupFeeData,
				});

				// Reload to get proper order and user fee count
				loadGroupFees();

				setSuccess(
					sprintf(
						__(
							'Group fee created successfully. %d user fees were created for group members.',
							'fair-membership'
						),
						response.user_fees_created || 0
					)
				);
			}

			setIsModalOpen(false);
			setEditingGroupFee(null);
			setError(null);
		} catch (err) {
			throw new Error(
				err.message ||
					__('Failed to save group fee.', 'fair-membership')
			);
		}
	};

	const handleCancel = () => {
		setIsModalOpen(false);
		setEditingGroupFee(null);
	};

	if (loading) {
		return (
			<div className="wrap">
				<h1>{__('Group Fees', 'fair-membership')}</h1>
				<Spinner />
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1 className="wp-heading-inline">
				{__('Group Fees', 'fair-membership')}
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
						<h2>{__('All Group Fees', 'fair-membership')}</h2>
						<span style={{ marginLeft: 'auto', color: '#757575' }}>
							{sprintf(__('%d total', 'fair-membership'), total)}
						</span>
					</HStack>
				</CardHeader>

				<CardBody>
					<GroupFeesList
						groupFees={groupFees}
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
						editingGroupFee
							? __('Edit Group Fee', 'fair-membership')
							: __('Add New Group Fee', 'fair-membership')
					}
					onRequestClose={handleCancel}
					style={{ maxWidth: '600px' }}
				>
					<GroupFeeForm
						groupFee={editingGroupFee}
						onSave={handleSave}
						onCancel={handleCancel}
					/>
				</Modal>
			)}
		</div>
	);
};

export default GroupFeesPage;
