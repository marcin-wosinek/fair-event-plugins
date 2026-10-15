/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';
import { __, _n, sprintf } from '@wordpress/i18n';
import { useState } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	ExternalLink,
	Notice,
	SelectControl,
	TextareaControl,
	TextControl,
	ToggleControl,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
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
	'page_id',
	'day_of_week',
	'time_of_day',
	'week_scope',
	'chat_ids',
];

const DELIVERY_STATE_LABELS = {
	sending: __( 'Sending', 'fair-events' ),
	sent: __( 'Delivered', 'fair-events' ),
	failed: __( 'Failed', 'fair-events' ),
	uncertain: __( 'Unknown — check the chat before resending', 'fair-events' ),
	skipped: __( 'Not sent — an earlier part failed', 'fair-events' ),
};

function editableState( channel ) {
	return {
		...Object.fromEntries(
			EDITABLE_FIELDS.map( ( field ) => [ field, channel[ field ] ] )
		),
		chat_ids: ( channel.chat_ids || [] ).join( '\n' ),
	};
}

/**
 * Render a Telegram message the way Telegram shows it: plain text with its
 * bold and link entities. Entity offsets count UTF-16 code units, which is
 * how JavaScript indexes strings.
 *
 * @param {Object} props
 * @param {Object} props.message Message with `text` and `entities`.
 */
export function TelegramMessage( { message } ) {
	const entities = message.entities || [];
	const bounds = new Set( [ 0, message.text.length ] );
	entities.forEach( ( entity ) => {
		bounds.add( entity.offset );
		bounds.add( entity.offset + entity.length );
	} );
	const points = [ ...bounds ].sort( ( a, b ) => a - b );

	const pieces = [];
	for ( let i = 0; i < points.length - 1; i++ ) {
		const from = points[ i ];
		const to = points[ i + 1 ];
		const active = entities.filter(
			( entity ) =>
				entity.offset <= from && entity.offset + entity.length >= to
		);
		let node = message.text.slice( from, to );
		if ( active.some( ( entity ) => 'bold' === entity.type ) ) {
			node = <strong>{ node }</strong>;
		}
		const link = active.find(
			( entity ) =>
				'text_link' === entity.type &&
				/^https?:\/\//i.test( entity.url || '' )
		);
		if ( link ) {
			node = (
				<a href={ link.url } target="_blank" rel="noopener noreferrer">
					{ node }
				</a>
			);
		}
		pieces.push( <span key={ from }>{ node }</span> );
	}

	return pieces;
}

/**
 * What the administrator should know about the bot token: whether one is
 * configured, where it comes from, and whether it can be used at all.
 * A configured token is not proof that Telegram accepts it.
 *
 * @param {Object} channel Telegram channel payload.
 * @return {{status: string, message: string}} Notice status and text.
 */
export function tokenStatus( channel ) {
	const source = channel.token_source;
	const name = channel.token_override_name;

	if ( ! channel.token_configured ) {
		return {
			status: 'warning',
			message: __(
				'No bot token is configured. Add one in Connectors to post to Telegram.',
				'fair-events'
			),
		};
	}

	if ( ! channel.token_valid ) {
		if ( 'env' === source ) {
			return {
				status: 'warning',
				message: sprintf(
					/* translators: %s: environment variable name */
					__(
						'The %s environment variable does not hold a valid Telegram bot token, so nothing can be sent. Correct it where it is set.',
						'fair-events'
					),
					name
				),
			};
		}
		if ( 'constant' === source ) {
			return {
				status: 'warning',
				message: sprintf(
					/* translators: %s: PHP constant name */
					__(
						'The %s constant does not hold a valid Telegram bot token, so nothing can be sent. Correct it where it is defined.',
						'fair-events'
					),
					name
				),
			};
		}
		return {
			status: 'warning',
			message: __(
				'The saved bot token is not a valid Telegram bot token, so nothing can be sent. Replace it in Connectors.',
				'fair-events'
			),
		};
	}

	if ( 'env' === source ) {
		return {
			status: 'info',
			message: sprintf(
				/* translators: %s: environment variable name */
				__(
					'The bot token comes from the %s environment variable, which overrides any token saved in Connectors. Send a test to confirm Telegram accepts it.',
					'fair-events'
				),
				name
			),
		};
	}
	if ( 'constant' === source ) {
		return {
			status: 'info',
			message: sprintf(
				/* translators: %s: PHP constant name */
				__(
					'The bot token comes from the %s constant, which overrides any token saved in Connectors. Send a test to confirm Telegram accepts it.',
					'fair-events'
				),
				name
			),
		};
	}
	return {
		status: 'info',
		message: __(
			'A bot token is saved in Connectors. It is not shown here. Send a test to confirm Telegram accepts it.',
			'fair-events'
		),
	};
}

