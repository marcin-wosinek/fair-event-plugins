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
	SelectControl,
	TextControl,
	TextareaControl,
	__experimentalHStack as HStack,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import UserFeesList from './UserFeesList.js';
import UserFeeForm from './UserFeeForm.js';

const UserFeesPage = () => {
	const [userFees, setUserFees] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [success, setSuccess] = useState(null);
	const [page, setPage] = useState(1);
	const [totalPages, setTotalPages] = useState(1);
	const [total, setTotal] = useState(0);

	// Filter state
	const [statusFilter, setStatusFilter] = useState('');

	// Modal state
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [editingUserFee, setEditingUserFee] = useState(null);

	// Adjust modal state
	const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
	const [adjustingUserFee, setAdjustingUserFee] = useState(null);
	const [newAmount, setNewAmount] = useState('');
	const [adjustReason, setAdjustReason] = useState('');
	const [adjusting, setAdjusting] = useState(false);

	// Load user fees on mount and when page or filters change
	useEffect(() => {
		loadUserFees();
	}, [page, statusFilter]);

	const loadUserFees = async () => {
		setLoading(true);
		setError(null);

		try {
			const params = new URLSearchParams({
				page: page.toString(),
				per_page: '20',
			});

			if (statusFilter) {
				params.append('status', statusFilter);
			}

			const response = await apiFetch({
				path: `/fair-membership/v1/user-fees?${params.toString()}`,
			});

			setUserFees(response || []);
			setTotal(response.length);
		} catch (err) {
			const errorMessage =
				err.message ||
				__('Failed to load user fees.', 'fair-membership');
			setError(errorMessage);
		} finally {
			setLoading(false);
		}
	};

	const handleAddNew = () => {
		setEditingUserFee(null);
		setIsModalOpen(true);
		setError(null);
		setSuccess(null);
	};

	const handleEdit = (userFee) => {
		setEditingUserFee(userFee);
		setIsModalOpen(true);
		setError(null);
		setSuccess(null);
	};

	const handleDelete = async (userFee) => {
		if (
			!confirm(
				sprintf(
					__(
						'Are you sure you want to delete the user fee "%s"?',
						'fair-membership'
					),
					userFee.title
				)
			)
		) {
			return;
		}

		try {
			await apiFetch({
				path: `/fair-membership/v1/user-fees/${userFee.id}`,
				method: 'DELETE',
			});

			setUserFees((prev) => prev.filter((uf) => uf.id !== userFee.id));
			setTotal((prev) => prev - 1);

			setSuccess(__('User fee deleted successfully.', 'fair-membership'));
			setError(null);
		} catch (err) {
			setError(
				err.message ||
					__('Failed to delete user fee.', 'fair-membership')
			);
			setSuccess(null);
		}
	};

	const handleMarkAsPaid = async (userFee) => {
		if (
			!confirm(
				sprintf(
					__('Mark fee "%s" as paid for %s?', 'fair-membership'),
					userFee.title,
					userFee.user_display_name || `User #${userFee.user_id}`
				)
			)
		) {
			return;
		}

		try {
			const response = await apiFetch({
				path: `/fair-membership/v1/user-fees/${userFee.id}/pay`,
				method: 'POST',
			});

			setUserFees((prev) =>
				prev.map((uf) => (uf.id === userFee.id ? response : uf))
			);

			setSuccess(__('Fee marked as paid.', 'fair-membership'));
			setError(null);
		} catch (err) {
			setError(
				err.message ||
					__('Failed to mark fee as paid.', 'fair-membership')
			);
			setSuccess(null);
		}
	};

	const handleAdjust = (userFee) => {
		setAdjustingUserFee(userFee);
		setNewAmount(userFee.amount.toString());
		setAdjustReason('');
		setIsAdjustModalOpen(true);
	};

	const handleAdjustSubmit = async (e) => {
		e.preventDefault();
		setAdjusting(true);

		try {
			const response = await apiFetch({
				path: `/fair-membership/v1/user-fees/${adjustingUserFee.id}/adjust`,
				method: 'POST',
				data: {
					new_amount: parseFloat(newAmount),
					reason: adjustReason,
				},
			});

			setUserFees((prev) =>
				prev.map((uf) =>
					uf.id === adjustingUserFee.id ? response.user_fee : uf
				)
			);

			setSuccess(
				__('Fee amount adjusted successfully.', 'fair-membership')
			);
			setError(null);
			setIsAdjustModalOpen(false);
			setAdjustingUserFee(null);
		} catch (err) {
			setError(
				err.message ||
					__('Failed to adjust fee amount.', 'fair-membership')
			);
		} finally {
			setAdjusting(false);
		}
	};

	const handleSave = async (userFeeData) => {
		try {
			if (editingUserFee) {
				const response = await apiFetch({
					path: `/fair-membership/v1/user-fees/${editingUserFee.id}`,
					method: 'PUT',
					data: userFeeData,
				});

				setUserFees((prev) =>
					prev.map((uf) =>
						uf.id === editingUserFee.id ? response : uf
					)
				);

				setSuccess(
					__('User fee updated successfully.', 'fair-membership')
				);
			} else {
				const response = await apiFetch({
					path: '/fair-membership/v1/user-fees',
					method: 'POST',
					data: userFeeData,
				});

				loadUserFees();

				setSuccess(
					__('User fee created successfully.', 'fair-membership')
				);
			}

			setIsModalOpen(false);
			setEditingUserFee(null);
			setError(null);
		} catch (err) {
			throw new Error(
				err.message || __('Failed to save user fee.', 'fair-membership')
			);
		}
	};

	const handleCancel = () => {
		setIsModalOpen(false);
		setEditingUserFee(null);
	};

	if (loading) {
		return (
			<div className="wrap">
				<h1>{__('User Fees', 'fair-membership')}</h1>
				<Spinner />
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1 className="wp-heading-inline">
				{__('User Fees', 'fair-membership')}
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

			<Card style={{ marginTop: '20px' }}>
				<CardHeader>
					<HStack>
						<h2>{__('Filters', 'fair-membership')}</h2>
					</HStack>
				</CardHeader>
				<CardBody>
					<HStack>
						<SelectControl
							label={__('Status', 'fair-membership')}
							value={statusFilter}
							onChange={setStatusFilter}
							options={[
								{
									value: '',
									label: __('All', 'fair-membership'),
								},
								{
									value: 'pending',
									label: __('Pending', 'fair-membership'),
								},
								{
									value: 'paid',
									label: __('Paid', 'fair-membership'),
								},
								{
									value: 'overdue',
									label: __('Overdue', 'fair-membership'),
								},
								{
									value: 'cancelled',
									label: __('Cancelled', 'fair-membership'),
								},
							]}
						/>
					</HStack>
				</CardBody>
			</Card>

			<Card style={{ marginTop: '20px' }}>
				<CardHeader>
					<HStack>
						<h2>{__('All User Fees', 'fair-membership')}</h2>
						<span style={{ marginLeft: 'auto', color: '#757575' }}>
							{sprintf(__('%d total', 'fair-membership'), total)}
						</span>
					</HStack>
				</CardHeader>

				<CardBody>
					<UserFeesList
						userFees={userFees}
						onEdit={handleEdit}
						onDelete={handleDelete}
						onMarkAsPaid={handleMarkAsPaid}
						onAdjust={handleAdjust}
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
						editingUserFee
							? __('Edit User Fee', 'fair-membership')
							: __('Add New User Fee', 'fair-membership')
					}
					onRequestClose={handleCancel}
					style={{ maxWidth: '600px' }}
				>
					<UserFeeForm
						userFee={editingUserFee}
						onSave={handleSave}
						onCancel={handleCancel}
					/>
				</Modal>
			)}

			{isAdjustModalOpen && adjustingUserFee && (
				<Modal
					title={__('Adjust Fee Amount', 'fair-membership')}
					onRequestClose={() => setIsAdjustModalOpen(false)}
					style={{ maxWidth: '500px' }}
				>
					<form onSubmit={handleAdjustSubmit}>
						<VStack spacing={4}>
							<p>
								{sprintf(
									__(
										'Adjusting fee "%s" for %s',
										'fair-membership'
									),
									adjustingUserFee.title,
									adjustingUserFee.user_display_name ||
										`User #${adjustingUserFee.user_id}`
								)}
							</p>

							<div>
								<strong>
									{__('Current Amount:', 'fair-membership')}
								</strong>{' '}
								$
								{parseFloat(adjustingUserFee.amount).toFixed(2)}
							</div>

							<TextControl
								label={__('New Amount', 'fair-membership')}
								type="number"
								value={newAmount}
								onChange={setNewAmount}
								required
								min="0"
								step="0.01"
							/>

							<TextareaControl
								label={__(
									'Reason for Adjustment',
									'fair-membership'
								)}
								value={adjustReason}
								onChange={setAdjustReason}
								required
								rows={3}
								help={__(
									'This will be saved in the adjustment history.',
									'fair-membership'
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
									onClick={() => setIsAdjustModalOpen(false)}
								>
									{__('Cancel', 'fair-membership')}
								</Button>
								<Button
									variant="primary"
									type="submit"
									isBusy={adjusting}
									disabled={adjusting}
								>
									{adjusting
										? __('Adjusting...', 'fair-membership')
										: __('Adjust', 'fair-membership')}
								</Button>
							</div>
						</VStack>
					</form>
				</Modal>
			)}
		</div>
	);
};

export default UserFeesPage;
