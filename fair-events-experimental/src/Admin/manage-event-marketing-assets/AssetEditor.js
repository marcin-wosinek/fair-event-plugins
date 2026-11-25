/**
 * Marketing assets - editor
 *
 * Form for one asset: use case, plain text, an optional PNG/JPEG image from
 * the Media Library, team members and a schedule item. The parent owns the
 * form state so an unsaved edit can be parked while another tab is open.
 *
 * @package FairEventsExperimental
 */

import {
	Card,
	CardBody,
	CardHeader,
	Button,
	Notice,
	TextControl,
	TextareaControl,
	CheckboxControl,
	SelectControl,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import {
	imageFromAttachment,
	memberName,
	publicationNeeds,
	saveBlocker,
} from './assetsModel.js';

/**
 * Open the Media Library to choose or upload one image.
 *
 * @param {Object}   options
 * @param {string}   options.title     Frame title.
 * @param {string}   options.button    Select button label.
 * @param {string[]} options.mimeTypes Accepted MIME types.
 * @param {Function} options.onSelect  Receives the chosen attachment.
 * @return {boolean} False when the Media Library is not available.
 */
export function openMediaFrame( { title, button, mimeTypes, onSelect } ) {
	const media = window.wp?.media;
	if ( typeof media !== 'function' ) {
		return false;
	}
	const frame = media( {
		title,
		button: { text: button },
		library: { type: mimeTypes },
		multiple: false,
	} );
	frame.on( 'select', () => {
		const attachment = frame.state().get( 'selection' ).first();
		if ( attachment ) {
			onSelect( attachment.toJSON() );
		}
	} );
	frame.open();
	return true;
}

const imageProblem = ( image ) => {
	if ( image.unavailable_reason === 'unsupported_type' ) {
		return __(
			'Only PNG and JPEG images can be used. Choose another image.',
			'fair-events-experimental'
		);
	}
	if ( image.unavailable_reason === 'trashed' ) {
		return __(
			'This image is in the Media Library trash. Restore it there or choose another image.',
			'fair-events-experimental'
		);
	}
	return __(
		'This image is no longer available in the Media Library. Choose another image or remove it.',
		'fair-events-experimental'
	);
};

export default function AssetEditor( {
	form,
	original,
	isNew,
	imageRemoved,
	options,
	linkedMembers,
	linkedScheduleItem,
	saving,
	error,
	onChange,
	onMediaUnavailable,
	onSave,
	onCancel,
} ) {
	const mimeTypes = options.supported_mime_types;
	const set = ( changes ) => onChange( { ...form, ...changes } );
	const canAddMembers = options.team.available;
	const needs = publicationNeeds(
		form,
		isNew ? null : original,
		linkedMembers
	);

	const blocker = saveBlocker(
		form,
		{
			label: __(
				'Enter what the asset is for to save it.',
				'fair-events-experimental'
			),
			content: imageRemoved
				? __(
						'The image of this asset was deleted from the Media Library. Add text or choose another image to save it.',
						'fair-events-experimental'
					)
				: __(
						'Add text, an image, or both to save the asset.',
						'fair-events-experimental'
					),
			image: __(
				'Replace or remove the image that cannot be used to save the asset.',
				'fair-events-experimental'
			),
			tooLong: __(
				'Shorten the use case or the text to save the asset.',
				'fair-events-experimental'
			),
			publication: __(
				'Confirm that the names of the team members you added will be public to save the asset, or remove them.',
				'fair-events-experimental'
			),
		},
		{
			maxLabel: options.max_label_length,
			maxText: options.max_text_length,
		},
		needs
	);

	const chooseImage = () => {
		const opened = openMediaFrame( {
			title: __( 'Choose an image', 'fair-events-experimental' ),
			button: __( 'Use this image', 'fair-events-experimental' ),
			mimeTypes,
			onSelect: ( attachment ) =>
				set( { image: imageFromAttachment( attachment, mimeTypes ) } ),
		} );
		if ( ! opened ) {
			onMediaUnavailable();
		}
	};

	// Members: the team, plus linked members it no longer offers (they can
	// only be removed).
	const teamMembers = options.team.members;
	const offered = [ ...teamMembers ];
	linkedMembers.forEach( ( member ) => {
		if ( ! offered.some( ( other ) => other.id === member.id ) ) {
			offered.push( member );
		}
	} );
	const nameOf = ( id ) => {
		const member = offered.find( ( other ) => other.id === id );
		return member ? memberName( member ) : '';
	};
	const becomingPublic = [ ...needs.added, ...needs.unpublished ];
	const offerPublication = canAddMembers && becomingPublic.length > 0;

	const scheduleItems = [ ...options.schedule.items ];
	if (
		linkedScheduleItem &&
		! scheduleItems.some( ( item ) => item.id === linkedScheduleItem.id )
	) {
		scheduleItems.push( linkedScheduleItem );
	}
	const scheduleOptions = [
		{
			value: '',
			label: __( 'No schedule item', 'fair-events-experimental' ),
		},
		...scheduleItems.map( ( item ) => ( {
			value: String( item.id ),
			label:
				item.title ||
				__( '(untitled schedule item)', 'fair-events-experimental' ),
		} ) ),
	];
	const canPickSchedule = options.schedule.available;

	const fieldErrors = error?.params || {};

	return (
		<Card className="fair-events-marketing-editor">
			<CardHeader>
				<h3>
					{ isNew
						? __(
								'New marketing asset',
								'fair-events-experimental'
							)
						: sprintf(
								/* translators: %s: asset use case */
								__( 'Edit %s', 'fair-events-experimental' ),
								form.label.trim() ||
									__(
										'(no use case)',
										'fair-events-experimental'
									)
							) }
				</h3>
			</CardHeader>
			<CardBody>
				<VStack spacing={ 4 }>
					<Notice status="info" isDismissible={ false }>
						{ __(
							'Everything in this asset — its use case, text and image — is shown on this date’s public marketing assets page as soon as it is saved, even before the event is published. Anyone can open that page without an account.',
							'fair-events-experimental'
						) }
					</Notice>

					<TextControl
						label={ __( 'Use case', 'fair-events-experimental' ) }
						value={ form.label }
						onChange={ ( label ) => set( { label } ) }
						help={
							fieldErrors.label ||
							__(
								'What the asset is for, such as "Instagram post", "WhatsApp status" or "WhatsApp group message".',
								'fair-events-experimental'
							)
						}
						maxLength={ options.max_label_length }
						disabled={ saving }
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>

					<TextareaControl
						label={ __( 'Text', 'fair-events-experimental' ) }
						value={ form.text }
						onChange={ ( text ) => set( { text } ) }
						help={
							fieldErrors.text ||
							__(
								'Plain text, saved exactly as typed: emoji, spacing and line breaks are kept.',
								'fair-events-experimental'
							)
						}
						rows={ 8 }
						disabled={ saving }
						className="fair-events-marketing-text"
						__nextHasNoMarginBottom
					/>

					<fieldset className="fair-events-marketing-fieldset">
						<legend>
							{ __( 'Image', 'fair-events-experimental' ) }
						</legend>
						<Notice status="info" isDismissible={ false }>
							{ __(
								'Images are ordinary Media Library files. Anyone with an image’s link can open it as soon as it is uploaded, even before the event is published. Removing the image, deleting this asset or turning off marketing assets keeps the file and its link working; delete it in the Media Library to remove it.',
								'fair-events-experimental'
							) }
						</Notice>
						{ imageRemoved && ! form.image && (
							<Notice status="warning" isDismissible={ false }>
								{ __(
									'Image removed: the image was deleted from the Media Library.',
									'fair-events-experimental'
								) }
							</Notice>
						) }
						{ form.image && (
							<div className="fair-events-marketing-image">
								{ form.image.available && form.image.url && (
									<img
										src={ form.image.url }
										alt={ form.image.alt || '' }
									/>
								) }
								<div>
									<p className="fair-events-marketing-image-name">
										{ form.image.title ||
											__(
												'(untitled image)',
												'fair-events-experimental'
											) }
									</p>
									{ ! form.image.available && (
										<p className="fair-events-marketing-problem">
											{ imageProblem( form.image ) }
										</p>
									) }
								</div>
							</div>
						) }
						<div className="fair-events-marketing-buttons">
							<Button
								variant="secondary"
								onClick={ chooseImage }
								disabled={ saving }
							>
								{ form.image
									? __(
											'Replace image',
											'fair-events-experimental'
										)
									: __(
											'Choose or upload image',
											'fair-events-experimental'
										) }
							</Button>
							{ form.image && (
								<Button
									variant="tertiary"
									isDestructive
									onClick={ () => set( { image: null } ) }
									disabled={ saving }
								>
									{ __(
										'Remove image',
										'fair-events-experimental'
									) }
								</Button>
							) }
						</div>
						{ fieldErrors.attachment_id && (
							<p className="fair-events-marketing-problem">
								{ fieldErrors.attachment_id }
							</p>
						) }
					</fieldset>

					<fieldset className="fair-events-marketing-fieldset">
						<legend>
							{ __( 'Team members', 'fair-events-experimental' ) }
						</legend>
						<p
							className="fair-events-marketing-hint"
							id="fair-events-marketing-members-disclosure"
						>
							{ __(
								'The name and surname of each linked team member are shown on the public marketing assets page, and visitors can filter the assets by them. You confirm this when you save. Contact details are never shown.',
								'fair-events-experimental'
							) }
						</p>
						{ ! canAddMembers && (
							<p className="fair-events-marketing-hint">
								{ __(
									'Team management is turned off, so no team members can be added. Members already linked can be removed.',
									'fair-events-experimental'
								) }
							</p>
						) }
						{ canAddMembers && offered.length === 0 && (
							<p className="fair-events-marketing-hint">
								{ __(
									'This event has no team yet. Add team members in Event Details to link them here.',
									'fair-events-experimental'
								) }
							</p>
						) }
						{ offered
							.filter(
								( member ) =>
									canAddMembers ||
									form.memberIds.includes( member.id ) ||
									linkedMembers.some(
										( other ) => other.id === member.id
									)
							)
							.map( ( member ) => {
								const checked = form.memberIds.includes(
									member.id
								);
								const onTeam = teamMembers.some(
									( other ) => other.id === member.id
								);
								const notPublic = linkedMembers.some(
									( other ) =>
										other.id === member.id &&
										false === other.public
								);
								return (
									<CheckboxControl
										key={ member.id }
										label={
											notPublic
												? sprintf(
														/* translators: %s: team member name */
														__(
															'%s (name not public)',
															'fair-events-experimental'
														),
														memberName( member )
													)
												: memberName( member )
										}
										checked={ checked }
										disabled={
											saving ||
											( ! checked &&
												( ! canAddMembers ||
													! onTeam ) )
										}
										onChange={ ( isChecked ) =>
											set( {
												memberIds: isChecked
													? [
															...form.memberIds,
															member.id,
														]
													: form.memberIds.filter(
															( id ) =>
																id !== member.id
														),
											} )
										}
										__nextHasNoMarginBottom
									/>
								);
							} ) }
						{ offerPublication && (
							<CheckboxControl
								label={ __(
									'Show these names on the public marketing assets page',
									'fair-events-experimental'
								) }
								help={
									needs.added.length > 0
										? sprintf(
												/* translators: %s: comma-separated team member names */
												__(
													'Required to link new team members. Becomes public: %s.',
													'fair-events-experimental'
												),
												becomingPublic
													.map( nameOf )
													.join( ', ' )
											)
										: sprintf(
												/* translators: %s: comma-separated team member names */
												__(
													'Optional. Becomes public: %s. Leave it unchecked to keep these names private.',
													'fair-events-experimental'
												),
												becomingPublic
													.map( nameOf )
													.join( ', ' )
											)
								}
								checked={ form.publishMemberNames }
								onChange={ ( publishMemberNames ) =>
									set( { publishMemberNames } )
								}
								disabled={ saving }
								__nextHasNoMarginBottom
							/>
						) }
						{ ! canAddMembers && needs.unpublished.length > 0 && (
							<p className="fair-events-marketing-hint">
								{ __(
									'Names that are not public cannot be published while team management is turned off.',
									'fair-events-experimental'
								) }
							</p>
						) }
						{ fieldErrors.member_ids && (
							<p className="fair-events-marketing-problem">
								{ fieldErrors.member_ids }
							</p>
						) }
					</fieldset>

					<SelectControl
						label={ __(
							'Schedule item',
							'fair-events-experimental'
						) }
						value={
							form.scheduleItemId
								? String( form.scheduleItemId )
								: ''
						}
						options={ scheduleOptions.filter(
							( option ) =>
								canPickSchedule ||
								option.value === '' ||
								option.value ===
									String( linkedScheduleItem?.id || '' )
						) }
						onChange={ ( value ) =>
							set( {
								scheduleItemId: value
									? Number.parseInt( value, 10 )
									: null,
							} )
						}
						help={
							fieldErrors.schedule_item_id ||
							( canPickSchedule
								? __(
										'Optional: the workshop or programme item this asset promotes.',
										'fair-events-experimental'
									)
								: __(
										'This event’s schedule is turned off, so no schedule item can be linked. A linked item can be removed.',
										'fair-events-experimental'
									) )
						}
						disabled={ saving }
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>

					{ error && (
						<Notice status="error" isDismissible={ false }>
							{ error.message }
						</Notice>
					) }

					<div className="fair-events-marketing-buttons">
						<Button
							variant="primary"
							onClick={ onSave }
							isBusy={ saving }
							disabled={ saving || !! blocker }
							accessibleWhenDisabled
							aria-describedby={
								blocker
									? 'fair-events-marketing-save-reason'
									: undefined
							}
						>
							{ isNew
								? __(
										'Create asset',
										'fair-events-experimental'
									)
								: __(
										'Save asset',
										'fair-events-experimental'
									) }
						</Button>
						<Button
							variant="tertiary"
							onClick={ onCancel }
							disabled={ saving }
						>
							{ __( 'Cancel', 'fair-events-experimental' ) }
						</Button>
						{ blocker && (
							<span
								id="fair-events-marketing-save-reason"
								className="fair-events-marketing-hint"
							>
								{ blocker }
							</span>
						) }
					</div>
				</VStack>
			</CardBody>
		</Card>
	);
}
