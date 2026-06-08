/**
 * WordPress dependencies
 */
import { useState, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Spinner,
	Notice,
	Modal,
	TextControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

const STATUS_LABELS = {
	connected: { text: __('Connected', 'fair-payments-connector'), color: '#007017' },
	error: { text: __('Error', 'fair-payments-connector'), color: '#d63638' },
	unverified: { text: __('Unverified', 'fair-payments-connector'), color: '#946800' },
};

const ConnectedSitesApp = () => {
	const [sites, setSites] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [success, setSuccess] = useState(null);
	const [isFormOpen, setIsFormOpen] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [editingId, setEditingId] = useState(null);
	const [testingId, setTestingId] = useState(null);
	const [label, setLabel] = useState('');
	const [baseUrl, setBaseUrl] = useState('');
	const [token, setToken] = useState('');

	useEffect(() => {
		loadSites();
	}, []);

	const loadSites = async () => {
		setLoading(true);
		setError(null);

		try {
			const data = await apiFetch({
				path: '/fair-payments-connector/v1/admin/connected-sites',
			});
			setSites(data);
		} catch (err) {
			setError(
				err.message ||
					__('Failed to load connected sites.', 'fair-payments-connector')
			);
		} finally {
			setLoading(false);
		}
	};

	const handleOpenAdd = () => {
		setEditingId(null);
		setLabel('');
		setBaseUrl('');
		setToken('');
		setError(null);
		setIsFormOpen(true);
	};

	const handleOpenEdit = (site) => {
		setEditingId(site.id);
		setLabel(site.label);
		setBaseUrl(site.base_url);
		setToken('');
		setError(null);
		setIsFormOpen(true);
	};

	const handleCloseForm = () => {
		setIsFormOpen(false);
		setEditingId(null);
	};

	const handleSave = async (e) => {
		e.preventDefault();
		setIsSaving(true);
		setError(null);

		try {
			if (editingId) {
				const data = { label, base_url: baseUrl };
				// Only send token when the admin entered a new one.
				if (token) {
					data.token = token;
				}
				await apiFetch({
					path: `/fair-payments-connector/v1/admin/connected-sites/${editingId}`,
					method: 'PUT',
					data,
				});
				setSuccess(__('Connected site updated.', 'fair-payments-connector'));
			} else {
				await apiFetch({
					path: '/fair-payments-connector/v1/admin/connected-sites',
					method: 'POST',
					data: { label, base_url: baseUrl, token },
				});
				setSuccess(__('Connected site added.', 'fair-payments-connector'));
			}
			handleCloseForm();
			loadSites();
		} catch (err) {
			setError(
				err.message ||
					__('Failed to save connected site.', 'fair-payments-connector')
			);
		} finally {
			setIsSaving(false);
		}
	};

	const handleTest = async (id) => {
		setTestingId(id);
		setError(null);
		setSuccess(null);

		try {
			const result = await apiFetch({
				path: `/fair-payments-connector/v1/admin/connected-sites/${id}/test`,
				method: 'POST',
			});
			const scopes =
				result.scopes && result.scopes.length
					? result.scopes.join(', ')
					: __('no scopes', 'fair-payments-connector');
			setSuccess(
				__('Connection succeeded. Granted scopes: ', 'fair-payments-connector') +
					scopes
			);
			loadSites();
		} catch (err) {
			setError(
				err.message || __('Connection test failed.', 'fair-payments-connector')
			);
			loadSites();
		} finally {
			setTestingId(null);
		}
	};

	const handleRemove = async (id) => {
		if (
			!window.confirm(
				__(
					'Remove this connected site? Stored token will be deleted.',
					'fair-payments-connector'
				)
			)
		) {
			return;
		}

		setError(null);
		setSuccess(null);

		try {
			await apiFetch({
				path: `/fair-payments-connector/v1/admin/connected-sites/${id}`,
				method: 'DELETE',
			});
			setSuccess(__('Connected site removed.', 'fair-payments-connector'));
			loadSites();
		} catch (err) {
			setError(
				err.message ||
					__('Failed to remove connected site.', 'fair-payments-connector')
			);
		}
	};

	const renderStatus = (status) => {
		const meta = STATUS_LABELS[status] || STATUS_LABELS.unverified;
		return (
			<span style={{ color: meta.color, fontWeight: 'bold' }}>
				{meta.text}
			</span>
		);
	};

	return (
		<div className="wrap fair-payments-connector-connected-sites-page">
			<VStack spacing={4}>
				<Card>
					<CardHeader>
						<HStack justify="space-between">
							<h1>{__('Connected Sites', 'fair-payments-connector')}</h1>
							<Button variant="primary" onClick={handleOpenAdd}>
								{__('Add Site', 'fair-payments-connector')}
							</Button>
						</HStack>
					</CardHeader>
					<CardBody>
						<VStack spacing={4}>
							<p style={{ color: '#666', margin: 0 }}>
								{__(
									'Register other sites this site pulls data from. Paste a token generated on the other site’s API Tokens page.',
									'fair-payments-connector'
								)}
							</p>

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

							{loading && (
								<div>
									<Spinner />
									<p>
										{__('Loading sites…', 'fair-payments-connector')}
									</p>
								</div>
							)}

							{!loading && sites.length === 0 && (
								<p>
									{__(
										'No connected sites yet. Add one to pull data from another site.',
										'fair-payments-connector'
									)}
								</p>
							)}

							{!loading && sites.length > 0 && (
								<table className="wp-list-table widefat fixed striped">
									<thead>
										<tr>
											<th>
												{__('Label', 'fair-payments-connector')}
											</th>
											<th>
												{__('Base URL', 'fair-payments-connector')}
											</th>
											<th>
												{__('Scopes', 'fair-payments-connector')}
											</th>
											<th>
												{__('Status', 'fair-payments-connector')}
											</th>
											<th>
												{__(
													'Last sync',
													'fair-payments-connector'
												)}
											</th>
											<th style={{ width: '220px' }}>
												{__('Actions', 'fair-payments-connector')}
											</th>
										</tr>
									</thead>
									<tbody>
										{sites.map((site) => (
											<tr key={site.id}>
												<td>
													<strong>
														{site.label}
													</strong>
												</td>
												<td>{site.base_url}</td>
												<td>
													{site.scopes.length ? (
														site.scopes.join(', ')
													) : (
														<em>—</em>
													)}
												</td>
												<td>
													{renderStatus(site.status)}
												</td>
												<td>
													{site.last_sync_at || (
														<em>
															{__(
																'Never',
																'fair-payments-connector'
															)}
														</em>
													)}
												</td>
												<td>
													<HStack
														spacing={1}
														justify="flex-start"
													>
														<Button
															variant="secondary"
															size="small"
															isBusy={
																testingId ===
																site.id
															}
															disabled={
																testingId !==
																null
															}
															onClick={() =>
																handleTest(
																	site.id
																)
															}
														>
															{__(
																'Test',
																'fair-payments-connector'
															)}
														</Button>
														<Button
															variant="tertiary"
															size="small"
															onClick={() =>
																handleOpenEdit(
																	site
																)
															}
														>
															{__(
																'Edit',
																'fair-payments-connector'
															)}
														</Button>
														<Button
															variant="tertiary"
															size="small"
															isDestructive
															onClick={() =>
																handleRemove(
																	site.id
																)
															}
														>
															{__(
																'Remove',
																'fair-payments-connector'
															)}
														</Button>
													</HStack>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							)}
						</VStack>
					</CardBody>
				</Card>
			</VStack>

			{isFormOpen && (
				<Modal
					title={
						editingId
							? __('Edit Connected Site', 'fair-payments-connector')
							: __('Add Connected Site', 'fair-payments-connector')
					}
					onRequestClose={handleCloseForm}
					style={{ maxWidth: '500px', width: '100%' }}
				>
					<form onSubmit={handleSave}>
						<VStack spacing={4}>
							<TextControl
								label={__('Label', 'fair-payments-connector')}
								value={label}
								onChange={setLabel}
								help={__(
									'A name to identify this site, e.g. acroyoga-club.es',
									'fair-payments-connector'
								)}
								required
							/>
							<TextControl
								label={__('Base URL', 'fair-payments-connector')}
								type="url"
								value={baseUrl}
								onChange={setBaseUrl}
								help={__(
									'The other site’s address, e.g. https://acroyoga-club.es',
									'fair-payments-connector'
								)}
								required
							/>
							<TextControl
								label={__('Token', 'fair-payments-connector')}
								type="password"
								value={token}
								onChange={setToken}
								help={
									editingId
										? __(
												'Leave blank to keep the existing token.',
												'fair-payments-connector'
										  )
										: __(
												'Paste the token from the other site’s API Tokens page.',
												'fair-payments-connector'
										  )
								}
								required={!editingId}
							/>
							<HStack justify="flex-end" spacing={2}>
								<Button
									variant="tertiary"
									onClick={handleCloseForm}
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
										!label ||
										!baseUrl ||
										(!editingId && !token)
									}
								>
									{editingId
										? __('Save', 'fair-payments-connector')
										: __('Add Site', 'fair-payments-connector')}
								</Button>
							</HStack>
						</VStack>
					</form>
				</Modal>
			)}
		</div>
	);
};

export default ConnectedSitesApp;
