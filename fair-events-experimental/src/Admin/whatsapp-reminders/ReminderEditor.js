/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';
import { __, sprintf } from '@wordpress/i18n';
import { useRef, useState } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	CheckboxControl,
	ExternalLink,
	Notice,
	RadioControl,
	SelectControl,
	TextControl,
	ToggleControl,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import ConfirmActionModal from '../components/ConfirmActionModal.js';
import {
	DAYS,
	PATH,
	draftCollaborator,
	draftProblem,
	payloadFromDraft,
	reminderProblem,
	templateKey,
	templatesForFeed,
	updateDraft,
} from './model.js';

/**
 * The error message of a failed request.
 *
 * @param {Object} error    apiFetch error.
 * @param {string} fallback Message when the server gave none.
 * @return {string} Message.
 */
function errorMessage( error, fallback ) {
	return error?.message || error?.data?.message || fallback;
}

/**
 * Editor of one feed's sharing reminder: whether it is on, the designated
 * collaborator and their consent, the approved template and the weekly
 * schedule. The parent keeps the draft, so it survives switching feeds.
 *
 * @param {Object}      props
 * @param {Object}      props.feed           Feed from the API.
 * @param {Object}      props.draft          Unsaved state of the form.
 * @param {Function}    props.onDraft        Receives the next draft.
 * @param {boolean}     props.dirty          Whether the draft differs from the saved reminder.
 * @param {Object[]}    props.members        Team members to choose from.
 * @param {boolean}     props.membersOn      Whether the team member directory is available.
 * @param {string|null} props.teamMembersUrl Team members page.
 * @param {Object}      props.connection     WhatsApp connection state.
 * @param {Object}      props.templates      `{ items, error, loading }` of the account's templates.
 * @param {Function}    props.onSaved        Receives the saved feed.
 * @param {Function}    props.onClose        Closes the editor.
 * @return {JSX.Element} The editor.
 */
