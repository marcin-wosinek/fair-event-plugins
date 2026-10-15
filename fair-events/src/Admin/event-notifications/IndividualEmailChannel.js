/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';
import { __, sprintf } from '@wordpress/i18n';
import { useState } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	Notice,
	SelectControl,
	TextControl,
	ToggleControl,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import EmailContentControls from './EmailContentControls.js';
import {
	DAYS,
	PATH,
	RUN_STATUS_LABELS,
	Row,
	StatusText,
	WEEK_SCOPES,
	errorMessage,
	useUnsavedWarning,
} from './shared.js';

/**
 * Event selection meaning every published event of this site. Mirrors
 * IndividualEmailSettings::LOCAL_EVENTS; any other value is a source slug.
 */
const LOCAL_EVENTS = '@local';

const EDITABLE_FIELDS = [
	'enabled',
	'recipient',
	'event_selection',
	'day_of_week',
	'time_of_day',
	'week_scope',
	'skip_empty',
	'subject',
	'intro',
	'outro',
];

// Sending succeeded only as far as this site can tell.
const STATUS_LABELS = {
	...RUN_STATUS_LABELS,
	sent: __( 'Handed over for delivery', 'fair-events' ),
};

function editableState( channel ) {
	return Object.fromEntries(
		EDITABLE_FIELDS.map( ( field ) => [ field, channel[ field ] ] )
	);
}

/**
 * Whether a value is one plain email address. The server has the final say;
 * this only catches lists and typos before a save.
 *
 * @param {string} value Typed recipient.
 * @return {boolean} Whether it looks like one address.
 */
export function isSingleEmail( value ) {
	return /^[^\s@,;<>()"'\\]+@[^\s@,;<>()"'\\]+\.[^\s@,;<>()"'\\]+$/.test(
		value
	);
}

/**
 * Options for the event selection: every local event, then each event
 * source. A saved source that is no longer available stays visible instead
 * of silently becoming another selection.
 *
 * @param {Array}  sources Enabled event sources.
 * @param {string} current Selected value.
 * @return {Array} Select options.
 */
function selectionOptions( sources, current ) {
	const options = [
		{
			value: LOCAL_EVENTS,
			label: __( 'All published local events', 'fair-events' ),
		},
		...sources.map( ( source ) => ( {
			value: source.slug,
			label: source.name,
		} ) ),
	];
	if ( ! options.some( ( option ) => option.value === current ) ) {
		options.push( {
			value: current,
			label: sprintf(
				/* translators: %s: event feed slug */
				__( '%s (unavailable)', 'fair-events' ),
				current
			),
		} );
	}
	return options;
}

/**
 * Individual email section of the Event notifications page.
 *
 * Sends the week's events to one address typed in here. Fair Events sends it
 * on its own: no other plugin, user account or participant is involved.
 *
 * @param {Object}   props
 * @param {Object}   props.channel Individual email channel payload.
 * @param {Array}    props.sources Enabled event sources.
 * @param {Function} props.onSaved Receives the page payload after a save.
 * @return {JSX.Element} The section.
 */
