/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import {
	Card,
	CardBody,
	ToggleControl,
	Button,
	Spinner,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import { saveSettings } from './settings-api.js';
import apiFetch from '@wordpress/api-fetch';

/**
 * Features Tab Component
 *
 * Displays feature toggles for the plugin.
 *
 * @param {Object}   props          Props
 * @param {Function} props.onNotice Handler for displaying notices
 * @return {JSX.Element} The features tab
 */
export default function FeaturesTab({ onNotice }) {
	const [budgetingEnabled, setBudgetingEnabled] = useState(false);
	const [loading, setLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		apiFetch({ path: '/wp/v2/settings' }).then((settings) => {
			setBudgetingEnabled(settings.fair_payment_enable_budgets || false);
			setLoading(false);
		});
	}, []);

	const handleSave = async () => {
		setIsSaving(true);
		try {
			await saveSettings({
				fair_payment_enable_budgets: budgetingEnabled,
			});
			onNotice({
				status: 'success',
				message: __(
					'Features saved. Reload the page to see menu changes.',
					'fair-payment'
				),
			});
		} catch (err) {
			onNotice({
				status: 'error',
				message:
					err.message ||
					__('Failed to save features.', 'fair-payment'),
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
				<ToggleControl
					__nextHasNoMarginBottom
					label={__('Enable Budgeting', 'fair-payment')}
					help={__(
						'Show budget categories, budget columns in entries, and budget assignment in forms.',
						'fair-payment'
					)}
					checked={budgetingEnabled}
					onChange={setBudgetingEnabled}
				/>
				<div style={{ marginTop: '16px' }}>
					<Button
						variant="primary"
						onClick={handleSave}
						isBusy={isSaving}
						disabled={isSaving}
					>
						{__('Save', 'fair-payment')}
					</Button>
				</div>
			</CardBody>
		</Card>
	);
}
