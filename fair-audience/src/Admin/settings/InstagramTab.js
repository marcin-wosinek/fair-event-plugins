/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import {
	Button,
	Notice,
	Card,
	CardBody,
	TextControl,
	Spinner,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import {
	loadInstagramSettings,
	saveSettings,
	testInstagramConnection,
} from './settings-api.js';

/**
 * Instagram Tab Component
 *
 * Displays Instagram connection status and controls.
 * Allows manual token entry or OAuth connection.
 *
 * @param {Object}   props              Props
 * @param {Function} props.onNotice     Handler for displaying notices
 * @param {boolean}  props.shouldReload Whether to reload settings (external trigger)
 * @return {JSX.Element} The Instagram connection tab
 */
export default function InstagramTab({ onNotice, shouldReload }) {
	const [connected, setConnected] = useState(false);
	const [username, setUsername] = useState('');
	const [userId, setUserId] = useState('');
	const [tokenExpires, setTokenExpires] = useState(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);

	// Manual token entry state.
	const [manualToken, setManualToken] = useState('');

	// Manual user ID entry state.
	const [manualUserId, setManualUserId] = useState('');
	const [isSavingUserId, setIsSavingUserId] = useState(false);

	// Test connection state.
	const [isTesting, setIsTesting] = useState(false);
	const [testResult, setTestResult] = useState(null);

	/**
	 * Load Instagram settings from API
	 */
	const loadSettings = () => {
		if (isLoading === false) {
			setIsLoading(true);
		}

		loadInstagramSettings()
			.then((settings) => {
				setConnected(settings.connected);
				setUsername(settings.username);
				setUserId(settings.userId);
				setManualUserId(settings.userId);
				setTokenExpires(settings.tokenExpires);
				setIsLoading(false);
			})
			.catch((error) => {
				console.error(
					'[Fair Audience] Failed to load Instagram settings:',
					error
				);
				onNotice({
					status: 'error',
					message: __('Failed to load settings.', 'fair-audience'),
				});
				setIsLoading(false);
			});
	};

	/**
	 * Load settings on mount
	 */
	useEffect(() => {
		loadSettings();
	}, []);

	/**
	 * Reload settings when shouldReload changes
	 */
	useEffect(() => {
		if (shouldReload) {
			loadSettings();
		}
	}, [shouldReload]);

	/**
	 * Handle Connect button click (OAuth flow)
	 */
	const handleConnect = () => {
		const siteId = btoa(window.location.hostname);
		const returnUrl =
			window.location.href.split('?')[0] + '?page=fair-audience-settings';
		const siteName = document.title;
		const siteUrl = window.location.origin;

		const authorizeUrl = new URL(
			'https://fair-event-plugins.com/oauth/instagram/authorize'
		);
		authorizeUrl.searchParams.set('site_id', siteId);
		authorizeUrl.searchParams.set('return_url', returnUrl);
		authorizeUrl.searchParams.set('site_name', siteName);
		authorizeUrl.searchParams.set('site_url', siteUrl);

		window.location.href = authorizeUrl.toString();
	};

	/**
	 * Handle manual token save
	 */
	const handleSaveManualToken = () => {
		if (!manualToken.trim()) {
			onNotice({
				status: 'error',
				message: __('Please enter an access token.', 'fair-audience'),
			});
			return;
		}

		setIsSaving(true);

		saveSettings({
			fair_audience_instagram_access_token: manualToken.trim(),
			fair_audience_instagram_user_id: '',
			fair_audience_instagram_username: '',
			fair_audience_instagram_token_expires: 0,
			fair_audience_instagram_connected: true,
		})
			.then(() => {
				setManualToken('');
				loadSettings();
				onNotice({
					status: 'success',
					message: __(
						'Instagram token saved successfully.',
						'fair-audience'
					),
				});
				setIsSaving(false);
			})
			.catch(() => {
				onNotice({
					status: 'error',
					message: __('Failed to save token.', 'fair-audience'),
				});
				setIsSaving(false);
			});
	};

	/**
	 * Handle Test Connection button click
	 */
	const handleTestConnection = () => {
		setIsTesting(true);
		setTestResult(null);

		testInstagramConnection()
			.then((result) => {
				setTestResult(result);
				setIsTesting(false);

				// Reload settings to get updated username if it was fetched.
				loadSettings();

				onNotice({
					status: 'success',
					message:
						result.message ||
						__('Connection successful!', 'fair-audience'),
				});
			})
			.catch((error) => {
				console.error('[Fair Audience] Connection test failed:', error);

				const errorMessage =
					error.message ||
					__('Connection test failed.', 'fair-audience');

				setTestResult({
					success: false,
					error: errorMessage,
					details: error.data?.details || null,
				});
				setIsTesting(false);

				onNotice({
					status: 'error',
					message: errorMessage,
				});
			});
	};

	/**
	 * Handle saving user ID independently
	 */
	const handleSaveUserId = () => {
		setIsSavingUserId(true);

		saveSettings({
			fair_audience_instagram_user_id: manualUserId.trim(),
		})
			.then(() => {
				setUserId(manualUserId.trim());
				onNotice({
					status: 'success',
					message: __(
						'Instagram User ID saved successfully.',
						'fair-audience'
					),
				});
				setIsSavingUserId(false);
			})
			.catch(() => {
				onNotice({
					status: 'error',
					message: __('Failed to save User ID.', 'fair-audience'),
				});
				setIsSavingUserId(false);
			});
	};

	/**
	 * Handle Disconnect button click
	 */
	const handleDisconnect = () => {
		if (
			!confirm(
				__(
					'Are you sure you want to disconnect from Instagram?',
					'fair-audience'
				)
			)
		) {
			return;
		}

		setIsSaving(true);
		setTestResult(null);

		saveSettings({
			fair_audience_instagram_access_token: '',
			fair_audience_instagram_user_id: '',
			fair_audience_instagram_username: '',
			fair_audience_instagram_token_expires: 0,
			fair_audience_instagram_connected: false,
		})
			.then(() => {
				loadSettings();
				onNotice({
					status: 'success',
					message: __(
						'Disconnected from Instagram.',
						'fair-audience'
					),
				});
				setIsSaving(false);
			})
			.catch(() => {
				onNotice({
					status: 'error',
					message: __('Failed to disconnect.', 'fair-audience'),
				});
				setIsSaving(false);
			});
	};

	if (isLoading) {
		return (
			<Card>
				<CardBody>
					<p>
						{__('Loading Instagram settings...', 'fair-audience')}
					</p>
				</CardBody>
			</Card>
		);
	}

	return (
		<Card>
			<CardBody>
				<h2>{__('Instagram Connection', 'fair-audience')}</h2>

				{!connected ? (
					<>
						<p>
							{__(
								'Connect your Instagram account to access your media and followers.',
								'fair-audience'
							)}
						</p>

						<div style={{ marginBottom: '2rem' }}>
							<h3>{__('Manual Token Entry', 'fair-audience')}</h3>
							<p
								style={{
									fontSize: '0.9em',
									color: '#666',
									marginBottom: '1rem',
								}}
							>
								{__(
									'Enter your Instagram access token manually. You can obtain this from the Meta Developer Portal.',
									'fair-audience'
								)}
							</p>
							<TextControl
								label={__('Access Token', 'fair-audience')}
								value={manualToken}
								onChange={setManualToken}
								placeholder={__(
									'Enter Instagram access token...',
									'fair-audience'
								)}
								disabled={isSaving}
							/>
							<Button
								variant="primary"
								onClick={handleSaveManualToken}
								disabled={isSaving || !manualToken.trim()}
								isBusy={isSaving}
							>
								{isSaving
									? __('Saving...', 'fair-audience')
									: __('Save Token', 'fair-audience')}
							</Button>
						</div>

						<div
							style={{
								borderTop: '1px solid #ddd',
								paddingTop: '1.5rem',
							}}
						>
							<h3>{__('OAuth Connection', 'fair-audience')}</h3>
							<p
								style={{
									fontSize: '0.9em',
									color: '#666',
									marginBottom: '1rem',
								}}
							>
								{__(
									'Or connect automatically via OAuth (requires server configuration).',
									'fair-audience'
								)}
							</p>
							<Button variant="secondary" onClick={handleConnect}>
								{__('Connect with Instagram', 'fair-audience')}
							</Button>
						</div>
					</>
				) : (
					<>
						<Notice status="success" isDismissible={false}>
							{__('Connected to Instagram', 'fair-audience')}
						</Notice>

						{username && (
							<div style={{ marginTop: '1rem' }}>
								<p>
									<strong>
										{__('Username:', 'fair-audience')}
									</strong>{' '}
									<code>@{username}</code>
								</p>
							</div>
						)}

						{tokenExpires && (
							<div style={{ marginTop: '0.5rem' }}>
								<p
									style={{
										fontSize: '0.9em',
										color: '#666',
									}}
								>
									{sprintf(
										/* translators: %s: expiration date */
										__(
											'Token expires: %s',
											'fair-audience'
										),
										new Date(
											tokenExpires * 1000
										).toLocaleString()
									)}
								</p>
							</div>
						)}

						{/* User ID Section */}
						<div
							style={{
								marginTop: '1.5rem',
								padding: '1rem',
								backgroundColor: '#f6f7f7',
								borderRadius: '4px',
							}}
						>
							<h3 style={{ marginTop: 0 }}>
								{__('Instagram User ID', 'fair-audience')}
							</h3>
							<p
								style={{
									fontSize: '0.9em',
									color: '#666',
									marginBottom: '1rem',
								}}
							>
								{__(
									'Set the Instagram User ID manually. This is required for posting to Instagram. You can find it by testing the connection above.',
									'fair-audience'
								)}
							</p>
							{userId && (
								<p style={{ marginBottom: '1rem' }}>
									<strong>
										{__(
											'Current User ID:',
											'fair-audience'
										)}
									</strong>{' '}
									<code>{userId}</code>
								</p>
							)}
							<TextControl
								label={__('User ID', 'fair-audience')}
								value={manualUserId}
								onChange={setManualUserId}
								placeholder={__(
									'Enter Instagram User ID...',
									'fair-audience'
								)}
								disabled={isSavingUserId}
								help={__(
									'The numeric ID of your Instagram account (e.g., 17841400123456789)',
									'fair-audience'
								)}
							/>
							<Button
								variant="primary"
								onClick={handleSaveUserId}
								disabled={
									isSavingUserId || manualUserId === userId
								}
								isBusy={isSavingUserId}
							>
								{isSavingUserId
									? __('Saving...', 'fair-audience')
									: __('Save User ID', 'fair-audience')}
							</Button>
						</div>

						{/* Test Connection Section */}
						<div
							style={{
								marginTop: '1.5rem',
								padding: '1rem',
								backgroundColor: '#f6f7f7',
								borderRadius: '4px',
							}}
						>
							<h3 style={{ marginTop: 0 }}>
								{__('Test Connection', 'fair-audience')}
							</h3>
							<p
								style={{
									fontSize: '0.9em',
									color: '#666',
									marginBottom: '1rem',
								}}
							>
								{__(
									'Verify your Instagram connection is working correctly.',
									'fair-audience'
								)}
							</p>

							<Button
								variant="secondary"
								onClick={handleTestConnection}
								disabled={isTesting}
								isBusy={isTesting}
							>
								{isTesting ? (
									<>
										<Spinner />
										{__('Testing...', 'fair-audience')}
									</>
								) : (
									__('Test Connection', 'fair-audience')
								)}
							</Button>

							{/* Test Results */}
							{testResult && (
								<div style={{ marginTop: '1rem' }}>
									{testResult.success ? (
										<>
											<Notice
												status="success"
												isDismissible={false}
											>
												{testResult.message}
											</Notice>

											{/* Account Info */}
											{testResult.account && (
												<div
													style={{
														marginTop: '1rem',
														padding: '0.75rem',
														backgroundColor: '#fff',
														border: '1px solid #ddd',
														borderRadius: '4px',
													}}
												>
													<h4
														style={{
															marginTop: 0,
															marginBottom:
																'0.5rem',
														}}
													>
														{__(
															'Account Details',
															'fair-audience'
														)}
													</h4>
													{testResult.account
														.username && (
														<p
															style={{
																margin: '0.25rem 0',
															}}
														>
															<strong>
																{__(
																	'Username:',
																	'fair-audience'
																)}
															</strong>{' '}
															@
															{
																testResult
																	.account
																	.username
															}
														</p>
													)}
												</div>
											)}

											{/* Token Info */}
											{testResult.token_info && (
												<div
													style={{
														marginTop: '1rem',
														padding: '0.75rem',
														backgroundColor: '#fff',
														border: '1px solid #ddd',
														borderRadius: '4px',
													}}
												>
													<h4
														style={{
															marginTop: 0,
															marginBottom:
																'0.5rem',
														}}
													>
														{__(
															'Token Info',
															'fair-audience'
														)}
													</h4>
													{testResult.token_info
														.expires_at && (
														<p
															style={{
																margin: '0.25rem 0',
															}}
														>
															<strong>
																{__(
																	'Expires:',
																	'fair-audience'
																)}
															</strong>{' '}
															{new Date(
																testResult
																	.token_info
																	.expires_at *
																	1000
															).toLocaleString()}
														</p>
													)}
													{testResult.token_info
														.scopes &&
														testResult.token_info
															.scopes.length >
															0 && (
															<p
																style={{
																	margin: '0.25rem 0',
																}}
															>
																<strong>
																	{__(
																		'Scopes:',
																		'fair-audience'
																	)}
																</strong>{' '}
																{testResult.token_info.scopes.join(
																	', '
																)}
															</p>
														)}
												</div>
											)}

											{/* Instagram Accounts */}
											{testResult.instagram_accounts &&
												testResult.instagram_accounts
													.length > 0 && (
													<div
														style={{
															marginTop: '1rem',
															padding: '0.75rem',
															backgroundColor:
																'#fff',
															border: '1px solid #ddd',
															borderRadius: '4px',
														}}
													>
														<h4
															style={{
																marginTop: 0,
																marginBottom:
																	'0.5rem',
															}}
														>
															{__(
																'Available Instagram Accounts',
																'fair-audience'
															)}
														</h4>
														{testResult.instagram_accounts.map(
															(
																account,
																index
															) => (
																<div
																	key={
																		account.id
																	}
																	style={{
																		margin: '0.5rem 0',
																		padding:
																			'0.5rem',
																		backgroundColor:
																			index ===
																			0
																				? '#e7f5e7'
																				: 'transparent',
																		borderRadius:
																			'4px',
																	}}
																>
																	<p
																		style={{
																			margin: 0,
																		}}
																	>
																		<code>
																			@
																			{
																				account.username
																			}
																		</code>{' '}
																		(
																		{
																			account.page
																		}
																		)
																		{index ===
																			0 && (
																			<strong
																				style={{
																					marginLeft:
																						'0.5rem',
																					color: '#00a32a',
																				}}
																			>
																				{__(
																					'(Active)',
																					'fair-audience'
																				)}
																			</strong>
																		)}
																	</p>
																	<p
																		style={{
																			margin: '0.25rem 0 0 0',
																			fontSize:
																				'0.9em',
																		}}
																	>
																		<strong>
																			{__(
																				'User ID:',
																				'fair-audience'
																			)}
																		</strong>{' '}
																		<code
																			style={{
																				backgroundColor:
																					'#f0f0f0',
																				padding:
																					'2px 6px',
																				borderRadius:
																					'3px',
																			}}
																		>
																			{
																				account.id
																			}
																		</code>
																	</p>
																</div>
															)
														)}
													</div>
												)}
										</>
									) : (
										<Notice
											status="error"
											isDismissible={false}
										>
											{testResult.error}
											{testResult.details && (
												<details
													style={{
														marginTop: '0.5rem',
													}}
												>
													<summary>
														{__(
															'Details',
															'fair-audience'
														)}
													</summary>
													<pre
														style={{
															fontSize: '0.8em',
															whiteSpace:
																'pre-wrap',
															marginTop: '0.5rem',
														}}
													>
														{typeof testResult.details ===
														'string'
															? testResult.details
															: JSON.stringify(
																	testResult.details,
																	null,
																	2
															  )}
													</pre>
												</details>
											)}
										</Notice>
									)}
								</div>
							)}
						</div>

						<div style={{ marginTop: '1.5rem' }}>
							<Button
								isDestructive
								onClick={handleDisconnect}
								disabled={isSaving}
							>
								{__('Disconnect', 'fair-audience')}
							</Button>
						</div>
					</>
				)}
			</CardBody>
		</Card>
	);
}
