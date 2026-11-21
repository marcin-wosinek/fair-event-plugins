/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import {
	Button,
	Card,
	CardBody,
	SelectControl,
	TextControl,
	__experimentalVStack as VStack,
} from '@wordpress/components';

/**
 * Help text, or the field's error in its place.
 *
 * @param {string|undefined} error Field error from the server.
 * @param {string}           help  Help text.
 * @return {JSX.Element|string} Help content.
 */
function helpOrError( error, help ) {
	if ( ! error ) {
		return help;
	}
	return (
		<span className="fair-events-team-member-form__error">{ error }</span>
	);
}

/**
 * Editor of one team member profile.
 *
 * Only the name is required. Server-side field errors replace each field's
 * help text, so the typed values stay in place for a retry.
 *
 * @param {Object}   props             Component props.
 * @param {Object}   props.value       Form state.
 * @param {Function} props.onChange    Receives the next form state.
 * @param {Function} props.onSubmit    Saves the form.
 * @param {boolean}  props.isSaving    Whether a save runs.
 * @param {boolean}  props.isNew       Whether the profile is new.
 * @param {Object}   props.errors      Field errors keyed by field.
 * @return {JSX.Element} The form.
 */
export default function TeamMemberForm( {
	value,
	onChange,
	onSubmit,
	isSaving,
	isNew,
	errors = {},
} ) {
	const set = ( field ) => ( next ) =>
		onChange( { ...value, [ field ]: next } );
	const nameMissing = '' === value.name.trim();

	const handleSubmit = ( event ) => {
		event.preventDefault();
		if ( nameMissing || isSaving ) {
			return;
		}
		onSubmit();
	};

	return (
		<form onSubmit={ handleSubmit } noValidate>
			<Card>
				<CardBody>
					<VStack spacing={ 4 }>
						<div className="fair-events-team-member-form__grid">
							<TextControl
								label={ __(
									'Name (required)',
									'fair-events-experimental'
								) }
								value={ value.name }
								onChange={ set( 'name' ) }
								help={ helpOrError(
									errors.name,
									nameMissing
										? __(
												'Enter a name to save.',
												'fair-events-experimental'
											)
										: ''
								) }
								autoComplete="off"
								__next40pxDefaultSize
								__nextHasNoMarginBottom
							/>
							<TextControl
								label={ __(
									'Surname',
									'fair-events-experimental'
								) }
								value={ value.surname }
								onChange={ set( 'surname' ) }
								help={ helpOrError( errors.surname, '' ) }
								autoComplete="off"
								__next40pxDefaultSize
								__nextHasNoMarginBottom
							/>
							<TextControl
								label={ __(
									'Email address',
									'fair-events-experimental'
								) }
								type="email"
								value={ value.email }
								onChange={ set( 'email' ) }
								help={ helpOrError( errors.email, '' ) }
								autoComplete="off"
								__next40pxDefaultSize
								__nextHasNoMarginBottom
							/>
							<TextControl
								label={ __(
									'Phone number',
									'fair-events-experimental'
								) }
								type="tel"
								value={ value.phone }
								onChange={ set( 'phone' ) }
								help={ helpOrError(
									errors.phone,
									__(
										'Include the international prefix, e.g. +34 600 000 000.',
										'fair-events-experimental'
									)
								) }
								autoComplete="off"
								__next40pxDefaultSize
								__nextHasNoMarginBottom
							/>
							<TextControl
								label={ __(
									'Instagram handle',
									'fair-events-experimental'
								) }
								value={ value.instagram }
								onChange={ set( 'instagram' ) }
								help={ helpOrError( errors.instagram, '' ) }
								autoComplete="off"
								__next40pxDefaultSize
								__nextHasNoMarginBottom
							/>
							<TextControl
								label={ __(
									'Facebook profile',
									'fair-events-experimental'
								) }
								type="url"
								value={ value.facebook_url }
								onChange={ set( 'facebook_url' ) }
								help={ helpOrError(
									errors.facebook_url,
									__(
										'The full address, e.g. https://www.facebook.com/name.',
										'fair-events-experimental'
									)
								) }
								autoComplete="off"
								__next40pxDefaultSize
								__nextHasNoMarginBottom
							/>
							<SelectControl
								label={ __(
									'Grammatical gender',
									'fair-events-experimental'
								) }
								value={ value.gender }
								options={ [
									{
										label: __(
											'Not set',
											'fair-events-experimental'
										),
										value: '',
									},
									{
										label: __(
											'Female',
											'fair-events-experimental'
										),
										value: 'female',
									},
									{
										label: __(
											'Male',
											'fair-events-experimental'
										),
										value: 'male',
									},
									{
										label: __(
											'Nonbinary',
											'fair-events-experimental'
										),
										value: 'nonbinary',
									},
								] }
								onChange={ set( 'gender' ) }
								help={ helpOrError(
									errors.gender,
									__(
										'How to word texts that mention this person. Leave it unset until you know.',
										'fair-events-experimental'
									)
								) }
								__next40pxDefaultSize
								__nextHasNoMarginBottom
							/>
						</div>
						<p className="description" style={ { margin: 0 } }>
							{ __(
								'Contact details are visible to administrators only. Adding someone to an event does not publish anything about them.',
								'fair-events-experimental'
							) }
						</p>
						<div>
							<Button
								variant="primary"
								type="submit"
								isBusy={ isSaving }
								disabled={ isSaving || nameMissing }
								accessibleWhenDisabled
								__next40pxDefaultSize
							>
								{ isSaving &&
									__(
										'Saving…',
										'fair-events-experimental'
									) }
								{ ! isSaving &&
									( isNew
										? __(
												'Add team member',
												'fair-events-experimental'
											)
										: __(
												'Save team member',
												'fair-events-experimental'
											) ) }
							</Button>
						</div>
					</VStack>
				</CardBody>
			</Card>
		</form>
	);
}