export default function ReminderEditor( {
	feed,
	draft,
	onDraft,
	dirty,
	members,
	membersOn,
	teamMembersUrl,
	connection,
	templates,
	onSaved,
	onClose,
} ) {
	const [ pending, setPending ] = useState( false );
	const [ notice, setNotice ] = useState( null );
	const [ confirmRemove, setConfirmRemove ] = useState( false );
	const [ removing, setRemoving ] = useState( false );
	const [ removeError, setRemoveError ] = useState( null );
	const busy = useRef( false );

	const saved = feed.reminder;
	const change = ( field ) => ( value ) =>
		onDraft( updateDraft( draft, field, value ) );
	const problem = draftProblem( draft, members );
	const collaborator = draftCollaborator( draft, members );

	const matching = templatesForFeed(
		templates.items || [],
		feed.summary_url
	);
	const options = matching.map( ( template ) => ( {
		value: templateKey( template ),
		label: sprintf(
			/* translators: 1: template name, 2: template language code */
			__( '%1$s (%2$s)', 'fair-events-experimental' ),
			template.name,
			template.language
		),
	} ) );
	// A saved template stays selectable while the list is unavailable.
	if (
		saved?.template &&
		! options.some(
			( { value } ) => value === templateKey( saved.template )
		)
	) {
		options.unshift( {
			value: templateKey( saved.template ),
			label: sprintf(
				/* translators: 1: template name, 2: template language code */
				__( '%1$s (%2$s)', 'fair-events-experimental' ),
				saved.template.name,
				saved.template.language
			),
		} );
	}
	options.unshift( {
		value: '',
		label: __( 'No template', 'fair-events-experimental' ),
	} );

	const put = async ( body ) =>
		apiFetch( {
			path: `${ PATH }/${ feed.source_id }`,
			method: 'PUT',
			data: body,
		} );

	const save = async () => {
		if ( busy.current || problem ) {
			return;
		}
		busy.current = true;
		setPending( true );
		setNotice( null );
		try {
			const next = await put( payloadFromDraft( draft ) );
			onSaved( next );
			setNotice( {
				status: 'success',
				message: __( 'Reminder saved.', 'fair-events-experimental' ),
			} );
		} catch ( error ) {
			setNotice( {
				status: 'error',
				message: errorMessage(
					error,
					__(
						'The reminder could not be saved. Try again.',
						'fair-events-experimental'
					)
				),
			} );
		}
		busy.current = false;
		setPending( false );
	};

	const removeCollaborator = async () => {
		if ( busy.current ) {
			return;
		}
		busy.current = true;
		setRemoving( true );
		setRemoveError( null );
		try {
			const next = await put( {
				...payloadFromDraft( {
					...draft,
					kind: 'none',
				} ),
				enabled: saved.enabled,
				day_of_week: saved.day_of_week,
				time_of_day: saved.time_of_day,
				template: saved.template
					? {
							name: saved.template.name,
							language: saved.template.language,
						}
					: null,
			} );
			setConfirmRemove( false );
			onSaved( next, { resetDraft: true } );
			setNotice( {
				status: 'success',
				message: __(
					'Collaborator removed. No reminder is sent until another one is designated.',
					'fair-events-experimental'
				),
			} );
		} catch ( error ) {
			setRemoveError(
				errorMessage(
					error,
					__(
						'The collaborator could not be removed. Try again.',
						'fair-events-experimental'
					)
				)
			);
		}
		busy.current = false;
		setRemoving( false );
	};

	const savedProblem = saved?.enabled
		? reminderProblem( feed, connection.ready )
		: null;

	const kindOptions = [
		{
			value: 'none',
			label: __( 'Nobody yet', 'fair-events-experimental' ),
		},
		...( membersOn
			? [
					{
						value: 'member',
						label: __(
							'A team member',
							'fair-events-experimental'
						),
					},
				]
			: [] ),
		{
			value: 'standalone',
			label: __( 'Someone else', 'fair-events-experimental' ),
		},
	];

	return (
		<Card className="fair-whatsapp-reminders__editor">
			<CardHeader>
				<h2>
					{ sprintf(
						/* translators: %s: event feed name */
						__( 'Reminder for %s', 'fair-events-experimental' ),
						feed.name ||
							__( '(untitled feed)', 'fair-events-experimental' )
					) }
					{ dirty && (
						<span className="fair-whatsapp-reminders__unsaved">
							{ __(
								'Unsaved changes',
								'fair-events-experimental'
							) }
						</span>
					) }
				</h2>
			</CardHeader>
			<CardBody>
				{ notice && (
					<Notice
						status={ notice.status }
						onRemove={ () => setNotice( null ) }
					>
						{ notice.message }
					</Notice>
				) }
				{ savedProblem && (
					<Notice status="warning" isDismissible={ false }>
						{ sprintf(
							/* translators: %s: what keeps the reminder from sending */
							__(
								'This reminder is on but is not sent: %s',
								'fair-events-experimental'
							),
							savedProblem
						) }
					</Notice>
				) }

				<p>
					{ __(
						'The collaborator gets a WhatsApp message on the chosen day. Its button opens this page, where they copy the week’s events and share them with their community themselves:',
						'fair-events-experimental'
					) }{ ' ' }
					<ExternalLink href={ feed.summary_url }>
						{ feed.summary_url }
					</ExternalLink>
				</p>

				<ToggleControl
					label={ __(
						'Send the weekly reminder',
						'fair-events-experimental'
					) }
					checked={ draft.enabled }
					onChange={ change( 'enabled' ) }
				/>

				<RadioControl
					label={ __( 'Collaborator', 'fair-events-experimental' ) }
					selected={ draft.kind }
					options={ kindOptions }
					onChange={ change( 'kind' ) }
				/>

				{ 'member' === draft.kind && (
					<SelectControl
						label={ __(
							'Team member',
							'fair-events-experimental'
						) }
						value={ draft.member_id }
						options={ [
							{
								value: '',
								label: __(
									'Choose a team member',
									'fair-events-experimental'
								),
							},
							...members.map( ( member ) => ( {
								value: String( member.id ),
								label: member.number
									? sprintf(
											/* translators: 1: team member name, 2: phone number */
											__(
												'%1$s — %2$s',
												'fair-events-experimental'
											),
											member.name,
											member.number
										)
									: sprintf(
											/* translators: %s: team member name */
											__(
												'%s — no phone number',
												'fair-events-experimental'
											),
											member.name
										),
							} ) ),
						] }
						onChange={ change( 'member_id' ) }
						help={
							teamMembersUrl ? (
								<a href={ teamMembersUrl }>
									{ __(
										'Edit numbers in Team members',
										'fair-events-experimental'
									) }
								</a>
							) : null
						}
					/>
				) }

				{ 'standalone' === draft.kind && (
					<div className="fair-whatsapp-reminders__fields">
						<TextControl
							label={ __( 'Name', 'fair-events-experimental' ) }
							value={ draft.name }
							onChange={ change( 'name' ) }
							maxLength={ 100 }
						/>
						<TextControl
							type="tel"
							label={ __(
								'WhatsApp number',
								'fair-events-experimental'
							) }
							help={ __(
								'With the country code, such as +34 600 123 456.',
								'fair-events-experimental'
							) }
							value={ draft.number }
							onChange={ change( 'number' ) }
						/>
					</div>
				) }

				{ collaborator && (
					<CheckboxControl
						label={
							collaborator.name && collaborator.number
								? sprintf(
										/* translators: 1: collaborator name, 2: phone number */
										__(
											'%1$s agreed to receive these weekly WhatsApp reminders at %2$s.',
											'fair-events-experimental'
										),
										collaborator.name,
										collaborator.number
									)
								: __(
										'The collaborator agreed to receive these weekly WhatsApp reminders at this number.',
										'fair-events-experimental'
									)
						}
						checked={ draft.consent }
						onChange={ change( 'consent' ) }
					/>
				) }

				<SelectControl
					label={ __( 'Template', 'fair-events-experimental' ) }
					value={ draft.template }
					options={ options }
					onChange={ change( 'template' ) }
					help={ sprintf(
						/* translators: %s: link to the feed's weekly summary */
						__(
							'Approved templates without parameters whose button opens %s.',
							'fair-events-experimental'
						),
						feed.summary_url
					) }
				/>
				{ ! connection.ready && (
					<p className="description">
						{ __(
							'Validate the WhatsApp connection to choose a template.',
							'fair-events-experimental'
						) }{ ' ' }
						<a href={ connection.whatsapp_url }>
							{ __(
								'Open Fair Events → WhatsApp',
								'fair-events-experimental'
							) }
						</a>
					</p>
				) }
				{ connection.ready && templates.loading && (
					<p className="description">
						{ __(
							'Loading templates…',
							'fair-events-experimental'
						) }
					</p>
				) }
				{ connection.ready && templates.error && (
					<Notice status="error" isDismissible={ false }>
						{ templates.error }
					</Notice>
				) }
				{ connection.ready &&
					templates.items &&
					0 === matching.length && (
						<p className="description">
							{ __(
								'No approved template has a button opening this link yet. Submit one in WhatsApp Manager with this link as its static button URL, then reload this page.',
								'fair-events-experimental'
							) }
						</p>
					) }

				<div className="fair-whatsapp-reminders__fields">
					<SelectControl
						label={ __( 'Send on', 'fair-events-experimental' ) }
						value={ draft.day_of_week }
						options={ DAYS }
						onChange={ change( 'day_of_week' ) }
					/>
					<TextControl
						type="time"
						label={ __( 'Send at', 'fair-events-experimental' ) }
						help={ __(
							'In the site’s timezone.',
							'fair-events-experimental'
						) }
						value={ draft.time_of_day }
						onChange={ change( 'time_of_day' ) }
					/>
				</div>

				<div className="fair-whatsapp-reminders__actions">
					<Button
						variant="primary"
						onClick={ save }
						isBusy={ pending }
						disabled={ pending || !! problem }
					>
						{ __( 'Save reminder', 'fair-events-experimental' ) }
					</Button>
					{ saved?.recipient && (
						<Button
							variant="secondary"
							isDestructive
							onClick={ () => {
								setRemoveError( null );
								setConfirmRemove( true );
							} }
							disabled={ pending }
						>
							{ __(
								'Remove collaborator',
								'fair-events-experimental'
							) }
						</Button>
					) }
					<Button variant="tertiary" onClick={ onClose }>
						{ __( 'Close', 'fair-events-experimental' ) }
					</Button>
				</div>
				{ problem && (
					<p className="description fair-whatsapp-reminders__problem">
						{ problem }
					</p>
				) }
			</CardBody>

			{ confirmRemove && saved?.recipient && (
				<ConfirmActionModal
					title={ sprintf(
						/* translators: %s: collaborator name */
						__(
							'Remove collaborator — %s',
							'fair-events-experimental'
						),
						saved.recipient.name
					) }
					confirmLabel={ __(
						'Remove collaborator',
						'fair-events-experimental'
					) }
					isDestructive
					isBusy={ removing }
					error={ removeError }
					onConfirm={ removeCollaborator }
					onCancel={ () => setConfirmRemove( false ) }
				>
					<p>
						{ sprintf(
							/* translators: 1: collaborator name, 2: event feed name */
							__(
								'%1$s will no longer get the weekly WhatsApp reminder for %2$s. No reminder is sent for this feed until you designate another collaborator. The schedule, template and history are kept, and unsaved changes in the form are discarded.',
								'fair-events-experimental'
							),
							saved.recipient.name,
							feed.name
						) }
					</p>
				</ConfirmActionModal>
			) }
		</Card>
	);
}
