/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import {
	Button,
	TextControl,
	SelectControl,
	Card,
	CardHeader,
	CardBody,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import { loadOrganizerSettings, saveSettings } from './settings-api.js';

/**
 * Whether a `sameAs` entry is either empty (dropped on save) or a valid
 * absolute http(s) URL.
 *
 * @param {string} value Entry value.
 * @return {boolean} True when the entry doesn't block saving.
 */
function isValidLink(value) {
	if ('' === value.trim()) {
		return true;
	}

	try {
		const url = new URL(value);
		return 'http:' === url.protocol || 'https:' === url.protocol;
	} catch (e) {
		return false;
	}
}

/**
 * Organizer Tab Component
 *
 * Sitewide organizer identity (name, address, type, social/profile links)
 * used to build the sitewide Organization JSON-LD block and the single-event
 * `organizer` reference.
 *
 * @param {Object}   props          Props
 * @param {Function} props.onNotice Handler for displaying notices
 * @return {JSX.Element} The Organizer settings tab
 */
export default function OrganizerTab({ onNotice }) {
	const [organizer, setOrganizer] = useState(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);

	useEffect(() => {
		loadOrganizerSettings()
			.then((settings) => {
				setOrganizer(settings);
				setIsLoading(false);
			})
			.catch(() => {
				onNotice({
					status: 'error',
					message: __(
						'Failed to load organizer settings.',
						'fair-events'
					),
				});
				setIsLoading(false);
			});
	}, [onNotice]);

	const updateField = (field, value) => {
		setOrganizer({ ...organizer, [field]: value });
	};

	const updateLink = (index, value) => {
		const sameAs = [...organizer.same_as];
		sameAs[index] = value;
		updateField('same_as', sameAs);
	};

	const addLink = () => {
		updateField('same_as', [...organizer.same_as, '']);
	};

	const removeLink = (index) => {
		updateField(
			'same_as',
			organizer.same_as.filter((_, i) => i !== index)
		);
	};

	const hasInvalidLink =
		organizer && organizer.same_as.some((url) => !isValidLink(url));

	const handleSave = () => {
		setIsSaving(true);

		saveSettings({ fair_events_organizer: organizer })
			.then(() => loadOrganizerSettings())
			.then((settings) => {
				setOrganizer(settings);
				onNotice({
					status: 'success',
					message: __(
						'Organizer settings saved successfully.',
						'fair-events'
					),
				});
				setIsSaving(false);
			})
			.catch(() => {
				onNotice({
					status: 'error',
					message: __(
						'Failed to save organizer settings.',
						'fair-events'
					),
				});
				setIsSaving(false);
			});
	};

	if (isLoading || !organizer) {
		return (
			<Card style={{ marginTop: '16px' }}>
				<CardBody>
					<p>{__('Loading organizer settings...', 'fair-events')}</p>
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
						<h2>{__('Identity', 'fair-events')}</h2>
					</CardHeader>
					<CardBody>
						<p className="description">
							{__(
								"This identity is used to build a sitewide Schema.org Organization block and to identify the event organizer, taking the place of the site name and home URL. Everything here is optional; leave it blank to keep today's behaviour.",
								'fair-events'
							)}
						</p>
						<TextControl
							label={__('Name', 'fair-events')}
							value={organizer.name}
							onChange={(value) => updateField('name', value)}
							disabled={isSaving}
						/>
						<SelectControl
							__next40pxDefaultSize
							label={__('Organization type', 'fair-events')}
							value={organizer.type}
							options={[
								{
									label: __('Organization', 'fair-events'),
									value: 'Organization',
								},
								{
									label: __('Sports club', 'fair-events'),
									value: 'SportsClub',
								},
							]}
							onChange={(value) => updateField('type', value)}
							disabled={isSaving}
						/>
					</CardBody>
				</Card>

				<Card>
					<CardHeader>
						<h2>{__('Address', 'fair-events')}</h2>
					</CardHeader>
					<CardBody>
						<TextControl
							label={__('Street address', 'fair-events')}
							value={organizer.street_address}
							onChange={(value) =>
								updateField('street_address', value)
							}
							disabled={isSaving}
						/>
						<TextControl
							label={__('City', 'fair-events')}
							value={organizer.address_locality}
							onChange={(value) =>
								updateField('address_locality', value)
							}
							disabled={isSaving}
						/>
						<TextControl
							label={__('Region', 'fair-events')}
							value={organizer.address_region}
							onChange={(value) =>
								updateField('address_region', value)
							}
							disabled={isSaving}
						/>
						<TextControl
							label={__('Postal code', 'fair-events')}
							value={organizer.postal_code}
							onChange={(value) =>
								updateField('postal_code', value)
							}
							disabled={isSaving}
						/>
						<TextControl
							label={__('Country', 'fair-events')}
							help={__(
								'Use a two-letter code, e.g. ES.',
								'fair-events'
							)}
							value={organizer.address_country}
							onChange={(value) =>
								updateField('address_country', value)
							}
							disabled={isSaving}
						/>
					</CardBody>
				</Card>

				<Card>
					<CardHeader>
						<h2>{__('Social & profile links', 'fair-events')}</h2>
					</CardHeader>
					<CardBody>
						<p className="description">
							{__(
								'Links to social media profiles or other pages that identify the organization (Instagram, Facebook, etc.).',
								'fair-events'
							)}
						</p>

						<VStack spacing={2}>
							{organizer.same_as.map((url, index) => {
								const invalid = !isValidLink(url);
								return (
									// eslint-disable-next-line react/no-array-index-key
									<HStack key={index} alignment="top">
										<TextControl
											type="url"
											label={__(
												'Profile URL',
												'fair-events'
											)}
											hideLabelFromVision
											value={url}
											onChange={(value) =>
												updateLink(index, value)
											}
											disabled={isSaving}
											help={
												invalid
													? __(
															'Enter a valid URL, e.g. https://example.com/profile.',
															'fair-events'
													  )
													: undefined
											}
											className={
												invalid
													? 'has-error'
													: undefined
											}
										/>
										<Button
											variant="tertiary"
											isDestructive
											onClick={() => removeLink(index)}
											disabled={isSaving}
										>
											{__('Remove', 'fair-events')}
										</Button>
									</HStack>
								);
							})}
						</VStack>

						<Button
							variant="secondary"
							onClick={addLink}
							disabled={isSaving}
							style={{ marginTop: '0.5rem' }}
						>
							{__('Add link', 'fair-events')}
						</Button>
					</CardBody>
				</Card>

				<div>
					<Button
						variant="primary"
						type="submit"
						isBusy={isSaving}
						disabled={isSaving || hasInvalidLink}
					>
						{isSaving
							? __('Saving...', 'fair-events')
							: __('Save organizer', 'fair-events')}
					</Button>
					{hasInvalidLink && (
						<p className="description">
							{__(
								'Fix the invalid social/profile link above before saving.',
								'fair-events'
							)}
						</p>
					)}
				</div>
			</VStack>
		</form>
	);
}
