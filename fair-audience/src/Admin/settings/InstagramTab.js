/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import { Button, Notice, Card, CardBody } from '@wordpress/components';

/**
 * Internal dependencies
 */
import { loadInstagramSettings, saveSettings } from './settings-api.js';

/**
 * Instagram Tab Component
 *
 * Displays Instagram OAuth connection status and controls.
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
	 * Handle Connect button click
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
						<Button variant="primary" onClick={handleConnect}>
							{__('Connect with Instagram', 'fair-audience')}
						</Button>
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
