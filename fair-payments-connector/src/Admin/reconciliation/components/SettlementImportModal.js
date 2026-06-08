/**
 * WordPress dependencies
 */
import { useState, useRef, useEffect } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Modal,
	Button,
	Notice,
	Spinner,
	SelectControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

/**
 * External dependencies
 */
import * as XLSX from 'xlsx';

/**
 * Internal dependencies
 */
import { parseSettlementRows } from '../parseSettlement';

const formatAmount = (amount, currency = 'EUR') => {
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: currency || 'EUR',
	}).format(amount || 0);
};

const SettlementImportModal = ({ onImport, onCancel }) => {
	const [isParsing, setIsParsing] = useState(false);
	const [isLoading, setIsLoading] = useState(false);
	const [isConfirming, setIsConfirming] = useState(false);
	const [error, setError] = useState(null);
	const [report, setReport] = useState(null);
	const [selectedEntryId, setSelectedEntryId] = useState('');
	const [success, setSuccess] = useState(null);
	const fileInputRef = useRef(null);

	useEffect(() => {
		if (report?.suggested_entry) {
			setSelectedEntryId(String(report.suggested_entry.id));
		} else {
			setSelectedEntryId('');
		}
	}, [report]);

	const readFile = (selectedFile) => {
		return new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = (e) => {
				try {
					const data = new Uint8Array(e.target.result);
					const workbook = XLSX.read(data, { type: 'array' });
					const sheetName = workbook.SheetNames[0];
					const sheet = workbook.Sheets[sheetName];
					const rows = XLSX.utils.sheet_to_json(sheet, {
						header: 1,
					});
					resolve(parseSettlementRows(rows));
				} catch (err) {
					reject(err);
				}
			};
			reader.onerror = () =>
				reject(
					new Error(
						__('Failed to read file.', 'fair-payments-connector')
					)
				);
			reader.readAsArrayBuffer(selectedFile);
		});
	};

	const handleFileChange = async (e) => {
		const selectedFile = e.target.files[0];
		if (!selectedFile) {
			return;
		}

		setError(null);
		setSuccess(null);
		setReport(null);
		setIsParsing(true);

		let parsed;
		try {
			parsed = await readFile(selectedFile);
		} catch (err) {
			setError(
				err.message ||
					__('Failed to parse file.', 'fair-payments-connector')
			);
			setIsParsing(false);
			return;
		}
		setIsParsing(false);

		setIsLoading(true);
		try {
			const response = await apiFetch({
				path: '/fair-payments-connector/v1/reconciliation/settlement/preview',
				method: 'POST',
				data: parsed,
			});
			setReport(response);
		} catch (err) {
			setError(
				err.message ||
					__('Failed to match settlement.', 'fair-payments-connector')
			);
		} finally {
			setIsLoading(false);
		}
	};

	const handleConfirm = async () => {
		if (!report || !selectedEntryId) {
			return;
		}

		setIsConfirming(true);
		setError(null);
		try {
			await apiFetch({
				path: `/fair-payments-connector/v1/financial-entries/${selectedEntryId}/match`,
				method: 'POST',
				data: { transaction_ids: report.resolved_transaction_ids },
			});
			setSuccess(
				__(
					'Settlement matched successfully.',
					'fair-payments-connector'
				)
			);
			setTimeout(() => {
				onImport();
			}, 1500);
		} catch (err) {
			setError(
				err.message ||
					__(
						'Failed to match transactions.',
						'fair-payments-connector'
					)
			);
		} finally {
			setIsConfirming(false);
		}
	};

	const entryOptions = report
		? [
				...(report.suggested_entry
					? [
							{
								value: String(report.suggested_entry.id),
								label: sprintf(
									/* translators: 1: amount, 2: date */
									__(
										'%1$s — %2$s (suggested)',
										'fair-payments-connector'
									),
									formatAmount(
										report.suggested_entry.amount,
										report.currency
									),
									report.suggested_entry.entry_date
								),
							},
					  ]
					: []),
				...report.alternative_entries.map((entry) => ({
					value: String(entry.id),
					label: sprintf(
						/* translators: 1: amount, 2: date */
						__('%1$s — %2$s', 'fair-payments-connector'),
						formatAmount(entry.amount, report.currency),
						entry.entry_date
					),
				})),
		  ]
		: [];

	const selectedEntry =
		report &&
		[report.suggested_entry, ...(report.alternative_entries || [])].find(
			(entry) => entry && String(entry.id) === selectedEntryId
		);

	const settlementMatchesEntry =
		selectedEntry &&
		Math.abs(selectedEntry.amount - report.settlement_total) <= 0.02;

	const feeDiff = report?.fee_reconciliation?.difference ?? 0;
	const hasFeeDiscrepancy = Math.abs(feeDiff) > 0.01;

	return (
		<Modal
			title={__(
				'Import Mollie Settlement CSV',
				'fair-payments-connector'
			)}
			onRequestClose={onCancel}
			style={{ maxWidth: '720px', width: '100%' }}
		>
			<VStack spacing={4}>
				{error && (
					<Notice status="error" isDismissible={false}>
						{error}
					</Notice>
				)}

				{success && (
					<Notice status="success" isDismissible={false}>
						{success}
					</Notice>
				)}

				<div>
					<p>
						{__(
							'Select a Mollie settlement export (.csv). Payment rows are matched to transactions by their Mollie payment ID, and the payout is matched to a bank entry.',
							'fair-payments-connector'
						)}
					</p>
					<input
						ref={fileInputRef}
						type="file"
						accept=".csv"
						onChange={handleFileChange}
						style={{ marginBottom: '8px' }}
					/>
				</div>

				{(isParsing || isLoading) && (
					<HStack justify="center">
						<Spinner />
						<span>
							{isParsing
								? __('Parsing file…', 'fair-payments-connector')
								: __(
										'Matching settlement…',
										'fair-payments-connector'
								  )}
						</span>
					</HStack>
				)}

				{report && !success && (
					<div
						style={{
							backgroundColor: '#f0f0f1',
							padding: '16px',
							borderRadius: '4px',
						}}
					>
						<h4 style={{ marginTop: 0 }}>
							{sprintf(
								/* translators: %s: settlement reference */
								__('Settlement %s', 'fair-payments-connector'),
								report.settlement_reference
							)}
						</h4>
						<p>
							<strong>
								{__(
									'Payments matched:',
									'fair-payments-connector'
								)}
							</strong>{' '}
							{report.matched.length} / {report.payment_count}
						</p>
						<p>
							<strong>
								{__(
									'Settlement total:',
									'fair-payments-connector'
								)}
							</strong>{' '}
							{formatAmount(
								report.settlement_total,
								report.currency
							)}
						</p>
						<p>
							<strong>
								{__('Fees total:', 'fair-payments-connector')}
							</strong>{' '}
							{formatAmount(report.fees_total, report.currency)}
							{hasFeeDiscrepancy && (
								<span style={{ color: '#d63638' }}>
									{' '}
									{sprintf(
										/* translators: %s: amount difference */
										__(
											'(differs from recorded fees by %s)',
											'fair-payments-connector'
										),
										formatAmount(feeDiff, report.currency)
									)}
								</span>
							)}
						</p>

						<div style={{ marginTop: '16px' }}>
							<SelectControl
								label={__(
									'Match to bank entry',
									'fair-payments-connector'
								)}
								value={selectedEntryId}
								options={[
									{
										value: '',
										label: __(
											'— Select a bank entry —',
											'fair-payments-connector'
										),
									},
									...entryOptions,
								]}
								onChange={setSelectedEntryId}
								__nextHasNoMarginBottom
							/>
							{selectedEntry && !settlementMatchesEntry && (
								<Notice status="warning" isDismissible={false}>
									{sprintf(
										/* translators: 1: entry amount, 2: settlement total */
										__(
											'Selected entry (%1$s) does not equal the settlement total (%2$s).',
											'fair-payments-connector'
										),
										formatAmount(
											selectedEntry.amount,
											report.currency
										),
										formatAmount(
											report.settlement_total,
											report.currency
										)
									)}
								</Notice>
							)}
						</div>

						{report.unmatched_csv_rows.length > 0 && (
							<div style={{ marginTop: '16px' }}>
								<strong style={{ color: '#d63638' }}>
									{sprintf(
										/* translators: %d: count */
										__(
											'%d payment row(s) had no matching transaction:',
											'fair-payments-connector'
										),
										report.unmatched_csv_rows.length
									)}
								</strong>
								<ul style={{ margin: '8px 0' }}>
									{report.unmatched_csv_rows.map(
										(row, idx) => (
											<li key={idx}>
												<code>
													{row.mollie_payment_id}
												</code>{' '}
												{formatAmount(
													row.amount,
													report.currency
												)}
											</li>
										)
									)}
								</ul>
							</div>
						)}

						{report.transactions_without_csv.length > 0 && (
							<div style={{ marginTop: '16px' }}>
								<strong style={{ color: '#dba617' }}>
									{sprintf(
										/* translators: %d: count */
										__(
											'%d unmatched transaction(s) in this date window are absent from the CSV:',
											'fair-payments-connector'
										),
										report.transactions_without_csv.length
									)}
								</strong>
								<ul style={{ margin: '8px 0' }}>
									{report.transactions_without_csv.map(
										(t) => (
											<li key={t.id}>
												<code>
													{t.mollie_payment_id}
												</code>{' '}
												{formatAmount(
													t.amount,
													t.currency
												)}
											</li>
										)
									)}
								</ul>
							</div>
						)}
					</div>
				)}

				<HStack justify="flex-end" spacing={2}>
					<Button variant="tertiary" onClick={onCancel}>
						{__('Cancel', 'fair-payments-connector')}
					</Button>
					<Button
						variant="primary"
						onClick={handleConfirm}
						isBusy={isConfirming}
						disabled={
							isConfirming ||
							isParsing ||
							isLoading ||
							!report ||
							!selectedEntryId ||
							report.resolved_transaction_ids.length === 0 ||
							success
						}
					>
						{__('Confirm Match', 'fair-payments-connector')}
					</Button>
				</HStack>
			</VStack>
		</Modal>
	);
};

export default SettlementImportModal;
