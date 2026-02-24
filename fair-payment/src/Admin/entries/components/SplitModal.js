/**
 * WordPress dependencies
 */
import { useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Modal,
	TextControl,
	TextareaControl,
	SelectControl,
	Button,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

const SplitModal = ({
	entry,
	budgets,
	budgetingEnabled,
	onSplit,
	onCancel,
	onUnsplit,
}) => {
	const isEditMode = entry.children && entry.children.length > 0;
	const [allocations, setAllocations] = useState(
		isEditMode
			? entry.children.map((child) => ({
					budget_id: child.budget_id
						? child.budget_id.toString()
						: '',
					amount: child.amount.toString(),
					description: child.description || '',
			  }))
			: [
					{
						budget_id: '',
						amount: '',
						description: entry.description || '',
					},
					{
						budget_id: '',
						amount: '',
						description: entry.description || '',
					},
			  ]
	);
	const [isSaving, setIsSaving] = useState(false);
	const [error, setError] = useState(null);

	const budgetOptions = [
		{ label: __('-- No Budget --', 'fair-payment'), value: '' },
		...budgets.map((budget) => ({
			label: budget.name,
			value: budget.id.toString(),
		})),
	];

	const updateAllocation = (index, key, value) => {
		setAllocations((prev) => {
			const updated = [...prev];
			updated[index] = { ...updated[index], [key]: value };
			return updated;
		});
	};

	const addRow = () => {
		setAllocations((prev) => [
			...prev,
			{ budget_id: '', amount: '', description: entry.description || '' },
		]);
	};

	const removeRow = (index) => {
		setAllocations((prev) => prev.filter((_, i) => i !== index));
	};

	const totalAllocated = allocations.reduce(
		(sum, a) => sum + (parseFloat(a.amount) || 0),
		0
	);
	const remaining = entry.amount - totalAllocated;
	const isBalanced = Math.abs(remaining) < 0.01;
	const allAmountsPositive = allocations.every(
		(a) => parseFloat(a.amount) > 0
	);

	const handleSubmit = async (e) => {
		e.preventDefault();
		setIsSaving(true);
		setError(null);

		try {
			await apiFetch({
				path: `/fair-payment/v1/financial-entries/${entry.id}/split`,
				method: isEditMode ? 'PUT' : 'POST',
				data: {
					allocations: allocations.map((a) => ({
						budget_id: a.budget_id
							? parseInt(a.budget_id, 10)
							: null,
						amount: parseFloat(a.amount),
						description: a.description,
					})),
				},
			});
			onSplit();
		} catch (err) {
			setError(
				err.message || __('Failed to split entry.', 'fair-payment')
			);
		} finally {
			setIsSaving(false);
		}
	};

	const formatAmount = (amount) => {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'EUR',
		}).format(amount);
	};

	return (
		<Modal
			title={
				isEditMode
					? __('Edit Split', 'fair-payment')
					: __('Split Entry', 'fair-payment')
			}
			onRequestClose={onCancel}
			style={{ maxWidth: '600px', width: '100%' }}
		>
			<form onSubmit={handleSubmit}>
				<VStack spacing={4}>
					{/* Original entry info */}
					<div
						style={{
							padding: '12px',
							background: '#f0f0f1',
							borderRadius: '4px',
						}}
					>
						<HStack spacing={4}>
							<div>
								<strong>{__('Amount:', 'fair-payment')}</strong>{' '}
								{formatAmount(entry.amount)}
							</div>
							<div>
								<strong>{__('Type:', 'fair-payment')}</strong>{' '}
								{entry.entry_type === 'cost'
									? __('Cost', 'fair-payment')
									: __('Income', 'fair-payment')}
							</div>
							<div>
								<strong>{__('Date:', 'fair-payment')}</strong>{' '}
								{entry.entry_date}
							</div>
						</HStack>
						{entry.description && (
							<div style={{ marginTop: '4px' }}>
								<strong>
									{__('Description:', 'fair-payment')}
								</strong>{' '}
								{entry.description}
							</div>
						)}
					</div>

					{error && (
						<div
							className="notice notice-error"
							style={{ margin: 0, padding: '8px' }}
						>
							{error}
						</div>
					)}

					{/* Allocation rows */}
					{allocations.map((allocation, index) => (
						<div
							key={index}
							style={{
								padding: '12px',
								border: '1px solid #ddd',
								borderRadius: '4px',
							}}
						>
							<HStack spacing={2} alignment="top" wrap>
								{budgetingEnabled && (
									<div
										style={{
											flex: 1,
											minWidth: '150px',
										}}
									>
										<SelectControl
											label={__('Budget', 'fair-payment')}
											value={allocation.budget_id}
											options={budgetOptions}
											onChange={(value) =>
												updateAllocation(
													index,
													'budget_id',
													value
												)
											}
										/>
									</div>
								)}
								<div style={{ width: '120px' }}>
									<TextControl
										label={__('Amount', 'fair-payment')}
										value={allocation.amount}
										onChange={(value) =>
											updateAllocation(
												index,
												'amount',
												value
											)
										}
										type="number"
										step="0.01"
										min="0.01"
										required
									/>
								</div>
								{allocations.length > 2 && (
									<div style={{ paddingTop: '24px' }}>
										<Button
											variant="tertiary"
											isDestructive
											size="small"
											onClick={() => removeRow(index)}
										>
											{__('Remove', 'fair-payment')}
										</Button>
									</div>
								)}
							</HStack>
							<TextareaControl
								label={__('Description', 'fair-payment')}
								value={allocation.description}
								onChange={(value) =>
									updateAllocation(
										index,
										'description',
										value
									)
								}
								rows={2}
							/>
						</div>
					))}

					<Button variant="secondary" onClick={addRow}>
						{__('+ Add Row', 'fair-payment')}
					</Button>

					{/* Running total */}
					<div
						style={{
							padding: '8px 12px',
							background: isBalanced ? '#edfaef' : '#fcf0f1',
							borderRadius: '4px',
							fontWeight: 'bold',
						}}
					>
						{__('Allocated:', 'fair-payment')}{' '}
						{formatAmount(totalAllocated)} /{' '}
						{formatAmount(entry.amount)}
						{!isBalanced && (
							<span
								style={{
									marginLeft: '12px',
									color: '#d63638',
								}}
							>
								{__('Remaining:', 'fair-payment')}{' '}
								{formatAmount(remaining)}
							</span>
						)}
					</div>

					<HStack
						justify={isEditMode ? 'space-between' : 'flex-end'}
						spacing={2}
					>
						{isEditMode && (
							<Button
								variant="tertiary"
								isDestructive
								onClick={onUnsplit}
								disabled={isSaving}
							>
								{__('Unsplit', 'fair-payment')}
							</Button>
						)}
						<HStack justify="flex-end" spacing={2}>
							<Button
								variant="tertiary"
								onClick={onCancel}
								disabled={isSaving}
							>
								{__('Cancel', 'fair-payment')}
							</Button>
							<Button
								variant="primary"
								type="submit"
								isBusy={isSaving}
								disabled={
									isSaving ||
									!isBalanced ||
									!allAmountsPositive
								}
							>
								{isEditMode
									? __('Update Split', 'fair-payment')
									: __('Split Entry', 'fair-payment')}
							</Button>
						</HStack>
					</HStack>
				</VStack>
			</form>
		</Modal>
	);
};

export default SplitModal;
