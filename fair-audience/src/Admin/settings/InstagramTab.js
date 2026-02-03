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
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import { loadInstagramSettings, saveSettings } from './settings-api.js';

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
	const [userId, setUserId] = useState('');
	const [username, setUsername] = useState('');
	const [tokenExpires, setTokenExpires] = useState(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);

	// Manual token entry state.
	const [manualToken, setManualToken] = useState('');
	const [manualUserId, setManualUserId] = useState('');

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
				setUserId(settings.userId);
				setUsername(settings.username);
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
			fair_audience_instagram_user_id: manualUserId.trim(),
			fair_audience_instagram_username: '',
			fair_audience_instagram_token_expires: 0,
			fair_audience_instagram_connected: true,
		})
			.then(() => {
				setManualToken('');
				setManualUserId('');
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
							<TextControl
								label={__(
									'User ID (optional)',
									'fair-audience'
								)}
								value={manualUserId}
								onChange={setManualUserId}
								placeholder={__(
									'Enter Instagram user ID...',
									'fair-audience'
								)}
								disabled={isSaving}
								help={__(
									'The Instagram Business Account ID.',
									'fair-audience'
								)}
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

						{userId && (
							<div style={{ marginTop: '0.5rem' }}>
								<p>
									<strong>
										{__('User ID:', 'fair-audience')}
									</strong>{' '}
									<code>{userId}</code>
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