export default function IndividualEmailChannel( {
	channel,
	sources,
	onSaved,
} ) {
	const [ form, setForm ] = useState( () => editableState( channel ) );
	const [ notice, setNotice ] = useState( null );
	const [ saving, setSaving ] = useState( false );
	const [ testing, setTesting ] = useState( false );
	const [ previewing, setPreviewing ] = useState( false );
	const [ preview, setPreview ] = useState( null );

	const saved = editableState( channel );
	const dirty = EDITABLE_FIELDS.some(
		( field ) => saved[ field ] !== form[ field ]
	);
	useUnsavedWarning( dirty );

	const update = ( field ) => ( value ) =>
		setForm( ( current ) => ( { ...current, [ field ]: value } ) );

	const recipient = form.recipient.trim();
	let recipientProblem = null;
	if ( '' !== recipient && ! isSingleEmail( recipient ) ) {
		recipientProblem = __(
			'Enter exactly one email address, for example name@example.com.',
			'fair-events'
		);
	} else if ( '' === recipient && form.enabled ) {
		recipientProblem = __(
			'Enter the email address that receives the weekly email before turning it on.',
			'fair-events'
		);
	}

	const save = async () => {
		setSaving( true );
		setNotice( null );
		try {
			const next = await apiFetch( {
				path: `${ PATH }/individual-email`,
				method: 'POST',
				data: { ...form, recipient },
			} );
			onSaved( next );
			setForm( editableState( next.channels.individual_email ) );
			setPreview( null );
			setNotice( {
				status: 'success',
				message: __(
					'Individual email settings saved.',
					'fair-events'
				),
			} );
		} catch ( error ) {
			setNotice( {
				status: 'error',
				message: errorMessage(
					error,
					__(
						'Failed to save the individual email settings.',
						'fair-events'
					)
				),
			} );
		}
		setSaving( false );
	};

	const sendTest = async () => {
		setTesting( true );
		setNotice( null );
		try {
			const response = await apiFetch( {
				path: `${ PATH }/individual-email/test`,
				method: 'POST',
			} );
			setNotice( {
				status: 'success',
				message: sprintf(
					/* translators: %s: email address the test was sent to */
					__(
						'Test email handed over for delivery to %s. The schedule is unchanged.',
						'fair-events'
					),
					response.sent_to
				),
			} );
		} catch ( error ) {
			setNotice( {
				status: 'error',
				message: errorMessage(
					error,
					__( 'Failed to send the test email.', 'fair-events' )
				),
			} );
		}
		setTesting( false );
	};

	const loadPreview = async () => {
		setPreviewing( true );
		try {
			setPreview(
				await apiFetch( { path: `${ PATH }/individual-email/preview` } )
			);
		} catch ( error ) {
			setPreview( {
				error: errorMessage(
					error,
					__( 'Failed to build the preview.', 'fair-events' )
				),
			} );
		}
		setPreviewing( false );
	};

	let testBlockedReason = null;
	if ( dirty ) {
		testBlockedReason = __(
			'Save your changes first — the preview and the test use the saved settings.',
			'fair-events'
		);
	} else if ( ! channel.recipient ) {
		testBlockedReason = __(
			'Save an email address before sending a test.',
			'fair-events'
		);
	}

	return (
		<Card className="fair-events-notifications__channel">
			<CardHeader>
				<h2>{ __( 'Individual email', 'fair-events' ) }</h2>
				{ dirty && (
					<span className="fair-events-notifications__unsaved">
						{ __( 'Unsaved changes', 'fair-events' ) }
					</span>
				) }
			</CardHeader>
			<CardBody>
				<p>
					{ __(
						'Email the week’s events to one address you enter here, for example your own inbox or a shared mailbox. Fair Events sends it on its own; no other plugin is needed.',
						'fair-events'
					) }
				</p>

				{ channel.configuration_error && (
					<Notice status="warning" isDismissible={ false }>
						{ channel.configuration_error }
					</Notice>
				) }

				<ToggleControl
					label={ __(
						'Email the weekly summary to this address',
						'fair-events'
					) }
					help={ __(
						'Turning this off keeps everything below.',
						'fair-events'
					) }
					checked={ !! form.enabled }
					onChange={ update( 'enabled' ) }
				/>

				<div className="fair-events-notifications__fields">
					<TextControl
						className="is-wide"
						type="email"
						label={ __( 'Send to', 'fair-events' ) }
						help={ __(
							'One email address. It does not need to belong to a user of this site.',
							'fair-events'
						) }
						value={ form.recipient }
						onChange={ update( 'recipient' ) }
						autoComplete="off"
					/>

					<SelectControl
						className="is-wide"
						label={ __( 'Events to include', 'fair-events' ) }
						help={ __(
							'Drafts and private events are never included.',
							'fair-events'
						) }
						value={ form.event_selection }
						options={ selectionOptions(
							sources,
							form.event_selection
						) }
						onChange={ update( 'event_selection' ) }
					/>

					<SelectControl
						label={ __( 'Send on', 'fair-events' ) }
						value={ String( form.day_of_week ) }
						options={ DAYS }
						onChange={ ( value ) =>
							update( 'day_of_week' )( parseInt( value, 10 ) )
						}
					/>

					<TextControl
						type="time"
						label={ __( 'Send at', 'fair-events' ) }
						value={ form.time_of_day }
						onChange={ update( 'time_of_day' ) }
					/>

					<SelectControl
						className="is-wide"
						label={ __( 'Which week to include', 'fair-events' ) }
						help={ __(
							'Weeks run from Monday to Sunday. Previews and tests select the week relative to today in the site timezone. Scheduled sends select it relative to their scheduled week.',
							'fair-events'
						) }
						value={ form.week_scope }
						options={ WEEK_SCOPES }
						onChange={ update( 'week_scope' ) }
					/>

					<EmailContentControls
						values={ form }
						onChange={ ( field, value ) =>
							update( field )( value )
						}
					/>
				</div>

				{ notice && (
					<Notice
						status={ notice.status }
						onRemove={ () => setNotice( null ) }
					>
						{ notice.message }
					</Notice>
				) }

				<div className="fair-events-notifications__actions">
					<Button
						variant="primary"
						onClick={ save }
						isBusy={ saving }
						disabled={ saving || testing || !! recipientProblem }
					>
						{ __(
							'Save individual email settings',
							'fair-events'
						) }
					</Button>
					<Button
						variant="secondary"
						onClick={ loadPreview }
						isBusy={ previewing }
						disabled={ previewing || dirty }
					>
						{ __( 'Preview next email', 'fair-events' ) }
					</Button>
					<Button
						variant="secondary"
						onClick={ sendTest }
						isBusy={ testing }
						disabled={ saving || testing || !! testBlockedReason }
					>
						{ channel.recipient
							? sprintf(
									/* translators: %s: the saved recipient email address */
									__(
										'Send test email to %s',
										'fair-events'
									),
									channel.recipient
								)
							: __( 'Send test email', 'fair-events' ) }
					</Button>
				</div>
				{ recipientProblem && (
					<p className="description">{ recipientProblem }</p>
				) }
				<p className="description">
					{ __(
						'The test goes to the saved address only. It works while the weekly email is off, does not count as the week’s send and does not move the next one.',
						'fair-events'
					) }
				</p>
				{ testBlockedReason && (
					<p className="description">{ testBlockedReason }</p>
				) }

				{ preview?.error && (
					<Notice status="error" isDismissible={ false }>
						{ preview.error }
					</Notice>
				) }
				{ preview && ! preview.error && (
					<>
						{ preview.empty && (
							<Notice status="warning" isDismissible={ false }>
								{ preview.skip_empty
									? sprintf(
											/* translators: %s: date range of a week */
											__(
												'No events for %s, so no email would be sent.',
												'fair-events'
											),
											preview.week_title
										)
									: sprintf(
											/* translators: %s: date range of a week */
											__(
												'No events for %s. The email below would still be sent.',
												'fair-events'
											),
											preview.week_title
										) }
							</Notice>
						) }
						<p>
							<strong>{ __( 'To:', 'fair-events' ) }</strong>{ ' ' }
							{ preview.recipient ||
								__(
									'No email address is saved yet.',
									'fair-events'
								) }
						</p>
						<p>
							<strong>{ __( 'Subject:', 'fair-events' ) }</strong>{ ' ' }
							{ preview.subject }
						</p>
						<div
							className="fair-events-notifications__preview"
							role="group"
							aria-label={ __( 'Email preview', 'fair-events' ) }
							// The server sanitizes the body with wp_kses_post().
							dangerouslySetInnerHTML={ {
								__html: preview.html,
							} }
						/>
					</>
				) }

				<h3>{ __( 'Delivery status', 'fair-events' ) }</h3>
				<p>
					{ channel.next_run
						? sprintf(
								/* translators: %s: date and time of the next send */
								__( 'Next send: %s.', 'fair-events' ),
								channel.next_run.time_local
							)
						: __(
								'Nothing is scheduled. Turn on the weekly email and save to schedule sends.',
								'fair-events'
							) }
				</p>
				{ 0 === channel.runs.length ? (
					<p>
						{ __(
							'No weekly email has been sent yet.',
							'fair-events'
						) }
					</p>
				) : (
					channel.runs.map( ( run ) => (
						<Row
							key={ run.send_week || run.time }
							detail={ run.message }
						>
							<strong>{ run.week_title || run.send_week }</strong>
							<StatusText
								state={ run.status }
								label={
									STATUS_LABELS[ run.status ] || run.status
								}
							/>
							{ run.destination && (
								<span>{ run.destination }</span>
							) }
							<span>{ run.time_local }</span>
						</Row>
					) )
				) }
			</CardBody>
		</Card>
	);
}
