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
	CheckboxControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

const AVAILABLE_SCOPES = [
	{
		value: 'transactions:read',
		label: __('Read transactions', 'fair-payments-connector'),
	},
	{ value: 'locations:read', label: __('Read locations', 'fair-payments-connector') },
];

const ApiTokensApp = () => {
	const [tokens, setTokens] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [success, setSuccess] = useState(null);
	const [isFormOpen, setIsFormOpen] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [label, setLabel] = useState('');
	const [scopes, setScopes] = useState(['transactions:read']);
	const [newToken, setNewToken] = useState(null);
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		loadTokens();
	}, []);

	const loadTokens = async () => {
		setLoading(true);
		setError(null);

		try {
			const data = await apiFetch({
				path: '/fair-payments-connector/v1/admin/api-tokens',
			});
			setTokens(data);
		} catch (err) {
			setError(
				err.message || __('Failed to load API tokens.', 'fair-payments-connector')
			);
		} finally {
			setLoading(false);
		}
	};

	const handleOpenForm = () => {
		setLabel('');
		setScopes(['transactions:read']);
		setNewToken(null);
		setCopied(false);
		setError(null);
		setIsFormOpen(true);
	};

	const toggleScope = (scope, checked) => {
		setScopes((current) =>
			checked ? [...current, scope] : current.filter((s) => s !== scope)
		);
	};

	const handleCreate = async (e) => {
		e.preventDefault();
		setIsSaving(true);
		setError(null);

		try {
			const response = await apiFetch({
				path: '/fair-payments-connector/v1/admin/api-tokens',
				method: 'POST',
				data: { label, scopes },
			});
			setNewToken(response.token);
			setSuccess(__('API token created.', 'fair-payments-connector'));
			loadTokens();
		} catch (err) {
			setError(
				err.message || __('Failed to create API token.', 'fair-payments-connector')
			);
		} finally {
			setIsSaving(false);
		}
	};

	const handleRevoke = async (id) => {
		if (
			!window.confirm(
				__(
					'Revoke this token? Any site using it will immediately lose access.',
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
				path: `/fair-payments-connector/v1/admin/api-tokens/${id}`,
				method: 'DELETE',
			});
			setSuccess(__('API token revoked.', 'fair-payments-connector'));
			loadTokens();
		} catch (err) {
			setError(
				err.message || __('Failed to revoke API token.', 'fair-payments-connector')
			);
		}
	};

	const handleCopy = () => {
		if (newToken && navigator.clipboard) {
			navigator.clipboard.writeText(newToken).then(() => {
				setCopied(true);
			});
		}
	};

	const handleCloseForm = () => {
		setIsFormOpen(false);
		setNewToken(null);
	};

	return (
		<div className="wrap fair-payments-connector-api-tokens-page">
			<VStack spacing={4}>
				<Card>
					<CardHeader>
						<HStack justify="space-between">
							<h1>{__('API Tokens', 'fair-payments-connector')}</h1>
							<Button variant="primary" onClick={handleOpenForm}>
								{__('Generate Token', 'fair-payments-connector')}
							</Button>
						</HStack>
					</CardHeader>
					<CardBody>
						<VStack spacing={4}>
							<p style={{ color: '#666', margin: 0 }}>
								{__(
									'Issue scoped tokens so other sites can read this site’s data over the data sharing API.',
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
										{__('Loading tokens…', 'fair-payments-connector')}
									</p>
								</div>
							)}

							{!loading && tokens.length === 0 && (
								<p>
									{__(
										'No API tokens yet. Generate one to share data with another site.',
										'fair-payments-connector'
									)}
								</p>
							)}

							{!loading && tokens.length > 0 && (
								<table className="wp-list-table widefat fixed striped">
									<thead>
										<tr>
											<th>
												{__('Label', 'fair-payments-connector')}
											</th>
											<th>
												{__('Scopes', 'fair-payments-connector')}
											</th>
											<th>
												{__('Created', 'fair-payments-connector')}
											</th>
											<th>
												{__(
													'Last used',
													'fair-payments-connector'
												)}
											</th>
											<th>
												{__('Status', 'fair-payments-connector')}
											</th>
											<th style={{ width: '120px' }}>
												{__('Actions', 'fair-payments-connector')}
											</th>
										</tr>
									</thead>
									<tbody>
										{tokens.map((token) => (
											<tr key={token.id}>
												<td>
													<strong>
														{token.label}
													</strong>
												</td>
												<td>
													{token.scopes.join(', ')}
												</td>
												<td>{token.created_at}</td>
												<td>
													{token.last_used_at || (
														<em>
															{__(
																'Never',
																'fair-payments-connector'
															)}
														</em>
													)}
												</td>
												<td>
													<span
														style={{
															color:
																token.status ===
																'active'
																	? '#007017'
																	: '#d63638',
															fontWeight: 'bold',
														}}
													>
														{token.status ===
														'active'
															? __(
																	'Active',
																	'fair-payments-connector'
															  )
															: __(
																	'Revoked',
																	'fair-payments-connector'
															  )}
													</span>
												</td>
												<td>
													{token.status ===
														'active' && (
														<Button
															variant="tertiary"
															size="small"
															isDestructive
															onClick={() =>
																handleRevoke(
																	token.id
																)
															}
														>
															{__(
																'Revoke',
																'fair-payments-connector'
															)}
														</Button>
													)}
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
						newToken
							? __('Token created', 'fair-payments-connector')
							: __('Generate API Token', 'fair-payments-connector')
					}
					onRequestClose={handleCloseForm}
					style={{ maxWidth: '500px', width: '100%' }}
				>
					{newToken ? (
						<VStack spacing={4}>
							<Notice status="warning" isDismissible={false}>
								{__(
									'Copy this token now. For security it will not be shown again.',
									'fair-payments-connector'
								)}
							</Notice>
							<code
								style={{
									display: 'block',
									padding: '12px',
									background: '#f0f0f1',
									wordBreak: 'break-all',
								}}
							>
								{newToken}
							</code>
							<HStack justify="flex-end" spacing={2}>
								<Button
									variant="secondary"
									onClick={handleCopy}
								>
									{copied
										? __('Copied!', 'fair-payments-connector')
										: __('Copy token', 'fair-payments-connector')}
								</Button>
								<Button
									variant="primary"
									onClick={handleCloseForm}
								>
									{__('Done', 'fair-payments-connector')}
								</Button>
							</HStack>
						</VStack>
					) : (
						<form onSubmit={handleCreate}>
							<VStack spacing={4}>
								<TextControl
									label={__('Label', 'fair-payments-connector')}
									value={label}
									onChange={setLabel}
									help={__(
										'A name to identify who this token is for, e.g. lamutable.es',
										'fair-payments-connector'
									)}
									required
								/>
								<fieldset>
									<legend
										style={{
											fontWeight: 'bold',
											marginBottom: '8px',
										}}
									>
										{__('Scopes', 'fair-payments-connector')}
									</legend>
									<VStack spacing={2}>
										{AVAILABLE_SCOPES.map((scope) => (
											<CheckboxControl
												key={scope.value}
												label={scope.label}
												checked={scopes.includes(
													scope.value
												)}
												onChange={(checked) =>
													toggleScope(
														scope.value,
														checked
													)
												}
											/>
										))}
									</VStack>
								</fieldset>
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
											scopes.length === 0
										}
									>
										{__('Generate', 'fair-payments-connector')}
									</Button>
								</HStack>
							</VStack>
						</form>
					)}
				</Modal>
			)}
		</div>
	);
};

export default ApiTokensApp;
