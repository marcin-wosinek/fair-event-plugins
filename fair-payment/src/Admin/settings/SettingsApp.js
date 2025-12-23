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
import apiFetch from '@wordpress/api-fetch';

/**
 * Settings App Component
 *
 * @return {JSX.Element} The settings app
 */
export default function SettingsApp() {
	const [connected, setConnected] = useState(false);
	const [mode, setMode] = useState('test');
	const [organizationId, setOrganizationId] = useState('');
	const [profileId, setProfileId] = useState('');
	const [tokenExpires, setTokenExpires] = useState(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [isSaving, setIsSaving] = useState(false);
	const [notice, setNotice] = useState(null);

	// Load settings on mount
	useEffect(() => {
		apiFetch({ path: '/wp/v2/settings' })
			.then((settings) => {
				setConnected(settings.fair_payment_mollie_connected || false);
				setMode(settings.fair_payment_mode || 'test');
				setOrganizationId(settings.fair_payment_organization_id || '');
				setProfileId(settings.fair_payment_mollie_profile_id || '');
				setTokenExpires(
					settings.fair_payment_mollie_token_expires || null
				);
				setIsLoading(false);
			})
			.catch((error) => {
				setNotice({
					status: 'error',
					message: __('Failed to load settings.', 'fair-payment'),
				});
				setIsLoading(false);
			});
	}, []);

	// Handle OAuth callback on mount
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const accessToken = params.get('mollie_access_token');
		const refreshToken = params.get('mollie_refresh_token');
		const expiresIn = params.get('mollie_expires_in');
		const orgId = params.get('mollie_organization_id');
		const profileId = params.get('mollie_profile_id');
		const testMode = params.get('mollie_test_mode');
		const error = params.get('error');

		// Handle OAuth errors
		if (error === 'access_denied') {
			setNotice({
				status: 'error',
				message: __(
					'Authorization cancelled. Please try again.',
					'fair-payment'
				),
			});
			// Clean URL
			window.history.replaceState(
				{},
				'',
				window.location.pathname + '?page=fair-payment-settings'
			);
			return;
		}

		// Handle successful OAuth callback
		if (accessToken && refreshToken) {
			setIsLoading(true);
			apiFetch({
				path: '/wp/v2/settings',
				method: 'POST',
				data: {
					fair_payment_mollie_access_token: accessToken,
					fair_payment_mollie_refresh_token: refreshToken,
					fair_payment_mollie_token_expires:
						Math.floor(Date.now() / 1000) + parseInt(expiresIn),
					fair_payment_mollie_organization_id: orgId || '',
					fair_payment_mollie_profile_id: profileId || '',
					fair_payment_mollie_connected: true,
					fair_payment_mode: testMode === '1' ? 'test' : 'live',
				},
			})
				.then(() => {
					// Clean URL (remove tokens from address bar)
					window.history.replaceState(
						{},
						'',
						window.location.pathname + '?page=fair-payment-settings'
					);
					setConnected(true);
					setOrganizationId(orgId || '');
					setProfileId(profileId || '');
					setMode(testMode === '1' ? 'test' : 'live');
					setTokenExpires(
						Math.floor(Date.now() / 1000) + parseInt(expiresIn)
					);
					setNotice({
						status: 'success',
						message: __(
							'Successfully connected to Mollie!',
							'fair-payment'
						),
					});
					setIsLoading(false);
				})
				.catch((error) => {
					setNotice({
						status: 'error',
						message: __(
							'Failed to save OAuth tokens.',
							'fair-payment'
						),
					});
					setIsLoading(false);
				});
		}
	}, []);

	// Handle Connect button click
	const handleConnect = () => {
		const siteId = btoa(window.location.hostname);
		const returnUrl =
			window.location.href.split('?')[0] + '?page=fair-payment-settings';
		const siteName = document.title;
		const siteUrl = window.location.origin;

		const authorizeUrl = new URL(
			'https://fair-event-plugins.com/oauth/authorize'
		);
		authorizeUrl.searchParams.set('site_id', siteId);
		authorizeUrl.searchParams.set('return_url', returnUrl);
		authorizeUrl.searchParams.set('site_name', siteName);
		authorizeUrl.searchParams.set('site_url', siteUrl);

		window.location.href = authorizeUrl.toString();
	};

	// Handle Disconnect button click
	const handleDisconnect = () => {
		if (
			!confirm(
				__(
					'Are you sure you want to disconnect from Mollie? You will need to reconnect to accept payments.',
					'fair-payment'
				)
			)
		) {
			return;
		}

		setIsSaving(true);
		setNotice(null);

		apiFetch({
			path: '/wp/v2/settings',
			method: 'POST',
			data: {
				fair_payment_mollie_access_token: '',
				fair_payment_mollie_refresh_token: '',
				fair_payment_mollie_token_expires: 0,
				fair_payment_mollie_connected: false,
			},
		})
			.then(() => {
				setConnected(false);
				setTokenExpires(null);
				setNotice({
					status: 'success',
					message: __('Disconnected from Mollie.', 'fair-payment'),
				});
				setIsSaving(false);
			})
			.catch((error) => {
				setNotice({
					status: 'error',
					message: __('Failed to disconnect.', 'fair-payment'),
				});
				setIsSaving(false);
			});
	};

	// Handle mode change
	const handleModeChange = (newMode) => {
		setIsSaving(true);
		setNotice(null);

		apiFetch({
			path: '/wp/v2/settings',
			method: 'POST',
			data: {
				fair_payment_mode: newMode,
			},
		})
			.then(() => {
				setMode(newMode);
				setNotice({
					status: 'success',
					message: sprintf(
						/* translators: %s: mode name (Test or Live) */
						__('Switched to %s mode.', 'fair-payment'),
						newMode === 'test'
							? __('Test', 'fair-payment')
							: __('Live', 'fair-payment')
					),
				});
				setIsSaving(false);
			})
			.catch((error) => {
				setNotice({
					status: 'error',
					message: __('Failed to change mode.', 'fair-payment'),
				});
				setIsSaving(false);
			});
	};

	// Handle manual token refresh
	const handleRefreshToken = () => {
		setIsRefreshing(true);
		setNotice(null);

		// Trigger a refresh by making a test API call
		// The MolliePaymentHandler will automatically refresh the token
		apiFetch({
			path: '/fair-payment/v1/test-connection',
			method: 'POST',
		})
			.then(() => {
				setNotice({
					status: 'success',
					message: __(
						'Connection refreshed successfully.',
						'fair-payment'
					),
				});
				setIsRefreshing(false);
			})
			.catch((error) => {
				setNotice({
					status: 'error',
					message: __(
						'Failed to refresh connection. Please try reconnecting.',
						'fair-payment'
					),
				});
				setIsRefreshing(false);
			});
	};

	if (isLoading) {
		return (
			<div className="wrap">
				<h1>{__('Fair Payment Settings', 'fair-payment')}</h1>
				<p>{__('Loading...', 'fair-payment')}</p>
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1>{__('Fair Payment Settings', 'fair-payment')}</h1>

			{notice && (
				<Notice
					status={notice.status}
					isDismissible={true}
					onRemove={() => setNotice(null)}
				>
					{notice.message}
				</Notice>
			)}

			<Card>
				<CardBody>
					<h2>{__('Mollie Connection', 'fair-payment')}</h2>

					{!connected ? (
						<>
							<p>
								{__(
									'Connect your Mollie account to accept payments. This uses secure OAuth authentication.',
									'fair-payment'
								)}
							</p>
							<Button isPrimary onClick={handleConnect}>
								{__('Connect with Mollie', 'fair-payment')}
							</Button>
						</>
					) : (
						<>
							<Notice status="success" isDismissible={false}>
								{__('Connected to Mollie', 'fair-payment')}
							</Notice>

							{organizationId && (
								<div style={{ marginTop: '1rem' }}>
									<p>
										<strong>
											{__(
												'Organization ID:',
												'fair-payment'
											)}
										</strong>{' '}
										<code>{organizationId}</code>
									</p>
								</div>
							)}

							<div style={{ marginTop: '0.5rem' }}>
								<p>
									<strong>
										{__('Profile ID:', 'fair-payment')}
									</strong>{' '}
									{profileId ? (
										<code>{profileId}</code>
									) : (
										<span style={{ color: '#d63638' }}>
											{__(
												'Missing (required for payments)',
												'fair-payment'
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
											'fair-payment'
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
												'fair-payment'
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
									label={__('Mode', 'fair-payment')}
									selected={mode}
									options={[
										{
											label: __(
												'Test Mode',
												'fair-payment'
											),
											value: 'test',
										},
										{
											label: __(
												'Live Mode',
												'fair-payment'
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
										{__('Disconnect', 'fair-payment')}
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
													'fair-payment'
												)
											: __(
													'Refresh Connection',
													'fair-payment'
												)}
									</Button>
								</ButtonGroup>
							</div>
						</>
					)}
				</CardBody>
			</Card>
		</div>
	);
}
