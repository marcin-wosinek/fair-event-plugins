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
	Spinner,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

const EventUrlField = ({ value, eventDateId, onChange }) => {
	const [mode, setMode] = useState(value ? 'manual' : 'search');
	const [searchTerm, setSearchTerm] = useState('');
	const [searchResults, setSearchResults] = useState([]);
	const [isSearching, setIsSearching] = useState(false);

	useEffect(() => {
		if (mode !== 'search' || searchTerm.length < 2) {
			setSearchResults([]);
			return;
		}

		const timeout = setTimeout(async () => {
			setIsSearching(true);
			try {
				const params = new URLSearchParams();
				params.append('search', searchTerm);
				params.append('per_page', 10);
				params.append('include_sources', true);
				const data = await apiFetch({
					path: `/fair-events/v1/event-dates?${params.toString()}`,
				});
				setSearchResults(
					(Array.isArray(data) ? data : []).filter(
						(ed) => ed.display_url
					)
				);
			} catch {
				setSearchResults([]);
			} finally {
				setIsSearching(false);
			}
		}, 300);

		return () => clearTimeout(timeout);
	}, [searchTerm, mode]);

	if (value) {
		return (
			<div>
				<div style={{ marginBottom: '4px', fontWeight: '600' }}>
					{__('Event', 'fair-payment')}
				</div>
				<HStack spacing={2}>
					<a
						href={value}
						target="_blank"
						rel="noopener noreferrer"
						style={{ wordBreak: 'break-all' }}
					>
						{value}
					</a>
					<Button
						variant="tertiary"
						size="small"
						isDestructive
						onClick={() => onChange('', null)}
					>
						{__('Clear', 'fair-payment')}
					</Button>
				</HStack>
			</div>
		);
	}

	return (
		<div>
			<div style={{ marginBottom: '4px', fontWeight: '600' }}>
				{__('Event', 'fair-payment')}
			</div>
			<HStack spacing={2} style={{ marginBottom: '8px' }}>
				<Button
					variant={mode === 'search' ? 'primary' : 'secondary'}
					size="small"
					onClick={() => setMode('search')}
				>
					{__('Search', 'fair-payment')}
				</Button>
				<Button
					variant={mode === 'manual' ? 'primary' : 'secondary'}
					size="small"
					onClick={() => setMode('manual')}
				>
					{__('Manual URL', 'fair-payment')}
				</Button>
			</HStack>

			{mode === 'search' && (
				<div>
					<TextControl
						value={searchTerm}
						onChange={setSearchTerm}
						placeholder={__('Search events...', 'fair-payment')}
						autoComplete="off"
					/>
					{isSearching && <Spinner />}
					{searchResults.length > 0 && (
						<div
							style={{
								border: '1px solid #ddd',
								borderRadius: '4px',
								maxHeight: '200px',
								overflowY: 'auto',
							}}
						>
							{searchResults.map((event) => (
								<div
									key={event.id}
									style={{
										padding: '8px 12px',
										cursor: 'pointer',
										borderBottom: '1px solid #eee',
									}}
									onClick={() => {
										const isExternalSource = String(
											event.id
										).startsWith('source_');
										onChange(
											event.display_url,
											isExternalSource ? null : event.id
										);
										setSearchTerm('');
										setSearchResults([]);
									}}
									onKeyDown={(e) => {
										if (e.key === 'Enter') {
											const isExternalSource = String(
												event.id
											).startsWith('source_');
											onChange(
												event.display_url,
												isExternalSource
													? null
													: event.id
											);
											setSearchTerm('');
											setSearchResults([]);
										}
									}}
									role="button"
									tabIndex={0}
								>
									<strong>{event.title}</strong>
									<div
										style={{
											fontSize: '12px',
											color: '#666',
										}}
									>
										{event.start_datetime?.split('T')[0] ||
											event.start_datetime?.split(' ')[0]}
									</div>
								</div>
							))}
						</div>
					)}
				</div>
			)}

			{mode === 'manual' && (
				<TextControl
					value=""
					onChange={(val) => {
						if (val) {
							onChange(val, null);
						}
					}}
					placeholder={__(
						'https://example.com/event',
						'fair-payment'
					)}
					type="url"
					help={__(
						'Enter the event URL and press Tab or click away',
						'fair-payment'
					)}
					onBlur={(e) => {
						if (e.target.value) {
							onChange(e.target.value, null);
						}
					}}
				/>
			)}
		</div>
	);
};

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
	});
	const [isSaving, setIsSaving] = useState(false);
	const [error, setError] = useState(null);

	const budgetOptions = [
		{ label: __('-- Select Budget --', 'fair-payment'), value: '' },
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
			};

			if (isEditMode) {
				await apiFetch({
					path: `/fair-payment/v1/financial-entries/transfer/${entry.id}`,
					method: 'PUT',
					data,
				});
			} else {
				await apiFetch({
					path: '/fair-payment/v1/financial-entries/transfer',
					method: 'POST',
					data,
				});
			}
			onSave();
		} catch (err) {
			setError(
				err.message || __('Failed to save transfer.', 'fair-payment')
			);
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<Modal
			title={
				isEditMode
					? __('Edit Transfer', 'fair-payment')
					: __('New Transfer', 'fair-payment')
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
							'Optional description for this transfer',
							'fair-payment'
						)}
					/>

					<SelectControl
						label={__('From Budget (Source)', 'fair-payment')}
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
						label={__('To Budget (Target)', 'fair-payment')}
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
								'fair-payment'
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
								!formData.entry_date ||
								!formData.source_budget_id ||
								!formData.target_budget_id ||
								isSameBudget
							}
						>
							{isEditMode
								? __('Update Transfer', 'fair-payment')
								: __('Create Transfer', 'fair-payment')}
						</Button>
					</HStack>
				</VStack>
			</form>
		</Modal>
	);
};

export default TransferModal;
