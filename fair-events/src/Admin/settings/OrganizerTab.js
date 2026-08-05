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
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import {
	loadOrganizerSettings,
	loadAttachmentUrl,
	saveSettings,
} from './settings-api.js';

/**
 * Open the WordPress media picker and call onSelect with the chosen attachment.
 *
 * @param {Object}   options          Media picker options
 * @param {string}   options.title    Dialog title
 * @param {string}   options.button   Button label
 * @param {string}   options.type     MIME type filter
 * @param {Function} options.onSelect Callback receiving the selected attachment
 */
function openMediaPicker({ title, button, type, onSelect }) {
	const frame = wp.media({
		title,
		button: { text: button },
		library: { type },
		multiple: false,
	});
	frame.on('select', () => {
		const attachment = frame.state().get('selection').first().toJSON();
		onSelect(attachment);
	});
	frame.open();
}

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
	const [defaults, setDefaults] = useState({
		name: '',
		website: '',
		logoId: 0,
	});
	const [logoPreviewUrl, setLogoPreviewUrl] = useState('');
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [removeLogoDialogOpen, setRemoveLogoDialogOpen] = useState(false);

	const applySettings = (settings) => {
		const { defaults: siteDefaults, ...organizerData } = settings;
		setOrganizer(organizerData);
		setDefaults(siteDefaults);
	};

	useEffect(() => {
		loadOrganizerSettings()
			.then((settings) => {
				applySettings(settings);
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

	useEffect(() => {
		if (!organizer) {
			return;
		}

		const effectiveLogoId = organizer.logo_id || defaults.logoId;
		loadAttachmentUrl(effectiveLogoId).then(setLogoPreviewUrl);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [organizer && organizer.logo_id, defaults.logoId]);

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
	const hasInvalidWebsite = organizer && !isValidLink(organizer.website);

	const handleSave = () => {
		setIsSaving(true);

		saveSettings({ fair_events_organizer: organizer })
			.then(() => loadOrganizerSettings())
			.then((settings) => {
				applySettings(settings);
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
							placeholder={defaults.name}
							value={organizer.name}
							onChange={(value) => updateField('name', value)}
							disabled={isSaving}
						/>
						<TextControl
							type="url"
							label={__('Website', 'fair-events')}
							placeholder={defaults.website}
							value={organizer.website}
							onChange={(value) => updateField('website', value)}
							disabled={isSaving}
							help={
								hasInvalidWebsite
									? __(
											'Enter a valid URL, e.g. https://example.com.',
											'fair-events'
									  )
									: undefined
							}
							className={
								hasInvalidWebsite ? 'has-error' : undefined
							}
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

						<div style={{ marginTop: '1rem' }}>
							<p
								style={{
									marginBottom: '0.5rem',
									fontWeight: 500,
								}}
							>
								{__('Logo', 'fair-events')}
							</p>
							<HStack alignment="left">
								{logoPreviewUrl && (
									<img
										src={logoPreviewUrl}
										alt=""
										style={{
											maxWidth: '80px',
											maxHeight: '80px',
											objectFit: 'contain',
										}}
									/>
								)}
								<Button
									variant="secondary"
									onClick={() =>
										openMediaPicker({
											title: __(
												'Select logo',
												'fair-events'
											),
											button: __(
												'Use image',
												'fair-events'
											),
											type: 'image',
											onSelect(attachment) {
												updateField(
													'logo_id',
													attachment.id
												);
												setLogoPreviewUrl(
													attachment.url
												);
											},
										})
									}
									disabled={isSaving}
								>
									{__('Change image', 'fair-events')}
								</Button>
								{!!organizer.logo_id && (
									<Button
										variant="tertiary"
										isDestructive
										onClick={() =>
											setRemoveLogoDialogOpen(true)
										}
										disabled={isSaving}
									>
										{__('Remove', 'fair-events')}
									</Button>
								)}
							</HStack>
							<p className="description">
								{__(
									"Falls back to the site's logo when not overridden.",
									'fair-events'
								)}
							</p>
						</div>
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

				<Card>
					<CardHeader>
						<h2>{__('Contact point', 'fair-events')}</h2>
					</CardHeader>
					<CardBody>
						<p className="description">
							{__(
								'Optional contact details for the organization, shown alongside its structured data.',
								'fair-events'
							)}
						</p>
						<TextControl
							type="email"
							label={__('Contact email', 'fair-events')}
							value={organizer.contact_email}
							onChange={(value) =>
								updateField('contact_email', value)
							}
							disabled={isSaving}
						/>
						<TextControl
							type="tel"
							label={__('Contact phone', 'fair-events')}
							value={organizer.contact_phone}
							onChange={(value) =>
								updateField('contact_phone', value)
							}
							disabled={isSaving}
						/>
					</CardBody>
				</Card>

				<div>
					<Button
						variant="primary"
						type="submit"
						isBusy={isSaving}
						disabled={
							isSaving || hasInvalidLink || hasInvalidWebsite
						}
					>
						{isSaving
							? __('Saving...', 'fair-events')
							: __('Save organizer', 'fair-events')}
					</Button>
					{(hasInvalidLink || hasInvalidWebsite) && (
						<p className="description">
							{__(
								'Fix the invalid link(s) above before saving.',
								'fair-events'
							)}
						</p>
					)}
				</div>
			</VStack>
			<ConfirmDialog
				isOpen={removeLogoDialogOpen}
				onConfirm={() => {
					updateField('logo_id', 0);
					setRemoveLogoDialogOpen(false);
				}}
				onCancel={() => setRemoveLogoDialogOpen(false)}
				confirmButtonText={__('Remove logo', 'fair-events')}
				cancelButtonText={__('Cancel', 'fair-events')}
			>
				{__('Remove organizer logo?', 'fair-events')}
			</ConfirmDialog>
		</form>
	);
}
