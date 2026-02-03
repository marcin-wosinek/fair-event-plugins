/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import { Notice, TabPanel } from '@wordpress/components';

/**
 * Internal dependencies
 */
import InstagramTab from './InstagramTab.js';
import { saveSettings } from './settings-api.js';

/**
 * Settings App Component
 *
 * Main settings page with tabs for Instagram connection.
 * Handles OAuth callback and notice display.
 *
 * @return {JSX.Element} The settings app
 */
export default function SettingsApp() {
	const [notice, setNotice] = useState(null);
	const [shouldReloadInstagram, setShouldReloadInstagram] = useState(false);

	/**
	 * Handle OAuth callback on mount
	 */
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const accessToken = params.get('instagram_access_token');
		const userId = params.get('instagram_user_id');
		const username = params.get('instagram_username');
		const expiresIn = params.get('instagram_expires_in');
		const error = params.get('error');

		// Handle OAuth errors.
		if (error === 'access_denied') {
			setNotice({
				status: 'error',
				message: __(
					'Authorization cancelled. Please try again.',
					'fair-audience'
				),
			});
			// Clean URL.
			window.history.replaceState(
				{},
				'',
				window.location.pathname + '?page=fair-audience-settings'
			);
			return;
		}

		// Handle successful OAuth callback.
		if (accessToken && userId) {
			const settingsData = {
				fair_audience_instagram_access_token: accessToken,
				fair_audience_instagram_user_id: userId,
				fair_audience_instagram_username: username || '',
				fair_audience_instagram_token_expires: expiresIn
					? Math.floor(Date.now() / 1000) + parseInt(expiresIn)
					: 0,
				fair_audience_instagram_connected: true,
			};

			saveSettings(settingsData)
				.then(() => {
					// Clean URL (remove tokens from address bar).
					window.history.replaceState(
						{},
						'',
						window.location.pathname +
							'?page=fair-audience-settings'
					);

					// Trigger reload in InstagramTab.
					setShouldReloadInstagram(true);

					setNotice({
						status: 'success',
						message: __(
							'Successfully connected to Instagram!',
							'fair-audience'
						),
					});
				})
				.catch((err) => {
					console.error(
						'[Fair Audience] Failed to save OAuth tokens:',
						err
					);
					setNotice({
						status: 'error',
						message:
							__(
								'Failed to save OAuth tokens: ',
								'fair-audience'
							) + (err.message || 'Unknown error'),
					});
				});
		}
	}, []);

	/**
	 * Reset shouldReloadInstagram flag after it's been used
	 */
	useEffect(() => {
		if (shouldReloadInstagram) {
			setShouldReloadInstagram(false);
		}
	}, [shouldReloadInstagram]);

	return (
		<div className="wrap">
			<h1>{__('Fair Audience Settings', 'fair-audience')}</h1>

			{notice && (
				<Notice
					status={notice.status}
					isDismissible={true}
					onRemove={() => setNotice(null)}
				>
					{notice.message}
				</Notice>
			)}

			<TabPanel
				className="fair-audience-settings-tabs"
				activeClass="active-tab"
				tabs={[
					{
						name: 'instagram',
						title: __('Instagram', 'fair-audience'),
					},
				]}
			>
				{(tab) => (
					<div style={{ marginTop: '1rem' }}>
						{tab.name === 'instagram' && (
							<InstagramTab
								onNotice={setNotice}
								shouldReload={shouldReloadInstagram}
							/>
						)}
					</div>
				)}
			</TabPanel>
		</div>
	);
}
