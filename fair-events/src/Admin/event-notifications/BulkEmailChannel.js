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
	sourceOptions,
	useUnsavedWarning,
} from './shared.js';

const EDITABLE_FIELDS = [
	'enabled',
	'source_slug',
	'day_of_week',
	'time_of_day',
	'week_scope',
	'skip_empty',
	'subject',
	'intro',
	'outro',
];

function editableState( channel ) {
	return Object.fromEntries(
		EDITABLE_FIELDS.map( ( field ) => [ field, channel[ field ] ] )
	);
}

/**
 * Bulk email section of the Event notifications page.
 *
 * Fair Audience decides who receives the email and sends it; without it the
 * section explains that sending is paused and leaves the saved settings alone.
 *
 * @param {Object}   props
 * @param {Object}   props.channel Bulk email channel payload.
 * @param {Array}    props.sources Enabled event sources.
 * @param {Function} props.onSaved Receives the page payload after a save.
 * @return {JSX.Element} The section.
 */
export default function BulkEmailChannel( { channel, sources, onSaved } ) {
	const [ form, setForm ] = useState( () => editableState( channel ) );
	const [ notice, setNotice ] = useState( null );
	const [ saving, setSaving ] = useState( false );
	const [ testing, setTesting ] = useState( false );
	const [ previewing, setPreviewing ] = useState( false );
	const [ preview, setPreview ] = useState( null );

	const saved = editableState( channel );
	const active = 'active' === channel.state;
	const dirty =
		active &&
		EDITABLE_FIELDS.some( ( field ) => saved[ field ] !== form[ field ] );
	useUnsavedWarning( dirty );

	const update = ( field ) => ( value ) =>
		setForm( ( current ) => ( { ...current, [ field ]: value } ) );

	const save = async () => {
		setSaving( true );
		setNotice( null );
		try {
			const next = await apiFetch( {
				path: `${ PATH }/bulk-email`,
				method: 'POST',
				data: form,
			} );
			onSaved( next );
			setForm( editableState( next.channels.bulk_email ) );
			setPreview( null );
			setNotice( {
				status: 'success',
				message: __( 'Bulk email settings saved.', 'fair-events' ),
			} );
		} catch ( error ) {
			setNotice( {
				status: 'error',
				message: errorMessage(
					error,
					__(
						'Failed to save the bulk email settings.',
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
				path: `${ PATH }/bulk-email/test`,
				method: 'POST',
			} );
			setNotice( {
				status: 'success',
				message: sprintf(
					/* translators: %s: email address the test was sent to */
					__(
						'Test email sent to %s. No subscriber received it.',
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
				await apiFetch( { path: `${ PATH }/bulk-email/preview` } )
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

	const header = (
		<CardHeader>
			<h2>{ __( 'Bulk email', 'fair-events' ) }</h2>
			{ dirty && (
				<span className="fair-events-notifications__unsaved">
					{ __( 'Unsaved changes', 'fair-events' ) }
				</span>
			) }
		</CardHeader>
	);

	if ( ! active ) {
		return (
			<Card className="fair-events-notifications__channel">
				{ header }
				<CardBody>
					<Notice status="warning" isDismissible={ false }>
						{ channel.state_message }
					</Notice>
				</CardBody>
			</Card>
		);
	}

	const blockedReason = dirty
		? __(
				'Save your changes first — the preview and the test use the saved settings.',
				'fair-events'
			)
		: null;

	return (
		<Card className="fair-events-notifications__channel">
			{ header }
			<CardBody>
				<p>
					{ __(
						'Email the week’s events to your subscribers. Fair Audience decides who receives it: only participants who agreed to marketing emails and did not opt out of the weekly summary, each with their own unsubscribe link.',
						'fair-events'
					) }
				</p>

				<ToggleControl
					label={ __(
						'Email the weekly summary to subscribers',
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
					<SelectControl
						className="is-wide"
						label={ __( 'Events to include', 'fair-events' ) }
						help={ __(
							'The event feed whose events are listed.',
							'fair-events'
						) }
						value={ form.source_slug }
						options={ sourceOptions( sources, form.source_slug ) }
						onChange={ update( 'source_slug' ) }
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
						disabled={ saving || testing }
					>
						{ __( 'Save bulk email settings', 'fair-events' ) }
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
						disabled={ saving || testing || dirty }
					>
						{ sprintf(
							/* translators: %s: the administrator's own email address */
							__( 'Send test email to %s', 'fair-events' ),
							channel.test_recipient
						) }
					</Button>
				</div>
				<p className="description">
					{ __(
						'The test goes to your address only, never to subscribers, and does not count as the week’s send.',
						'fair-events'
					) }
				</p>
				{ blockedReason && (
					<p className="description">{ blockedReason }</p>
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
								{ form.skip_empty
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
									RUN_STATUS_LABELS[ run.status ] ||
									run.status
								}
							/>
							<span>{ run.time_local }</span>
						</Row>
					) )
				) }
			</CardBody>
		</Card>
	);
}
