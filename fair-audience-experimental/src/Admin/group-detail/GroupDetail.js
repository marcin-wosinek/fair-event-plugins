import { __, _n, sprintf } from '@wordpress/i18n';
import { useState, useEffect, useCallback } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	Modal,
	SearchControl,
	CheckboxControl,
	TextControl,
	TextareaControl,
	Spinner,
	Notice,
} from '@wordpress/components';

import ConfirmActionModal, {
	useConfirmAction,
} from '../components/ConfirmActionModal.js';

const memberName = ( person ) =>
	`${ person.name || '' } ${ person.surname || '' }`.trim() ||
	__( '(unnamed)', 'fair-audience-experimental' );

export default function GroupDetail() {
	const urlParams = new URLSearchParams( window.location.search );
	const groupId = urlParams.get( 'group_id' );

	const groupsListUrl =
		// eslint-disable-next-line no-undef
		typeof fairAudienceGroupDetailData !== 'undefined'
			? // eslint-disable-next-line no-undef
				fairAudienceGroupDetailData.groupsListUrl
			: 'admin.php?page=fair-audience-groups';

	const [ group, setGroup ] = useState( null );
	const [ members, setMembers ] = useState( [] );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ membersLoading, setMembersLoading ] = useState( true );
	const [ error, setError ] = useState( null );

	// Edit modal state.
	const [ isEditModalOpen, setIsEditModalOpen ] = useState( false );
	const [ editName, setEditName ] = useState( '' );
	const [ editDescription, setEditDescription ] = useState( '' );
	const [ isSaving, setIsSaving ] = useState( false );
	const [ saveError, setSaveError ] = useState( null );

	const [ allParticipants, setAllParticipants ] = useState( [] );
	const [ participantsLoading, setParticipantsLoading ] = useState( false );
	const [ participantSearch, setParticipantSearch ] = useState( '' );
	const [ selectedParticipants, setSelectedParticipants ] = useState( [] );
	const [ isAddingMembers, setIsAddingMembers ] = useState( false );
	// Outcome of the last add: { added, failed: [ { id, label, reason } ] }.
	const [ addResult, setAddResult ] = useState( null );
	const [ memberNotice, setMemberNotice ] = useState( null );
	const removeMember = useConfirmAction();

	const loadGroup = useCallback( () => {
		if ( ! groupId ) {
			setError(
				__( 'No group ID provided.', 'fair-audience-experimental' )
			);
			setIsLoading( false );
			return;
		}

		apiFetch( { path: `/fair-audience/v1/groups/${ groupId }` } )
			.then( ( data ) => {
				setGroup( data );
			} )
			.catch( () => {
				setError(
					__( 'Group not found.', 'fair-audience-experimental' )
				);
			} )
			.finally( () => {
				setIsLoading( false );
			} );
	}, [ groupId ] );

	const loadMembers = useCallback( () => {
		if ( ! groupId ) {
			return;
		}
		setMembersLoading( true );
		apiFetch( {
			path: `/fair-audience/v1/groups/${ groupId }/participants`,
		} )
			.then( ( data ) => {
				setMembers( data );
			} )
			.catch( () => {
				// Ignore; main error handled in loadGroup.
			} )
			.finally( () => {
				setMembersLoading( false );
			} );
	}, [ groupId ] );

	const loadParticipants = useCallback( ( search = '' ) => {
		setParticipantsLoading( true );

		const params = new URLSearchParams();
		params.append( 'per_page', '100' );
		params.append( 'orderby', 'surname' );
		params.append( 'order', 'asc' );
		if ( search ) {
			params.append( 'search', search );
		}

		apiFetch( {
			path: `/fair-audience/v1/participants?${ params.toString() }`,
		} )
			.then( ( data ) => {
				setAllParticipants( data );
			} )
			.catch( () => {
				setAllParticipants( [] );
			} )
			.finally( () => {
				setParticipantsLoading( false );
			} );
	}, [] );

	useEffect( () => {
		loadGroup();
		loadMembers();
		loadParticipants();
	}, [ loadGroup, loadMembers, loadParticipants ] );

	const handleParticipantSearch = ( value ) => {
		setParticipantSearch( value );
		loadParticipants( value );
	};

	const toggleParticipantSelection = ( participantId ) => {
		setSelectedParticipants( ( prev ) => {
			if ( prev.includes( participantId ) ) {
				return prev.filter( ( id ) => id !== participantId );
			}
			return [ ...prev, participantId ];
		} );
	};

	const handleAddMembers = async () => {
		if (
			! groupId ||
			selectedParticipants.length === 0 ||
			isAddingMembers
		) {
			return;
		}

		setIsAddingMembers( true );
		setAddResult( null );

		// One outcome per participant, so a failure keeps only the
		// participants that still need adding.
		const outcomes = await Promise.all(
			selectedParticipants.map( ( participantId ) =>
				apiFetch( {
					path: `/fair-audience/v1/groups/${ groupId }/participants`,
					method: 'POST',
					data: { participant_id: participantId },
				} ).then(
					() => ( { participantId, ok: true } ),
					( err ) =>
						// Already a member counts as done.
						err.message?.includes( 'already' )
							? { participantId, ok: true }
							: {
									participantId,
									ok: false,
									reason:
										err.message ||
										__(
											'The participant could not be added.',
											'fair-audience-experimental'
										),
								}
				)
			)
		);

		const failed = outcomes
			.filter( ( outcome ) => ! outcome.ok )
			.map( ( outcome ) => {
				const participant = allParticipants.find(
					( p ) => p.id === outcome.participantId
				);
				return {
					id: outcome.participantId,
					label: participant
						? memberName( participant )
						: `#${ outcome.participantId }`,
					reason: outcome.reason,
				};
			} );

		setSelectedParticipants( failed.map( ( item ) => item.id ) );
		setAddResult( { added: outcomes.length - failed.length, failed } );
		setIsAddingMembers( false );
		loadMembers();
	};

	const openEditModal = () => {
		setEditName( group.name );
		setEditDescription( group.description || '' );
		setSaveError( null );
		setIsEditModalOpen( true );
	};

	const handleSaveGroup = () => {
		if ( ! editName.trim() || isSaving ) {
			return;
		}

		setIsSaving( true );
		setSaveError( null );

		apiFetch( {
			path: `/fair-audience/v1/groups/${ groupId }`,
			method: 'PUT',
			data: {
				name: editName.trim(),
				description: editDescription.trim(),
			},
		} )
			.then( () => {
				setIsEditModalOpen( false );
				loadGroup();
			} )
			.catch( ( err ) => {
				setSaveError(
					err.message ||
						__(
							'The group could not be saved. Try again.',
							'fair-audience-experimental'
						)
				);
			} )
			.finally( () => {
				setIsSaving( false );
			} );
	};

	const handleRemoveMember = () =>
		removeMember.run(
			async ( member ) => {
				await apiFetch( {
					path: `/fair-audience/v1/groups/${ groupId }/participants/${ member.id }`,
					method: 'DELETE',
				} );
				setMemberNotice(
					sprintf(
						/* translators: %s: participant name */
						__(
							'%s removed from the group.',
							'fair-audience-experimental'
						),
						memberName( member )
					)
				);
				loadMembers();
			},
			__(
				'The participant could not be removed from the group. Try again.',
				'fair-audience-experimental'
			)
		);

	if ( isLoading ) {
		return (
			<div style={ { padding: '20px', textAlign: 'center' } }>
				<Spinner />
			</div>
		);
	}

	if ( error ) {
		return (
			<div className="wrap">
				<p>
					<a href={ groupsListUrl }>
						{ __(
							'← Back to Groups',
							'fair-audience-experimental'
						) }
					</a>
				</p>
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			</div>
		);
	}

	if ( ! group ) {
		return null;
	}

	const memberIds = members.map( ( m ) => m.id );
	const availableParticipants = allParticipants.filter(
		( p ) => ! memberIds.includes( p.id )
	);

	return (
		<div className="wrap">
			<p>
				<a href={ groupsListUrl }>
					{ __( '← Back to Groups', 'fair-audience-experimental' ) }
				</a>
			</p>

			<div
				style={ {
					display: 'flex',
					alignItems: 'center',
					gap: '8px',
				} }
			>
				<h1 style={ { margin: 0 } }>{ group.name }</h1>
				<Button
					variant="secondary"
					icon="edit"
					onClick={ openEditModal }
				>
					{ __( 'Edit', 'fair-audience-experimental' ) }
				</Button>
			</div>
			{ group.description && (
				<p style={ { color: '#666' } }>{ group.description }</p>
			) }

			<Card style={ { marginBottom: '16px' } }>
				<CardHeader>
					<h2 style={ { margin: 0 } }>
						{ __( 'Members', 'fair-audience-experimental' ) } (
						{ members.length })
					</h2>
				</CardHeader>
				<CardBody>
					{ memberNotice && (
						<Notice
							status="success"
							onRemove={ () => setMemberNotice( null ) }
						>
							{ memberNotice }
						</Notice>
					) }
					{ membersLoading ? (
						<Spinner />
					) : members.length === 0 ? (
						<p>
							{ __(
								'No members in this group.',
								'fair-audience-experimental'
							) }
						</p>
					) : (
						<table className="wp-list-table widefat striped">
							<thead>
								<tr>
									<th>
										{ __(
											'Name',
											'fair-audience-experimental'
										) }
									</th>
									<th>
										{ __(
											'Email',
											'fair-audience-experimental'
										) }
									</th>
									<th style={ { width: '120px' } }>
										{ __(
											'Actions',
											'fair-audience-experimental'
										) }
									</th>
								</tr>
							</thead>
							<tbody>
								{ members.map( ( member ) => {
									const detailUrl = `admin.php?page=fair-audience-participant-detail&participant_id=${ member.id }`;
									const fullName = `${ member.name || '' } ${
										member.surname || ''
									}`.trim();
									return (
										<tr key={ member.id }>
											<td>
												<a href={ detailUrl }>
													{ fullName ||
														__(
															'(unnamed)',
															'fair-audience-experimental'
														) }
												</a>
											</td>
											<td>{ member.email || '—' }</td>
											<td>
												<Button
													variant="link"
													isDestructive
													onClick={ () => {
														setMemberNotice( null );
														removeMember.open(
															member
														);
													} }
												>
													{ __(
														'Remove',
														'fair-audience-experimental'
													) }
												</Button>
											</td>
										</tr>
									);
								} ) }
							</tbody>
						</table>
					) }
				</CardBody>
			</Card>

			<Card>
				<CardHeader>
					<h2 style={ { margin: 0 } }>
						{ __( 'Add Members', 'fair-audience-experimental' ) }
					</h2>
				</CardHeader>
				<CardBody>
					<SearchControl
						value={ participantSearch }
						onChange={ handleParticipantSearch }
						placeholder={ __(
							'Search participants...',
							'fair-audience-experimental'
						) }
					/>

					<div
						style={ {
							maxHeight: '320px',
							overflowY: 'auto',
							marginTop: '8px',
							marginBottom: '16px',
							padding: '4px',
						} }
					>
						{ participantsLoading ? (
							<Spinner />
						) : availableParticipants.length === 0 ? (
							<p>
								{ __(
									'No participants available to add.',
									'fair-audience-experimental'
								) }
							</p>
						) : (
							availableParticipants.map( ( participant ) => (
								<CheckboxControl
									key={ participant.id }
									label={ `${ participant.name || '' } ${
										participant.surname || ''
									}${
										participant.email
											? ` (${ participant.email })`
											: ''
									}`.trim() }
									checked={ selectedParticipants.includes(
										participant.id
									) }
									onChange={ () =>
										toggleParticipantSelection(
											participant.id
										)
									}
								/>
							) )
						) }
					</div>

					{ addResult && addResult.added > 0 && (
						<Notice
							status="success"
							onRemove={ () => setAddResult( null ) }
						>
							{ sprintf(
								/* translators: %d: number of participants added */
								_n(
									'%d participant added to the group.',
									'%d participants added to the group.',
									addResult.added,
									'fair-audience-experimental'
								),
								addResult.added
							) }
						</Notice>
					) }
					{ addResult && addResult.failed.length > 0 && (
						<Notice status="error" isDismissible={ false }>
							<p>
								{ __(
									'These participants were not added and stay selected for a retry:',
									'fair-audience-experimental'
								) }
							</p>
							<ul>
								{ addResult.failed.map( ( item ) => (
									<li key={ item.id }>
										{ sprintf(
											/* translators: 1: participant name, 2: reason */
											__(
												'%1$s: %2$s',
												'fair-audience-experimental'
											),
											item.label,
											item.reason
										) }
									</li>
								) ) }
							</ul>
						</Notice>
					) }

					<Button
						variant="primary"
						onClick={ handleAddMembers }
						disabled={
							selectedParticipants.length === 0 || isAddingMembers
						}
						isBusy={ isAddingMembers }
					>
						{ __( 'Add Selected', 'fair-audience-experimental' ) }
					</Button>
				</CardBody>
			</Card>

			{ removeMember.target && (
				<ConfirmActionModal
					title={ sprintf(
						/* translators: %s: participant name */
						__(
							'Remove from group — %s',
							'fair-audience-experimental'
						),
						memberName( removeMember.target )
					) }
					confirmLabel={ __(
						'Remove from group',
						'fair-audience-experimental'
					) }
					busyLabel={ __(
						'Removing…',
						'fair-audience-experimental'
					) }
					isDestructive
					isBusy={ removeMember.isBusy }
					error={ removeMember.error }
					onConfirm={ handleRemoveMember }
					onCancel={ removeMember.close }
				>
					<p>
						{ sprintf(
							/* translators: 1: participant name, 2: participant email or dash, 3: group name */
							__(
								'Remove %1$s (%2$s) from %3$s?',
								'fair-audience-experimental'
							),
							memberName( removeMember.target ),
							removeMember.target.email || '—',
							group.name
						) }
					</p>
					<p>
						{ __(
							'The participant stays in your audience, and you can add them to the group again later.',
							'fair-audience-experimental'
						) }
					</p>
				</ConfirmActionModal>
			) }

			{ isEditModalOpen && (
				<Modal
					title={ __( 'Edit Group', 'fair-audience-experimental' ) }
					onRequestClose={ () => setIsEditModalOpen( false ) }
					style={ { maxWidth: '500px', width: '100%' } }
				>
					<TextControl
						label={ __( 'Name', 'fair-audience-experimental' ) }
						value={ editName }
						onChange={ setEditName }
						placeholder={ __(
							'Enter group name...',
							'fair-audience-experimental'
						) }
					/>

					<TextareaControl
						label={ __(
							'Description',
							'fair-audience-experimental'
						) }
						value={ editDescription }
						onChange={ setEditDescription }
						placeholder={ __(
							'Enter group description (optional)...',
							'fair-audience-experimental'
						) }
					/>

					{ saveError && (
						<Notice status="error" isDismissible={ false }>
							{ saveError }
						</Notice>
					) }

					<div
						style={ {
							display: 'flex',
							justifyContent: 'flex-end',
							gap: '8px',
							marginTop: '16px',
						} }
					>
						<Button
							variant="secondary"
							onClick={ () => setIsEditModalOpen( false ) }
						>
							{ __( 'Cancel', 'fair-audience-experimental' ) }
						</Button>
						<Button
							variant="primary"
							onClick={ handleSaveGroup }
							disabled={ ! editName.trim() || isSaving }
							isBusy={ isSaving }
						>
							{ __( 'Update', 'fair-audience-experimental' ) }
						</Button>
					</div>
				</Modal>
			) }
		</div>
	);
}
