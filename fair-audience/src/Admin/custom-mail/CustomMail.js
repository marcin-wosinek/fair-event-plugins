/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect, useRef } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	TextControl,
	SelectControl,
	CheckboxControl,
	Notice,
	Spinner,
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import {
	loadCustomMails,
	sendCustomMail,
	loadEventDates,
	loadGroups,
	deleteCustomMail,
	previewRecipients,
} from './custom-mail-api.js';
import ContentEditor from './ContentEditor.js';
import RecipientPreview, { isEligible } from './RecipientPreview.js';
import SendResult from './SendResult.js';
import MailHistory from './MailHistory.js';
import {
	hasVisibleContent,
	isRejectedBeforeSending,
	stripRetiredPlaceholders,
} from './mail-content.js';

const EDITOR_ID = 'custom-mail-content';

const AUDIENCE_TYPES = [ 'signed_up', 'collaborator', 'interested' ];

const EMPTY_DRAFT = {
	subject: '',
	content: '',
	eventDateId: '',
	isMarketing: true,
	labels: { signed_up: true, collaborator: true, interested: false },
	groupIds: [],
};

const IDLE_PREVIEW = { status: 'idle', recipients: [], error: null };

/**
 * Custom Mail page: compose an email for the participants of one event
 * occurrence, see who would receive it, send it, and review past messages.
 *
 * Sending to the whole audience and group filters come from the experimental
 * companion; the page works without them.
 *
 * @return {JSX.Element} The custom mail page
 */
