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
	Notice,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import { saveSettings } from './settings-api.js';
import apiFetch from '@wordpress/api-fetch';

/**
 * Features Tab Component
 *
 * Displays feature toggles for the plugin. Budgeting stays in its existing
 * standalone option; the rest of the toggles come from the
 * `fair_payment_features` registry (currently just `bundled-translations`).
 *
 * @param {Object}   props          Props
 * @param {Function} props.onNotice Handler for displaying notices
 * @return {JSX.Element} The features tab
 */
export default function FeaturesTab({ onNotice }) {
	const registry = window.fairPaymentSettingsData?.features || {};
	const [budgetingEnabled, setBudgetingEnabled] = useState(false);
	const [featureValues, setFeatureValues] = useState({});
	const [loading, setLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		apiFetch({ path: '/wp/v2/settings' }).then((settings) => {
			setBudgetingEnabled(settings.fair_payment_enable_budgets || false);

			const stored = settings.fair_payment_features || {};
			const next = {};
			Object.entries(registry).forEach(([key, meta]) => {
				if (meta.always_on || meta.forced) {
					next[key] = meta.enabled;
				} else {
					next[key] =
						typeof stored[key] === 'boolean'
							? stored[key]
							: meta.enabled;
				}
			});
			setFeatureValues(next);
			setLoading(false);
		});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const handleSave = async () => {
		const payload = {
			fair_payment_enable_budgets: budgetingEnabled,
		};
		const featuresPayload = {};
		Object.entries(registry).forEach(([key, meta]) => {
			if (meta.always_on || meta.forced) {
				return;
			}
			featuresPayload[key] = !!featureValues[key];
		});
		payload.fair_payment_features = featuresPayload;

		setIsSaving(true);
		try {
			await saveSettings(payload);
			onNotice({
				status: 'success',
				message: __(
					'Features saved. Reload the page to see menu changes.',
					'fair-payments-connector'
				),
			});
		} catch (err) {
			onNotice({
				status: 'error',
				message:
					err.message ||
					__('Failed to save features.', 'fair-payments-connector'),
			});
		} finally {
			setIsSaving(false);
		}
	};

	if (loading) {
		return <Spinner />;
	}

	const registryEntries = Object.entries(registry).filter(
		([, meta]) => !meta.always_on
	);

	return (
		<Card>
			<CardBody>
				<ToggleControl
					__nextHasNoMarginBottom
					label={__('Enable Budgeting', 'fair-payments-connector')}
					help={__(
						'Show budget categories, budget columns in entries, and budget assignment in forms.',
						'fair-payments-connector'
					)}
					checked={budgetingEnabled}
					onChange={setBudgetingEnabled}
				/>

				{registryEntries.map(([key, meta]) => {
					const help = meta.forced
						? __(
								'Forced by a wp-config constant — change it there.',
								'fair-payments-connector'
						  )
						: meta.description;

					return (
						<div key={key} style={{ marginTop: '1rem' }}>
							<ToggleControl
								__nextHasNoMarginBottom
								label={meta.label}
								checked={!!featureValues[key]}
								onChange={(value) =>
									setFeatureValues({
										...featureValues,
										[key]: value,
									})
								}
								disabled={isSaving || meta.forced}
								help={help}
							/>
						</div>
					);
				})}

				{registryEntries.some(([, meta]) => meta.forced) && (
					<Notice status="info" isDismissible={false}>
						{__(
							'One or more bundles are forced by wp-config and cannot be toggled here.',
							'fair-payments-connector'
						)}
					</Notice>
				)}

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
