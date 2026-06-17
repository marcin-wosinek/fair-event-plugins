/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import {
	Button,
	Notice,
	RadioControl,
	Card,
	CardBody,
	ButtonGroup,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import {
	loadConnectionSettings,
	saveSettings,
	testConnection,
	fetchOAuthState,
} from './settings-api';

/**
 * Connection Tab Component
 *
 * Displays Mollie OAuth connection status and controls.
 * Manages its own loading state and data fetching.
 *
 * @param {Object}   props              Props
 * @param {Function} props.onNotice     Handler for displaying notices
 * @param {boolean}  props.shouldReload Whether to reload settings (external trigger)
 * @return {JSX.Element} The connection tab
 */
export default function ConnectionTab({ onNotice, shouldReload }) {
	const [connected, setConnected] = useState(false);
	const [mode, setMode] = useState('test');
	const [organizationId, setOrganizationId] = useState('');
	const [profileId, setProfileId] = useState('');
	const [tokenExpires, setTokenExpires] = useState(null);
	const [isLoading, setIsLoading] = useState(false);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [isSaving, setIsSaving] = useState(false);

	/**
	 * Load connection settings from API
	 */
	const loadSettings = () => {
		if (isLoading) {
			console.log(
				'[Fair Payments Connector] Skipping loadSettings - already loading'
			);
			return;
		}

		setIsLoading(true);

		loadConnectionSettings()
			.then((settings) => {
				setConnected(settings.connected);
				setMode(settings.mode);
				setOrganizationId(settings.organizationId);
				setProfileId(settings.profileId);
				setTokenExpires(settings.tokenExpires);
				setIsLoading(false);
			})
			.catch((error) => {
				console.error(
					'[Fair Payments Connector] Failed to load settings:',
					error
				);
				onNotice({
					status: 'error',
					message: __(
						'Failed to load settings.',
						'fair-payments-connector'
					),
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
	 * Handle Connect button click — fetches a CSRF state token first, then redirects.
	 */
	const handleConnect = () => {
		fetchOAuthState()
			.then((state) => {
				const siteId = btoa(window.location.hostname);
				const returnUrl =
					window.location.href.split('?')[0] +
					'?page=fair-payments-connector-settings';
				const siteName = document.title;
				const siteUrl = window.location.origin;

				const authorizeUrl = new URL(
					'https://fair-event-plugins.com/oauth/authorize'
				);
				authorizeUrl.searchParams.set('site_id', siteId);
				authorizeUrl.searchParams.set('return_url', returnUrl);
				authorizeUrl.searchParams.set('site_name', siteName);
				authorizeUrl.searchParams.set('site_url', siteUrl);
				authorizeUrl.searchParams.set('state', state);

				window.location.href = authorizeUrl.toString();
			})
			.catch(() => {
				onNotice({
					status: 'error',
					message: __(
						'Failed to initiate Mollie connection. Please try again.',
						'fair-payments-connector'
					),
				});
			});
	};

	/**
	 * Handle Disconnect button click
	 */
	const handleDisconnect = () => {
		if (
			!confirm(
				__(
					'Are you sure you want to disconnect from Mollie? You will need to reconnect to accept payments.',
					'fair-payments-connector'
				)
			)
		) {
			return;
		}

		setIsSaving(true);

		saveSettings({
			fair_payment_mollie_access_token: '',
			fair_payment_mollie_refresh_token: '',
			fair_payment_mollie_token_expires: 0,
			fair_payment_mollie_connected: false,
		})
			.then(() => {
				loadSettings();
				onNotice({
					status: 'success',
					message: __(
						'Disconnected from Mollie.',
						'fair-payments-connector'
					),
				});
				setIsSaving(false);
			})
			.catch(() => {
				onNotice({
					status: 'error',
					message: __(
						'Failed to disconnect.',
						'fair-payments-connector'
					),
				});
				setIsSaving(false);
			});
	};

	/**
	 * Handle mode change
	 *
	 * @param {string} newMode New mode value (test/live)
	 */
	const handleModeChange = (newMode) => {
		setIsSaving(true);

		saveSettings({
			fair_payment_mode: newMode,
		})
			.then(() => {
				loadSettings();
				onNotice({
					status: 'success',
					message: sprintf(
						/* translators: %s: mode name (Test or Live) */
						__('Switched to %s mode.', 'fair-payments-connector'),
						newMode === 'test'
							? __('Test', 'fair-payments-connector')
							: __('Live', 'fair-payments-connector')
					),
				});
				setIsSaving(false);
			})
			.catch(() => {
				onNotice({
					status: 'error',
					message: __(
						'Failed to change mode.',
						'fair-payments-connector'
					),
				});
				setIsSaving(false);
			});
	};

	/**
	 * Handle manual token refresh
	 */
	const handleRefreshToken = () => {
		setIsRefreshing(true);

		testConnection()
			.then((response) => {
				loadSettings();
				onNotice({
					status: 'success',
					message:
						response.message ||
						__(
							'Connection refreshed successfully.',
							'fair-payments-connector'
						),
				});
				setIsRefreshing(false);
			})
			.catch((error) => {
				// Log detailed error for troubleshooting
				console.error(
					'[Fair Payments Connector] Connection test failed:',
					error
				);
				console.error('[Fair Payments Connector] Error details:', {
					message: error.message,
					code: error.code,
					data: error.data,
				});

				// Build detailed error message for admin
				let errorMessage =
					__(
						'Failed to refresh connection.',
						'fair-payments-connector'
					) + ' ';

				if (error.message) {
					errorMessage += error.message;
				}

				if (error.data && error.data.details) {
					const details = error.data.details;
					const debugInfo = [];

					if (details.message) {
						debugInfo.push('Error: ' + details.message);
					}
					if (details.file && details.line) {
						debugInfo.push(
							'Location: ' + details.file + ':' + details.line
						);
					}
					if (details.code) {
						debugInfo.push('Code: ' + details.code);
					}

					if (debugInfo.length > 0) {
						errorMessage += ' (' + debugInfo.join(', ') + ')';
					}
				}

				errorMessage +=
					' ' +
					__(
						'Please check the error log for more details or try reconnecting to Mollie.',
						'fair-payments-connector'
					);

				onNotice({
					status: 'error',
					message: errorMessage,
				});
				setIsRefreshing(false);
			});
	};

	if (isLoading) {
		return (
			<Card>
				<CardBody>
					<p>
						{__(
							'Loading connection settings...',
							'fair-payments-connector'
						)}
					</p>
				</CardBody>
			</Card>
		);
	}

	return (
		<Card>
			<CardBody>
				<h2>{__('Mollie Connection', 'fair-payments-connector')}</h2>

				{!connected ? (
					<>
						<p>
							{__(
								'Connect your Mollie account to accept payments. This uses secure OAuth authentication.',
								'fair-payments-connector'
							)}
						</p>
						<Button isPrimary onClick={handleConnect}>
							{__(
								'Connect with Mollie',
								'fair-payments-connector'
							)}
						</Button>
					</>
				) : (
					<>
						<Notice status="success" isDismissible={false}>
							{__(
								'Connected to Mollie',
								'fair-payments-connector'
							)}
						</Notice>

						{organizationId && (
							<div style={{ marginTop: '1rem' }}>
								<p>
									<strong>
										{__(
											'Organization ID:',
											'fair-payments-connector'
										)}
									</strong>{' '}
									<code>{organizationId}</code>
								</p>
							</div>
						)}

						<div style={{ marginTop: '0.5rem' }}>
							<p>
								<strong>
									{__(
										'Profile ID:',
										'fair-payments-connector'
									)}
								</strong>{' '}
								{profileId ? (
									<code>{profileId}</code>
								) : (
									<span style={{ color: '#d63638' }}>
										{__(
											'Missing (required for payments)',
											'fair-payments-connector'
										)}
									</span>
								)}
							</p>
							{!profileId && (
								<p
									style={{
										fontSize: '0.9em',
										color: '#d63638',
										marginTop: '0.5rem',
									}}
								>
									{__(
										'Please reconnect to Mollie to fetch the profile ID.',
										'fair-payments-connector'
									)}
								</p>
							)}
						</div>

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
											'fair-payments-connector'
										),
										new Date(
											tokenExpires * 1000
										).toLocaleString()
									)}
								</p>
							</div>
						)}

						<div style={{ marginTop: '1.5rem' }}>
							<RadioControl
								label={__('Mode', 'fair-payments-connector')}
								selected={mode}
								options={[
									{
										label: __(
											'Test Mode',
											'fair-payments-connector'
										),
										value: 'test',
									},
									{
										label: __(
											'Live Mode',
											'fair-payments-connector'
										),
										value: 'live',
									},
								]}
								onChange={handleModeChange}
								disabled={isSaving}
							/>
						</div>

						<div style={{ marginTop: '1.5rem' }}>
							<ButtonGroup>
								<Button
									isDestructive
									onClick={handleDisconnect}
									disabled={isSaving}
								>
									{__(
										'Disconnect',
										'fair-payments-connector'
									)}
								</Button>
								<Button
									isSecondary
									onClick={handleRefreshToken}
									isBusy={isRefreshing}
									disabled={isRefreshing}
								>
									{isRefreshing
										? __(
												'Refreshing...',
												'fair-payments-connector'
										  )
										: __(
												'Refresh Connection',
												'fair-payments-connector'
										  )}
								</Button>
							</ButtonGroup>
						</div>
					</>
				)}
			</CardBody>
		</Card>
	);
}
