/**
 * WordPress dependencies
 */
import { useState, useEffect, useCallback } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Spinner,
	Notice,
	SelectControl,
	TextControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import EntryForm from './components/EntryForm.js';
import MatchModal from './components/MatchModal.js';
import ImportModal from './components/ImportModal.js';

const EntriesApp = () => {
	const [entries, setEntries] = useState([]);
	const [budgets, setBudgets] = useState([]);
	const [totals, setTotals] = useState({
		total_cost: 0,
		total_income: 0,
		balance: 0,
	});
	const [pagination, setPagination] = useState({
		total: 0,
		pages: 0,
		page: 1,
	});
	const [filters, setFilters] = useState({
		date_from: '',
		date_to: '',
		budget_id: '',
		entry_type: '',
		unmatched: false,
	});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [success, setSuccess] = useState(null);

	// Modal states
	const [isFormOpen, setIsFormOpen] = useState(false);
	const [editingEntry, setEditingEntry] = useState(null);
	const [matchingEntry, setMatchingEntry] = useState(null);
	const [isImportOpen, setIsImportOpen] = useState(false);

	useEffect(() => {
		loadBudgets();
	}, []);

	useEffect(() => {
		loadEntries();
		loadTotals();
	}, [filters, pagination.page]);

	const loadBudgets = async () => {
		try {
			const data = await apiFetch({
				path: '/fair-payment/v1/budgets',
			});
			setBudgets(data);
		} catch (err) {
			console.error('Failed to load budgets:', err);
		}
	};

	const loadEntries = async () => {
		setLoading(true);
		setError(null);

		try {
			const params = new URLSearchParams();
			params.append('page', pagination.page);
			params.append('per_page', 50);

			if (filters.date_from)
				params.append('date_from', filters.date_from);
			if (filters.date_to) params.append('date_to', filters.date_to);
			if (filters.budget_id)
				params.append('budget_id', filters.budget_id);
			if (filters.entry_type)
				params.append('entry_type', filters.entry_type);
			if (filters.unmatched) params.append('unmatched', 'true');

			const data = await apiFetch({
				path: `/fair-payment/v1/financial-entries?${params.toString()}`,
			});

			setEntries(data.entries);
			setPagination((prev) => ({
				...prev,
				total: data.total,
				pages: data.pages,
			}));
		} catch (err) {
			setError(
				err.message || __('Failed to load entries.', 'fair-payment')
			);
		} finally {
			setLoading(false);
		}
	};

	const loadTotals = async () => {
		try {
			const params = new URLSearchParams();
			if (filters.date_from)
				params.append('date_from', filters.date_from);
			if (filters.date_to) params.append('date_to', filters.date_to);
			if (filters.budget_id)
				params.append('budget_id', filters.budget_id);
			if (filters.unmatched) params.append('unmatched', 'true');

			const data = await apiFetch({
				path: `/fair-payment/v1/financial-entries/totals?${params.toString()}`,
			});

			setTotals(data);
		} catch (err) {
			console.error('Failed to load totals:', err);
		}
	};

	const handleCreate = () => {
		setEditingEntry(null);
		setIsFormOpen(true);
	};

	const handleEdit = (entry) => {
		setEditingEntry(entry);
		setIsFormOpen(true);
	};

	const handleDelete = async (id) => {
		if (
			!window.confirm(
				__(
					'Are you sure you want to delete this entry?',
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
				path: `/fair-payment/v1/financial-entries/${id}`,
				method: 'DELETE',
			});
			setSuccess(__('Entry deleted successfully.', 'fair-payment'));
			loadEntries();
			loadTotals();
		} catch (err) {
			setError(
				err.message || __('Failed to delete entry.', 'fair-payment')
			);
		}
	};

	const handleFormSave = () => {
		setIsFormOpen(false);
		setEditingEntry(null);
		setSuccess(
			editingEntry
				? __('Entry updated successfully.', 'fair-payment')
				: __('Entry created successfully.', 'fair-payment')
		);
		loadEntries();
		loadTotals();
	};

	const handleFormCancel = () => {
		setIsFormOpen(false);
		setEditingEntry(null);
	};

	const handleMatch = (entry) => {
		setMatchingEntry(entry);
	};

	const handleUnmatch = async (id) => {
		if (
			!window.confirm(
				__(
					'Are you sure you want to unmatch this entry from its transaction?',
					'fair-payment'
				)
			)
		) {
			return;
		}

		try {
			await apiFetch({
				path: `/fair-payment/v1/financial-entries/${id}/match`,
				method: 'DELETE',
			});
			setSuccess(__('Entry unmatched successfully.', 'fair-payment'));
			loadEntries();
		} catch (err) {
			setError(
				err.message || __('Failed to unmatch entry.', 'fair-payment')
			);
		}
	};

	const handleMatchComplete = () => {
		setMatchingEntry(null);
		setSuccess(__('Entry matched to transaction.', 'fair-payment'));
		loadEntries();
	};

	const handleMatchCancel = () => {
		setMatchingEntry(null);
	};

	const handleImport = () => {
		setIsImportOpen(true);
	};

	const handleImportComplete = () => {
		setIsImportOpen(false);
		setSuccess(__('Entries imported successfully.', 'fair-payment'));
		loadEntries();
		loadTotals();
	};

	const handleImportCancel = () => {
		setIsImportOpen(false);
	};

	const handleFilterChange = (key, value) => {
		setFilters((prev) => ({ ...prev, [key]: value }));
		setPagination((prev) => ({ ...prev, page: 1 }));
	};

	const handlePageChange = (newPage) => {
		setPagination((prev) => ({ ...prev, page: newPage }));
	};

	const formatAmount = (amount) => {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'EUR',
		}).format(amount);
	};

	const getBudgetName = (budgetId) => {
		const budget = budgets.find((b) => b.id === budgetId);
		return budget ? budget.name : '-';
	};

	const budgetOptions = [
		{ label: __('All Budgets', 'fair-payment'), value: '' },
		...budgets.map((budget) => ({
			label: budget.name,
			value: budget.id.toString(),
		})),
	];

	return (
		<div className="wrap fair-payment-entries-page">
			<VStack spacing={4}>
				{/* Totals Summary */}
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
									{formatAmount(totals.total_cost)}
								</div>
								<div style={{ color: '#666' }}>
									{__('Total Costs', 'fair-payment')}
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
									{formatAmount(totals.total_income)}
								</div>
								<div style={{ color: '#666' }}>
									{__('Total Income', 'fair-payment')}
								</div>
							</div>
							<div style={{ textAlign: 'center' }}>
								<div
									style={{
										fontSize: '24px',
										fontWeight: 'bold',
										color:
											totals.balance >= 0
												? '#007017'
												: '#d63638',
									}}
								>
									{formatAmount(totals.balance)}
								</div>
								<div style={{ color: '#666' }}>
									{__('Balance', 'fair-payment')}
								</div>
							</div>
						</HStack>
					</CardBody>
				</Card>

				{/* Main Entries Card */}
				<Card>
					<CardHeader>
						<HStack justify="space-between">
							<h1>{__('Financial Entries', 'fair-payment')}</h1>
							<div style={{ display: 'flex', gap: '8px' }}>
								<Button
									variant="primary"
									onClick={handleCreate}
								>
									{__('Add Entry', 'fair-payment')}
								</Button>
								<Button
									variant="secondary"
									onClick={handleImport}
								>
									{__('Import', 'fair-payment')}
								</Button>
							</div>
						</HStack>
					</CardHeader>
					<CardBody>
						<VStack spacing={4}>
							{/* Filters */}
							<HStack spacing={3} wrap>
								<TextControl
									label={__('From Date', 'fair-payment')}
									value={filters.date_from}
									onChange={(value) =>
										handleFilterChange('date_from', value)
									}
									type="date"
								/>
								<TextControl
									label={__('To Date', 'fair-payment')}
									value={filters.date_to}
									onChange={(value) =>
										handleFilterChange('date_to', value)
									}
									type="date"
								/>
								<SelectControl
									label={__('Budget', 'fair-payment')}
									value={filters.budget_id}
									options={budgetOptions}
									onChange={(value) =>
										handleFilterChange('budget_id', value)
									}
								/>
								<SelectControl
									label={__('Type', 'fair-payment')}
									value={filters.entry_type}
									options={[
										{
											label: __(
												'All Types',
												'fair-payment'
											),
											value: '',
										},
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
										handleFilterChange('entry_type', value)
									}
								/>
								<SelectControl
									label={__('Matching', 'fair-payment')}
									value={filters.unmatched ? 'unmatched' : ''}
									options={[
										{
											label: __('All', 'fair-payment'),
											value: '',
										},
										{
											label: __(
												'Unmatched Only',
												'fair-payment'
											),
											value: 'unmatched',
										},
									]}
									onChange={(value) =>
										handleFilterChange(
											'unmatched',
											value === 'unmatched'
										)
									}
								/>
							</HStack>

							{/* Notices */}
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

							{/* Loading */}
							{loading && (
								<div
									style={{
										textAlign: 'center',
										padding: '20px',
									}}
								>
									<Spinner />
									<p>
										{__(
											'Loading entries...',
											'fair-payment'
										)}
									</p>
								</div>
							)}

							{/* Empty State */}
							{!loading && entries.length === 0 && (
								<div
									style={{
										textAlign: 'center',
										padding: '20px',
									}}
								>
									<p>
										{__(
											'No entries found. Add your first entry to start tracking costs and income.',
											'fair-payment'
										)}
									</p>
								</div>
							)}

							{/* Entries Table */}
							{!loading && entries.length > 0 && (
								<>
									<table className="wp-list-table widefat fixed striped">
										<thead>
											<tr>
												<th>
													{__('Date', 'fair-payment')}
												</th>
												<th>
													{__('Type', 'fair-payment')}
												</th>
												<th>
													{__(
														'Amount',
														'fair-payment'
													)}
												</th>
												<th>
													{__(
														'Description',
														'fair-payment'
													)}
												</th>
												<th>
													{__(
														'Budget',
														'fair-payment'
													)}
												</th>
												<th>
													{__(
														'Matched',
														'fair-payment'
													)}
												</th>
												<th>
													{__(
														'Actions',
														'fair-payment'
													)}
												</th>
											</tr>
										</thead>
										<tbody>
											{entries.map((entry) => (
												<tr key={entry.id}>
													<td>{entry.entry_date}</td>
													<td>
														<span
															style={{
																color:
																	entry.entry_type ===
																	'cost'
																		? '#d63638'
																		: '#007017',
																fontWeight:
																	'bold',
															}}
														>
															{entry.entry_type ===
															'cost'
																? __(
																		'Cost',
																		'fair-payment'
																  )
																: __(
																		'Income',
																		'fair-payment'
																  )}
														</span>
													</td>
													<td>
														<strong>
															{formatAmount(
																entry.amount
															)}
														</strong>
													</td>
													<td>
														{entry.description || (
															<em>-</em>
														)}
													</td>
													<td>
														{getBudgetName(
															entry.budget_id
														)}
													</td>
													<td>
														{entry.transaction_id ? (
															<span
																style={{
																	color: '#007017',
																}}
															>
																{__(
																	'Yes',
																	'fair-payment'
																)}
															</span>
														) : (
															<span
																style={{
																	color: '#996800',
																}}
															>
																{__(
																	'No',
																	'fair-payment'
																)}
															</span>
														)}
													</td>
													<td>
														<HStack spacing={1}>
															<Button
																variant="secondary"
																size="small"
																onClick={() =>
																	handleEdit(
																		entry
																	)
																}
															>
																{__(
																	'Edit',
																	'fair-payment'
																)}
															</Button>
															{entry.transaction_id ? (
																<Button
																	variant="tertiary"
																	size="small"
																	onClick={() =>
																		handleUnmatch(
																			entry.id
																		)
																	}
																>
																	{__(
																		'Unmatch',
																		'fair-payment'
																	)}
																</Button>
															) : (
																<Button
																	variant="tertiary"
																	size="small"
																	onClick={() =>
																		handleMatch(
																			entry
																		)
																	}
																>
																	{__(
																		'Match',
																		'fair-payment'
																	)}
																</Button>
															)}
															<Button
																variant="tertiary"
																size="small"
																isDestructive
																onClick={() =>
																	handleDelete(
																		entry.id
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
											))}
										</tbody>
									</table>

									{/* Pagination */}
									{pagination.pages > 1 && (
										<HStack justify="center" spacing={2}>
											<Button
												variant="secondary"
												disabled={pagination.page === 1}
												onClick={() =>
													handlePageChange(
														pagination.page - 1
													)
												}
											>
												{__('Previous', 'fair-payment')}
											</Button>
											<span>
												{__(
													'Page %1$d of %2$d',
													'fair-payment'
												)
													.replace(
														'%1$d',
														pagination.page
													)
													.replace(
														'%2$d',
														pagination.pages
													)}
											</span>
											<Button
												variant="secondary"
												disabled={
													pagination.page ===
													pagination.pages
												}
												onClick={() =>
													handlePageChange(
														pagination.page + 1
													)
												}
											>
												{__('Next', 'fair-payment')}
											</Button>
										</HStack>
									)}
								</>
							)}
						</VStack>
					</CardBody>
				</Card>
			</VStack>

			{/* Entry Form Modal */}
			{isFormOpen && (
				<EntryForm
					entry={editingEntry}
					budgets={budgets}
					onSave={handleFormSave}
					onCancel={handleFormCancel}
				/>
			)}

			{/* Match Modal */}
			{matchingEntry && (
				<MatchModal
					entry={matchingEntry}
					onMatch={handleMatchComplete}
					onCancel={handleMatchCancel}
				/>
			)}

			{/* Import Modal */}
			{isImportOpen && (
				<ImportModal
					onImport={handleImportComplete}
					onCancel={handleImportCancel}
				/>
			)}
		</div>
	);
};

export default EntriesApp;
