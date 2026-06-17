/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import {
	Card,
	CardBody,
	SelectControl,
	Button,
	Spinner,
} from '@wordpress/components';
import apiFetch from '@wordpress/api-fetch';

/**
 * Internal dependencies
 */
import { saveSettings } from './settings-api.js';

const SUPPORTED_CURRENCIES = [
	{ label: 'EUR — Euro', value: 'EUR' },
	{ label: 'USD — US Dollar', value: 'USD' },
	{ label: 'GBP — British Pound', value: 'GBP' },
	{ label: 'CHF — Swiss Franc', value: 'CHF' },
	{ label: 'DKK — Danish Krone', value: 'DKK' },
	{ label: 'NOK — Norwegian Krone', value: 'NOK' },
	{ label: 'SEK — Swedish Krona', value: 'SEK' },
	{ label: 'PLN — Polish Złoty', value: 'PLN' },
	{ label: 'CZK — Czech Koruna', value: 'CZK' },
	{ label: 'HUF — Hungarian Forint', value: 'HUF' },
];

/**
 * Currency Tab Component
 *
 * Lets the admin set the site-wide default currency for all new transactions.
 *
 * @param {Object}   props          Props
 * @param {Function} props.onNotice Handler for displaying notices
 * @return {JSX.Element} The currency tab
 */
export default function CurrencyTab({ onNotice }) {
	const [currency, setCurrency] = useState('EUR');
	const [loading, setLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		apiFetch({ path: '/wp/v2/settings' })
			.then((settings) => {
				setCurrency(settings.fair_payment_currency || 'EUR');
				setLoading(false);
			})
			.catch((err) => {
				onNotice({
					status: 'error',
					message:
						err.message ||
						__(
							'Failed to load currency settings.',
							'fair-payments-connector'
						),
				});
				setLoading(false);
			});
	}, []);

	const handleSave = async () => {
		setIsSaving(true);
		try {
			await saveSettings({ fair_payment_currency: currency });
			onNotice({
				status: 'success',
				message: __(
					'Currency settings saved.',
					'fair-payments-connector'
				),
			});
		} catch (err) {
			onNotice({
				status: 'error',
				message:
					err.message ||
					__(
						'Failed to save currency settings.',
						'fair-payments-connector'
					),
			});
		} finally {
			setIsSaving(false);
		}
	};

	if (loading) {
		return <Spinner />;
	}

	return (
		<Card>
			<CardBody>
				<h2>{__('Default Currency', 'fair-payments-connector')}</h2>
				<p style={{ color: '#666', marginBottom: '1rem' }}>
					{__(
						'Set the default currency for all new transactions. Existing transaction records are not affected.',
						'fair-payments-connector'
					)}
				</p>

				<div style={{ maxWidth: '320px' }}>
					<SelectControl
						label={__('Site currency', 'fair-payments-connector')}
						value={currency}
						options={SUPPORTED_CURRENCIES}
						onChange={setCurrency}
					/>
				</div>

				<div style={{ marginTop: '16px' }}>
					<Button
						variant="primary"
						onClick={handleSave}
						isBusy={isSaving}
						disabled={isSaving}
					>
						{__('Save', 'fair-payments-connector')}
					</Button>
				</div>
			</CardBody>
		</Card>
	);
}
