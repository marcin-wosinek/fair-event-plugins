/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import {
	Card,
	CardBody,
	ToggleControl,
	__experimentalNumberControl as NumberControl,
	Button,
	Spinner,
} from '@wordpress/components';
import apiFetch from '@wordpress/api-fetch';

/**
 * Internal dependencies
 */
import { saveSettings } from './settings-api.js';

/**
 * Payment Methods Tab Component
 *
 * Lets the admin configure per-payment-method behavior. Currently:
 * - Disable bank transfer when the sale is within N working days of its key date.
 *
 * @param {Object}   props          Props
 * @param {Function} props.onNotice Handler for displaying notices
 * @return {JSX.Element} The payment methods tab
 */
export default function PaymentMethodsTab({ onNotice }) {
	const [disableNearDate, setDisableNearDate] = useState(false);
	const [thresholdDays, setThresholdDays] = useState(3);
	const [loading, setLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		apiFetch({ path: '/wp/v2/settings' })
			.then((settings) => {
				setDisableNearDate(
					settings.fair_payment_disable_banktransfer_near_date ||
						false
				);
				const days = parseInt(
					settings.fair_payment_banktransfer_threshold_days,
					10
				);
				setThresholdDays(Number.isFinite(days) ? days : 3);
				setLoading(false);
			})
			.catch((err) => {
				onNotice({
					status: 'error',
					message:
						err.message ||
						__(
							'Failed to load payment method settings.',
							'fair-payments-connector'
						),
				});
				setLoading(false);
			});
	}, []);

	const handleSave = async () => {
		setIsSaving(true);
		try {
			await saveSettings({
				fair_payment_disable_banktransfer_near_date: disableNearDate,
				fair_payment_banktransfer_threshold_days: thresholdDays,
			});
			onNotice({
				status: 'success',
				message: __(
					'Payment method settings saved.',
					'fair-payments-connector'
				),
			});
		} catch (err) {
			onNotice({
				status: 'error',
				message:
					err.message ||
					__(
						'Failed to save payment method settings.',
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
				<h2>{__('Bank Transfer (SEPA)', 'fair-payments-connector')}</h2>
				<p style={{ color: '#666', marginBottom: '1rem' }}>
					{__(
						'SEPA bank transfers can take 1–3 working days to settle. Disable this method when the sale is too close to its key date (e.g. event day) to ensure payments clear in time.',
						'fair-payments-connector'
					)}
				</p>

				<ToggleControl
					__nextHasNoMarginBottom
					label={__(
						'Disable bank transfer near the key date',
						'fair-payments-connector'
					)}
					help={__(
						'Hide bank transfer as a payment option when the sale is within the threshold below.',
						'fair-payments-connector'
					)}
					checked={disableNearDate}
					onChange={setDisableNearDate}
				/>

				<div style={{ marginTop: '16px', maxWidth: '320px' }}>
					<NumberControl
						label={__(
							'Working-day threshold',
							'fair-payments-connector'
						)}
						help={__(
							'Disable bank transfer when fewer than this many working days remain before the key date.',
							'fair-payments-connector'
						)}
						min={0}
						step={1}
						value={thresholdDays}
						onChange={(value) => {
							const next = parseInt(value, 10);
							setThresholdDays(Number.isFinite(next) ? next : 0);
						}}
						disabled={!disableNearDate}
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
