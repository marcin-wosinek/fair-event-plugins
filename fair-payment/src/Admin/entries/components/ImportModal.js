/**
 * WordPress dependencies
 */
import { useState, useRef } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Modal,
	Button,
	Notice,
	Spinner,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

/**
 * External dependencies
 */
import * as XLSX from 'xlsx';

const ImportModal = ({ onImport, onCancel }) => {
	const [file, setFile] = useState(null);
	const [parsedEntries, setParsedEntries] = useState([]);
	const [isLoading, setIsLoading] = useState(false);
	const [isParsing, setIsParsing] = useState(false);
	const [error, setError] = useState(null);
	const [result, setResult] = useState(null);
	const fileInputRef = useRef(null);

	const handleFileChange = async (e) => {
		const selectedFile = e.target.files[0];
		if (!selectedFile) {
			return;
		}

		setFile(selectedFile);
		setError(null);
		setResult(null);
		setParsedEntries([]);
		setIsParsing(true);

		try {
			const entries = await parseExcelFile(selectedFile);
			setParsedEntries(entries);
		} catch (err) {
			setError(
				err.message || __('Failed to parse file.', 'fair-payment')
			);
		} finally {
			setIsParsing(false);
		}
	};

	const parseExcelFile = (file) => {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();

			reader.onload = (e) => {
				try {
					const data = new Uint8Array(e.target.result);
					const workbook = XLSX.read(data, { type: 'array' });
					const sheetName = workbook.SheetNames[0];
					const sheet = workbook.Sheets[sheetName];
					const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });

					// Find the header row (contains 'Fecha de la operación')
					let headerRowIndex = -1;
					for (let i = 0; i < rows.length; i++) {
						if (
							rows[i] &&
							rows[i].some(
								(cell) =>
									typeof cell === 'string' &&
									cell.toLowerCase().includes('fecha')
							)
						) {
							headerRowIndex = i;
							break;
						}
					}

					if (headerRowIndex === -1) {
						reject(
							new Error(
								__(
									'Could not find header row in the file.',
									'fair-payment'
								)
							)
						);
						return;
					}

					// Parse data rows
					const entries = [];
					for (let i = headerRowIndex + 1; i < rows.length; i++) {
						const row = rows[i];
						if (
							!row ||
							row.length < 4 ||
							typeof row[0] !== 'number'
						) {
							continue;
						}

						// Convert Excel date serial to JS date
						const excelDate = row[0];
						const date = new Date(
							(excelDate - 25569) * 86400 * 1000
						);
						const dateStr = date.toISOString().split('T')[0];

						const description = row[2] || '';
						const amount = parseFloat(row[3]) || 0;
						const nroApunte = row[5] || i; // Use row index as fallback

						// Determine entry type based on amount sign
						const entryType = amount < 0 ? 'cost' : 'income';
						const absAmount = Math.abs(amount);

						// Create unique external reference
						const externalReference = `import_${dateStr}_${nroApunte}_${amount}`;

						entries.push({
							entry_date: dateStr,
							description: description,
							amount: absAmount,
							entry_type: entryType,
							external_reference: externalReference,
						});
					}

					if (entries.length === 0) {
						reject(
							new Error(
								__(
									'No valid entries found in the file.',
									'fair-payment'
								)
							)
						);
						return;
					}

					resolve(entries);
				} catch (err) {
					reject(err);
				}
			};

			reader.onerror = () => {
				reject(new Error(__('Failed to read file.', 'fair-payment')));
			};

			reader.readAsArrayBuffer(file);
		});
	};

	const handleImport = async () => {
		if (parsedEntries.length === 0) {
			return;
		}

		setIsLoading(true);
		setError(null);
		setResult(null);

		try {
			const response = await apiFetch({
				path: '/fair-payment/v1/financial-entries/import',
				method: 'POST',
				data: { entries: parsedEntries },
			});

			setResult(response);

			if (response.imported > 0) {
				// Notify parent to refresh data
				setTimeout(() => {
					onImport();
				}, 2000);
			}
		} catch (err) {
			setError(
				err.message || __('Failed to import entries.', 'fair-payment')
			);
		} finally {
			setIsLoading(false);
		}
	};

	const formatAmount = (amount) => {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'EUR',
		}).format(amount);
	};

	const costEntries = parsedEntries.filter((e) => e.entry_type === 'cost');
	const incomeEntries = parsedEntries.filter(
		(e) => e.entry_type === 'income'
	);
	const totalCosts = costEntries.reduce((sum, e) => sum + e.amount, 0);
	const totalIncome = incomeEntries.reduce((sum, e) => sum + e.amount, 0);

	return (
		<Modal
			title={__('Import Financial Entries', 'fair-payment')}
			onRequestClose={onCancel}
			style={{ maxWidth: '600px' }}
		>
			<VStack spacing={4}>
				{error && (
					<Notice status="error" isDismissible={false}>
						{error}
					</Notice>
				)}

				{result && (
					<Notice
						status={result.imported > 0 ? 'success' : 'warning'}
						isDismissible={false}
					>
						{result.message}
					</Notice>
				)}

				<div>
					<p>
						{__(
							'Select an Excel file (.xlsx) to import financial entries. The file should have columns for date, description, and amount.',
							'fair-payment'
						)}
					</p>
					<p>
						<strong>
							{__(
								'Note: Duplicate entries will be automatically skipped.',
								'fair-payment'
							)}
						</strong>
					</p>
				</div>

				<div>
					<input
						ref={fileInputRef}
						type="file"
						accept=".xlsx,.xls"
						onChange={handleFileChange}
						style={{ marginBottom: '16px' }}
					/>
				</div>

				{isParsing && (
					<HStack justify="center">
						<Spinner />
						<span>{__('Parsing file...', 'fair-payment')}</span>
					</HStack>
				)}

				{parsedEntries.length > 0 && !result && (
					<div
						style={{
							backgroundColor: '#f0f0f1',
							padding: '16px',
							borderRadius: '4px',
						}}
					>
						<h4 style={{ marginTop: 0 }}>
							{__('Preview', 'fair-payment')}
						</h4>
						<p>
							<strong>
								{__('Total entries:', 'fair-payment')}
							</strong>{' '}
							{parsedEntries.length}
						</p>
						<p>
							<strong>{__('Costs:', 'fair-payment')}</strong>{' '}
							{costEntries.length} ({formatAmount(totalCosts)})
						</p>
						<p>
							<strong>{__('Income:', 'fair-payment')}</strong>{' '}
							{incomeEntries.length} ({formatAmount(totalIncome)})
						</p>
						<p>
							<strong>{__('Balance:', 'fair-payment')}</strong>{' '}
							<span
								style={{
									color:
										totalIncome - totalCosts >= 0
											? '#007017'
											: '#d63638',
								}}
							>
								{formatAmount(totalIncome - totalCosts)}
							</span>
						</p>

						{parsedEntries.length <= 10 && (
							<div style={{ marginTop: '16px' }}>
								<strong>
									{__('Entries to import:', 'fair-payment')}
								</strong>
								<table
									style={{
										width: '100%',
										marginTop: '8px',
										fontSize: '12px',
									}}
								>
									<thead>
										<tr>
											<th style={{ textAlign: 'left' }}>
												{__('Date', 'fair-payment')}
											</th>
											<th style={{ textAlign: 'left' }}>
												{__('Type', 'fair-payment')}
											</th>
											<th style={{ textAlign: 'right' }}>
												{__('Amount', 'fair-payment')}
											</th>
											<th style={{ textAlign: 'left' }}>
												{__(
													'Description',
													'fair-payment'
												)}
											</th>
										</tr>
									</thead>
									<tbody>
										{parsedEntries.map((entry, index) => (
											<tr key={index}>
												<td>{entry.entry_date}</td>
												<td
													style={{
														color:
															entry.entry_type ===
															'cost'
																? '#d63638'
																: '#007017',
													}}
												>
													{entry.entry_type === 'cost'
														? __(
																'Cost',
																'fair-payment'
														  )
														: __(
																'Income',
																'fair-payment'
														  )}
												</td>
												<td
													style={{
														textAlign: 'right',
													}}
												>
													{formatAmount(entry.amount)}
												</td>
												<td
													style={{
														maxWidth: '150px',
														overflow: 'hidden',
														textOverflow:
															'ellipsis',
														whiteSpace: 'nowrap',
													}}
												>
													{entry.description}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						)}
					</div>
				)}

				<HStack justify="flex-end" spacing={2}>
					<Button variant="tertiary" onClick={onCancel}>
						{__('Cancel', 'fair-payment')}
					</Button>
					<Button
						variant="primary"
						onClick={handleImport}
						isBusy={isLoading}
						disabled={
							isLoading ||
							isParsing ||
							parsedEntries.length === 0 ||
							result
						}
					>
						{__('Import', 'fair-payment')}
					</Button>
				</HStack>
			</VStack>
		</Modal>
	);
};

export default ImportModal;
