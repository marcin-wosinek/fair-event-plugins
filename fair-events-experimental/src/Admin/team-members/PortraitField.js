/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useEffect, useState } from '@wordpress/element';
import {
	Button,
	__experimentalHStack as HStack,
	__experimentalVStack as VStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import { loadAttachmentUrl } from './team-members-api.js';

/**
 * Open the Media Library to choose one image.
 *
 * @param {Function} onSelect Receives the chosen attachment.
 * @return {boolean} False when the Media Library is not available.
 */
function choosePortrait( onSelect ) {
	const media = window.wp?.media;
	if ( typeof media !== 'function' ) {
		return false;
	}
	const frame = media( {
		title: __( 'Choose portrait', 'fair-events-experimental' ),
		button: { text: __( 'Use as portrait', 'fair-events-experimental' ) },
		library: { type: 'image' },
		multiple: false,
	} );
	frame.on( 'select', () => {
		onSelect( frame.state().get( 'selection' ).first().toJSON() );
	} );
	frame.open();
	return true;
}

/**
 * Portrait of a team member: a Media Library image with a preview and
 * choose, replace and remove actions. Removing only detaches the image;
 * it stays in the Media Library.
 *
 * @param {Object}           props          Component props.
 * @param {number}           props.value    Attachment ID, or 0 for none.
 * @param {Function}         props.onChange Receives the next attachment ID.
 * @param {boolean}          props.disabled Whether a save runs.
 * @param {string|undefined} props.error    Field error from the server.
 * @return {JSX.Element} The field.
 */
export default function PortraitField( { value, onChange, disabled, error } ) {
	// `{ id, url }` of the last preview read; `url` is null when the image
	// can't be read.
	const [ preview, setPreview ] = useState( null );
	const [ pickerMissing, setPickerMissing ] = useState( false );

	useEffect( () => {
		if ( ! value || preview?.id === value ) {
			return undefined;
		}
		let current = true;
		const show = ( url ) => {
			if ( current ) {
				setPreview( { id: value, url } );
			}
		};
		loadAttachmentUrl( value ).then( show, () => show( null ) );
		return () => {
			current = false;
		};
	}, [ value, preview ] );

	const open = () => {
		const opened = choosePortrait( ( attachment ) => {
			setPreview( { id: attachment.id, url: attachment.url || null } );
			onChange( attachment.id );
		} );
		setPickerMissing( ! opened );
	};

	const shown = value && preview?.id === value ? preview : null;
	const unavailable = !! shown && ! shown.url;

	return (
		<VStack
			spacing={ 2 }
			className="fair-events-team-member-form__portrait"
		>
			<p className="fair-events-team-member-form__label">
				{ __( 'Portrait', 'fair-events-experimental' ) }
			</p>
			<HStack alignment="left" wrap>
				{ shown?.url && (
					<img
						src={ shown.url }
						alt={ __(
							'Portrait preview',
							'fair-events-experimental'
						) }
						className="fair-events-team-member-form__portrait-preview"
					/>
				) }
				<Button
					variant="secondary"
					onClick={ open }
					disabled={ disabled }
					accessibleWhenDisabled
					__next40pxDefaultSize
				>
					{ value
						? __( 'Replace portrait', 'fair-events-experimental' )
						: __( 'Choose portrait', 'fair-events-experimental' ) }
				</Button>
				{ !! value && (
					<Button
						variant="tertiary"
						isDestructive
						onClick={ () => onChange( 0 ) }
						disabled={ disabled }
						accessibleWhenDisabled
						__next40pxDefaultSize
					>
						{ __( 'Remove portrait', 'fair-events-experimental' ) }
					</Button>
				) }
			</HStack>
			{ unavailable && (
				<p className="fair-events-team-member-form__error">
					{ __(
						'This image is no longer available in the Media Library, so it is left out of promotional material. Restore it there, or replace or remove it here.',
						'fair-events-experimental'
					) }
				</p>
			) }
			{ pickerMissing && (
				<p className="fair-events-team-member-form__error">
					{ __(
						'The Media Library could not be opened. Reload the page and try again.',
						'fair-events-experimental'
					) }
				</p>
			) }
			{ error && (
				<p className="fair-events-team-member-form__error">{ error }</p>
			) }
			<p className="description" style={ { margin: 0 } }>
				{ __(
					'Removing the portrait keeps the image in the Media Library. Anyone with its direct address can open it, as with other images on this site.',
					'fair-events-experimental'
				) }
			</p>
		</VStack>
	);
}
