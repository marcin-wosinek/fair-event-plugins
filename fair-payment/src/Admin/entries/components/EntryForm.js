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

const EventUrlField = ({ value, onChange }) => {
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
						onClick={() => onChange('')}
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
										onChange(event.display_url);
										setSearchTerm('');
										setSearchResults([]);
									}}
									onKeyDown={(e) => {
										if (e.key === 'Enter') {
											onChange(event.display_url);
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
							onChange(val);
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
							onChange(e.target.value);
						}
					}}
				/>
			)}
		</div>
	);
};

const EntryForm = ({
	entry,
	budgets,
	budgetingEnabled,
	eventsEnabled,
	onSave,
	onCancel,
}) => {
	const [formData, setFormData] = useState({
		amount: '',
		entry_type: 'cost',
		entry_date: new Date().toISOString().split('T')[0],
		description: '',
		budget_id: '',
		event_url: '',
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
				event_url: entry.event_url || '',
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
				event_url: formData.event_url || null,
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

					{budgetingEnabled && (
						<SelectControl
							label={__('Budget Category', 'fair-payment')}
							value={formData.budget_id}
							options={budgetOptions}
							onChange={(value) =>
								setFormData({ ...formData, budget_id: value })
							}
						/>
					)}

					{eventsEnabled && (
						<EventUrlField
							value={formData.event_url}
							onChange={(value) =>
								setFormData({ ...formData, event_url: value })
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
