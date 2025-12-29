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
 * NOTE: This component follows the same pattern as fair-events/src/Admin/settings/SettingsApp.js
 * When updating this file, consider whether the changes should also be applied to the fair-events version.
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
				setSlug(settings.fair_team_slug || 'team-member');
				setIsLoading(false);
			})
			.catch((error) => {
				setNotice({
					status: 'error',
					message: __('Failed to load settings.', 'fair-team'),
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
				fair_team_slug: slug,
			},
		})
			.then(() => {
				// Reload settings after save
				return apiFetch({ path: '/wp/v2/settings' });
			})
			.then((settings) => {
				setSlug(settings.fair_team_slug || 'team-member');
				setNotice({
					status: 'success',
					message: __('Settings saved successfully.', 'fair-team'),
				});
				setIsSaving(false);
			})
			.catch((error) => {
				setNotice({
					status: 'error',
					message: __('Failed to save settings.', 'fair-team'),
				});
				setIsSaving(false);
			});
	};

	if (isLoading) {
		return (
			<div className="wrap">
				<h1>{__('Fair Team Settings', 'fair-team')}</h1>
				<p>{__('Loading...', 'fair-team')}</p>
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1>{__('Fair Team Settings', 'fair-team')}</h1>

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
					label={__('Team Member URL Slug', 'fair-team')}
					help={__(
						'The URL slug used for team member permalinks (e.g., /team-member/member-name)',
						'fair-team'
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
						? __('Saving...', 'fair-team')
						: __('Save Settings', 'fair-team')}
				</Button>
			</form>
		</div>
	);
}
