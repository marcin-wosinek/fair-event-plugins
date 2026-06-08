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

/**
 * Internal dependencies
 */
import EventUrlField from './EventUrlField.js';
import ParticipantField from './ParticipantField.js';

const TransferModal = ({ entry, budgets, eventsEnabled, onSave, onCancel }) => {
	const isEditMode = !!entry;

	// When editing, find the cost child (source) and income child (target).
	const costChild = isEditMode
		? entry.children?.find((c) => c.entry_type === 'cost')
		: null;
	const incomeChild = isEditMode
		? entry.children?.find((c) => c.entry_type === 'income')
		: null;

	const [formData, setFormData] = useState({
		amount: isEditMode ? entry.amount?.toString() : '',
		entry_date: isEditMode
			? entry.entry_date
			: new Date().toISOString().split('T')[0],
		description: isEditMode ? entry.description || '' : '',
		source_budget_id: costChild
			? costChild.budget_id?.toString() || ''
			: '',
		target_budget_id: incomeChild
			? incomeChild.budget_id?.toString() || ''
			: '',
		event_url: costChild ? costChild.event_url || '' : '',
		event_date_id: costChild ? costChild.event_date_id || null : null,
		participant_id: isEditMode ? entry.participant_id || null : null,
	});
	const [participant, setParticipant] = useState(
		isEditMode && entry.participant ? entry.participant : null
	);
	const [isSaving, setIsSaving] = useState(false);
	const [error, setError] = useState(null);

	const budgetOptions = [
		{
			label: __('-- Select Budget --', 'fair-payments-connector'),
			value: '',
		},
		...budgets.map((budget) => ({
			label: budget.name,
			value: budget.id.toString(),
		})),
	];

	const isSameBudget =
		formData.source_budget_id &&
		formData.target_budget_id &&
		formData.source_budget_id === formData.target_budget_id;

	const handleSubmit = async (e) => {
		e.preventDefault();
		setIsSaving(true);
		setError(null);

		try {
			const data = {
				amount: parseFloat(formData.amount),
				entry_date: formData.entry_date,
				source_budget_id: parseInt(formData.source_budget_id, 10),
				target_budget_id: parseInt(formData.target_budget_id, 10),
				description: formData.description || null,
				event_url: formData.event_url || null,
				event_date_id: formData.event_date_id || null,
				participant_id: formData.participant_id || null,
			};

			if (isEditMode) {
				await apiFetch({
					path: `/fair-payments-connector/v1/financial-entries/transfer/${entry.id}`,
					method: 'PUT',
					data,
				});
			} else {
				await apiFetch({
					path: '/fair-payments-connector/v1/financial-entries/transfer',
					method: 'POST',
					data,
				});
			}
			onSave();
		} catch (err) {
			setError(
				err.message ||
					__('Failed to save transfer.', 'fair-payments-connector')
			);
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<Modal
			title={
				isEditMode
					? __('Edit Transfer', 'fair-payments-connector')
					: __('New Transfer', 'fair-payments-connector')
			}
			onRequestClose={onCancel}
			style={{ maxWidth: '500px', width: '100%' }}
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

					<TextControl
						label={__('Amount', 'fair-payments-connector')}
						value={formData.amount}
						onChange={(value) =>
							setFormData({ ...formData, amount: value })
						}
						type="number"
						step="0.01"
						min="0.01"
						required
						help={__(
							'Enter amount in EUR',
							'fair-payments-connector'
						)}
					/>

					<TextControl
						label={__('Date', 'fair-payments-connector')}
						value={formData.entry_date}
						onChange={(value) =>
							setFormData({ ...formData, entry_date: value })
						}
						type="date"
						required
					/>

					<TextareaControl
						label={__('Description', 'fair-payments-connector')}
						value={formData.description}
						onChange={(value) =>
							setFormData({ ...formData, description: value })
						}
						help={__(
							'Optional description for this transfer',
							'fair-payments-connector'
						)}
					/>

					<SelectControl
						label={__(
							'From Budget (Source)',
							'fair-payments-connector'
						)}
						value={formData.source_budget_id}
						options={budgetOptions}
						onChange={(value) =>
							setFormData({
								...formData,
								source_budget_id: value,
							})
						}
					/>

					<SelectControl
						label={__(
							'To Budget (Target)',
							'fair-payments-connector'
						)}
						value={formData.target_budget_id}
						options={budgetOptions}
						onChange={(value) =>
							setFormData({
								...formData,
								target_budget_id: value,
							})
						}
					/>

					{isSameBudget && (
						<div
							className="notice notice-warning"
							style={{ margin: 0, padding: '8px' }}
						>
							{__(
								'Source and target budgets must be different.',
								'fair-payments-connector'
							)}
						</div>
					)}

					{eventsEnabled && (
						<EventUrlField
							value={formData.event_url}
							eventDateId={formData.event_date_id}
							onChange={(url, dateId) =>
								setFormData({
									...formData,
									event_url: url,
									event_date_id: dateId,
								})
							}
						/>
					)}

					<ParticipantField
						participantId={formData.participant_id}
						participant={participant}
						onChange={(id, p) => {
							setFormData({
								...formData,
								participant_id: id,
							});
							setParticipant(p);
						}}
					/>

					<HStack justify="flex-end" spacing={2}>
						<Button
							variant="tertiary"
							onClick={onCancel}
							disabled={isSaving}
						>
							{__('Cancel', 'fair-payments-connector')}
						</Button>
						<Button
							variant="primary"
							type="submit"
							isBusy={isSaving}
							disabled={
								isSaving ||
								!formData.amount ||
								!formData.entry_date ||
								!formData.source_budget_id ||
								!formData.target_budget_id ||
								isSameBudget
							}
						>
							{isEditMode
								? __(
										'Update Transfer',
										'fair-payments-connector'
								  )
								: __(
										'Create Transfer',
										'fair-payments-connector'
								  )}
						</Button>
					</HStack>
				</VStack>
			</form>
		</Modal>
	);
};

export default TransferModal;
