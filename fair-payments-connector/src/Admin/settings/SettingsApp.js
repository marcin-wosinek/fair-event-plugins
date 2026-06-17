/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import { Notice, TabPanel } from '@wordpress/components';

/**
 * Internal dependencies
 */
import ConnectionTab from './ConnectionTab';
import CurrencyTab from './CurrencyTab.js';
import FeaturesTab from './FeaturesTab.js';
import PaymentMethodsTab from './PaymentMethodsTab.js';
import { saveOAuthCallback } from './settings-api';

/**
 * Settings App Component
 *
 * Main settings page with tabs for Connection and Advanced settings.
 * Handles OAuth callback and notice display. Each tab manages its own loading state.
 *
 * @return {JSX.Element} The settings app
 */
export default function SettingsApp() {
	const [notice, setNotice] = useState(null);
	const [currentTab, setCurrentTab] = useState('connection');
	const [shouldReloadConnection, setShouldReloadConnection] = useState(false);

	/**
	 * Handle OAuth callback on mount
	 */
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const accessToken = params.get('mollie_access_token');
		const refreshToken = params.get('mollie_refresh_token');
		const expiresIn = params.get('mollie_expires_in');
		const orgId = params.get('mollie_organization_id');
		const profileId = params.get('mollie_profile_id');
		const testMode = params.get('mollie_test_mode');
		const state = params.get('state');
		const error = params.get('error');

		// Handle OAuth errors
		if (error === 'access_denied') {
			setNotice({
				status: 'error',
				message: __(
					'Authorization cancelled. Please try again.',
					'fair-payments-connector'
				),
			});
			// Clean URL
			window.history.replaceState(
				{},
				'',
				window.location.pathname +
					'?page=fair-payments-connector-settings'
			);
			return;
		}

		if (accessToken && !refreshToken) {
			setNotice({
				status: 'warning',
				message: __(
					'OAuth callback incomplete: refresh token not received from authorization server.',
					'fair-payments-connector'
				),
			});
			return;
		}

		// Handle successful OAuth callback — validate state server-side before saving.
		if (accessToken && refreshToken) {
			if (!state) {
				setNotice({
					status: 'error',
					message: __(
						'OAuth callback is missing the state parameter. Please try connecting again.',
						'fair-payments-connector'
					),
				});
				return;
			}

			saveOAuthCallback({
				state,
				access_token: accessToken,
				refresh_token: refreshToken,
				expires_in: parseInt(expiresIn, 10) || 0,
				organization_id: orgId || '',
				profile_id: profileId || '',
				test_mode: testMode === '1',
			})
				.then(() => {
					// Clean URL (remove tokens from address bar)
					window.history.replaceState(
						{},
						'',
						window.location.pathname +
							'?page=fair-payments-connector-settings'
					);

					// Trigger reload in ConnectionTab
					setShouldReloadConnection(true);

					setNotice({
						status: 'success',
						message: __(
							'Successfully connected to Mollie!',
							'fair-payments-connector'
						),
					});
				})
				.catch((err) => {
					setNotice({
						status: 'error',
						message:
							__(
								'Failed to save OAuth tokens: ',
								'fair-payments-connector'
							) + (err.message || 'Unknown error'),
					});
				});
		}
	}, []);

	/**
	 * Reset shouldReloadConnection flag after it's been used
	 */
	useEffect(() => {
		if (shouldReloadConnection) {
			setShouldReloadConnection(false);
		}
	}, [shouldReloadConnection]);

	/**
	 * Handle tab selection
	 *
	 * @param {string} tabName Name of selected tab
	 */
	const handleTabSelect = (tabName) => {
		console.log(
			'[Fair Payments Connector] Tab selected:',
			tabName,
			'(current:',
			currentTab,
			')'
		);

		// Only update tab if switching to different tab
		if (tabName === currentTab) {
			console.log('[Fair Payments Connector] Same tab, skipping');
			return;
		}

		setCurrentTab(tabName);
	};

	return (
		<div className="wrap">
			<h1>
				{__(
					'Fair Payments Connector Settings',
					'fair-payments-connector'
				)}
			</h1>

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
				className="fair-payments-connector-settings-tabs"
				activeClass="active-tab"
				tabs={[
					{
						name: 'connection',
						title: __('Connection', 'fair-payments-connector'),
					},
					{
						name: 'features',
						title: __('Features', 'fair-payments-connector'),
					},
					{
						name: 'payment-methods',
						title: __('Payment Methods', 'fair-payments-connector'),
					},
					{
						name: 'currency',
						title: __('Currency', 'fair-payments-connector'),
					},
				]}
				onSelect={handleTabSelect}
			>
				{(tab) => (
					<div style={{ marginTop: '1rem' }}>
						{tab.name === 'connection' && (
							<ConnectionTab
								onNotice={setNotice}
								shouldReload={shouldReloadConnection}
							/>
						)}
						{tab.name === 'features' && (
							<FeaturesTab onNotice={setNotice} />
						)}
						{tab.name === 'payment-methods' && (
							<PaymentMethodsTab onNotice={setNotice} />
						)}
						{tab.name === 'currency' && (
							<CurrencyTab onNotice={setNotice} />
						)}
					</div>
				)}
			</TabPanel>
		</div>
	);
}
