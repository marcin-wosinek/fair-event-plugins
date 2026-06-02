/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import {
	Button,
	TextControl,
	CheckboxControl,
	ToggleControl,
	ExternalLink,
	Card,
	CardHeader,
	CardBody,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import apiFetch from '@wordpress/api-fetch';

/**
 * Internal dependencies
 */
import { loadGeneralSettings, saveSettings } from './settings-api.js';
import CopyUrlButton from '../components/CopyUrlButton.js';

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
	const [enabledPostTypes, setEnabledPostTypes] = useState([]);
	const [registerPostType, setRegisterPostType] = useState(true);
	const [availablePostTypes, setAvailablePostTypes] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);

	// Load settings and post types on mount.
	useEffect(() => {
		Promise.all([loadGeneralSettings(), apiFetch({ path: '/wp/v2/types' })])
			.then(([settings, postTypes]) => {
				setSlug(settings.slug);
				setEnabledPostTypes(settings.enabledPostTypes);
				setRegisterPostType(settings.registerPostType);

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
		const otherPostTypes = enabledPostTypes.filter(
			(t) => t !== 'fair_event'
		);

		// With the Events post type off, at least one other type must be chosen.
		if (!registerPostType && otherPostTypes.length === 0) {
			onNotice({
				status: 'error',
				message: __(
					'Select at least one post type, or enable the Events post type.',
					'fair-events'
				),
			});
			return;
		}

		setIsSaving(true);

		saveSettings({
			fair_events_slug: slug,
			fair_events_register_post_type: registerPostType,
			fair_events_enabled_post_types: otherPostTypes,
		})
			.then(() => {
				return loadGeneralSettings();
			})
			.then((settings) => {
				setSlug(settings.slug);
				setEnabledPostTypes(settings.enabledPostTypes);
				setRegisterPostType(settings.registerPostType);
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
			<Card style={{ marginTop: '16px' }}>
				<CardBody>
					<p>{__('Loading settings...', 'fair-events')}</p>
				</CardBody>
			</Card>
		);
	}

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				handleSave();
			}}
		>
			<VStack spacing={4} style={{ marginTop: '16px' }}>
				<Card>
					<CardHeader>
						<h2>{__('Event URL Slug', 'fair-events')}</h2>
					</CardHeader>
					<CardBody>
						<TextControl
							label={__('Event URL Slug', 'fair-events')}
							hideLabelFromVision
							help={__(
								'The URL slug used for event permalinks (e.g., /fair-events/event-name)',
								'fair-events'
							)}
							value={slug}
							onChange={(value) => setSlug(value)}
							disabled={isSaving}
						/>
					</CardBody>
				</Card>

				<Card>
					<CardHeader>
						<h2>{__('Enabled Post Types', 'fair-events')}</h2>
					</CardHeader>
					<CardBody>
						<p className="description">
							{__(
								'Select which post types can have event data (dates, location).',
								'fair-events'
							)}
						</p>

						<ToggleControl
							label={__(
								'Use the Events post type',
								'fair-events'
							)}
							checked={registerPostType}
							onChange={(value) => setRegisterPostType(value)}
							help={__(
								'Register the dedicated Events post type. Turn off to attach events only to the post types selected below.',
								'fair-events'
							)}
							disabled={isSaving}
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
					</CardBody>
				</Card>

				<Card>
					<CardHeader>
						<h2>{__('Events API', 'fair-events')}</h2>
					</CardHeader>
					<CardBody>
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
							<CopyUrlButton
								url={
									window.fairEventsSettingsData?.eventsApiUrl
								}
								label={__('Copy API URL', 'fair-events')}
								tooltip={__(
									'Copy Events API URL to clipboard',
									'fair-events'
								)}
							/>{' '}
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
					</CardBody>
				</Card>

				<div>
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
				</div>
			</VStack>
		</form>
	);
}
