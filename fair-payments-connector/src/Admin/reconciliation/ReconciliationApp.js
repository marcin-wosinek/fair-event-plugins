/**
 * WordPress dependencies
 */
import { useState, useEffect, useCallback } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Spinner,
	Notice,
	CheckboxControl,
	Panel,
	PanelBody,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
	__experimentalText as Text,
	TextControl,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import SettlementImportModal from './components/SettlementImportModal';

const formatAmount = (amount, currency = 'EUR') => {
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency,
	}).format(amount);
};

const formatDate = (dateString) => {
	if (!dateString) return '';
	return new Date(dateString).toLocaleDateString();
};

const ReconciliationApp = () => {
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [success, setSuccess] = useState(null);

	const [unmatchedEntries, setUnmatchedEntries] = useState([]);
	const [unmatchedTransactions, setUnmatchedTransactions] = useState([]);
	const [matchedEntries, setMatchedEntries] = useState([]);

	const [selectedEntry, setSelectedEntry] = useState(null);
	const [selectedTransactionIds, setSelectedTransactionIds] = useState([]);
	const [suggestions, setSuggestions] = useState([]);
	const [loadingSuggestions, setLoadingSuggestions] = useState(false);
	const [matching, setMatching] = useState(false);
	const [descriptionFilter, setDescriptionFilter] = useState(
		'trf. stichting mollie payments'
	);
	const [showSettlementModal, setShowSettlementModal] = useState(false);

	const filteredUnmatchedEntries = unmatchedEntries.filter((entry) => {
		if (!descriptionFilter) return true;
		return (entry.description || '')
			.toLowerCase()
			.includes(descriptionFilter.toLowerCase());
	});

	const loadData = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const data = await apiFetch({
				path: '/fair-payments-connector/v1/reconciliation',
			});
			setUnmatchedEntries(data.unmatched_entries);
			setUnmatchedTransactions(data.unmatched_transactions);
			setMatchedEntries(data.matched_entries);
		} catch (err) {
			setError(
				err.message ||
					__(
						'Failed to load reconciliation data.',
						'fair-payments-connector'
					)
			);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		loadData();
	}, [loadData]);

	const handleSelectEntry = async (entry) => {
		setSelectedEntry(entry);
		setSelectedTransactionIds([]);
		setSuggestions([]);
		setLoadingSuggestions(true);

		try {
			const data = await apiFetch({
				path: `/fair-payments-connector/v1/financial-entries/${entry.id}/suggest-matches`,
			});
			setSuggestions(data);
		} catch (err) {
			// Suggestions are optional, don't block on error.
			setSuggestions([]);
		} finally {
			setLoadingSuggestions(false);
		}
	};

	const handleToggleTransaction = (transactionId) => {
		setSelectedTransactionIds((prev) =>
			prev.includes(transactionId)
				? prev.filter((id) => id !== transactionId)
				: [...prev, transactionId]
		);
	};

	const handleApplySuggestion = (suggestion) => {
		setSelectedTransactionIds(suggestion.transaction_ids);
	};

	const handleConfirmMatch = async () => {
		if (!selectedEntry || selectedTransactionIds.length === 0) return;

		setMatching(true);
		setError(null);
		try {
			await apiFetch({
				path: `/fair-payments-connector/v1/financial-entries/${selectedEntry.id}/match`,
				method: 'POST',
				data: { transaction_ids: selectedTransactionIds },
			});
			setSuccess(
				__(
					'Transactions matched successfully.',
					'fair-payments-connector'
				)
			);
			setSelectedEntry(null);
			setSelectedTransactionIds([]);
			setSuggestions([]);
			await loadData();
		} catch (err) {
			setError(
				err.message ||
					__(
						'Failed to match transactions.',
						'fair-payments-connector'
					)
			);
		} finally {
			setMatching(false);
		}
	};

	const handleUnmatchTransaction = async (entryId, transactionId) => {
		setError(null);
		try {
			await apiFetch({
				path: `/fair-payments-connector/v1/financial-entries/${entryId}/match`,
				method: 'DELETE',
				data: { transaction_id: transactionId },
			});
			setSuccess(
				__(
					'Transaction unmatched successfully.',
					'fair-payments-connector'
				)
			);
			await loadData();
		} catch (err) {
			setError(
				err.message ||
					__(
						'Failed to unmatch transaction.',
						'fair-payments-connector'
					)
			);
		}
	};

	const handleUnmatchAll = async (entryId) => {
		setError(null);
		try {
			await apiFetch({
				path: `/fair-payments-connector/v1/financial-entries/${entryId}/match`,
				method: 'DELETE',
			});
			setSuccess(
				__(
					'All transactions unmatched successfully.',
					'fair-payments-connector'
				)
			);
			await loadData();
		} catch (err) {
			setError(
				err.message ||
					__(
						'Failed to unmatch transactions.',
						'fair-payments-connector'
					)
			);
		}
	};

	// Calculate running total of selected transactions.
	const selectedTotal = unmatchedTransactions
		.filter((t) => selectedTransactionIds.includes(t.id))
		.reduce((sum, t) => sum + parseFloat(t.amount), 0);

	const selectedNetTotal = unmatchedTransactions
		.filter((t) => selectedTransactionIds.includes(t.id))
		.reduce((sum, t) => {
			const net =
				parseFloat(t.amount) -
				parseFloat(t.application_fee || 0) -
				parseFloat(t.mollie_fee || 0);
			return sum + net;
		}, 0);

	if (loading) {
		return (
			<div className="wrap">
				<h1>{__('Reconciliation', 'fair-payments-connector')}</h1>
				<div style={{ textAlign: 'center', padding: '40px' }}>
					<Spinner />
				</div>
			</div>
		);
	}

	return (
		<div className="wrap">
			<HStack justify="space-between" alignment="center">
				<h1>{__('Reconciliation', 'fair-payments-connector')}</h1>
				<Button
					variant="secondary"
					onClick={() => setShowSettlementModal(true)}
				>
					{__('Import settlement CSV', 'fair-payments-connector')}
				</Button>
			</HStack>

			{showSettlementModal && (
				<SettlementImportModal
					onImport={() => {
						setShowSettlementModal(false);
						setSuccess(
							__(
								'Settlement matched successfully.',
								'fair-payments-connector'
							)
						);
						loadData();
					}}
					onCancel={() => setShowSettlementModal(false)}
				/>
			)}

			{error && (
				<Notice
					status="error"
					isDismissible
					onDismiss={() => setError(null)}
				>
					{error}
				</Notice>
			)}

			{success && (
				<Notice
					status="success"
					isDismissible
					onDismiss={() => setSuccess(null)}
				>
					{success}
				</Notice>
			)}

			<div
				style={{
					display: 'grid',
					gridTemplateColumns: '1fr 1fr',
					gap: '20px',
					marginTop: '20px',
				}}
			>
				{/* Left panel: Unmatched Bank Entries */}
				<div>
					<Panel>
						<PanelBody
							title={
								__(
									'Unmatched Bank Entries',
									'fair-payments-connector'
								) +
								` (${filteredUnmatchedEntries.length}/${unmatchedEntries.length})`
							}
							initialOpen={true}
						>
							<TextControl
								label={__(
									'Filter by description',
									'fair-payments-connector'
								)}
								value={descriptionFilter}
								onChange={setDescriptionFilter}
								placeholder={__(
									'Type to filter…',
									'fair-payments-connector'
								)}
							/>
							{filteredUnmatchedEntries.length === 0 ? (
								<p>
									{__(
										'All bank entries are matched.',
										'fair-payments-connector'
									)}
								</p>
							) : (
								<table
									className="wp-list-table widefat fixed striped"
									style={{ marginTop: 0 }}
								>
									<thead>
										<tr>
											<th>
												{__(
													'Date',
													'fair-payments-connector'
												)}
											</th>
											<th>
												{__(
													'Amount',
													'fair-payments-connector'
												)}
											</th>
											<th>
												{__(
													'Type',
													'fair-payments-connector'
												)}
											</th>
											<th>
												{__(
													'Description',
													'fair-payments-connector'
												)}
											</th>
											<th style={{ width: '80px' }}>
												{__(
													'Action',
													'fair-payments-connector'
												)}
											</th>
										</tr>
									</thead>
									<tbody>
										{filteredUnmatchedEntries.map(
											(entry) => (
												<tr
													key={entry.id}
													style={{
														background:
															selectedEntry?.id ===
															entry.id
																? '#e7f5fa'
																: undefined,
													}}
												>
													<td>{entry.entry_date}</td>
													<td>
														{formatAmount(
															entry.amount
														)}
													</td>
													<td>{entry.entry_type}</td>
													<td>
														{entry.description || (
															<em>
																{__(
																	'No description',
																	'fair-payments-connector'
																)}
															</em>
														)}
													</td>
													<td>
														<Button
															variant={
																selectedEntry?.id ===
																entry.id
																	? 'primary'
																	: 'secondary'
															}
															size="small"
															onClick={() =>
																handleSelectEntry(
																	entry
																)
															}
														>
															{selectedEntry?.id ===
															entry.id
																? __(
																		'Selected',
																		'fair-payments-connector'
																  )
																: __(
																		'Select',
																		'fair-payments-connector'
																  )}
														</Button>
													</td>
												</tr>
											)
										)}
									</tbody>
								</table>
							)}
						</PanelBody>
					</Panel>
				</div>

				{/* Right panel: Transactions for matching */}
				<div>
					{selectedEntry && (
						<Panel>
							<PanelBody
								title={__(
									'Match Transactions',
									'fair-payments-connector'
								)}
								initialOpen={true}
							>
								<VStack spacing={4}>
									{/* Selected entry summary */}
									<div
										style={{
											background: '#f0f0f1',
											padding: '12px',
											borderRadius: '4px',
										}}
									>
										<Text>
											<strong>
												{__(
													'Matching entry:',
													'fair-payments-connector'
												)}
											</strong>{' '}
											{formatAmount(selectedEntry.amount)}{' '}
											({selectedEntry.entry_type}) -{' '}
											{selectedEntry.entry_date}
											{selectedEntry.description &&
												` - ${selectedEntry.description}`}
										</Text>
									</div>

									{/* Auto-suggest results */}
									{loadingSuggestions && (
										<HStack justify="center">
											<Spinner />
											<Text>
												{__(
													'Finding suggestions...',
													'fair-payments-connector'
												)}
											</Text>
										</HStack>
									)}

									{!loadingSuggestions &&
										suggestions.length > 0 && (
											<div>
												<Text weight="bold">
													{__(
														'Suggestions:',
														'fair-payments-connector'
													)}
												</Text>
												{suggestions.map(
													(suggestion, idx) => (
														<div
															key={idx}
															style={{
																border: '1px solid #ccc',
																borderRadius:
																	'4px',
																padding: '8px',
																marginTop:
																	'8px',
																display: 'flex',
																justifyContent:
																	'space-between',
																alignItems:
																	'center',
															}}
														>
															<Text>
																{
																	suggestion
																		.transaction_ids
																		.length
																}{' '}
																{__(
																	'transactions',
																	'fair-payments-connector'
																)}
																{' — '}
																{__(
																	'Net:',
																	'fair-payments-connector'
																)}{' '}
																{formatAmount(
																	suggestion.net_amount
																)}
																{' ('}
																{__(
																	'diff:',
																	'fair-payments-connector'
																)}{' '}
																{formatAmount(
																	suggestion.difference
																)}
																{')'}
															</Text>
															<Button
																variant="secondary"
																size="small"
																onClick={() =>
																	handleApplySuggestion(
																		suggestion
																	)
																}
															>
																{__(
																	'Apply',
																	'fair-payments-connector'
																)}
															</Button>
														</div>
													)
												)}
											</div>
										)}

									{/* Running total */}
									{selectedTransactionIds.length > 0 && (
										<div
											style={{
												background: '#f0f6fc',
												padding: '12px',
												borderRadius: '4px',
												border: '1px solid #c3d9ed',
											}}
										>
											<HStack>
												<VStack spacing={1}>
													<Text>
														<strong>
															{__(
																'Selected:',
																'fair-payments-connector'
															)}
														</strong>{' '}
														{
															selectedTransactionIds.length
														}{' '}
														{__(
															'transactions',
															'fair-payments-connector'
														)}
													</Text>
													<Text>
														<strong>
															{__(
																'Gross total:',
																'fair-payments-connector'
															)}
														</strong>{' '}
														{formatAmount(
															selectedTotal
														)}
													</Text>
													<Text>
														<strong>
															{__(
																'Net total (after fees):',
																'fair-payments-connector'
															)}
														</strong>{' '}
														{formatAmount(
															selectedNetTotal
														)}
													</Text>
													<Text>
														<strong>
															{__(
																'Difference from entry:',
																'fair-payments-connector'
															)}
														</strong>{' '}
														{formatAmount(
															selectedNetTotal -
																selectedEntry.amount
														)}
													</Text>
												</VStack>
												<Button
													variant="primary"
													onClick={handleConfirmMatch}
													disabled={matching}
													isBusy={matching}
												>
													{__(
														'Confirm Match',
														'fair-payments-connector'
													)}
												</Button>
											</HStack>
										</div>
									)}

									{/* Transaction list with checkboxes */}
									{unmatchedTransactions.length === 0 ? (
										<p>
											{__(
												'No unmatched transactions found.',
												'fair-payments-connector'
											)}
										</p>
									) : (
										<table
											className="wp-list-table widefat fixed striped"
											style={{ marginTop: 0 }}
										>
											<thead>
												<tr>
													<th
														style={{
															width: '30px',
														}}
													></th>
													<th>
														{__(
															'Date',
															'fair-payments-connector'
														)}
													</th>
													<th>
														{__(
															'Amount',
															'fair-payments-connector'
														)}
													</th>
													<th>
														{__(
															'Net',
															'fair-payments-connector'
														)}
													</th>
													<th>
														{__(
															'Description',
															'fair-payments-connector'
														)}
													</th>
													<th>
														{__(
															'Mollie ID',
															'fair-payments-connector'
														)}
													</th>
												</tr>
											</thead>
											<tbody>
												{unmatchedTransactions.map(
													(t) => {
														const net =
															parseFloat(
																t.amount
															) -
															parseFloat(
																t.application_fee ||
																	0
															) -
															parseFloat(
																t.mollie_fee ||
																	0
															);
														return (
															<tr key={t.id}>
																<td>
																	<CheckboxControl
																		checked={selectedTransactionIds.includes(
																			t.id
																		)}
																		onChange={() =>
																			handleToggleTransaction(
																				t.id
																			)
																		}
																		__nextHasNoMarginBottom
																	/>
																</td>
																<td>
																	{formatDate(
																		t.created_at
																	)}
																</td>
																<td>
																	{formatAmount(
																		t.amount,
																		t.currency
																	)}
																</td>
																<td>
																	{formatAmount(
																		net,
																		t.currency
																	)}
																</td>
																<td>
																	{t.description || (
																		<em>
																			{__(
																				'No description',
																				'fair-payments-connector'
																			)}
																		</em>
																	)}
																</td>
																<td>
																	<code
																		style={{
																			fontSize:
																				'11px',
																		}}
																	>
																		{
																			t.mollie_payment_id
																		}
																	</code>
																</td>
															</tr>
														);
													}
												)}
											</tbody>
										</table>
									)}
								</VStack>
							</PanelBody>
						</Panel>
					)}

					{!selectedEntry && (
						<Panel>
							<PanelBody
								title={__(
									'Match Transactions',
									'fair-payments-connector'
								)}
								initialOpen={true}
							>
								<p>
									{__(
										'Select a bank entry from the left panel to start matching.',
										'fair-payments-connector'
									)}
								</p>
							</PanelBody>
						</Panel>
					)}
				</div>
			</div>

			{/* Matched entries section */}
			<div style={{ marginTop: '30px' }}>
				<Panel>
					<PanelBody
						title={
							__('Matched Entries', 'fair-payments-connector') +
							` (${matchedEntries.length})`
						}
						initialOpen={false}
					>
						{matchedEntries.length === 0 ? (
							<p>
								{__(
									'No matched entries yet.',
									'fair-payments-connector'
								)}
							</p>
						) : (
							matchedEntries.map((entry) => (
								<div
									key={entry.id}
									style={{
										border: '1px solid #ddd',
										borderRadius: '4px',
										padding: '12px',
										marginBottom: '12px',
									}}
								>
									<HStack justify="space-between">
										<VStack spacing={1}>
											<Text weight="bold">
												{formatAmount(entry.amount)} (
												{entry.entry_type}) -{' '}
												{entry.entry_date}
												{entry.description &&
													` - ${entry.description}`}
											</Text>
											<Text>
												{entry.transactions?.length ||
													0}{' '}
												{__(
													'matched transactions',
													'fair-payments-connector'
												)}
											</Text>
										</VStack>
										<Button
											variant="tertiary"
											isDestructive
											size="small"
											onClick={() =>
												handleUnmatchAll(entry.id)
											}
										>
											{__(
												'Unmatch All',
												'fair-payments-connector'
											)}
										</Button>
									</HStack>

									{entry.transactions &&
										entry.transactions.length > 0 && (
											<table
												className="wp-list-table widefat fixed striped"
												style={{ marginTop: '8px' }}
											>
												<thead>
													<tr>
														<th>
															{__(
																'Date',
																'fair-payments-connector'
															)}
														</th>
														<th>
															{__(
																'Amount',
																'fair-payments-connector'
															)}
														</th>
														<th>
															{__(
																'Description',
																'fair-payments-connector'
															)}
														</th>
														<th>
															{__(
																'Mollie ID',
																'fair-payments-connector'
															)}
														</th>
														<th
															style={{
																width: '100px',
															}}
														>
															{__(
																'Action',
																'fair-payments-connector'
															)}
														</th>
													</tr>
												</thead>
												<tbody>
													{entry.transactions.map(
														(t) => (
															<tr key={t.id}>
																<td>
																	{formatDate(
																		t.created_at
																	)}
																</td>
																<td>
																	{formatAmount(
																		t.amount,
																		t.currency
																	)}
																</td>
																<td>
																	{t.description ||
																		''}
																</td>
																<td>
																	<code
																		style={{
																			fontSize:
																				'11px',
																		}}
																	>
																		{
																			t.mollie_payment_id
																		}
																	</code>
																</td>
																<td>
																	<Button
																		variant="tertiary"
																		isDestructive
																		size="small"
																		onClick={() =>
																			handleUnmatchTransaction(
																				entry.id,
																				t.id
																			)
																		}
																	>
																		{__(
																			'Unmatch',
																			'fair-payments-connector'
																		)}
																	</Button>
																</td>
															</tr>
														)
													)}
												</tbody>
											</table>
										)}
								</div>
							))
						)}
					</PanelBody>
				</Panel>
			</div>
		</div>
	);
};

export default ReconciliationApp;
