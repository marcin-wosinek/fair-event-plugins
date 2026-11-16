/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
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
import ConfirmActionModal from '../components/ConfirmActionModal.js';
import { loadAttachmentUrl } from './settings-api.js';

/**
 * Blank organizer: every field the form edits, with its empty value.
 */
export const EMPTY_ORGANIZER = Object.freeze( {
	name: '',
	type: 'Organization',
	street_address: '',
	address_locality: '',
	address_region: '',
	postal_code: '',
	address_country: '',
	same_as: [],
	logo_id: 0,
	website: '',
	contact_email: '',
	contact_phone: '',
	notification_emails: [],
} );

/**
 * Open the WordPress media picker and call onSelect with the chosen attachment.
 *
 * @param {Object}   options          Media picker options
 * @param {string}   options.title    Dialog title
 * @param {string}   options.button   Button label
 * @param {string}   options.type     MIME type filter
 * @param {Function} options.onSelect Callback receiving the selected attachment
 */
function openMediaPicker( { title, button, type, onSelect } ) {
	const frame = wp.media( {
		title,
		button: { text: button },
		library: { type },
		multiple: false,
	} );
	frame.on( 'select', () => {
		const attachment = frame.state().get( 'selection' ).first().toJSON();
		onSelect( attachment );
	} );
	frame.open();
}

/**
 * Whether a `sameAs` entry is either empty (dropped on save) or a valid
 * absolute http(s) URL.
 *
 * @param {string} value Entry value.
 * @return {boolean} True when the entry doesn't block saving.
 */
function isValidLink( value ) {
	if ( '' === value.trim() ) {
		return true;
	}

	try {
		const url = new URL( value );
		return 'http:' === url.protocol || 'https:' === url.protocol;
	} catch ( e ) {
		return false;
	}
}

/**
 * Whether a notification recipient row is either empty (ignored on save) or
 * a plausible email address. The server's `format: email` check is the
 * authority; this mirrors it closely enough to block obvious mistakes.
 *
 * @param {string} value Entry value.
 * @return {boolean} True when the entry doesn't block saving.
 */
function isValidEmail( value ) {
	const trimmed = value.trim();
	if ( '' === trimmed ) {
		return true;
	}

	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test( trimmed );
}

/**
 * Build the save payload: trim notification recipients and drop empty rows.
 * The server normalizes the rest (duplicates), and the reload shows it.
 *
 * @param {Object} organizer Organizer form state.
 * @return {Object} Organizer payload.
 */
export function toSavePayload( organizer ) {
	return {
		...organizer,
		notification_emails: organizer.notification_emails
			.map( ( email ) => email.trim() )
			.filter( ( email ) => '' !== email ),
	};
}

/**
 * Organizer Form Component
 *
 * Controlled form for one organizer's identity (name, address, type,
 * social/profile links, logo, contact point) plus its private notification
 * recipients. The Organizer settings tab uses it for the sitewide organizer;
 * Fair Events Experimental reuses it for additional organizers.
 *
 * @param {Object}      props             Props
 * @param {Object}      props.organizer   Organizer being edited
 * @param {Function}    props.onChange    Receives the next organizer state
 * @param {Function}    props.onSubmit    Called when the form is submitted
 * @param {boolean}     props.isSaving    Whether a save is running
 * @param {Object|null} props.defaults    Site values a blank field falls back to (`{ name, website, logoId }`), or null when blank fields stay unset
 * @param {JSX.Element} props.intro       Optional replacement for the identity description
 * @param {boolean}     props.requireName Whether a blank name blocks saving
 * @return {JSX.Element} The organizer form
 */
