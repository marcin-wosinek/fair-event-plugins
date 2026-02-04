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
	ExternalLink,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import {
	loadFacebookSettings,
	saveSettings,
	testFacebookConnection,
} from './settings-api.js';

/**
 * Facebook Tab Component
 *
 * Displays Facebook connection status and controls.
 * Allows manual token entry for Page access tokens.
 *
 * @param {Object}   props          Props
 * @param {Function} props.onNotice Handler for displaying notices
 * @return {JSX.Element} The Facebook connection tab
 */
export default function FacebookTab({ onNotice }) {
	const [connected, setConnected] = useState(false);
	const [pageId, setPageId] = useState('');
	const [pageName, setPageName] = useState('');
	const [tokenExpires, setTokenExpires] = useState(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);

	// Manual token entry state.
	const [manualToken, setManualToken] = useState('');

	// Manual Page ID entry state.
	const [manualPageId, setManualPageId] = useState('');
	const [isSavingPageId, setIsSavingPageId] = useState(false);

	// Test connection state.
	const [isTesting, setIsTesting] = useState(false);
	const [testResult, setTestResult] = useState(null);

	/**
	 * Load Facebook settings from API
	 */
	const loadSettings = () => {
		if (isLoading === false) {
			setIsLoading(true);
		}

		loadFacebookSettings()
			.then((settings) => {
				setConnected(settings.connected);
				setPageId(settings.pageId);
				setManualPageId(settings.pageId);
				setPageName(settings.pageName);
				setTokenExpires(settings.tokenExpires);
				setIsLoading(false);
			})
			.catch((error) => {
				console.error(
					'[Fair Events] Failed to load Facebook settings:',
					error
				);
				onNotice({
					status: 'error',
					message: __('Failed to load settings.', 'fair-events'),
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
	 * Handle manual token save
	 */
	const handleSaveManualToken = () => {
		if (!manualToken.trim()) {
			onNotice({
				status: 'error',
				message: __('Please enter an access token.', 'fair-events'),
			});
			return;
		}

		setIsSaving(true);

		saveSettings({
			fair_events_facebook_access_token: manualToken.trim(),
			fair_events_facebook_page_id: '',
			fair_events_facebook_page_name: '',
			fair_events_facebook_token_expires: 0,
			fair_events_facebook_connected: true,
		})
			.then(() => {
				setManualToken('');
				loadSettings();
				onNotice({
					status: 'success',
					message: __(
						'Facebook token saved successfully.',
						'fair-events'
					),
				});
				setIsSaving(false);
			})
			.catch(() => {
				onNotice({
					status: 'error',
					message: __('Failed to save token.', 'fair-events'),
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

		testFacebookConnection()
			.then((result) => {
				setTestResult(result);
				setIsTesting(false);

				// Reload settings to get updated page info if it was fetched.
				loadSettings();

				onNotice({
					status: 'success',
					message:
						result.message ||
						__('Connection successful!', 'fair-events'),
				});
			})
			.catch((error) => {
				console.error('[Fair Events] Connection test failed:', error);

				const errorMessage =
					error.message ||
					__('Connection test failed.', 'fair-events');

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
	 * Handle saving Page ID independently
	 */
	const handleSavePageId = () => {
		setIsSavingPageId(true);

		saveSettings({
			fair_events_facebook_page_id: manualPageId.trim(),
		})
			.then(() => {
				setPageId(manualPageId.trim());
				onNotice({
					status: 'success',
					message: __(
						'Facebook Page ID saved successfully.',
						'fair-events'
					),
				});
				setIsSavingPageId(false);
			})
			.catch(() => {
				onNotice({
					status: 'error',
					message: __('Failed to save Page ID.', 'fair-events'),
				});
				setIsSavingPageId(false);
			});
	};

	/**
	 * Handle Disconnect button click
	 */
	const handleDisconnect = () => {
		if (
			!confirm(
				__(
					'Are you sure you want to disconnect from Facebook?',
					'fair-events'
				)
			)
		) {
			return;
		}

		setIsSaving(true);
		setTestResult(null);

		saveSettings({
			fair_events_facebook_access_token: '',
			fair_events_facebook_page_id: '',
			fair_events_facebook_page_name: '',
			fair_events_facebook_token_expires: 0,
			fair_events_facebook_connected: false,
		})
			.then(() => {
				loadSettings();
				onNotice({
					status: 'success',
					message: __('Disconnected from Facebook.', 'fair-events'),
				});
				setIsSaving(false);
			})
			.catch(() => {
				onNotice({
					status: 'error',
					message: __('Failed to disconnect.', 'fair-events'),
				});
				setIsSaving(false);
			});
	};

	if (isLoading) {
		return (
			<Card>
				<CardBody>
					<p>{__('Loading Facebook settings...', 'fair-events')}</p>
				</CardBody>
			</Card>
		);
	}

	return (
		<Card>
			<CardBody>
				<h2>{__('Facebook Connection', 'fair-events')}</h2>

				{!connected ? (
					<>
						<p>
							{__(
								'Connect your Facebook Page to publish events directly to Facebook.',
								'fair-events'
							)}
						</p>

						<div style={{ marginBottom: '2rem' }}>
							<h3>{__('Manual Token Entry', 'fair-events')}</h3>
							<p
								style={{
									fontSize: '0.9em',
									color: '#666',
									marginBottom: '1rem',
								}}
							>
								{__(
									'Enter your Facebook Page access token manually. You can obtain this from the Meta Developer Portal.',
									'fair-events'
								)}
							</p>
							<TextControl
								label={__('Page Access Token', 'fair-events')}
								value={manualToken}
								onChange={setManualToken}
								placeholder={__(
									'Enter Facebook Page access token...',
									'fair-events'
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
									? __('Saving...', 'fair-events')
									: __('Save Token', 'fair-events')}
							</Button>
						</div>

						<div
							style={{
								borderTop: '1px solid #ddd',
								paddingTop: '1.5rem',
							}}
						>
							<h3>
								{__(
									'How to Get a Page Access Token',
									'fair-events'
								)}
							</h3>
							<ol
								style={{
									fontSize: '0.9em',
									color: '#666',
									marginBottom: '1rem',
								}}
							>
								<li>
									{__(
										'Go to the Meta Developer Portal and create or select an app.',
										'fair-events'
									)}
								</li>
								<li>
									{__(
										'Navigate to Graph API Explorer.',
										'fair-events'
									)}
								</li>
								<li>
									{__(
										'Select your app and generate a User Access Token with pages_manage_posts and pages_read_engagement permissions.',
										'fair-events'
									)}
								</li>
								<li>
									{__(
										'Exchange it for a long-lived token and then get the Page Access Token.',
										'fair-events'
									)}
								</li>
							</ol>
							<p>
								<ExternalLink href="https://developers.facebook.com/tools/explorer/">
									{__(
										'Open Graph API Explorer',
										'fair-events'
									)}
								</ExternalLink>
							</p>
						</div>
					</>
				) : (
					<>
						<Notice status="success" isDismissible={false}>
							{__('Connected to Facebook', 'fair-events')}
						</Notice>

						{pageName && (
							<div style={{ marginTop: '1rem' }}>
								<p>
									<strong>
										{__('Page:', 'fair-events')}
									</strong>{' '}
									{pageName}
								</p>
							</div>
						)}

						{tokenExpires && tokenExpires > 0 && (
							<div style={{ marginTop: '0.5rem' }}>
								<p
									style={{
										fontSize: '0.9em',
										color: '#666',
									}}
								>
									{sprintf(
										/* translators: %s: expiration date */
										__('Token expires: %s', 'fair-events'),
										new Date(
											tokenExpires * 1000
										).toLocaleString()
									)}
								</p>
							</div>
						)}

						{/* Page ID Section */}
						<div
							style={{
								marginTop: '1.5rem',
								padding: '1rem',
								backgroundColor: '#f6f7f7',
								borderRadius: '4px',
							}}
						>
							<h3 style={{ marginTop: 0 }}>
								{__('Facebook Page ID', 'fair-events')}
							</h3>
							<p
								style={{
									fontSize: '0.9em',
									color: '#666',
									marginBottom: '1rem',
								}}
							>
								{__(
									'The Page ID is used for publishing events. You can find it by testing the connection or from your Facebook Page settings.',
									'fair-events'
								)}
							</p>
							{pageId && (
								<p style={{ marginBottom: '1rem' }}>
									<strong>
										{__('Current Page ID:', 'fair-events')}
									</strong>{' '}
									<code>{pageId}</code>
								</p>
							)}
							<TextControl
								label={__('Page ID', 'fair-events')}
								value={manualPageId}
								onChange={setManualPageId}
								placeholder={__(
									'Enter Facebook Page ID...',
									'fair-events'
								)}
								disabled={isSavingPageId}
								help={__(
									'The numeric ID of your Facebook Page',
									'fair-events'
								)}
							/>
							<Button
								variant="primary"
								onClick={handleSavePageId}
								disabled={
									isSavingPageId || manualPageId === pageId
								}
								isBusy={isSavingPageId}
							>
								{isSavingPageId
									? __('Saving...', 'fair-events')
									: __('Save Page ID', 'fair-events')}
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
								{__('Test Connection', 'fair-events')}
							</h3>
							<p
								style={{
									fontSize: '0.9em',
									color: '#666',
									marginBottom: '1rem',
								}}
							>
								{__(
									'Verify your Facebook connection is working and discover available Pages.',
									'fair-events'
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
										{__('Testing...', 'fair-events')}
									</>
								) : (
									__('Test Connection', 'fair-events')
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
															'fair-events'
														)}
													</h4>
													{testResult.token_info
														.expires_at > 0 && (
														<p
															style={{
																margin: '0.25rem 0',
															}}
														>
															<strong>
																{__(
																	'Expires:',
																	'fair-events'
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
																		'fair-events'
																	)}
																</strong>{' '}
																{testResult.token_info.scopes.join(
																	', '
																)}
															</p>
														)}
												</div>
											)}

											{/* Facebook Pages */}
											{testResult.facebook_pages &&
												testResult.facebook_pages
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
																'Available Facebook Pages',
																'fair-events'
															)}
														</h4>
														{testResult.facebook_pages.map(
															(page, index) => (
																<div
																	key={
																		page.id
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
																		<strong>
																			{
																				page.name
																			}
																		</strong>
																		{index ===
																			0 && (
																			<span
																				style={{
																					marginLeft:
																						'0.5rem',
																					color: '#00a32a',
																				}}
																			>
																				{__(
																					'(Active)',
																					'fair-events'
																				)}
																			</span>
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
																				'Page ID:',
																				'fair-events'
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
																				page.id
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
															'fair-events'
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
								{__('Disconnect', 'fair-events')}
							</Button>
						</div>
					</>
				)}
			</CardBody>
		</Card>
	);
}
