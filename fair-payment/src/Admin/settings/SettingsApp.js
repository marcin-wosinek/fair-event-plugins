/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import {
	TextControl,
	Button,
	Notice,
	RadioControl,
	Card,
	CardBody,
} from '@wordpress/components';
import apiFetch from '@wordpress/api-fetch';

/**
 * Settings App Component
 *
 * @return {JSX.Element} The settings app
 */
export default function SettingsApp() {
	const [testApiKey, setTestApiKey] = useState('');
	const [liveApiKey, setLiveApiKey] = useState('');
	const [mode, setMode] = useState('test');
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [notice, setNotice] = useState(null);

	// Load settings on mount
	useEffect(() => {
		apiFetch({ path: '/wp/v2/settings' })
			.then((settings) => {
				setTestApiKey(settings.fair_payment_test_api_key || '');
				setLiveApiKey(settings.fair_payment_live_api_key || '');
				setMode(settings.fair_payment_mode || 'test');
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

	// Save settings
	const handleSave = () => {
		setIsSaving(true);
		setNotice(null);

		apiFetch({
			path: '/wp/v2/settings',
			method: 'POST',
			data: {
				fair_payment_test_api_key: testApiKey,
				fair_payment_live_api_key: liveApiKey,
				fair_payment_mode: mode,
			},
		})
			.then(() => {
				// Reload settings after save
				return apiFetch({ path: '/wp/v2/settings' });
			})
			.then((settings) => {
				setTestApiKey(settings.fair_payment_test_api_key || '');
				setLiveApiKey(settings.fair_payment_live_api_key || '');
				setMode(settings.fair_payment_mode || 'test');
				setNotice({
					status: 'success',
					message: __('Settings saved successfully.', 'fair-payment'),
				});
				setIsSaving(false);
			})
			.catch((error) => {
				setNotice({
					status: 'error',
					message: __('Failed to save settings.', 'fair-payment'),
				});
				setIsSaving(false);
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
					<h2>{__('Mollie API Configuration', 'fair-payment')}</h2>

					<RadioControl
						label={__('Mode', 'fair-payment')}
						selected={mode}
						options={[
							{
								label: __('Test Mode', 'fair-payment'),
								value: 'test',
							},
							{
								label: __('Live Mode', 'fair-payment'),
								value: 'live',
							},
						]}
						onChange={(value) => setMode(value)}
					/>

					<TextControl
						label={__('Test API Key', 'fair-payment')}
						value={testApiKey}
						onChange={(value) => setTestApiKey(value)}
						disabled={isSaving}
						placeholder="test_..."
						help={__(
							'Get your Test API key from Mollie Dashboard → Developers → API keys',
							'fair-payment'
						)}
					/>

					<TextControl
						label={__('Live API Key', 'fair-payment')}
						value={liveApiKey}
						onChange={(value) => setLiveApiKey(value)}
						disabled={isSaving}
						placeholder="live_..."
						help={__(
							'Get your Live API key from Mollie Dashboard → Developers → API keys',
							'fair-payment'
						)}
					/>

					<Button
						isPrimary
						onClick={handleSave}
						isBusy={isSaving}
						disabled={isSaving}
					>
						{isSaving
							? __('Saving...', 'fair-payment')
							: __('Save Settings', 'fair-payment')}
					</Button>
				</CardBody>
			</Card>
		</div>
	);
}
