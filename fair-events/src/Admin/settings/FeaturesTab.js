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
 * Features Tab Component
 *
 * Per-bundle toggles backed by the `fair_events_features` option. Bundles
 * forced by a wp-config constant render disabled with an explanatory note —
 * the server-side sanitizer drops writes to forced keys, so the UI just
 * reflects what PHP will accept.
 *
 * @param {Object}   props          Props
 * @param {Function} props.onNotice Handler for displaying notices
 * @return {JSX.Element} The Features settings tab
 */
export default function FeaturesTab({ onNotice }) {
	const registry = window.fairEventsSettingsData?.features || {};
	const [values, setValues] = useState({});
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		apiFetch({ path: '/wp/v2/settings' })
			.then((settings) => {
				const stored = settings.fair_events_features || {};
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
					message: __('Failed to load features.', 'fair-events'),
				});
				setIsLoading(false);
			});
		// registry comes from a global injected once per page load — no need
		// to track it in deps.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [onNotice]);

	const handleToggle = (key, value) => {
		setValues({ ...values, [key]: value });
	};

	const handleSave = () => {
		// Drop forced/always-on keys from the payload — the PHP sanitizer
		// ignores them anyway, but sending only editable keys keeps intent
		// clear.
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
			data: { fair_events_features: payload },
		})
			.then(() => {
				onNotice({
					status: 'success',
					message: __(
						'Features saved. Reload the page to see admin-menu changes.',
						'fair-events'
					),
				});
				setIsSaving(false);
			})
			.catch(() => {
				onNotice({
					status: 'error',
					message: __('Failed to save features.', 'fair-events'),
				});
				setIsSaving(false);
			});
	};

	if (isLoading) {
		return (
			<Card style={{ marginTop: '16px' }}>
				<CardBody>
					<p>{__('Loading features...', 'fair-events')}</p>
				</CardBody>
			</Card>
		);
	}

	const entries = Object.entries(registry);

	return (
		<Card style={{ marginTop: '16px' }}>
			<CardHeader>
				<h2>{__('Feature Bundles', 'fair-events')}</h2>
			</CardHeader>
			<CardBody>
				<p className="description">
					{__(
						'Toggle optional feature bundles. Bundles fixed in wp-config (FAIR_EVENTS_INTERNAL or FAIR_EVENTS_FEATURE_*) are read-only here.',
						'fair-events'
					)}
				</p>

				{entries.map(([key, meta]) => {
					const help = meta.forced
						? __(
								'Forced by a wp-config constant — change it there.',
								'fair-events'
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
							'fair-events'
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
						? __('Saving...', 'fair-events')
						: __('Save Features', 'fair-events')}
				</Button>
			</CardBody>
		</Card>
	);
}
