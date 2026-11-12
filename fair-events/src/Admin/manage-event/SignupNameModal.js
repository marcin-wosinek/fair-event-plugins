/**
 * Edit a registration's name and surname (#2215).
 *
 * Changes the registration only: a linked Fair Audience profile keeps its
 * own name.
 *
 * @package FairEvents
 */

import { useRef, useState } from '@wordpress/element';
import {
	Modal,
	Button,
	Flex,
	FlexItem,
	Notice,
	TextControl,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { WrappingModalStyle, WRAPPING_MODAL_CLASS } from 'fair-events-shared';
import { signupFullName } from './signup-name.js';

/**
 * Request body of a name edit: the trimmed name and surname. An empty
 * surname is sent, so it clears the stored one.
 *
 * @param {string} name    Name as typed.
 * @param {string} surname Surname as typed.
 * @return {{name: string, surname: string}} Request data.
 */
export function nameEditData( name, surname ) {
	return {
		name: String( name ?? '' ).trim(),
		surname: String( surname ?? '' ).trim(),
	};
}

export default function SignupNameModal( { signup, onClose, onSaved } ) {
	const [ name, setName ] = useState( signup.name || '' );
	const [ surname, setSurname ] = useState( signup.surname || '' );
	const [ saving, setSaving ] = useState( false );
	const [ saveError, setSaveError ] = useState( null );
	// Refuses a second submission before the first one re-rendered the popup.
	const inFlight = useRef( false );

	const nameMissing = name.trim() === '';

	// The outcome of a dismissed request would be unknown to the user.
	const close = () => {
		if ( ! saving ) {
			onClose();
		}
	};

	const save = async () => {
		if ( inFlight.current || nameMissing ) {
			return;
		}
		inFlight.current = true;
		setSaving( true );
		setSaveError( null );
		try {
			const updated = await apiFetch( {
				path: `/fair-events/v1/get-tickets/${ signup.id }`,
				method: 'PUT',
				data: nameEditData( name, surname ),
			} );
			onSaved( updated );
		} catch ( err ) {
			setSaveError(
				err?.message ||
					__(
						'The name could not be saved. Please try again.',
						'fair-events'
					)
			);
		} finally {
			inFlight.current = false;
			setSaving( false );
		}
	};

	return (
		<Modal
			title={ sprintf(
				/* translators: %s: registrant's current complete name */
				__( 'Edit name — %s', 'fair-events' ),
				signupFullName( signup ) || __( '(no name)', 'fair-events' )
			) }
			onRequestClose={ close }
			isDismissible={ ! saving }
			shouldCloseOnEsc={ ! saving }
			shouldCloseOnClickOutside={ ! saving }
			size="medium"
			className={ WRAPPING_MODAL_CLASS }
		>
			<WrappingModalStyle />
			<form
				onSubmit={ ( event ) => {
					event.preventDefault();
					save();
				} }
			>
				<p>
					{ __(
						'This changes the name on this registration only. A linked audience profile keeps its own name.',
						'fair-events'
					) }
				</p>
				{ saveError && (
					<Notice status="error" isDismissible={ false }>
						{ saveError }
					</Notice>
				) }
				<TextControl
					__nextHasNoMarginBottom
					__next40pxDefaultSize
					label={ __( 'Name', 'fair-events' ) }
					value={ name }
					onChange={ setName }
					disabled={ saving }
					maxLength={ 255 }
					autoComplete="off"
				/>
				{ nameMissing && (
					<p style={ { color: '#cc1818', margin: '4px 0 0' } }>
						{ __( 'Name is required.', 'fair-events' ) }
					</p>
				) }
				<div style={ { marginTop: '16px' } }>
					<TextControl
						__nextHasNoMarginBottom
						__next40pxDefaultSize
						label={ __( 'Surname (optional)', 'fair-events' ) }
						value={ surname }
						onChange={ setSurname }
						disabled={ saving }
						maxLength={ 255 }
						autoComplete="off"
					/>
				</div>
				<Flex
					justify="flex-end"
					wrap
					gap={ 2 }
					style={ { marginTop: '24px' } }
				>
					<FlexItem>
						<Button
							variant="tertiary"
							onClick={ close }
							disabled={ saving }
						>
							{ __( 'Cancel', 'fair-events' ) }
						</Button>
					</FlexItem>
					<FlexItem>
						<Button
							variant="primary"
							type="submit"
							isBusy={ saving }
							disabled={ saving || nameMissing }
							// Stay focusable while pending, so focus can
							// still return to the trigger afterwards.
							accessibleWhenDisabled={ saving }
						>
							{ __( 'Save name', 'fair-events' ) }
						</Button>
					</FlexItem>
				</Flex>
			</form>
		</Modal>
	);
}
