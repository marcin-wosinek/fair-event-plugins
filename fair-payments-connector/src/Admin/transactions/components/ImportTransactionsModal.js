/**
 * WordPress dependencies
 */
import { useState, useEffect, useRef } from '@wordpress/element';
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
 * Internal dependencies
 */
import { parseMollieCsv } from '../parseMollieCsv.js';

const STATUS_COLORS = {
	connected: '#007017',
	error: '#d63638',
	unverified: '#946800',
};

const ImportTransactionsModal = ({ onClose, onImported }) => {
	const [view, setView] = useState('choose');
	const [error, setError] = useState(null);
	const [isImporting, setIsImporting] = useState(false);
	const [sites, setSites] = useState([]);
	const [loadingSites, setLoadingSites] = useState(false);
	const [busySiteId, setBusySiteId] = useState(null);
	const fileInputRef = useRef(null);

	useEffect(() => {
		if (view !== 'sites') {
			return;
		}

		const loadSites = async () => {
			setLoadingSites(true);
			setError(null);

			try {
				const data = await apiFetch({
					path: '/fair-payments-connector/v1/admin/connected-sites',
				});
				setSites(data);
			} catch (err) {
				setError(
					err.message ||
						__(
							'Failed to load connected sites.',
							'fair-payments-connector'
						)
				);
			} finally {
				setLoadingSites(false);
			}
		};

		loadSites();
	}, [view]);

	const handleFileChange = async (e) => {
		const file = e.target.files[0];
		if (!file) {
			return;
		}

		// Reset the input so the same file can be re-selected.
		e.target.value = '';

		setIsImporting(true);
		setError(null);

		try {
			const text = await file.text();
			let toImport;

			if (file.name.endsWith('.csv')) {
				toImport = parseMollieCsv(text);
			} else {
				const imported = JSON.parse(text);

				if (!Array.isArray(imported)) {
					throw new Error(
						__(
							'Invalid file format. Expected a JSON array.',
							'fair-payments-connector'
						)
					);
				}

				toImport = imported.filter((t) => t.mollie_payment_id);
			}

			if (toImport.length === 0) {
				throw new Error(
					__(
						'No valid transactions found in the file.',
						'fair-payments-connector'
					)
				);
			}

			const response = await apiFetch({
				path: '/fair-payments-connector/v1/transactions/import',
				method: 'POST',
				data: { transactions: toImport },
			});

			onImported(response.message);
		} catch (err) {
			setError(
				err.message ||
					__(
						'Failed to import transactions.',
						'fair-payments-connector'
					)
			);
		} finally {
			setIsImporting(false);
		}
	};

	const handleSiteImport = async (site) => {
		setBusySiteId(site.id);
		setError(null);

		try {
			const response = await apiFetch({
				path: `/fair-payments-connector/v1/admin/connected-sites/${site.id}/import-transactions`,
				method: 'POST',
			});

			onImported(response.message);
		} catch (err) {
			setError(
				err.message ||
					__(
						'Failed to import transactions from the connected site.',
						'fair-payments-connector'
					)
			);
		} finally {
			setBusySiteId(null);
		}
	};

	const renderChoose = () => (
		<VStack spacing={4}>
			<p style={{ margin: 0 }}>
				{__(
					'Where do you want to import transactions from?',
					'fair-payments-connector'
				)}
			</p>
			<HStack spacing={3} justify="flex-start">
				<Button
					variant="secondary"
					onClick={() => {
						setError(null);
						setView('sites');
					}}
				>
					{__('Connected Sites', 'fair-payments-connector')}
				</Button>
				<Button
					variant="secondary"
					onClick={() => {
						setError(null);
						setView('file');
					}}
				>
					{__('From File', 'fair-payments-connector')}
				</Button>
			</HStack>
		</VStack>
	);

	const renderFile = () => (
		<VStack spacing={4}>
			<p style={{ margin: 0 }}>
				{__(
					'Select a JSON file exported from another site, or a Mollie payments CSV export.',
					'fair-payments-connector'
				)}
			</p>
			<input
				ref={fileInputRef}
				type="file"
				accept=".json,.csv"
				onChange={handleFileChange}
				disabled={isImporting}
			/>
			{isImporting && (
				<HStack justify="flex-start" spacing={2}>
					<Spinner />
					<span>{__('Importing…', 'fair-payments-connector')}</span>
				</HStack>
			)}
			<HStack justify="flex-start">
				<Button
					variant="tertiary"
					onClick={() => setView('choose')}
					disabled={isImporting}
				>
					{__('Back', 'fair-payments-connector')}
				</Button>
			</HStack>
		</VStack>
	);

	const renderSites = () => (
		<VStack spacing={4}>
			<p style={{ margin: 0 }}>
				{__(
					'Pull transactions from a registered connected site. Existing transactions are matched by payment ID and updated rather than duplicated.',
					'fair-payments-connector'
				)}
			</p>

			{loadingSites && (
				<HStack justify="flex-start" spacing={2}>
					<Spinner />
					<span>
						{__('Loading sites…', 'fair-payments-connector')}
					</span>
				</HStack>
			)}

			{!loadingSites && sites.length === 0 && (
				<p>
					{__(
						'No connected sites yet. Add one on the Connected Sites page first.',
						'fair-payments-connector'
					)}
				</p>
			)}

			{!loadingSites && sites.length > 0 && (
				<table className="wp-list-table widefat fixed striped">
					<thead>
						<tr>
							<th>{__('Label', 'fair-payments-connector')}</th>
							<th>{__('Status', 'fair-payments-connector')}</th>
							<th style={{ width: '120px' }}>
								{__('Actions', 'fair-payments-connector')}
							</th>
						</tr>
					</thead>
					<tbody>
						{sites.map((site) => (
							<tr key={site.id}>
								<td>
									<strong>{site.label}</strong>
									<br />
									<span style={{ color: '#666' }}>
										{site.base_url}
									</span>
								</td>
								<td>
									<span
										style={{
											color:
												STATUS_COLORS[site.status] ||
												STATUS_COLORS.unverified,
											fontWeight: 'bold',
										}}
									>
										{site.status}
									</span>
								</td>
								<td>
									<Button
										variant="primary"
										size="small"
										isBusy={busySiteId === site.id}
										disabled={busySiteId !== null}
										onClick={() => handleSiteImport(site)}
									>
										{__(
											'Import',
											'fair-payments-connector'
										)}
									</Button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			)}

			<HStack justify="flex-start">
				<Button
					variant="tertiary"
					onClick={() => setView('choose')}
					disabled={busySiteId !== null}
				>
					{__('Back', 'fair-payments-connector')}
				</Button>
			</HStack>
		</VStack>
	);

	return (
		<Modal
			title={__('Import Transactions', 'fair-payments-connector')}
			onRequestClose={onClose}
			style={{ maxWidth: '640px', width: '100%' }}
		>
			<VStack spacing={4}>
				{error && (
					<Notice
						status="error"
						isDismissible
						onRemove={() => setError(null)}
					>
						{error}
					</Notice>
				)}

				{view === 'choose' && renderChoose()}
				{view === 'file' && renderFile()}
				{view === 'sites' && renderSites()}
			</VStack>
		</Modal>
	);
};

export default ImportTransactionsModal;
