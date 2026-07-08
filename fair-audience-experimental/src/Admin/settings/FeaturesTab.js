/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import {
	Button,
	ToggleControl,
	Card,
	CardHeader,
	CardBody,
	Notice,
} from '@wordpress/components';
import apiFetch from '@wordpress/api-fetch';

/**
 * Features Tab Component for Fair Audience Experimental.
 *
 * Per-bundle toggles backed by the `fair_audience_experimental_features` option.
 *
 * @param {Object}   props          Props
 * @param {Function} props.onNotice Handler for displaying notices
 * @return {JSX.Element} The Features settings tab
 */
export default function FeaturesTab({ onNotice }) {
	const registry =
		window.fairAudienceExperimentalSettingsData?.features || {};
	const [values, setValues] = useState({});
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		apiFetch({ path: '/wp/v2/settings' })
			.then((settings) => {
				const stored =
					settings.fair_audience_experimental_features || {};
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
				setValues(next);
				setIsLoading(false);
			})
			.catch(() => {
				onNotice({
					status: 'error',
					message: __(
						'Failed to load features.',
						'fair-audience-experimental'
					),
				});
				setIsLoading(false);
			});
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [onNotice]);

	const handleToggle = (key, value) => {
		setValues({ ...values, [key]: value });
	};

	const handleSave = () => {
		const payload = {};
		Object.entries(registry).forEach(([key, meta]) => {
			if (meta.always_on || meta.forced) {
				return;
			}
			payload[key] = !!values[key];
		});

		setIsSaving(true);
		apiFetch({
			path: '/wp/v2/settings',
			method: 'POST',
			data: { fair_audience_experimental_features: payload },
		})
			.then(() => {
				onNotice({
					status: 'success',
					message: __(
						'Features saved. Reload the page to see admin-menu changes.',
						'fair-audience-experimental'
					),
				});
				setIsSaving(false);
			})
			.catch(() => {
				onNotice({
					status: 'error',
					message: __(
						'Failed to save features.',
						'fair-audience-experimental'
					),
				});
				setIsSaving(false);
			});
	};

	if (isLoading) {
		return (
			<Card style={{ marginTop: '16px' }}>
				<CardBody>
					<p>
						{__(
							'Loading features...',
							'fair-audience-experimental'
						)}
					</p>
				</CardBody>
			</Card>
		);
	}

	const entries = Object.entries(registry);

	return (
		<Card style={{ marginTop: '16px' }}>
			<CardHeader>
				<h2>{__('Feature Bundles', 'fair-audience-experimental')}</h2>
			</CardHeader>
			<CardBody>
				<p className="description">
					{__(
						'Toggle optional experimental feature bundles. Bundles fixed in wp-config (FAIR_AUDIENCE_EXPERIMENTAL_INTERNAL or FAIR_AUDIENCE_EXPERIMENTAL_FEATURE_*) are read-only here.',
						'fair-audience-experimental'
					)}
				</p>

				{entries.map(([key, meta]) => {
					const help = meta.forced
						? __(
								'Forced by a wp-config constant — change it there.',
								'fair-audience-experimental'
						  )
						: meta.description;

					return (
						<div key={key} style={{ marginBottom: '1rem' }}>
							<ToggleControl
								label={meta.label}
								checked={!!values[key]}
								onChange={(value) => handleToggle(key, value)}
								disabled={
									isSaving || meta.always_on || meta.forced
								}
								help={help}
							/>
						</div>
					);
				})}

				{entries.some(([, meta]) => meta.forced) && (
					<Notice status="info" isDismissible={false}>
						{__(
							'One or more bundles are forced by wp-config and cannot be toggled here.',
							'fair-audience-experimental'
						)}
					</Notice>
				)}

				<Button
					variant="primary"
					onClick={handleSave}
					isBusy={isSaving}
					disabled={isSaving}
				>
					{isSaving
						? __('Saving...', 'fair-audience-experimental')
						: __('Save Features', 'fair-audience-experimental')}
				</Button>
			</CardBody>
		</Card>
	);
}
