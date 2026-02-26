/**
 * WordPress dependencies
 */
import { useState, useEffect, useCallback, Fragment } from '@wordpress/element';
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
import SplitModal from './components/SplitModal.js';
import TransferModal from './components/TransferModal.js';

const budgetingEnabled = window.fairPaymentSettings?.budgetingEnabled === '1';
const eventsEnabled = window.fairPaymentSettings?.eventsEnabled === '1';

const getEventUrlLabel = (url) => {
	try {
		const parsed = new URL(url);
		const path = parsed.pathname.replace(/\/$/, '');
		const segment = path.split('/').pop();
		return segment ? segment.replace(/-/g, ' ') : parsed.hostname;
	} catch {
		return url;
	}
};

const EntriesApp = () => {
	const [entries, setEntries] = useState([]);
	const [budgets, setBudgets] = useState([]);
	const [eventUrls, setEventUrls] = useState([]);
	const [eventDateOptions, setEventDateOptions] = useState([]);
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
		event_url: '',
		event_date_id: '',
		entry_type: '',
		unmatched: false,
	});
	const [sort, setSort] = useState({
		orderby: 'entry_date',
		order: 'desc',
	});
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [success, setSuccess] = useState(null);

	// Modal states
	const [isFormOpen, setIsFormOpen] = useState(false);
	const [editingEntry, setEditingEntry] = useState(null);
	const [matchingEntry, setMatchingEntry] = useState(null);
	const [isImportOpen, setIsImportOpen] = useState(false);
	const [splittingEntry, setSplittingEntry] = useState(null);
	const [isTransferOpen, setIsTransferOpen] = useState(false);
	const [transferEntry, setTransferEntry] = useState(null);
	const [expandedEntries, setExpandedEntries] = useState({});

	useEffect(() => {
		if (budgetingEnabled) {
			loadBudgets();

			const params = new URLSearchParams(window.location.search);
			const budgetId = params.get('budget_id');
			if (budgetId) {
				setFilters((prev) => ({ ...prev, budget_id: budgetId }));
			}
		}
		if (eventsEnabled) {
			loadEventUrls();
			loadEventDateOptions();

			const params = new URLSearchParams(window.location.search);
			const eventDateId = params.get('event_date_id');
			if (eventDateId) {
				setFilters((prev) => ({
					...prev,
					event_date_id: eventDateId,
				}));
			}
		}
	}, []);

	useEffect(() => {
		loadEntries();
		loadTotals();
	}, [filters, pagination.page, sort]);

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

	const loadEventUrls = async () => {
		try {
			const data = await apiFetch({
				path: '/fair-payment/v1/financial-entries/event-urls',
			});
			setEventUrls(data);
		} catch (err) {
			console.error('Failed to load event URLs:', err);
		}
	};

	const loadEventDateOptions = async () => {
		try {
			const ids = await apiFetch({
				path: '/fair-payment/v1/financial-entries/event-date-ids',
			});
			if (ids.length === 0) {
				setEventDateOptions([]);
				return;
			}
			try {
				const events = await apiFetch({
					path: `/fair-events/v1/event-dates/batch?ids=${ids.join(
						','
					)}`,
				});
				setEventDateOptions(
					events.map((event) => ({
						label:
							event.title ||
							getEventUrlLabel(event.display_url || ''),
						value: event.id.toString(),
					}))
				);
			} catch {
				// fair-events not available, fall back to bare IDs.
				setEventDateOptions(
					ids.map((id) => ({
						label: `#${id}`,
						value: id.toString(),
					}))
				);
			}
		} catch (err) {
			console.error('Failed to load event date IDs:', err);
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
			if (filters.event_url)
				params.append('event_url', filters.event_url);
			if (filters.event_date_id)
				params.append('event_date_id', filters.event_date_id);
			if (filters.entry_type)
				params.append('entry_type', filters.entry_type);
			if (filters.unmatched) params.append('unmatched', 'true');
			params.append('orderby', sort.orderby);
			params.append('order', sort.order);

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
			if (filters.event_url)
				params.append('event_url', filters.event_url);
			if (filters.event_date_id)
				params.append('event_date_id', filters.event_date_id);
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
			if (eventsEnabled) {
				loadEventUrls();
				loadEventDateOptions();
			}
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
		if (eventsEnabled) {
			loadEventUrls();
			loadEventDateOptions();
		}
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
		if (eventsEnabled) {
			loadEventUrls();
			loadEventDateOptions();
		}
	};

	const handleImportCancel = () => {
		setIsImportOpen(false);
	};

	const handleSplit = (entry) => {
		setSplittingEntry(entry);
	};

	const handleSplitComplete = () => {
		const wasEdit =
			splittingEntry?.children && splittingEntry.children.length > 0;
		setSplittingEntry(null);
		setSuccess(
			wasEdit
				? __('Split updated successfully.', 'fair-payment')
				: __('Entry split successfully.', 'fair-payment')
		);
		loadEntries();
		loadTotals();
		if (eventsEnabled) {
			loadEventUrls();
			loadEventDateOptions();
		}
	};

	const handleSplitCancel = () => {
		setSplittingEntry(null);
	};

	const handleUnsplit = async (id) => {
		if (
			!window.confirm(
				__(
					'Are you sure you want to unsplit this entry? All child allocations will be deleted.',
					'fair-payment'
				)
			)
		) {
			return;
		}

		try {
			await apiFetch({
				path: `/fair-payment/v1/financial-entries/${id}/split`,
				method: 'DELETE',
			});
			setSplittingEntry(null);
			setSuccess(__('Entry unsplit successfully.', 'fair-payment'));
			loadEntries();
			loadTotals();
			if (eventsEnabled) {
				loadEventUrls();
				loadEventDateOptions();
			}
		} catch (err) {
			setError(
				err.message || __('Failed to unsplit entry.', 'fair-payment')
			);
		}
	};

	const handleTransfer = () => {
		setTransferEntry(null);
		setIsTransferOpen(true);
	};

	const handleEditTransfer = (entry) => {
		setTransferEntry(entry);
		setIsTransferOpen(true);
	};

	const handleTransferSave = () => {
		setIsTransferOpen(false);
		setTransferEntry(null);
		setSuccess(
			transferEntry
				? __('Transfer updated successfully.', 'fair-payment')
				: __('Transfer created successfully.', 'fair-payment')
		);
		loadEntries();
		loadTotals();
		if (eventsEnabled) {
			loadEventUrls();
			loadEventDateOptions();
		}
	};

	const handleTransferCancel = () => {
		setIsTransferOpen(false);
		setTransferEntry(null);
	};

	const toggleExpanded = (entryId) => {
		setExpandedEntries((prev) => ({
			...prev,
			[entryId]: !prev[entryId],
		}));
	};

	const handleFilterChange = (key, value) => {
		setFilters((prev) => ({ ...prev, [key]: value }));
		setPagination((prev) => ({ ...prev, page: 1 }));
	};

	const handlePageChange = (newPage) => {
		setPagination((prev) => ({ ...prev, page: newPage }));
	};

	const handleSort = (column) => {
		setSort((prev) => ({
			orderby: column,
			order:
				prev.orderby === column && prev.order === 'desc'
					? 'asc'
					: 'desc',
		}));
		setPagination((prev) => ({ ...prev, page: 1 }));
	};

	const SortableHeader = ({ column, children }) => {
		const isActive = sort.orderby === column;
		const arrow = isActive
			? sort.order === 'asc'
				? ' \u25B2'
				: ' \u25BC'
			: '';
		return (
			<th
				style={{ cursor: 'pointer', userSelect: 'none' }}
				onClick={() => handleSort(column)}
			>
				{children}
				{arrow}
			</th>
		);
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
		{ label: __('Unbudgeted', 'fair-payment'), value: 'none' },
	];

	const eventUrlOptions = [
		{ label: __('All Events', 'fair-payment'), value: '' },
		...eventUrls.map((url) => ({
			label: getEventUrlLabel(url),
			value: url,
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
								{budgetingEnabled && (
									<Button
										variant="secondary"
										onClick={handleTransfer}
									>
										{__('Transfer', 'fair-payment')}
									</Button>
								)}
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
								{budgetingEnabled && (
									<SelectControl
										label={__('Budget', 'fair-payment')}
										value={filters.budget_id}
										options={budgetOptions}
										onChange={(value) =>
											handleFilterChange(
												'budget_id',
												value
											)
										}
									/>
								)}
								{eventsEnabled &&
									eventDateOptions.length > 0 && (
										<SelectControl
											label={__('Event', 'fair-payment')}
											value={filters.event_date_id}
											options={[
												{
													label: __(
														'All Events',
														'fair-payment'
													),
													value: '',
												},
												...eventDateOptions,
											]}
											onChange={(value) =>
												handleFilterChange(
													'event_date_id',
													value
												)
											}
										/>
									)}
								{eventsEnabled &&
									eventDateOptions.length === 0 &&
									eventUrls.length > 0 && (
										<SelectControl
											label={__('Event', 'fair-payment')}
											value={filters.event_url}
											options={eventUrlOptions}
											onChange={(value) =>
												handleFilterChange(
													'event_url',
													value
												)
											}
										/>
									)}
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
										{
											label: __(
												'Transfer',
												'fair-payment'
											),
											value: 'transfer',
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
									<div style={{ overflowX: 'auto' }}>
										<table className="wp-list-table widefat striped">
											<thead>
												<tr>
													<SortableHeader column="entry_date">
														{__(
															'Date',
															'fair-payment'
														)}
													</SortableHeader>
													<th>
														{__(
															'Type',
															'fair-payment'
														)}
													</th>
													<SortableHeader column="amount">
														{__(
															'Amount',
															'fair-payment'
														)}
													</SortableHeader>
													<th>
														{__(
															'Description',
															'fair-payment'
														)}
													</th>
													{budgetingEnabled && (
														<SortableHeader column="budget_id">
															{__(
																'Budget',
																'fair-payment'
															)}
														</SortableHeader>
													)}
													{eventsEnabled && (
														<SortableHeader column="event_date_id">
															{__(
																'Event',
																'fair-payment'
															)}
														</SortableHeader>
													)}
													<th>
														{__(
															'Matched',
															'fair-payment'
														)}
													</th>
													<SortableHeader column="imported_at">
														{__(
															'Imported',
															'fair-payment'
														)}
													</SortableHeader>
													<th>
														{__(
															'Actions',
															'fair-payment'
														)}
													</th>
												</tr>
											</thead>
											<tbody>
												{entries.map((entry) => {
													const isTransfer =
														entry.entry_type ===
														'transfer';
													const isSplit =
														!isTransfer &&
														entry.children &&
														entry.children.length >
															0;
													const isChild =
														!!entry.parent_entry_id;
													const isExpanded =
														expandedEntries[
															entry.id
														];

													return (
														<Fragment
															key={entry.id}
														>
															<tr>
																<td>
																	{
																		entry.entry_date
																	}
																</td>
																<td>
																	<span
																		style={{
																			color: isTransfer
																				? '#2271b1'
																				: entry.entry_type ===
																				  'cost'
																				? '#d63638'
																				: '#007017',
																			fontWeight:
																				'bold',
																		}}
																	>
																		{isTransfer
																			? __(
																					'Transfer',
																					'fair-payment'
																			  )
																			: entry.entry_type ===
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
																	{isChild && (
																		<span
																			style={{
																				marginLeft:
																					'4px',
																				color: '#2271b1',
																				fontSize:
																					'12px',
																			}}
																		>
																			{__(
																				'(split)',
																				'fair-payment'
																			)}
																		</span>
																	)}
																</td>
																<td>
																	{entry.description || (
																		<em>
																			-
																		</em>
																	)}
																</td>
																{budgetingEnabled && (
																	<td>
																		{isTransfer ? (
																			<Button
																				variant="link"
																				size="small"
																				onClick={() =>
																					toggleExpanded(
																						entry.id
																					)
																				}
																				style={{
																					color: '#2271b1',
																					fontWeight:
																						'bold',
																				}}
																			>
																				{isExpanded
																					? __(
																							'Transfer \u25BE',
																							'fair-payment'
																					  )
																					: __(
																							'Transfer \u25B8',
																							'fair-payment'
																					  )}
																			</Button>
																		) : isSplit ? (
																			<Button
																				variant="link"
																				size="small"
																				onClick={() =>
																					toggleExpanded(
																						entry.id
																					)
																				}
																				style={{
																					color: '#2271b1',
																					fontWeight:
																						'bold',
																				}}
																			>
																				{isExpanded
																					? __(
																							'Split \u25BE',
																							'fair-payment'
																					  )
																					: __(
																							'Split \u25B8',
																							'fair-payment'
																					  )}
																			</Button>
																		) : (
																			getBudgetName(
																				entry.budget_id
																			)
																		)}
																	</td>
																)}
																{eventsEnabled && (
																	<td>
																		{entry.event_url ? (
																			<a
																				href={
																					entry.event_url
																				}
																				target="_blank"
																				rel="noopener noreferrer"
																				title={
																					entry.event_url
																				}
																				style={{
																					fontSize:
																						'13px',
																				}}
																			>
																				{getEventUrlLabel(
																					entry.event_url
																				)}
																			</a>
																		) : isTransfer ? (
																			<Button
																				variant="link"
																				size="small"
																				onClick={() =>
																					toggleExpanded(
																						entry.id
																					)
																				}
																				style={{
																					color: '#2271b1',
																					fontWeight:
																						'bold',
																				}}
																			>
																				{isExpanded
																					? __(
																							'Transfer \u25BE',
																							'fair-payment'
																					  )
																					: __(
																							'Transfer \u25B8',
																							'fair-payment'
																					  )}
																			</Button>
																		) : isSplit ? (
																			<Button
																				variant="link"
																				size="small"
																				onClick={() =>
																					toggleExpanded(
																						entry.id
																					)
																				}
																				style={{
																					color: '#2271b1',
																					fontWeight:
																						'bold',
																				}}
																			>
																				{isExpanded
																					? __(
																							'Split \u25BE',
																							'fair-payment'
																					  )
																					: __(
																							'Split \u25B8',
																							'fair-payment'
																					  )}
																			</Button>
																		) : (
																			<em>
																				-
																			</em>
																		)}
																	</td>
																)}
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
																<td
																	title={
																		entry.import_source ||
																		''
																	}
																>
																	{entry.imported_at || (
																		<em>
																			-
																		</em>
																	)}
																</td>
																<td>
																	{isChild ? (
																		<HStack
																			spacing={
																				1
																			}
																		>
																			<Button
																				variant="secondary"
																				size="small"
																				onClick={() =>
																					handleSplit(
																						entry.parent
																					)
																				}
																			>
																				{__(
																					'Edit Split',
																					'fair-payment'
																				)}
																			</Button>
																		</HStack>
																	) : isTransfer ? (
																		<HStack
																			spacing={
																				1
																			}
																		>
																			<Button
																				variant="secondary"
																				size="small"
																				onClick={() =>
																					handleEditTransfer(
																						entry
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
																	) : (
																		<HStack
																			spacing={
																				1
																			}
																		>
																			<Button
																				variant="secondary"
																				size="small"
																				onClick={() =>
																					handleEdit(
																						entry
																					)
																				}
																				disabled={
																					isSplit
																				}
																			>
																				{__(
																					'Edit',
																					'fair-payment'
																				)}
																			</Button>
																			{isSplit ? (
																				<Button
																					variant="tertiary"
																					size="small"
																					onClick={() =>
																						handleSplit(
																							entry
																						)
																					}
																				>
																					{__(
																						'Edit Split',
																						'fair-payment'
																					)}
																				</Button>
																			) : (
																				<Button
																					variant="tertiary"
																					size="small"
																					onClick={() =>
																						handleSplit(
																							entry
																						)
																					}
																				>
																					{__(
																						'Split',
																						'fair-payment'
																					)}
																				</Button>
																			)}
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
																				disabled={
																					isSplit
																				}
																			>
																				{__(
																					'Delete',
																					'fair-payment'
																				)}
																			</Button>
																		</HStack>
																	)}
																</td>
															</tr>
															{isTransfer &&
																isExpanded &&
																entry.children &&
																entry.children.map(
																	(child) => (
																		<tr
																			key={`child-${child.id}`}
																			style={{
																				backgroundColor:
																					'#f6f7f7',
																			}}
																		>
																			<td></td>
																			<td>
																				<span
																					style={{
																						color:
																							child.entry_type ===
																							'cost'
																								? '#d63638'
																								: '#007017',
																						fontSize:
																							'13px',
																					}}
																				>
																					{child.entry_type ===
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
																			<td
																				style={{
																					paddingLeft:
																						'20px',
																				}}
																			>
																				{formatAmount(
																					child.amount
																				)}
																			</td>
																			<td
																				style={{
																					color: '#666',
																					fontSize:
																						'13px',
																				}}
																			>
																				{child.description || (
																					<em>
																						-
																					</em>
																				)}
																			</td>
																			{budgetingEnabled && (
																				<td>
																					{getBudgetName(
																						child.budget_id
																					)}
																				</td>
																			)}
																			{eventsEnabled && (
																				<td>
																					{child.event_url ? (
																						<a
																							href={
																								child.event_url
																							}
																							target="_blank"
																							rel="noopener noreferrer"
																							title={
																								child.event_url
																							}
																							style={{
																								fontSize:
																									'12px',
																							}}
																						>
																							{getEventUrlLabel(
																								child.event_url
																							)}
																						</a>
																					) : (
																						<em>
																							-
																						</em>
																					)}
																				</td>
																			)}
																			<td
																				colSpan={
																					3
																				}
																			></td>
																		</tr>
																	)
																)}
															{isSplit &&
																isExpanded &&
																entry.children.map(
																	(child) => (
																		<tr
																			key={`child-${child.id}`}
																			style={{
																				backgroundColor:
																					'#f6f7f7',
																			}}
																		>
																			<td></td>
																			<td></td>
																			<td
																				style={{
																					paddingLeft:
																						'20px',
																				}}
																			>
																				{formatAmount(
																					child.amount
																				)}
																			</td>
																			<td
																				style={{
																					color: '#666',
																					fontSize:
																						'13px',
																				}}
																			>
																				{child.description || (
																					<em>
																						-
																					</em>
																				)}
																			</td>
																			{budgetingEnabled && (
																				<td>
																					{getBudgetName(
																						child.budget_id
																					)}
																				</td>
																			)}
																			{eventsEnabled && (
																				<td>
																					{child.event_url ? (
																						<a
																							href={
																								child.event_url
																							}
																							target="_blank"
																							rel="noopener noreferrer"
																							title={
																								child.event_url
																							}
																							style={{
																								fontSize:
																									'12px',
																							}}
																						>
																							{getEventUrlLabel(
																								child.event_url
																							)}
																						</a>
																					) : (
																						<em>
																							-
																						</em>
																					)}
																				</td>
																			)}
																			<td
																				colSpan={
																					3
																				}
																			></td>
																		</tr>
																	)
																)}
														</Fragment>
													);
												})}
											</tbody>
										</table>
									</div>

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
					budgetingEnabled={budgetingEnabled}
					eventsEnabled={eventsEnabled}
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

			{/* Split Modal */}
			{splittingEntry && (
				<SplitModal
					entry={splittingEntry}
					budgets={budgets}
					budgetingEnabled={budgetingEnabled}
					eventsEnabled={eventsEnabled}
					onSplit={handleSplitComplete}
					onCancel={handleSplitCancel}
					onUnsplit={() => handleUnsplit(splittingEntry.id)}
				/>
			)}

			{/* Transfer Modal */}
			{isTransferOpen && (
				<TransferModal
					entry={transferEntry}
					budgets={budgets}
					eventsEnabled={eventsEnabled}
					onSave={handleTransferSave}
					onCancel={handleTransferCancel}
				/>
			)}
		</div>
	);
};

export default EntriesApp;