export default function OrganizerForm( {
	organizer,
	onChange,
	onSubmit,
	isSaving,
	defaults = null,
	intro,
	requireName = false,
} ) {
	const [ logoPreviewUrl, setLogoPreviewUrl ] = useState( '' );
	const [ removeLogoDialogOpen, setRemoveLogoDialogOpen ] = useState( false );
	const fallbackLogoId = defaults ? defaults.logoId : 0;
	const fallbackName = defaults ? defaults.name : '';

	useEffect( () => {
		let current = true;
		loadAttachmentUrl( organizer.logo_id || fallbackLogoId ).then(
			( url ) => {
				if ( current ) {
					setLogoPreviewUrl( url );
				}
			}
		);
		return () => {
			current = false;
		};
	}, [ organizer.logo_id, fallbackLogoId ] );

	const updateField = ( field, value ) => {
		onChange( { ...organizer, [ field ]: value } );
	};

	const updateLink = ( index, value ) => {
		const sameAs = [ ...organizer.same_as ];
		sameAs[ index ] = value;
		updateField( 'same_as', sameAs );
	};

	const addLink = () => {
		updateField( 'same_as', [ ...organizer.same_as, '' ] );
	};

	const removeLink = ( index ) => {
		updateField(
			'same_as',
			organizer.same_as.filter( ( _, i ) => i !== index )
		);
	};

	const updateEmail = ( index, value ) => {
		const emails = [ ...organizer.notification_emails ];
		emails[ index ] = value;
		updateField( 'notification_emails', emails );
	};

	const addEmail = () => {
		updateField( 'notification_emails', [
			...organizer.notification_emails,
			'',
		] );
	};

	const removeEmail = ( index ) => {
		updateField(
			'notification_emails',
			organizer.notification_emails.filter( ( _, i ) => i !== index )
		);
	};

	const hasInvalidLink = organizer.same_as.some(
		( url ) => ! isValidLink( url )
	);
	const hasInvalidWebsite = ! isValidLink( organizer.website );
	const hasInvalidEmail = organizer.notification_emails.some(
		( email ) => ! isValidEmail( email )
	);
	const isMissingName = requireName && '' === organizer.name.trim();

	let removeLogoConsequence = __(
		'The organizer will have no logo. The image you remove here stays in the Media Library.',
		'fair-events'
	);
	if ( defaults && defaults.logoId ) {
		removeLogoConsequence = __(
			"The organizer will use the site's logo instead. The image you remove here stays in the Media Library.",
			'fair-events'
		);
	} else if ( defaults ) {
		removeLogoConsequence = __(
			'The site has no logo of its own, so the organizer will have no logo. The image you remove here stays in the Media Library.',
			'fair-events'
		);
	}

	return (
		<form
			onSubmit={ ( e ) => {
				e.preventDefault();
				onSubmit();
			} }
		>
			<VStack spacing={ 4 } style={ { marginTop: '16px' } }>
				<Card>
					<CardHeader>
						<h2>{ __( 'Identity', 'fair-events' ) }</h2>
					</CardHeader>
					<CardBody>
						{ intro || (
							<p className="description">
								{ __(
									"This identity is used to build a sitewide Schema.org Organization block and to identify the event organizer, taking the place of the site name and home URL. Everything here is optional; leave it blank to keep today's behaviour.",
									'fair-events'
								) }
							</p>
						) }
						<TextControl
							label={
								requireName
									? __( 'Name (required)', 'fair-events' )
									: __( 'Name', 'fair-events' )
							}
							placeholder={ fallbackName }
							value={ organizer.name }
							onChange={ ( value ) =>
								updateField( 'name', value )
							}
							disabled={ isSaving }
							help={
								isMissingName
									? __(
											'Enter a name for this organizer.',
											'fair-events'
										)
									: undefined
							}
						/>
						<TextControl
							type="url"
							label={ __( 'Website', 'fair-events' ) }
							placeholder={ defaults ? defaults.website : '' }
							value={ organizer.website }
							onChange={ ( value ) =>
								updateField( 'website', value )
							}
							disabled={ isSaving }
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
							label={ __( 'Organization type', 'fair-events' ) }
							value={ organizer.type }
							options={ [
								{
									label: __( 'Organization', 'fair-events' ),
									value: 'Organization',
								},
								{
									label: __( 'Sports club', 'fair-events' ),
									value: 'SportsClub',
								},
							] }
							onChange={ ( value ) =>
								updateField( 'type', value )
							}
							disabled={ isSaving }
						/>

						<div style={ { marginTop: '1rem' } }>
							<p
								style={ {
									marginBottom: '0.5rem',
									fontWeight: 500,
								} }
							>
								{ __( 'Logo', 'fair-events' ) }
							</p>
							<HStack alignment="left">
								{ logoPreviewUrl && (
									<img
										src={ logoPreviewUrl }
										alt=""
										style={ {
											maxWidth: '80px',
											maxHeight: '80px',
											objectFit: 'contain',
										} }
									/>
								) }
								<Button
									variant="secondary"
									onClick={ () =>
										openMediaPicker( {
											title: __(
												'Select logo',
												'fair-events'
											),
											button: __(
												'Use image',
												'fair-events'
											),
											type: 'image',
											onSelect( attachment ) {
												updateField(
													'logo_id',
													attachment.id
												);
												setLogoPreviewUrl(
													attachment.url
												);
											},
										} )
									}
									disabled={ isSaving }
								>
									{ __( 'Change image', 'fair-events' ) }
								</Button>
								{ !! organizer.logo_id && (
									<Button
										variant="tertiary"
										isDestructive
										onClick={ () =>
											setRemoveLogoDialogOpen( true )
										}
										disabled={ isSaving }
									>
										{ __( 'Remove', 'fair-events' ) }
									</Button>
								) }
							</HStack>
							{ defaults && (
								<p className="description">
									{ __(
										"Falls back to the site's logo when not overridden.",
										'fair-events'
									) }
								</p>
							) }
						</div>
					</CardBody>
				</Card>

				<Card>
					<CardHeader>
						<h2>{ __( 'Address', 'fair-events' ) }</h2>
					</CardHeader>
					<CardBody>
						<TextControl
							label={ __( 'Street address', 'fair-events' ) }
							value={ organizer.street_address }
							onChange={ ( value ) =>
								updateField( 'street_address', value )
							}
							disabled={ isSaving }
						/>
						<TextControl
							label={ __( 'City', 'fair-events' ) }
							value={ organizer.address_locality }
							onChange={ ( value ) =>
								updateField( 'address_locality', value )
							}
							disabled={ isSaving }
						/>
						<TextControl
							label={ __( 'Region', 'fair-events' ) }
							value={ organizer.address_region }
							onChange={ ( value ) =>
								updateField( 'address_region', value )
							}
							disabled={ isSaving }
						/>
						<TextControl
							label={ __( 'Postal code', 'fair-events' ) }
							value={ organizer.postal_code }
							onChange={ ( value ) =>
								updateField( 'postal_code', value )
							}
							disabled={ isSaving }
						/>
						<TextControl
							label={ __( 'Country', 'fair-events' ) }
							help={ __(
								'Use a two-letter code, e.g. ES.',
								'fair-events'
							) }
							value={ organizer.address_country }
							onChange={ ( value ) =>
								updateField( 'address_country', value )
							}
							disabled={ isSaving }
						/>
					</CardBody>
				</Card>

				<Card>
					<CardHeader>
						<h2>
							{ __( 'Social & profile links', 'fair-events' ) }
						</h2>
					</CardHeader>
					<CardBody>
						<p className="description">
							{ __(
								'Links to social media profiles or other pages that identify the organization (Instagram, Facebook, etc.).',
								'fair-events'
							) }
						</p>

						<VStack spacing={ 2 }>
							{ organizer.same_as.map( ( url, index ) => {
								const invalid = ! isValidLink( url );
								return (
									// eslint-disable-next-line react/no-array-index-key
									<HStack key={ index } alignment="top">
										<TextControl
											type="url"
											label={ __(
												'Profile URL',
												'fair-events'
											) }
											hideLabelFromVision
											value={ url }
											onChange={ ( value ) =>
												updateLink( index, value )
											}
											disabled={ isSaving }
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
											onClick={ () =>
												removeLink( index )
											}
											disabled={ isSaving }
										>
											{ __( 'Remove', 'fair-events' ) }
										</Button>
									</HStack>
								);
							} ) }
						</VStack>

						<Button
							variant="secondary"
							onClick={ addLink }
							disabled={ isSaving }
							style={ { marginTop: '0.5rem' } }
						>
							{ __( 'Add link', 'fair-events' ) }
						</Button>
					</CardBody>
				</Card>

				<Card>
					<CardHeader>
						<h2>{ __( 'Contact point', 'fair-events' ) }</h2>
					</CardHeader>
					<CardBody>
						<p className="description">
							{ __(
								'Optional contact details for the organization, shown alongside its structured data.',
								'fair-events'
							) }
						</p>
						<TextControl
							type="email"
							label={ __( 'Contact email', 'fair-events' ) }
							value={ organizer.contact_email }
							onChange={ ( value ) =>
								updateField( 'contact_email', value )
							}
							disabled={ isSaving }
						/>
						<TextControl
							type="tel"
							label={ __( 'Contact phone', 'fair-events' ) }
							value={ organizer.contact_phone }
							onChange={ ( value ) =>
								updateField( 'contact_phone', value )
							}
							disabled={ isSaving }
						/>
					</CardBody>
				</Card>

				<Card>
					<CardHeader>
						<h2>
							{ __(
								'Notification email addresses',
								'fair-events'
							) }
						</h2>
					</CardHeader>
					<CardBody>
						<p className="description">
							{ __(
								'Private addresses for notifications sent to the organizer. Unlike the public contact email, they are never shown on the site or in its structured data.',
								'fair-events'
							) }
						</p>

						<VStack spacing={ 2 }>
							{ organizer.notification_emails.map(
								( email, index ) => {
									const invalid = ! isValidEmail( email );
									return (
										<HStack key={ index } alignment="top">
											<TextControl
												type="email"
												label={ __(
													'Notification email address',
													'fair-events'
												) }
												hideLabelFromVision
												value={ email }
												onChange={ ( value ) =>
													updateEmail( index, value )
												}
												disabled={ isSaving }
												help={
													invalid
														? __(
																'Enter a valid email address, e.g. team@example.com.',
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
												label={ __(
													'Remove email address',
													'fair-events'
												) }
												onClick={ () =>
													removeEmail( index )
												}
												disabled={ isSaving }
											>
												{ __(
													'Remove',
													'fair-events'
												) }
											</Button>
										</HStack>
									);
								}
							) }
						</VStack>

						<Button
							variant="secondary"
							onClick={ addEmail }
							disabled={ isSaving }
							style={ { marginTop: '0.5rem' } }
						>
							{ __( 'Add email address', 'fair-events' ) }
						</Button>
					</CardBody>
				</Card>

				<div>
					<Button
						variant="primary"
						type="submit"
						isBusy={ isSaving }
						disabled={
							isSaving ||
							isMissingName ||
							hasInvalidLink ||
							hasInvalidWebsite ||
							hasInvalidEmail
						}
					>
						{ isSaving
							? __( 'Saving...', 'fair-events' )
							: __( 'Save organizer', 'fair-events' ) }
					</Button>
					{ isMissingName && (
						<p className="description">
							{ __(
								'Enter a name before saving.',
								'fair-events'
							) }
						</p>
					) }
					{ ( hasInvalidLink || hasInvalidWebsite ) && (
						<p className="description">
							{ __(
								'Fix the invalid link(s) above before saving.',
								'fair-events'
							) }
						</p>
					) }
					{ hasInvalidEmail && (
						<p className="description">
							{ __(
								'Fix the invalid notification email address(es) above before saving.',
								'fair-events'
							) }
						</p>
					) }
				</div>
			</VStack>
			{ removeLogoDialogOpen && (
				<ConfirmActionModal
					title={ __( 'Remove organizer logo?', 'fair-events' ) }
					confirmLabel={ __( 'Remove logo', 'fair-events' ) }
					isDestructive
					onConfirm={ () => {
						updateField( 'logo_id', 0 );
						setRemoveLogoDialogOpen( false );
					} }
					onCancel={ () => setRemoveLogoDialogOpen( false ) }
				>
					<p style={ { margin: 0 } }>
						{ organizer.name || fallbackName
							? sprintf(
									/* translators: %s: organizer name */
									__(
										'Remove the logo chosen for the organizer %s?',
										'fair-events'
									),
									organizer.name || fallbackName
								)
							: __(
									'Remove the logo chosen for the organizer?',
									'fair-events'
								) }
					</p>
					<p style={ { margin: 0 } }>{ removeLogoConsequence }</p>
					<p style={ { margin: 0 } }>
						{ __(
							'Nothing is saved until you select Save organizer.',
							'fair-events'
						) }
					</p>
				</ConfirmActionModal>
			) }
		</form>
	);
}
