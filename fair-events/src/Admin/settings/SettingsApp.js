/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import { Button, TextControl, Notice } from '@wordpress/components';
import apiFetch from '@wordpress/api-fetch';

/**
 * Settings App Component
 *
 * @return {JSX.Element} The Settings app component
 */
export default function SettingsApp() {
	const [slug, setSlug] = useState('');
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [notice, setNotice] = useState(null);

	// Load settings on mount
	useEffect(() => {
		apiFetch({ path: '/wp/v2/settings' })
			.then((settings) => {
				setSlug(settings.fair_events_slug || 'fair-events');
				setIsLoading(false);
			})
			.catch((error) => {
				setNotice({
					status: 'error',
					message: __('Failed to load settings.', 'fair-events'),
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
				fair_events_slug: slug,
			},
		})
			.then(() => {
				// Reload settings after save
				return apiFetch({ path: '/wp/v2/settings' });
			})
			.then((settings) => {
				setSlug(settings.fair_events_slug || 'fair-events');
				setNotice({
					status: 'success',
					message: __('Settings saved successfully.', 'fair-events'),
				});
				setIsSaving(false);
			})
			.catch((error) => {
				setNotice({
					status: 'error',
					message: __('Failed to save settings.', 'fair-events'),
				});
				setIsSaving(false);
			});
	};

	if (isLoading) {
		return (
			<div className="wrap">
				<h1>{__('Fair Events Settings', 'fair-events')}</h1>
				<p>{__('Loading...', 'fair-events')}</p>
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1>{__('Fair Events Settings', 'fair-events')}</h1>

			{notice && (
				<Notice
					status={notice.status}
					isDismissible={true}
					onRemove={() => setNotice(null)}
				>
					{notice.message}
				</Notice>
			)}

			<form
				onSubmit={(e) => {
					e.preventDefault();
					handleSave();
				}}
			>
				<TextControl
					label={__('Event URL Slug', 'fair-events')}
					help={__(
						'The URL slug used for event permalinks (e.g., /fair-events/event-name)',
						'fair-events'
					)}
					value={slug}
					onChange={(value) => setSlug(value)}
					disabled={isSaving}
				/>

				<Button
					isPrimary
					type="submit"
					isBusy={isSaving}
					disabled={isSaving}
				>
					{isSaving
						? __('Saving...', 'fair-events')
						: __('Save Settings', 'fair-events')}
				</Button>
			</form>
		</div>
	);
}
