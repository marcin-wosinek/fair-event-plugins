/**
 * WordPress dependencies
 */
import { useState, useEffect } from '@wordpress/element';
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

const EntryForm = ({ entry, budgets, onSave, onCancel }) => {
	const [formData, setFormData] = useState({
		amount: '',
		entry_type: 'cost',
		entry_date: new Date().toISOString().split('T')[0],
		description: '',
		budget_id: '',
	});
	const [isSaving, setIsSaving] = useState(false);
	const [error, setError] = useState(null);

	useEffect(() => {
		if (entry) {
			setFormData({
				amount: entry.amount?.toString() || '',
				entry_type: entry.entry_type || 'cost',
				entry_date:
					entry.entry_date || new Date().toISOString().split('T')[0],
				description: entry.description || '',
				budget_id: entry.budget_id?.toString() || '',
			});
		}
	}, [entry]);

	const handleSubmit = async (e) => {
		e.preventDefault();
		setIsSaving(true);
		setError(null);

		try {
			const data = {
				...formData,
				amount: parseFloat(formData.amount),
				budget_id: formData.budget_id
					? parseInt(formData.budget_id, 10)
					: null,
			};

			if (entry) {
				await apiFetch({
					path: `/fair-payment/v1/financial-entries/${entry.id}`,
					method: 'PUT',
					data,
				});
			} else {
				await apiFetch({
					path: '/fair-payment/v1/financial-entries',
					method: 'POST',
					data,
				});
			}
			onSave();
		} catch (err) {
			setError(
				err.message || __('Failed to save entry.', 'fair-payment')
			);
		} finally {
			setIsSaving(false);
		}
	};

	const budgetOptions = [
		{ label: __('-- No Budget --', 'fair-payment'), value: '' },
		...budgets.map((budget) => ({
			label: budget.name,
			value: budget.id.toString(),
		})),
	];

	return (
		<Modal
			title={
				entry
					? __('Edit Financial Entry', 'fair-payment')
					: __('Add Financial Entry', 'fair-payment')
			}
			onRequestClose={onCancel}
			style={{ maxWidth: '500px' }}
		>
			<form onSubmit={handleSubmit}>
				<VStack spacing={4}>
					{error && (
						<div
							className="notice notice-error"
							style={{ margin: 0, padding: '8px' }}
						>
							{error}
						</div>
					)}

					<SelectControl
						label={__('Type', 'fair-payment')}
						value={formData.entry_type}
						options={[
							{
								label: __('Cost', 'fair-payment'),
								value: 'cost',
							},
							{
								label: __('Income', 'fair-payment'),
								value: 'income',
							},
						]}
						onChange={(value) =>
							setFormData({ ...formData, entry_type: value })
						}
					/>

					<TextControl
						label={__('Amount', 'fair-payment')}
						value={formData.amount}
						onChange={(value) =>
							setFormData({ ...formData, amount: value })
						}
						type="number"
						step="0.01"
						min="0.01"
						required
						help={__('Enter amount in EUR', 'fair-payment')}
					/>

					<TextControl
						label={__('Date', 'fair-payment')}
						value={formData.entry_date}
						onChange={(value) =>
							setFormData({ ...formData, entry_date: value })
						}
						type="date"
						required
					/>

					<TextareaControl
						label={__('Description', 'fair-payment')}
						value={formData.description}
						onChange={(value) =>
							setFormData({ ...formData, description: value })
						}
						help={__(
							'Optional description for this entry',
							'fair-payment'
						)}
					/>

					<SelectControl
						label={__('Budget Category', 'fair-payment')}
						value={formData.budget_id}
						options={budgetOptions}
						onChange={(value) =>
							setFormData({ ...formData, budget_id: value })
						}
					/>

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
								!formData.amount ||
								!formData.entry_date
							}
						>
							{entry
								? __('Update Entry', 'fair-payment')
								: __('Create Entry', 'fair-payment')}
						</Button>
					</HStack>
				</VStack>
			</form>
		</Modal>
	);
};

export default EntryForm;
