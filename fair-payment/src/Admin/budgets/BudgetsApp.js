/**
 * WordPress dependencies
 */
import { useState, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Spinner,
	Notice,
	Modal,
	TextControl,
	TextareaControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

const BudgetsApp = () => {
	const [budgets, setBudgets] = useState([]);
	const [stats, setStats] = useState({});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [success, setSuccess] = useState(null);
	const [isFormOpen, setIsFormOpen] = useState(false);
	const [editingBudget, setEditingBudget] = useState(null);
	const [formData, setFormData] = useState({
		name: '',
		description: '',
	});
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		loadData();
	}, []);

	const loadData = async () => {
		setLoading(true);
		setError(null);

		try {
			const [budgetsData, statsData] = await Promise.all([
				apiFetch({ path: '/fair-payment/v1/budgets' }),
				apiFetch({ path: '/fair-payment/v1/budgets/stats' }),
			]);
			setBudgets(budgetsData);
			setStats(statsData);
		} catch (err) {
			setError(
				err.message || __('Failed to load budgets.', 'fair-payment')
			);
		} finally {
			setLoading(false);
		}
	};

	const handleCreate = () => {
		setEditingBudget(null);
		setFormData({
			name: '',
			description: '',
		});
		setIsFormOpen(true);
	};

	const handleEdit = (budget) => {
		setEditingBudget(budget);
		setFormData({
			name: budget.name,
			description: budget.description || '',
		});
		setIsFormOpen(true);
	};

	const handleDelete = async (id) => {
		if (
			!window.confirm(
				__(
					'Are you sure you want to delete this budget? Financial entries will be unlinked but not deleted.',
					'fair-payment'
				)
			)
		) {
			return;
		}

		setError(null);
		setSuccess(null);

		try {
			await apiFetch({
				path: `/fair-payment/v1/budgets/${id}`,
				method: 'DELETE',
			});
			setSuccess(__('Budget deleted successfully.', 'fair-payment'));
			loadData();
		} catch (err) {
			setError(
				err.message || __('Failed to delete budget.', 'fair-payment')
			);
		}
	};

	const handleFormSubmit = async (e) => {
		e.preventDefault();
		setIsSaving(true);
		setError(null);

		try {
			if (editingBudget) {
				await apiFetch({
					path: `/fair-payment/v1/budgets/${editingBudget.id}`,
					method: 'PUT',
					data: formData,
				});
				setSuccess(__('Budget updated successfully.', 'fair-payment'));
			} else {
				await apiFetch({
					path: '/fair-payment/v1/budgets',
					method: 'POST',
					data: formData,
				});
				setSuccess(__('Budget created successfully.', 'fair-payment'));
			}
			setIsFormOpen(false);
			setEditingBudget(null);
			loadData();
		} catch (err) {
			setError(
				err.message ||
					(editingBudget
						? __('Failed to update budget.', 'fair-payment')
						: __('Failed to create budget.', 'fair-payment'))
			);
		} finally {
			setIsSaving(false);
		}
	};

	const handleFormCancel = () => {
		setIsFormOpen(false);
		setEditingBudget(null);
	};

	const formatAmount = (amount) => {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'EUR',
		}).format(amount || 0);
	};

	const getBudgetStats = (budgetId) => {
		return (
			stats[budgetId] || {
				total_cost: 0,
				total_income: 0,
				balance: 0,
				total_count: 0,
			}
		);
	};

	const unbudgeted = stats.unbudgeted || {
		total_cost: 0,
		total_income: 0,
		balance: 0,
		cost_count: 0,
		income_count: 0,
		total_count: 0,
	};

	return (
		<div className="wrap fair-payment-budgets-page">
			<VStack spacing={4}>
				{/* Unbudgeted Summary */}
				<Card>
					<CardBody>
						<HStack justify="space-around">
							<div style={{ textAlign: 'center' }}>
								<div
									style={{
										fontSize: '24px',
										fontWeight: 'bold',
										color: '#d63638',
									}}
								>
									{formatAmount(unbudgeted.total_cost)}
								</div>
								<div style={{ color: '#666' }}>
									{__('Unbudgeted Costs', 'fair-payment')} (
									{unbudgeted.cost_count || 0})
								</div>
							</div>
							<div style={{ textAlign: 'center' }}>
								<div
									style={{
										fontSize: '24px',
										fontWeight: 'bold',
										color: '#007017',
									}}
								>
									{formatAmount(unbudgeted.total_income)}
								</div>
								<div style={{ color: '#666' }}>
									{__('Unbudgeted Income', 'fair-payment')} (
									{unbudgeted.income_count || 0})
								</div>
							</div>
						</HStack>
					</CardBody>
				</Card>

				{/* Budgets List */}
				<Card>
					<CardHeader>
						<HStack justify="space-between">
							<h1>{__('Budget Categories', 'fair-payment')}</h1>
							<Button variant="primary" onClick={handleCreate}>
								{__('Add New Budget', 'fair-payment')}
							</Button>
						</HStack>
					</CardHeader>
					<CardBody>
						<VStack spacing={4}>
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

							{loading && (
								<div className="budgets-loading">
									<Spinner />
									<p>
										{__(
											'Loading budgets...',
											'fair-payment'
										)}
									</p>
								</div>
							)}

							{!loading && budgets.length === 0 && (
								<div className="budgets-empty">
									<p>
										{__(
											'No budget categories found. Create your first budget category to organize your costs and income.',
											'fair-payment'
										)}
									</p>
								</div>
							)}

							{!loading && budgets.length > 0 && (
								<table className="wp-list-table widefat fixed striped">
									<thead>
										<tr>
											<th>
												{__('Name', 'fair-payment')}
											</th>
											<th>
												{__(
													'Description',
													'fair-payment'
												)}
											</th>
											<th style={{ width: '120px' }}>
												{__('Balance', 'fair-payment')}
											</th>
											<th style={{ width: '180px' }}>
												{__('Actions', 'fair-payment')}
											</th>
										</tr>
									</thead>
									<tbody>
										{budgets.map((budget) => {
											const budgetStats = getBudgetStats(
												budget.id
											);
											return (
												<tr key={budget.id}>
													<td>
														<strong>
															{budget.name}
														</strong>
													</td>
													<td>
														{budget.description || (
															<em>
																{__(
																	'No description',
																	'fair-payment'
																)}
															</em>
														)}
													</td>
													<td>
														<span
															style={{
																color:
																	budgetStats.balance >=
																	0
																		? '#007017'
																		: '#d63638',
																fontWeight:
																	'bold',
															}}
														>
															{formatAmount(
																budgetStats.balance
															)}
														</span>
													</td>
													<td>
														<HStack spacing={2}>
															<Button
																variant="secondary"
																size="small"
																onClick={() =>
																	handleEdit(
																		budget
																	)
																}
															>
																{__(
																	'Edit',
																	'fair-payment'
																)}
															</Button>
															<Button
																variant="tertiary"
																size="small"
																isDestructive
																onClick={() =>
																	handleDelete(
																		budget.id
																	)
																}
															>
																{__(
																	'Delete',
																	'fair-payment'
																)}
															</Button>
														</HStack>
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							)}
						</VStack>
					</CardBody>
				</Card>
			</VStack>

			{isFormOpen && (
				<Modal
					title={
						editingBudget
							? __('Edit Budget', 'fair-payment')
							: __('Add New Budget', 'fair-payment')
					}
					onRequestClose={handleFormCancel}
					style={{ maxWidth: '500px' }}
				>
					<form onSubmit={handleFormSubmit}>
						<VStack spacing={4}>
							<TextControl
								label={__('Name', 'fair-payment')}
								value={formData.name}
								onChange={(value) =>
									setFormData({ ...formData, name: value })
								}
								required
							/>
							<TextareaControl
								label={__('Description', 'fair-payment')}
								value={formData.description}
								onChange={(value) =>
									setFormData({
										...formData,
										description: value,
									})
								}
								help={__(
									'Optional description for this budget category',
									'fair-payment'
								)}
							/>
							<HStack justify="flex-end" spacing={2}>
								<Button
									variant="tertiary"
									onClick={handleFormCancel}
									disabled={isSaving}
								>
									{__('Cancel', 'fair-payment')}
								</Button>
								<Button
									variant="primary"
									type="submit"
									isBusy={isSaving}
									disabled={isSaving || !formData.name}
								>
									{editingBudget
										? __('Update Budget', 'fair-payment')
										: __('Create Budget', 'fair-payment')}
								</Button>
							</HStack>
						</VStack>
					</form>
				</Modal>
			)}
		</div>
	);
};

export default BudgetsApp;