/**
 * Telegram section of the Event notifications page.
 *
 * @param {Object}   props
 * @param {Object}   props.channel Telegram channel payload.
 * @param {Array}    props.sources Enabled event sources.
 * @param {Array}    props.pages   Public pages.
 * @param {Function} props.onSaved Receives the page payload after a save.
 * @return {JSX.Element} The section.
 */
export default function TelegramChannel( {
	channel,
	sources,
	pages,
	onSaved,
} ) {
	const [ form, setForm ] = useState( () => editableState( channel ) );
	const [ notice, setNotice ] = useState( null );
	const [ saving, setSaving ] = useState( false );
	const [ testing, setTesting ] = useState( false );
	const [ testResults, setTestResults ] = useState( null );
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
				path: `${ PATH }/telegram`,
				method: 'POST',
				data: form,
			} );
			onSaved( next );
			setForm( editableState( next.channels.telegram ) );
			setPreview( null );
			setNotice( {
				status: 'success',
				message: __( 'Telegram settings saved.', 'fair-events' ),
			} );
		} catch ( error ) {
			setNotice( {
				status: 'error',
				message: errorMessage(
					error,
					__( 'Failed to save the Telegram settings.', 'fair-events' )
				),
			} );
		}
		setSaving( false );
	};

	const sendTest = async () => {
		setTesting( true );
		setTestResults( null );
		setNotice( null );
		try {
			const response = await apiFetch( {
				path: `${ PATH }/telegram/test`,
				method: 'POST',
			} );
			setTestResults( response.results );
			setNotice(
				response.success
					? {
							status: 'success',
							message: __(
								'Telegram accepted the test summary for every chat.',
								'fair-events'
							),
					  }
					: {
							status: 'error',
							message: __(
								'The test summary did not reach every chat. See the results below.',
								'fair-events'
							),
					  }
			);
		} catch ( error ) {
			setNotice( {
				status: 'error',
				message: errorMessage(
					error,
					__( 'Failed to send the test summary.', 'fair-events' )
				),
			} );
		}
		setTesting( false );
	};

	const loadPreview = async () => {
		setPreviewing( true );
		try {
			setPreview(
				await apiFetch( { path: `${ PATH }/telegram/preview` } )
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
			<h2>{ __( 'Telegram', 'fair-events' ) }</h2>
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

	const pageOptions = [
		{ value: '0', label: __( 'Choose a page', 'fair-events' ) },
		...pages.map( ( page ) => ( {
			value: String( page.id ),
			label: page.title,
		} ) ),
	];

	const token = tokenStatus( channel );
	const tokenUsable = channel.token_configured && channel.token_valid;
	let testBlockedReason = null;
	if ( ! tokenUsable ) {
		testBlockedReason = __(
			'Fix the bot token in Connectors before sending a test message.',
			'fair-events'
		);
	} else if ( 0 === channel.chat_ids.length ) {
		testBlockedReason = __(
			'Save at least one chat or channel before sending a test message.',
			'fair-events'
		);
	} else if ( dirty ) {
		testBlockedReason = __(
			'Save your changes first — the test uses the saved settings.',
			'fair-events'
		);
	}

	return (
		<Card className="fair-events-notifications__channel">
			{ header }
			<CardBody>
				<p>
					{ __(
						'Post the week’s events to Telegram chats and channels, in the same format as the calendar’s “Copy summary” button.',
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
						'Post the weekly summary to Telegram',
						'fair-events'
					) }
					help={ __(
						'Turning this off keeps the bot token in Connectors and everything below.',
						'fair-events'
					) }
					checked={ !! form.enabled }
					onChange={ update( 'enabled' ) }
				/>

				<div className="fair-events-notifications__fields">
					<SelectControl
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
						label={ __(
							'Page linked in the heading',
							'fair-events'
						) }
						help={ __(
							'Any published, public page. Its title and link head the message.',
							'fair-events'
						) }
						value={ String( form.page_id || 0 ) }
						options={ pageOptions }
						onChange={ ( value ) =>
							update( 'page_id' )( parseInt( value, 10 ) || 0 )
						}
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
							'Previews and tests select the week relative to today in the site timezone. Scheduled sends select it relative to their scheduled week.',
							'fair-events'
						) }
						value={ form.week_scope }
						options={ WEEK_SCOPES }
						onChange={ update( 'week_scope' ) }
					/>

					<TextareaControl
						className="is-wide"
						label={ __( 'Chats and channels', 'fair-events' ) }
						help={ __(
							'One per line: a numeric chat ID (e.g. -1001234567890) or a public @channel username. Add the bot to each chat or channel with permission to post.',
							'fair-events'
						) }
						value={ form.chat_ids }
						onChange={ update( 'chat_ids' ) }
						rows={ 3 }
					/>
				</div>

				<Notice status={ token.status } isDismissible={ false }>
					{ token.message }{ ' ' }
					<ExternalLink href={ channel.connectors_url }>
						{ __( 'Manage in Connectors', 'fair-events' ) }
					</ExternalLink>
				</Notice>

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
						{ __( 'Save Telegram settings', 'fair-events' ) }
					</Button>
					<Button
						variant="secondary"
						onClick={ loadPreview }
						isBusy={ previewing }
						disabled={ previewing || dirty }
					>
						{ __( 'Preview next Telegram message', 'fair-events' ) }
					</Button>
					<Button
						variant="secondary"
						onClick={ sendTest }
						isBusy={ testing }
						disabled={ saving || testing || !! testBlockedReason }
					>
						{ __( 'Send test to the saved chats', 'fair-events' ) }
					</Button>
				</div>
				<p className="description">
					{ channel.chat_ids.length > 0
						? sprintf(
								/* translators: %s: comma-separated list of Telegram chats */
								__(
									'The test posts the selected week’s summary to: %s. It works while posting is off and is not recorded as a weekly send.',
									'fair-events'
								),
								channel.chat_ids.join( ', ' )
						  )
						: __(
								'The test posts the selected week’s summary to every saved chat. It works while posting is off and is not recorded as a weekly send.',
								'fair-events'
						  ) }
				</p>
				{ testBlockedReason && (
					<p className="description">{ testBlockedReason }</p>
				) }
				{ dirty && ! testBlockedReason && (
					<p className="description">
						{ __(
							'Save your changes to preview them.',
							'fair-events'
						) }
					</p>
				) }

				{ testResults &&
					testResults.map( ( result ) => (
						<Row
							key={ result.destination }
							detail={ result.message }
						>
							<strong>{ result.destination }</strong>
							<StatusText
								state={ result.state }
								label={
									DELIVERY_STATE_LABELS[ result.state ] ||
									result.state
								}
							/>
						</Row>
					) ) }

				{ preview?.error && (
					<Notice status="error" isDismissible={ false }>
						{ preview.error }
					</Notice>
				) }
				{ preview && ! preview.error && (
					<>
						<p>
							{ 0 === preview.occurrence_count
								? sprintf(
										/* translators: %s: date range of a week */
										__(
											'No events for %s, so nothing would be sent.',
											'fair-events'
										),
										preview.week_title
								  )
								: sprintf(
										/* translators: 1: number of Telegram messages, 2: date range of a week */
										_n(
											'Events for %2$s, sent as %1$d message.',
											'Events for %2$s, sent as %1$d messages.',
											preview.messages.length,
											'fair-events'
										),
										preview.messages.length,
										preview.week_title
								  ) }
						</p>
						{ 0 < preview.occurrence_count &&
							preview.messages.map( ( message, index ) => (
								<div
									key={ index }
									role="group"
									aria-label={ sprintf(
										/* translators: 1: message number, 2: number of messages */
										__(
											'Telegram message %1$d of %2$d',
											'fair-events'
										),
										index + 1,
										preview.messages.length
									) }
									className="fair-events-notifications__preview is-telegram"
								>
									<TelegramMessage message={ message } />
								</div>
							) ) }
					</>
				) }

				<h3>{ __( 'Delivery status', 'fair-events' ) }</h3>
				<p>
					{ channel.next_run
						? sprintf(
								/* translators: 1: date and time of the next send, 2: date range of the week it covers */
								__(
									'Next send: %1$s, with events for %2$s.',
									'fair-events'
								),
								channel.next_run.time_local,
								channel.next_run.week_title
						  )
						: __(
								'Nothing is scheduled. Turn on posting and save to schedule sends.',
								'fair-events'
						  ) }
				</p>
				{ 0 === channel.runs.length ? (
					<p>
						{ __(
							'No Telegram summary has been sent yet.',
							'fair-events'
						) }
					</p>
				) : (
					channel.runs.map( ( run ) => (
						<Row key={ run.week_start } detail={ run.message }>
							<strong>{ run.week_title }</strong>
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

				{ channel.deliveries.length > 0 && (
					<>
						<h3>{ __( 'Messages by chat', 'fair-events' ) }</h3>
						{ channel.deliveries.map( ( delivery ) => (
							<Row
								key={ `${ delivery.week_start }-${ delivery.destination }-${ delivery.part }` }
								detail={
									delivery.error_message ||
									delivery.error_code
								}
							>
								<strong>{ delivery.destination }</strong>
								{ delivery.part_count > 1 && (
									<span>
										{ sprintf(
											/* translators: 1: message part number, 2: number of parts */
											__(
												'Part %1$d of %2$d',
												'fair-events'
											),
											delivery.part,
											delivery.part_count
										) }
									</span>
								) }
								<StatusText
									state={ delivery.state }
									label={
										DELIVERY_STATE_LABELS[
											delivery.state
										] || delivery.state
									}
								/>
								<span>{ delivery.updated_at_local }</span>
							</Row>
						) ) }
					</>
				) }
			</CardBody>
		</Card>
	);
}
