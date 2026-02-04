/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import {
	Button,
	TextControl,
	CheckboxControl,
	PanelBody,
	ExternalLink,
	Card,
	CardBody,
} from '@wordpress/components';
import apiFetch from '@wordpress/api-fetch';

/**
 * Internal dependencies
 */
import { loadGeneralSettings, saveSettings } from './settings-api.js';

/**
 * General Tab Component
 *
 * Displays event URL slug, enabled post types, and Events API settings.
 *
 * @param {Object}   props          Props
 * @param {Function} props.onNotice Handler for displaying notices
 * @return {JSX.Element} The General settings tab
 */
export default function GeneralTab({ onNotice }) {
	const [slug, setSlug] = useState('');
	const [enabledPostTypes, setEnabledPostTypes] = useState(['fair_event']);
	const [availablePostTypes, setAvailablePostTypes] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);

	// Load settings and post types on mount.
	useEffect(() => {
		Promise.all([loadGeneralSettings(), apiFetch({ path: '/wp/v2/types' })])
			.then(([settings, postTypes]) => {
				setSlug(settings.slug);
				setEnabledPostTypes(settings.enabledPostTypes);

				// Filter to get content post types that make sense for events.
				// Exclude system types that shouldn't have event data.
				const excludedTypes = [
					'attachment',
					'nav_menu_item',
					'wp_block',
					'wp_template',
					'wp_template_part',
					'wp_navigation',
					'wp_global_styles',
					'wp_font_family',
					'wp_font_face',
					'fair_event', // Show fair_event separately as always enabled.
				];
				const contentTypes = Object.values(postTypes).filter(
					(type) => !excludedTypes.includes(type.slug)
				);
				setAvailablePostTypes(contentTypes);
				setIsLoading(false);
			})
			.catch(() => {
				onNotice({
					status: 'error',
					message: __('Failed to load settings.', 'fair-events'),
				});
				setIsLoading(false);
			});
	}, [onNotice]);

	// Handle post type checkbox toggle.
	const handlePostTypeToggle = (postTypeSlug, isChecked) => {
		if (isChecked) {
			setEnabledPostTypes([...enabledPostTypes, postTypeSlug]);
		} else {
			setEnabledPostTypes(
				enabledPostTypes.filter((s) => s !== postTypeSlug)
			);
		}
	};

	// Save settings.
	const handleSave = () => {
		setIsSaving(true);

		saveSettings({
			fair_events_slug: slug,
			fair_events_enabled_post_types: enabledPostTypes,
		})
			.then(() => {
				return loadGeneralSettings();
			})
			.then((settings) => {
				setSlug(settings.slug);
				setEnabledPostTypes(settings.enabledPostTypes);
				onNotice({
					status: 'success',
					message: __('Settings saved successfully.', 'fair-events'),
				});
				setIsSaving(false);
			})
			.catch(() => {
				onNotice({
					status: 'error',
					message: __('Failed to save settings.', 'fair-events'),
				});
				setIsSaving(false);
			});
	};

	if (isLoading) {
		return (
			<Card>
				<CardBody>
					<p>{__('Loading settings...', 'fair-events')}</p>
				</CardBody>
			</Card>
		);
	}

	return (
		<Card>
			<CardBody>
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

					<PanelBody
						title={__('Enabled Post Types', 'fair-events')}
						initialOpen={true}
					>
						<p className="description">
							{__(
								'Select which post types can have event data (dates, location). The Events post type is always enabled.',
								'fair-events'
							)}
						</p>

						<CheckboxControl
							label={__('Events', 'fair-events')}
							checked={true}
							disabled={true}
							help={__(
								'The Events post type is always enabled.',
								'fair-events'
							)}
						/>

						{availablePostTypes.map((postType) => (
							<CheckboxControl
								key={postType.slug}
								label={postType.name}
								checked={enabledPostTypes.includes(
									postType.slug
								)}
								onChange={(isChecked) =>
									handlePostTypeToggle(
										postType.slug,
										isChecked
									)
								}
								disabled={isSaving}
							/>
						))}
					</PanelBody>

					<PanelBody
						title={__('Events API', 'fair-events')}
						initialOpen={true}
					>
						<p className="description">
							{__(
								'Share your events with other Fair Events sites using the public JSON API.',
								'fair-events'
							)}
						</p>

						<p>
							<strong>
								{__('Events API URL:', 'fair-events')}
							</strong>
							<br />
							<code>
								{window.fairEventsSettingsData?.eventsApiUrl}
							</code>
						</p>

						<p>
							<ExternalLink
								href={
									window.fairEventsSettingsData?.eventsApiUrl
								}
							>
								{__('Open Events API', 'fair-events')}
							</ExternalLink>
						</p>

						<p className="description">
							{__(
								'Optional parameters: start_date, end_date (Y-m-d format), categories (comma-separated slugs), per_page, page.',
								'fair-events'
							)}
						</p>
					</PanelBody>

					<Button
						variant="primary"
						type="submit"
						isBusy={isSaving}
						disabled={isSaving}
					>
						{isSaving
							? __('Saving...', 'fair-events')
							: __('Save Settings', 'fair-events')}
					</Button>
				</form>
			</CardBody>
		</Card>
	);
}
