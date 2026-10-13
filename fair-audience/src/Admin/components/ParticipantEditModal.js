import { __, _n, sprintf } from '@wordpress/i18n';
import { useState, useEffect, useRef } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardBody,
	Modal,
	Notice,
	TextControl,
	SelectControl,
	CheckboxControl,
	Spinner,
} from '@wordpress/components';
import UserLinkSection from '../all-participants/UserLinkSection.js';

const EMPTY_FORM = {
	name: '',
	surname: '',
	email: '',
	phone: '',
	instagram: '',
	email_profile: 'minimal',
	wp_user_id: null,
	wp_user: null,
};

export default function ParticipantEditModal( {
	isOpen,
	participant,
	onClose,
	onSaved,
} ) {
	const [ formData, setFormData ] = useState( EMPTY_FORM );
	const [ allGroups, setAllGroups ] = useState( [] );
	const [ selectedGroupIds, setSelectedGroupIds ] = useState( [] );
	const [ originalGroupIds, setOriginalGroupIds ] = useState( [] );
	const [ groupsLoading, setGroupsLoading ] = useState( false );
	const [ isSaving, setIsSaving ] = useState( false );
	// The profile an earlier, partly failed attempt already created: saving
	// again updates it instead of adding a second one.
	const [ createdId, setCreatedId ] = useState( null );
	// Why the last attempt failed: a message, and the group changes at fault.
	const [ error, setError ] = useState( null );
	// Refuses a second submission before the first one re-rendered the form.
	const inFlight = useRef( false );

	// Filled when the popup opens, and for another participant: a reload of
	// the same participant behind an open popup must not wipe what was typed.
	useEffect( () => {
		if ( ! isOpen ) {
			return;
		}

		setCreatedId( null );
		setError( null );

		if ( participant ) {
			setFormData( {
				name: participant.name || '',
				surname: participant.surname || '',
				email: participant.email || '',
				phone: participant.phone || '',
				instagram: participant.instagram || '',
				email_profile: participant.email_profile || 'minimal',
				wp_user_id: participant.wp_user_id || null,
				wp_user: participant.wp_user || null,
			} );
			const groupIds = ( participant.groups || [] ).map( ( g ) => g.id );
			setSelectedGroupIds( groupIds );
			setOriginalGroupIds( groupIds );
		} else {
			setFormData( EMPTY_FORM );
			setSelectedGroupIds( [] );
			setOriginalGroupIds( [] );
		}

		setGroupsLoading( true );
		apiFetch( { path: '/fair-audience/v1/groups' } )
			.then( ( data ) => {
				setAllGroups( data );
				setGroupsLoading( false );
			} )
			.catch( ( err ) => {
				// eslint-disable-next-line no-console
				console.error( 'Error loading groups:', err );
				setGroupsLoading( false );
			} );
	}, [ isOpen, participant?.id ] );

	const handleLinkUser = ( user ) => {
		setFormData( { ...formData, wp_user_id: user.id, wp_user: user } );
	};

	const handleUnlinkUser = () => {
		setFormData( { ...formData, wp_user_id: null, wp_user: null } );
	};

	const handleSubmit = async () => {
		if ( inFlight.current ) {
			return;
		}
		inFlight.current = true;
		setIsSaving( true );
		setError( null );

		const existingId = participant ? participant.id : createdId;
		const dataToSend = {
			name: formData.name,
			surname: formData.surname,
			email: formData.email,
			phone: formData.phone,
			instagram: formData.instagram,
			email_profile: formData.email_profile,
			wp_user_id: formData.wp_user_id,
		};

		try {
			const result = await apiFetch( {
				path: existingId
					? `/fair-audience/v1/participants/${ existingId }`
					: '/fair-audience/v1/participants',
				method: existingId ? 'PUT' : 'POST',
				data: dataToSend,
			} );
			const participantId = existingId || result.id;
			if ( ! existingId ) {
				setCreatedId( participantId );
			}

			const groupsToAdd = selectedGroupIds.filter(
				( id ) => ! originalGroupIds.includes( id )
			);
			const groupsToRemove = originalGroupIds.filter(
				( id ) => ! selectedGroupIds.includes( id )
			);

			// Each group change stands on its own: the ones that went
			// through are remembered, so a retry sends only the rest.
			const outcomes = await Promise.all( [
				...groupsToAdd.map( ( groupId ) =>
					apiFetch( {
						path: `/fair-audience/v1/groups/${ groupId }/participants`,
						method: 'POST',
						data: { participant_id: participantId },
					} )
						.then( () => ( { groupId, added: true } ) )
						.catch( ( err ) =>
							err.message?.includes( 'already' )
								? { groupId, added: true }
								: { groupId, added: true, err }
						)
				),
				...groupsToRemove.map( ( groupId ) =>
					apiFetch( {
						path: `/fair-audience/v1/groups/${ groupId }/participants/${ participantId }`,
						method: 'DELETE',
					} )
						.then( () => ( { groupId, added: false } ) )
						.catch( ( err ) => ( { groupId, added: false, err } ) )
				),
			] );

			const done = outcomes.filter( ( outcome ) => ! outcome.err );
			const failed = outcomes.filter( ( outcome ) => outcome.err );
			const doneAdded = done
				.filter( ( outcome ) => outcome.added )
				.map( ( outcome ) => outcome.groupId );
			const doneRemoved = done
				.filter( ( outcome ) => ! outcome.added )
				.map( ( outcome ) => outcome.groupId );
			setOriginalGroupIds( [
				...originalGroupIds.filter(
					( id ) => ! doneRemoved.includes( id )
				),
				...doneAdded,
			] );

			if ( failed.length > 0 ) {
				setError( {
					message: sprintf(
						/* translators: %d: number of group changes */
						_n(
							'The profile was saved, but %d group change failed. Your selection is kept: save again to retry it.',
							'The profile was saved, but %d group changes failed. Your selection is kept: save again to retry them.',
							failed.length,
							'fair-audience'
						),
						failed.length
					),
					groups: failed.map( ( outcome ) => ( {
						id: outcome.groupId,
						name:
							allGroups.find(
								( group ) => group.id === outcome.groupId
							)?.name || `#${ outcome.groupId }`,
						reason: outcome.err.message,
					} ) ),
				} );
				onSaved?.( result, {
					complete: false,
					created: ! participant,
				} );
				return;
			}

			onSaved?.( result, {
				complete: true,
				// Created by this popup, whichever attempt completed it.
				created: ! participant,
			} );
			onClose();
		} catch ( err ) {
			setError( {
				message:
					err.message ||
					__(
						'The participant could not be saved. Try again.',
						'fair-audience'
					),
				groups: [],
			} );
		} finally {
			inFlight.current = false;
			setIsSaving( false );
		}
	};

	// Closing mid-save would drop the form while its result is unknown.
	const close = () => {
		if ( ! isSaving ) {
			onClose();
		}
	};

	if ( ! isOpen ) {
		return null;
	}

	return (
		<Modal
			title={
				participant
					? __( 'Edit Participant', 'fair-audience' )
					: __( 'Add Participant', 'fair-audience' )
			}
			onRequestClose={ close }
			style={ { maxWidth: '500px', width: '100%' } }
		>
			<Card>
				<CardBody>
					<TextControl
						label={ __( 'Name *', 'fair-audience' ) }
						value={ formData.name }
						onChange={ ( value ) =>
							setFormData( { ...formData, name: value } )
						}
						required
					/>
					<TextControl
						label={ __( 'Surname', 'fair-audience' ) }
						value={ formData.surname }
						onChange={ ( value ) =>
							setFormData( { ...formData, surname: value } )
						}
					/>
					<TextControl
						label={ __( 'Email', 'fair-audience' ) }
						type="email"
						value={ formData.email }
						onChange={ ( value ) =>
							setFormData( { ...formData, email: value } )
						}
					/>
					<TextControl
						label={ __( 'Phone', 'fair-audience' ) }
						type="tel"
						value={ formData.phone }
						onChange={ ( value ) =>
							setFormData( { ...formData, phone: value } )
						}
					/>
					<TextControl
						label={ __( 'Instagram Handle', 'fair-audience' ) }
						value={ formData.instagram }
						onChange={ ( value ) =>
							setFormData( { ...formData, instagram: value } )
						}
						help={ __(
							'Enter handle only (without @)',
							'fair-audience'
						) }
					/>
					<SelectControl
						label={ __( 'Email Profile', 'fair-audience' ) }
						value={ formData.email_profile }
						options={ [
							{
								label: __( 'Minimal', 'fair-audience' ),
								value: 'minimal',
							},
							{
								label: __( 'Marketing', 'fair-audience' ),
								value: 'marketing',
							},
							{
								label: __( 'No marketing', 'fair-audience' ),
								value: 'declined',
							},
						] }
						onChange={ ( value ) =>
							setFormData( { ...formData, email_profile: value } )
						}
					/>
					<UserLinkSection
						linkedUser={ formData.wp_user }
						participantEmail={ formData.email }
						onLink={ handleLinkUser }
						onUnlink={ handleUnlinkUser }
					/>
					<div style={ { marginTop: '16px' } }>
						<label
							style={ {
								display: 'block',
								marginBottom: '8px',
								fontWeight: '600',
							} }
						>
							{ __( 'Groups', 'fair-audience' ) }
						</label>
						{ groupsLoading ? (
							<Spinner />
						) : allGroups.length === 0 ? (
							<p style={ { color: '#666' } }>
								{ __(
									'No groups available.',
									'fair-audience'
								) }
							</p>
						) : (
							<div
								style={ {
									maxHeight: '150px',
									overflowY: 'auto',
									border: '1px solid #ddd',
									padding: '8px',
									borderRadius: '4px',
								} }
							>
								{ allGroups.map( ( group ) => (
									<CheckboxControl
										key={ group.id }
										label={ group.name }
										checked={ selectedGroupIds.includes(
											group.id
										) }
										onChange={ ( checked ) => {
											if ( checked ) {
												setSelectedGroupIds( [
													...selectedGroupIds,
													group.id,
												] );
											} else {
												setSelectedGroupIds(
													selectedGroupIds.filter(
														( id ) =>
															id !== group.id
													)
												);
											}
										} }
									/>
								) ) }
							</div>
						) }
					</div>
					{ error && (
						<div
							className="fair-audience-participant-edit__error"
							style={ { marginTop: '16px' } }
						>
							<Notice status="error" isDismissible={ false }>
								<p style={ { margin: 0 } }>{ error.message }</p>
								{ error.groups.length > 0 && (
									<ul
										style={ {
											margin: '8px 0 0',
											paddingLeft: '18px',
											listStyle: 'disc',
										} }
									>
										{ error.groups.map( ( group ) => (
											<li key={ group.id }>
												<strong>{ group.name }</strong>
												{ group.reason && (
													<div>{ group.reason }</div>
												) }
											</li>
										) ) }
									</ul>
								) }
							</Notice>
						</div>
					) }
					<div style={ { marginTop: '16px' } }>
						<Button
							variant="primary"
							onClick={ handleSubmit }
							isBusy={ isSaving }
							disabled={ isSaving }
						>
							{ participant || createdId
								? __( 'Update', 'fair-audience' )
								: __( 'Add', 'fair-audience' ) }
						</Button>
					</div>
				</CardBody>
			</Card>
		</Modal>
	);
}