export default function CustomMail() {
	const features = window.fairAudienceCustomMailData || {};
	const allAudience = !! features.allAudience;
	const groupsEnabled = !! features.groups;

	const [ mails, setMails ] = useState( [] );
	const [ eventDates, setEventDates ] = useState( [] );
	const [ groups, setGroups ] = useState( [] );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ notice, setNotice ] = useState( null );

	const [ draft, setDraft ] = useState( EMPTY_DRAFT );
	const [ preview, setPreview ] = useState( IDLE_PREVIEW );
	const [ excludedIds, setExcludedIds ] = useState( new Set() );
	const [ isSending, setIsSending ] = useState( false );
	const [ sendResult, setSendResult ] = useState( null );
	const [ mailToDelete, setMailToDelete ] = useState( null );
	const [ isDeleting, setIsDeleting ] = useState( false );

	const editorRef = useRef( null );
	const previewRequest = useRef( 0 );
	const sendInFlight = useRef( false );

	const updateDraft = ( changes ) =>
		setDraft( ( current ) => ( { ...current, ...changes } ) );

	const selectedLabels = AUDIENCE_TYPES.filter(
		( type ) => draft.labels[ type ]
	);
	const labelsKey = selectedLabels.join( ',' );
	const groupsKey = draft.groupIds.join( ',' );
	const eventSelected = draft.eventDateId !== '';

	const reloadHistory = () =>
		loadCustomMails()
			.then( setMails )
			.catch( () => {} );

	// Load history, events and (when available) groups on mount.
	useEffect( () => {
		Promise.all( [
			loadCustomMails(),
			loadEventDates(),
			groupsEnabled ? loadGroups() : Promise.resolve( [] ),
		] )
			.then( ( [ mailsData, eventDatesData, groupsData ] ) => {
				setMails( mailsData );
				setEventDates( eventDatesData );
				setGroups( groupsData );
			} )
			.catch( ( error ) => {
				setNotice( {
					status: 'error',
					message:
						error.message ||
						__(
							'The page data could not be loaded.',
							'fair-audience'
						),
				} );
			} )
			.finally( () => setIsLoading( false ) );
	}, [ groupsEnabled ] );

	// Refresh the recipient preview whenever the selection changes. Only the
	// answer to the latest request is kept: an earlier one arriving late would
	// show the recipients of a selection the organizer has moved on from.
	useEffect( () => {
		if ( isLoading ) {
			return;
		}

		previewRequest.current += 1;
		const requestId = previewRequest.current;

		const hasScope = eventSelected || allAudience;
		if ( ! hasScope || ( eventSelected && labelsKey === '' ) ) {
			setPreview( IDLE_PREVIEW );
			return;
		}

		const data = { is_marketing: draft.isMarketing };
		if ( groupsKey !== '' ) {
			data.group_ids = groupsKey.split( ',' ).map( Number );
		}
		if ( eventSelected ) {
			data.event_date_id = parseInt( draft.eventDateId, 10 );
			data.labels = labelsKey.split( ',' );
		}

		setPreview( ( current ) => ( { ...current, status: 'loading' } ) );
		previewRecipients( data )
			.then( ( recipients ) => {
				if ( requestId !== previewRequest.current ) {
					return;
				}
				setPreview( { status: 'ready', recipients, error: null } );
				// Keep exclusions for people still on the list.
				setExcludedIds( ( current ) => {
					const ids = new Set(
						recipients.map( ( r ) => r.participant_id )
					);
					return new Set(
						[ ...current ].filter( ( id ) => ids.has( id ) )
					);
				} );
			} )
			.catch( ( error ) => {
				if ( requestId !== previewRequest.current ) {
					return;
				}
				setPreview( {
					status: 'error',
					recipients: [],
					error: error.message || null,
				} );
			} );
	}, [
		isLoading,
		allAudience,
		eventSelected,
		draft.eventDateId,
		draft.isMarketing,
		labelsKey,
		groupsKey,
	] );

	const toggleExcluded = ( participantId ) => {
		setExcludedIds( ( current ) => {
			const next = new Set( current );
			if ( next.has( participantId ) ) {
				next.delete( participantId );
			} else {
				next.add( participantId );
			}
			return next;
		} );
	};

	const toggleGroup = ( groupId ) => {
		updateDraft( {
			groupIds: draft.groupIds.includes( groupId )
				? draft.groupIds.filter( ( id ) => id !== groupId )
				: [ ...draft.groupIds, groupId ],
		} );
	};

	const receivingCount = preview.recipients.filter(
		( r ) => isEligible( r ) && ! excludedIds.has( r.participant_id )
	).length;

	/**
	 * Why the email cannot be sent yet, in the order the form is filled in.
	 *
	 * @param {string} content Email body to check.
	 * @return {string|null} Reason, or null when the email can be sent.
	 */
	const getBlockingReason = ( content ) => {
		if ( ! draft.subject.trim() ) {
			return __( 'Enter a subject.', 'fair-audience' );
		}
		if ( ! hasVisibleContent( stripRetiredPlaceholders( content ) ) ) {
			return __( 'Write the email content.', 'fair-audience' );
		}
		if ( ! eventSelected && ! allAudience ) {
			return __(
				'Select the event whose participants should receive this email.',
				'fair-audience'
			);
		}
		if ( eventSelected && selectedLabels.length === 0 ) {
			return __( 'Select at least one audience type.', 'fair-audience' );
		}
		if ( preview.status === 'loading' ) {
			return __( 'Loading recipients…', 'fair-audience' );
		}
		if ( preview.status === 'ready' && receivingCount === 0 ) {
			return __( 'No one would receive this email.', 'fair-audience' );
		}
		return null;
	};

	const blockingReason = getBlockingReason( draft.content );

	const handleSubmit = ( event ) => {
		event.preventDefault();

		// A second click or Enter press while the first request is still
		// running must not send the email twice.
		if ( sendInFlight.current ) {
			return;
		}

		// The editor's Code view can change without telling React.
		const content = editorRef.current
			? editorRef.current.read()
			: draft.content;
		if ( content !== draft.content ) {
			updateDraft( { content } );
		}
		if ( getBlockingReason( content ) ) {
			return;
		}

		const data = {
			subject: draft.subject.trim(),
			content,
			is_marketing: draft.isMarketing,
			skip_participant_ids: Array.from( excludedIds ),
		};
		if ( draft.groupIds.length > 0 ) {
			data.group_ids = draft.groupIds;
		}
		if ( eventSelected ) {
			data.event_date_id = parseInt( draft.eventDateId, 10 );
			data.labels = selectedLabels;
		}

		sendInFlight.current = true;
		setIsSending( true );
		setNotice( null );
		setSendResult( null );

		sendCustomMail( data )
			.then( ( result ) => {
				setSendResult( result );
				// The message is in Mail History now; a fresh form keeps it
				// from being sent a second time by accident.
				setDraft( EMPTY_DRAFT );
				setExcludedIds( new Set() );
				reloadHistory();
			} )
			.catch( ( error ) => {
				if ( isRejectedBeforeSending( error ) ) {
					setNotice( {
						status: 'error',
						message:
							error.message ||
							__( 'The email was not sent.', 'fair-audience' ),
					} );
					return;
				}
				setNotice( {
					status: 'error',
					message: __(
						'The request did not finish, so some emails may already have been sent. Check Mail History before sending this email again.',
						'fair-audience'
					),
				} );
				reloadHistory();
			} )
			.finally( () => {
				sendInFlight.current = false;
				setIsSending( false );
			} );
	};

	/**
	 * Load a past message into the form to send it again or adapt it.
	 *
	 * @param {Object} mail History record.
	 */
	const handleDuplicate = ( mail ) => {
		const eventDateId = mail.event_date_id
			? String( mail.event_date_id )
			: '';
		updateDraft( {
			subject: mail.subject || '',
			content: mail.content || '',
			eventDateId: eventDates.some(
				( ed ) => String( ed.id ) === eventDateId
			)
				? eventDateId
				: '',
			isMarketing: !! mail.is_marketing,
		} );
		window.scrollTo( { top: 0, behavior: 'smooth' } );
	};

	const confirmDelete = () => {
		const mail = mailToDelete;
		setIsDeleting( true );
		deleteCustomMail( mail.id )
			.then( () => {
				setNotice( {
					status: 'success',
					message: __( 'The record was deleted.', 'fair-audience' ),
				} );
				return reloadHistory();
			} )
			.catch( ( error ) => {
				setNotice( {
					status: 'error',
					message:
						error.message ||
						__(
							'The record could not be deleted.',
							'fair-audience'
						),
				} );
			} )
			.finally( () => {
				setIsDeleting( false );
				setMailToDelete( null );
			} );
	};

	if ( isLoading ) {
		return (
			<div className="wrap fair-audience-custom-mail">
				<h1>{ __( 'Custom Mail', 'fair-audience' ) }</h1>
				<div className="fair-audience-custom-mail__loading">
					<Spinner />
				</div>
			</div>
		);
	}

	let eventHelp = __(
		'Only the people registered for this date receive the email.',
		'fair-audience'
	);
	if ( ! eventSelected && allAudience ) {
		eventHelp = __(
			'Everyone in your audience receives the email.',
			'fair-audience'
		);
	} else if ( ! eventSelected && eventDates.length === 0 ) {
		eventHelp = __(
			'There are no published events yet. Publish an event to email its participants.',
			'fair-audience'
		);
	} else if ( ! eventSelected ) {
		eventHelp = __(
			'Choose the event date whose participants should receive the email.',
			'fair-audience'
		);
	}

	const eventOptions = [
		{
			label: allAudience
				? __( 'All audience', 'fair-audience' )
				: __( 'Select an event…', 'fair-audience' ),
			value: '',
		},
		...eventDates.map( ( ed ) => ( {
			label: ed.display_label,
			value: String( ed.id ),
		} ) ),
	];

	return (
		<div className="wrap fair-audience-custom-mail">
			<h1>{ __( 'Custom Mail', 'fair-audience' ) }</h1>

			{ notice && (
				<Notice
					status={ notice.status }
					isDismissible
					onRemove={ () => setNotice( null ) }
				>
					{ notice.message }
				</Notice>
			) }

			<SendResult
				result={ sendResult }
				onDismiss={ () => setSendResult( null ) }
			/>

			<Card className="fair-audience-custom-mail__compose">
				<CardHeader>
					<h2 className="fair-audience-custom-mail__card-title">
						{ __( 'Write an email', 'fair-audience' ) }
					</h2>
				</CardHeader>
				<CardBody>
					<form onSubmit={ handleSubmit }>
						<SelectControl
							label={ __( 'Event', 'fair-audience' ) }
							value={ draft.eventDateId }
							options={ eventOptions }
							onChange={ ( eventDateId ) =>
								updateDraft( { eventDateId } )
							}
							disabled={ isSending }
							help={ eventHelp }
							__nextHasNoMarginBottom
							__next40pxDefaultSize
						/>

						{ eventSelected && (
							<fieldset className="fair-audience-custom-mail__fieldset">
								<legend>
									{ __( 'Audience', 'fair-audience' ) }
								</legend>
								<CheckboxControl
									label={ __(
										'Participants',
										'fair-audience'
									) }
									checked={ draft.labels.signed_up }
									onChange={ ( checked ) =>
										updateDraft( {
											labels: {
												...draft.labels,
												signed_up: checked,
											},
										} )
									}
									disabled={ isSending }
									__nextHasNoMarginBottom
								/>
								<CheckboxControl
									label={ __(
										'Collaborators',
										'fair-audience'
									) }
									checked={ draft.labels.collaborator }
									onChange={ ( checked ) =>
										updateDraft( {
											labels: {
												...draft.labels,
												collaborator: checked,
											},
										} )
									}
									disabled={ isSending }
									__nextHasNoMarginBottom
								/>
								<CheckboxControl
									label={ __(
										'Interested',
										'fair-audience'
									) }
									checked={ draft.labels.interested }
									onChange={ ( checked ) =>
										updateDraft( {
											labels: {
												...draft.labels,
												interested: checked,
											},
										} )
									}
									disabled={ isSending }
									__nextHasNoMarginBottom
								/>
							</fieldset>
						) }

						{ groupsEnabled && groups.length > 0 && (
							<fieldset className="fair-audience-custom-mail__fieldset">
								<legend>
									{ __( 'Groups', 'fair-audience' ) }
								</legend>
								<p className="fair-audience-custom-mail__help">
									{ __(
										'If selected, only sends to members of these groups.',
										'fair-audience'
									) }
								</p>
								{ groups.map( ( group ) => (
									<CheckboxControl
										key={ group.id }
										label={ sprintf(
											/* translators: 1: group name, 2: number of members */
											__(
												'%1$s (%2$d)',
												'fair-audience'
											),
											group.name,
											group.member_count
										) }
										checked={ draft.groupIds.includes(
											group.id
										) }
										onChange={ () =>
											toggleGroup( group.id )
										}
										disabled={ isSending }
										__nextHasNoMarginBottom
									/>
								) ) }
							</fieldset>
						) }

						<CheckboxControl
							label={ __( 'Marketing email', 'fair-audience' ) }
							checked={ draft.isMarketing }
							onChange={ ( isMarketing ) =>
								updateDraft( { isMarketing } )
							}
							help={ __(
								'If checked, only sends to participants who consented to marketing communications.',
								'fair-audience'
							) }
							disabled={ isSending }
							__nextHasNoMarginBottom
						/>

						<TextControl
							label={ __( 'Subject', 'fair-audience' ) }
							value={ draft.subject }
							onChange={ ( subject ) =>
								updateDraft( { subject } )
							}
							disabled={ isSending }
							__nextHasNoMarginBottom
							__next40pxDefaultSize
						/>

						<ContentEditor
							ref={ editorRef }
							id={ EDITOR_ID }
							value={ draft.content }
							onChange={ ( content ) =>
								updateDraft( { content } )
							}
							disabled={ isSending }
							eventSelected={ eventSelected }
						/>

						<RecipientPreview
							preview={ preview }
							excludedIds={ excludedIds }
							onToggle={ toggleExcluded }
							disabled={ isSending }
						/>

						<div className="fair-audience-custom-mail__submit">
							<Button
								variant="primary"
								type="submit"
								disabled={ isSending || !! blockingReason }
								isBusy={ isSending }
								aria-describedby={
									blockingReason
										? 'fair-audience-custom-mail-blocked'
										: undefined
								}
								__next40pxDefaultSize
							>
								{ isSending
									? __( 'Sending…', 'fair-audience' )
									: __( 'Send email', 'fair-audience' ) }
							</Button>
							{ blockingReason && ! isSending && (
								<span
									id="fair-audience-custom-mail-blocked"
									className="fair-audience-custom-mail__help"
								>
									{ blockingReason }
								</span>
							) }
						</div>
					</form>
				</CardBody>
			</Card>

			<MailHistory
				mails={ mails }
				onDuplicate={ handleDuplicate }
				onDelete={ setMailToDelete }
				disabled={ isSending || isDeleting }
			/>

			<ConfirmDialog
				isOpen={ mailToDelete !== null }
				onConfirm={ confirmDelete }
				onCancel={ () => setMailToDelete( null ) }
				confirmButtonText={ __( 'Delete record', 'fair-audience' ) }
				cancelButtonText={ __( 'Cancel', 'fair-audience' ) }
			>
				{ mailToDelete &&
					sprintf(
						/* translators: %s: email subject */
						__(
							'Delete the record of “%s” from Mail History? Emails that were already sent are not affected. This cannot be undone.',
							'fair-audience'
						),
						mailToDelete.subject
					) }
			</ConfirmDialog>
		</div>
	);
}
