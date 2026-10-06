import apiFetch from '@wordpress/api-fetch';
import { __, _n, sprintf } from '@wordpress/i18n';
import { useEffect, useState } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	ExternalLink,
	Flex,
	FlexItem,
	Notice,
	SelectControl,
	TextareaControl,
	TextControl,
	ToggleControl,
	__experimentalVStack as VStack,
} from '@wordpress/components';

const PATH = '/fair-events-experimental/v1/weekly-notifications';

const EDITABLE_FIELDS = [
	'enabled',
	'source_slug',
	'page_id',
	'day_of_week',
	'time_of_day',
	'week_scope',
	'telegram_enabled',
	'telegram_chat_ids',
];

// Fields describing the bot token, which is managed in Settings → Connectors.
const TOKEN_FIELDS = [
	'telegram_token_configured',
	'telegram_token_valid',
	'telegram_token_source',
	'connectors_url',
];

// Environment variable and PHP constant that override the saved token.
const TOKEN_OVERRIDE_NAME = 'FAIR_EVENTS_EXPERIMENTAL_TELEGRAM_BOT_TOKEN';

const DAYS = [
	{ value: '1', label: __( 'Monday', 'fair-events-experimental' ) },
	{ value: '2', label: __( 'Tuesday', 'fair-events-experimental' ) },
	{ value: '3', label: __( 'Wednesday', 'fair-events-experimental' ) },
	{ value: '4', label: __( 'Thursday', 'fair-events-experimental' ) },
	{ value: '5', label: __( 'Friday', 'fair-events-experimental' ) },
	{ value: '6', label: __( 'Saturday', 'fair-events-experimental' ) },
	{ value: '7', label: __( 'Sunday', 'fair-events-experimental' ) },
];

const RUN_STATUS_LABELS = {
	sent: __( 'Sent', 'fair-events-experimental' ),
	partial: __( 'Partly sent', 'fair-events-experimental' ),
	failed: __( 'Failed', 'fair-events-experimental' ),
	skipped_empty: __( 'Skipped — no events', 'fair-events-experimental' ),
	expired: __( 'Skipped — week ended', 'fair-events-experimental' ),
	configuration_error: __(
		'Configuration error',
		'fair-events-experimental'
	),
};

const DELIVERY_STATE_LABELS = {
	sending: __( 'Sending', 'fair-events-experimental' ),
	sent: __( 'Delivered', 'fair-events-experimental' ),
	failed: __( 'Failed', 'fair-events-experimental' ),
	uncertain: __(
		'Unknown — check the chat before resending',
		'fair-events-experimental'
	),
	skipped: __(
		'Not sent — an earlier part failed',
		'fair-events-experimental'
	),
};

const STATE_COLORS = {
	sent: '#00a32a',
	partial: '#b26200',
	uncertain: '#b26200',
	sending: '#757575',
	skipped: '#757575',
	skipped_empty: '#757575',
	expired: '#757575',
	failed: '#d63638',
	configuration_error: '#d63638',
};

const PROVIDER_LABELS = {
	telegram: __( 'Telegram', 'fair-events-experimental' ),
};

function errorMessage( error, fallback ) {
	return error?.message || error?.data?.message || fallback;
}

function chatIdsText( chatIds ) {
	return ( chatIds || [] ).join( '\n' );
}

function editableState( config ) {
	return {
		...Object.fromEntries(
			EDITABLE_FIELDS.map( ( field ) => [ field, config[ field ] ] )
		),
		telegram_chat_ids: chatIdsText( config.telegram_chat_ids ),
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
 * @param {Object} config Settings response.
 * @return {{status: string, message: string}} Notice status and text.
 */
export function tokenStatus( config ) {
	const source = config.telegram_token_source;

	if ( ! config.telegram_token_configured ) {
		return {
			status: 'warning',
			message: __(
				'No bot token is configured. Add one in Connectors to post to Telegram.',
				'fair-events-experimental'
			),
		};
	}

	if ( ! config.telegram_token_valid ) {
		if ( 'env' === source ) {
			return {
				status: 'warning',
				message: sprintf(
					/* translators: %s: environment variable name */
					__(
						'The %s environment variable does not hold a valid Telegram bot token, so nothing can be sent. Correct it where it is set.',
						'fair-events-experimental'
					),
					TOKEN_OVERRIDE_NAME
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
						'fair-events-experimental'
					),
					TOKEN_OVERRIDE_NAME
				),
			};
		}
		return {
			status: 'warning',
			message: __(
				'The saved bot token is not a valid Telegram bot token, so nothing can be sent. Replace it in Connectors.',
				'fair-events-experimental'
			),
		};
	}

	if ( 'env' === source ) {
		return {
			status: 'info',
			message: sprintf(
				/* translators: %s: environment variable name */
				__(
					'The bot token comes from the %s environment variable, which overrides any token saved in Connectors. Send a test summary to confirm Telegram accepts it.',
					'fair-events-experimental'
				),
				TOKEN_OVERRIDE_NAME
			),
		};
	}
	if ( 'constant' === source ) {
		return {
			status: 'info',
			message: sprintf(
				/* translators: %s: PHP constant name */
				__(
					'The bot token comes from the %s constant, which overrides any token saved in Connectors. Send a test summary to confirm Telegram accepts it.',
					'fair-events-experimental'
				),
				TOKEN_OVERRIDE_NAME
			),
		};
	}
	return {
		status: 'info',
		message: __(
			'A bot token is saved in Connectors. It is not shown here. Send a test summary to confirm Telegram accepts it.',
			'fair-events-experimental'
		),
	};
}

function StatusText( { state, label } ) {
	return (
		<span
			style={ {
				color: STATE_COLORS[ state ] || '#1e1e1e',
				fontWeight: 600,
			} }
		>
			{ label }
		</span>
	);
}

function Row( { children, detail } ) {
	return (
		<div
			style={ {
				borderBottom: '1px solid #e0e0e0',
				paddingBottom: '8px',
			} }
		>
			<Flex wrap justify="flex-start" gap={ 3 }>
				{ children }
			</Flex>
			{ detail && (
				<p style={ { margin: '4px 0 0', color: '#757575' } }>
					{ detail }
				</p>
			) }
		</div>
	);
}

export default function WeeklyNotifications( { onNotice } ) {
	const [ config, setConfig ] = useState( null );
	const [ form, setForm ] = useState( null );
	const [ saving, setSaving ] = useState( false );
	const [ testing, setTesting ] = useState( false );
	const [ testResults, setTestResults ] = useState( null );
	const [ previewing, setPreviewing ] = useState( false );
	const [ preview, setPreview ] = useState( null );

	const applyConfig = ( next ) => {
		setConfig( next );
		setForm( editableState( next ) );
	};

	useEffect( () => {
		apiFetch( { path: PATH } )
			.then( applyConfig )
			.catch( () =>
				onNotice( {
					status: 'error',
					message: __(
						'Failed to load weekly notification settings.',
						'fair-events-experimental'
					),
				} )
			);
	}, [] );

	// The token is edited on another screen, usually in another tab. Coming
	// back re-reads only its status, so unsaved edits here are kept.
	useEffect( () => {
		const refreshToken = () => {
			if ( 'hidden' === document.visibilityState ) {
				return;
			}
			apiFetch( { path: PATH } )
				.then( ( next ) =>
					setConfig(
						( current ) =>
							current && {
								...current,
								...Object.fromEntries(
									TOKEN_FIELDS.map( ( field ) => [
										field,
										next[ field ],
									] )
								),
							}
					)
				)
				.catch( () => {} );
		};
		window.addEventListener( 'focus', refreshToken );
		document.addEventListener( 'visibilitychange', refreshToken );
		return () => {
			window.removeEventListener( 'focus', refreshToken );
			document.removeEventListener( 'visibilitychange', refreshToken );
		};
	}, [] );

	const dirty =
		!! form &&
		EDITABLE_FIELDS.some(
			( field ) => editableState( config )[ field ] !== form[ field ]
		);

	useEffect( () => {
		if ( ! dirty ) {
			return undefined;
		}
		const warn = ( event ) => {
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener( 'beforeunload', warn );
		return () => window.removeEventListener( 'beforeunload', warn );
	}, [ dirty ] );

	if ( ! config || ! form ) {
		return (
			<p>
				{ __(
					'Loading weekly notification settings…',
					'fair-events-experimental'
				) }
			</p>
		);
	}

	const update = ( field ) => ( value ) =>
		setForm( { ...form, [ field ]: value } );

	const save = async () => {
		setSaving( true );
		try {
			const data = {
				...form,
				page_id: parseInt( form.page_id, 10 ) || 0,
				day_of_week: parseInt( form.day_of_week, 10 ),
			};
			const next = await apiFetch( { path: PATH, method: 'POST', data } );
			applyConfig( next );
			setPreview( null );
			onNotice( {
				status: 'success',
				message: __(
					'Weekly notification settings saved.',
					'fair-events-experimental'
				),
			} );
		} catch ( error ) {
			onNotice( {
				status: 'error',
				message: errorMessage(
					error,
					__(
						'Failed to save weekly notification settings.',
						'fair-events-experimental'
					)
				),
			} );
		}
		setSaving( false );
	};

	const sendTest = async () => {
		setTesting( true );
		setTestResults( null );
		try {
			const response = await apiFetch( {
				path: `${ PATH }/test`,
				method: 'POST',
			} );
			setTestResults( response.results );
			onNotice(
				response.success
					? {
							status: 'success',
							message: __(
								'Telegram accepted the test summary for every chat.',
								'fair-events-experimental'
							),
					  }
					: {
							status: 'error',
							message: __(
								'The test summary did not reach every chat. See the results below.',
								'fair-events-experimental'
							),
					  }
			);
		} catch ( error ) {
			onNotice( {
				status: 'error',
				message: errorMessage(
					error,
					__(
						'Failed to send the test summary.',
						'fair-events-experimental'
					)
				),
			} );
		}
		setTesting( false );
	};

	const loadPreview = async () => {
		setPreviewing( true );
		try {
			setPreview( await apiFetch( { path: `${ PATH }/preview` } ) );
		} catch ( error ) {
			setPreview( {
				error: errorMessage(
					error,
					__(
						'Failed to build the preview.',
						'fair-events-experimental'
					)
				),
			} );
		}
		setPreviewing( false );
	};

	const sourceOptions = [
		{
			value: '',
			label: __( 'Choose an event source', 'fair-events-experimental' ),
		},
		...config.sources.map( ( source ) => ( {
			value: source.slug,
			label: source.name,
		} ) ),
	];
	if (
		form.source_slug &&
		! config.sources.some( ( source ) => source.slug === form.source_slug )
	) {
		sourceOptions.push( {
			value: form.source_slug,
			label: sprintf(
				/* translators: %s: event source slug */
				__( '%s (unavailable)', 'fair-events-experimental' ),
				form.source_slug
			),
		} );
	}

	const pageOptions = [
		{
			value: '0',
			label: __( 'Choose a page', 'fair-events-experimental' ),
		},
		...config.pages.map( ( page ) => ( {
			value: String( page.id ),
			label: page.title,
		} ) ),
	];

	const token = tokenStatus( config );
	const tokenUsable =
		config.telegram_token_configured && config.telegram_token_valid;
	let testBlockedReason = null;
	if ( ! tokenUsable ) {
		testBlockedReason = __(
			'Fix the bot token in Connectors before sending a test message.',
			'fair-events-experimental'
		);
	} else if ( 0 === config.telegram_chat_ids.length ) {
		testBlockedReason = __(
			'Save at least one chat or channel before sending a test message.',
			'fair-events-experimental'
		);
	} else if ( dirty ) {
		testBlockedReason = __(
			'Save your changes first — the test uses the saved settings.',
			'fair-events-experimental'
		);
	}

	return (
		<Card style={ { marginTop: '16px' } }>
			<CardHeader>
				<h2>
					{ __( 'Weekly notifications', 'fair-events-experimental' ) }
				</h2>
			</CardHeader>
			<CardBody>
				<p>
					{ __(
						'Post the week’s events from an event source to your channels every week, in the same format as the calendar’s “Copy summary” button.',
						'fair-events-experimental'
					) }
				</p>

				{ config.configuration_error && (
					<Notice status="warning" isDismissible={ false }>
						{ config.configuration_error }
					</Notice>
				) }

				<ToggleControl
					label={ __(
						'Send weekly event notifications',
						'fair-events-experimental'
					) }
					checked={ !! form.enabled }
					onChange={ update( 'enabled' ) }
				/>

				<SelectControl
					label={ __( 'Event source', 'fair-events-experimental' ) }
					value={ form.source_slug }
					options={ sourceOptions }
					onChange={ update( 'source_slug' ) }
				/>

				<SelectControl
					label={ __(
						'Page linked in the heading',
						'fair-events-experimental'
					) }
					help={ __(
						'Any published, public page. Its title and link head the message. The event source decides which events are listed.',
						'fair-events-experimental'
					) }
					value={ String( form.page_id || 0 ) }
					options={ pageOptions }
					onChange={ ( value ) =>
						update( 'page_id' )( parseInt( value, 10 ) )
					}
				/>

				<SelectControl
					label={ __( 'Send on', 'fair-events-experimental' ) }
					value={ String( form.day_of_week ) }
					options={ DAYS }
					onChange={ ( value ) =>
						update( 'day_of_week' )( parseInt( value, 10 ) )
					}
				/>

				<TextControl
					type="time"
					label={ __( 'Send at', 'fair-events-experimental' ) }
					help={ __(
						'In the site’s timezone. Sends can run a few minutes late on low-traffic sites.',
						'fair-events-experimental'
					) }
					value={ form.time_of_day }
					onChange={ update( 'time_of_day' ) }
				/>

				<SelectControl
					label={ __(
						'Which week to include',
						'fair-events-experimental'
					) }
					value={ form.week_scope }
					options={ [
						{
							value: 'current',
							label: __(
								'The week of the send',
								'fair-events-experimental'
							),
						},
						{
							value: 'next',
							label: __(
								'The following week',
								'fair-events-experimental'
							),
						},
					] }
					onChange={ update( 'week_scope' ) }
				/>

				<h3>{ __( 'Telegram', 'fair-events-experimental' ) }</h3>

				<ToggleControl
					label={ __(
						'Post to Telegram',
						'fair-events-experimental'
					) }
					help={ __(
						'Turning this off keeps the bot token in Connectors and the chats below.',
						'fair-events-experimental'
					) }
					checked={ !! form.telegram_enabled }
					onChange={ update( 'telegram_enabled' ) }
				/>

				<Notice status={ token.status } isDismissible={ false }>
					{ token.message }
				</Notice>
				<p>
					<ExternalLink href={ config.connectors_url }>
						{ __(
							'Manage in Connectors',
							'fair-events-experimental'
						) }
					</ExternalLink>
				</p>

				<TextareaControl
					label={ __(
						'Chats and channels',
						'fair-events-experimental'
					) }
					help={ __(
						'One per line: a numeric chat ID (e.g. -1001234567890) or a public @channel username. Add the bot to each chat or channel with permission to post.',
						'fair-events-experimental'
					) }
					value={ form.telegram_chat_ids }
					onChange={ update( 'telegram_chat_ids' ) }
					rows={ 3 }
				/>

				<p>
					<Button
						variant="primary"
						onClick={ save }
						isBusy={ saving }
						disabled={ saving || testing }
					>
						{ __(
							'Save weekly notification settings',
							'fair-events-experimental'
						) }
					</Button>{ ' ' }
					<Button
						variant="secondary"
						onClick={ sendTest }
						isBusy={ testing }
						disabled={ saving || testing || !! testBlockedReason }
					>
						{ __(
							'Send test summary to Telegram',
							'fair-events-experimental'
						) }
					</Button>
				</p>
				<p className="description">
					{ __(
						'The test sends the summary for the next scheduled week to every saved chat, even while delivery is off. It is not recorded as a weekly send.',
						'fair-events-experimental'
					) }
				</p>
				{ testBlockedReason && (
					<p className="description">{ testBlockedReason }</p>
				) }

				{ testResults && (
					<VStack spacing={ 2 } style={ { marginBottom: '16px' } }>
						{ testResults.map( ( result ) => (
							<Row
								key={ result.destination }
								detail={ result.message }
							>
								<FlexItem>
									<strong>{ result.destination }</strong>
								</FlexItem>
								<FlexItem>
									<StatusText
										state={ result.state }
										label={
											DELIVERY_STATE_LABELS[
												result.state
											] || result.state
										}
									/>
								</FlexItem>
							</Row>
						) ) }
					</VStack>
				) }

				<h3>{ __( 'Schedule', 'fair-events-experimental' ) }</h3>
				<p>
					{ config.next_run
						? sprintf(
								/* translators: 1: date and time of the next send, 2: date range of the week it covers */
								__(
									'Next send: %1$s, with events for %2$s.',
									'fair-events-experimental'
								),
								config.next_run.time_local,
								config.next_run.week_title
						  )
						: __(
								'Nothing is scheduled. Turn on weekly notifications and save to schedule sends.',
								'fair-events-experimental'
						  ) }
				</p>
				<p>
					<Button
						variant="secondary"
						onClick={ loadPreview }
						isBusy={ previewing }
						disabled={ previewing || dirty }
					>
						{ __(
							'Preview next message',
							'fair-events-experimental'
						) }
					</Button>
				</p>
				{ dirty && (
					<p className="description">
						{ __(
							'Save your changes to preview them.',
							'fair-events-experimental'
						) }
					</p>
				) }
				{ preview?.error && (
					<Notice status="error" isDismissible={ false }>
						{ preview.error }
					</Notice>
				) }
				{ preview && ! preview.error && (
					<>
						<p>
							{ 0 === preview.occurrence_count
								? __(
										'No events that week, so nothing would be sent.',
										'fair-events-experimental'
								  )
								: sprintf(
										/* translators: %d: number of Telegram messages */
										_n(
											'Telegram: sent as %d message.',
											'Telegram: sent as %d messages.',
											preview.telegram_parts,
											'fair-events-experimental'
										),
										preview.telegram_parts
								  ) }
						</p>
						{ ( preview.telegram_messages || [] ).map(
							( message, index ) => (
								<div
									key={ index }
									aria-label={ sprintf(
										/* translators: 1: message number, 2: number of messages */
										__(
											'Telegram message %1$d of %2$d',
											'fair-events-experimental'
										),
										index + 1,
										preview.telegram_messages.length
									) }
									role="group"
									style={ {
										whiteSpace: 'pre-wrap',
										overflowWrap: 'anywhere',
										background: '#f6f7f7',
										padding: '12px',
										marginBottom: '8px',
										maxHeight: '320px',
										overflow: 'auto',
									} }
								>
									<TelegramMessage message={ message } />
								</div>
							)
						) }
					</>
				) }

				<h3>{ __( 'Recent sends', 'fair-events-experimental' ) }</h3>
				{ 0 === config.runs.length ? (
					<p>
						{ __(
							'No weekly notification has run yet.',
							'fair-events-experimental'
						) }
					</p>
				) : (
					<VStack spacing={ 2 } style={ { marginBottom: '16px' } }>
						{ config.runs.map( ( run ) => (
							<Row key={ run.week_start } detail={ run.message }>
								<FlexItem>
									<strong>{ run.week_title }</strong>
								</FlexItem>
								<FlexItem>
									<StatusText
										state={ run.status }
										label={
											RUN_STATUS_LABELS[ run.status ] ||
											run.status
										}
									/>
								</FlexItem>
								<FlexItem>{ run.time_local }</FlexItem>
							</Row>
						) ) }
					</VStack>
				) }

				<h3>
					{ __( 'Delivery details', 'fair-events-experimental' ) }
				</h3>
				{ 0 === config.deliveries.length ? (
					<p>
						{ __(
							'No messages delivered yet.',
							'fair-events-experimental'
						) }
					</p>
				) : (
					<VStack spacing={ 2 }>
						{ config.deliveries.map( ( delivery ) => (
							<Row
								key={ `${ delivery.week_start }-${ delivery.provider }-${ delivery.destination }-${ delivery.part }` }
								detail={
									delivery.error_message ||
									delivery.error_code
								}
							>
								<FlexItem>
									<strong>{ delivery.destination }</strong>
								</FlexItem>
								<FlexItem>
									{ PROVIDER_LABELS[ delivery.provider ] ||
										delivery.provider }
								</FlexItem>
								{ delivery.part_count > 1 && (
									<FlexItem>
										{ sprintf(
											/* translators: 1: message part number, 2: number of parts */
											__(
												'Part %1$d of %2$d',
												'fair-events-experimental'
											),
											delivery.part,
											delivery.part_count
										) }
									</FlexItem>
								) }
								<FlexItem>
									<StatusText
										state={ delivery.state }
										label={
											DELIVERY_STATE_LABELS[
												delivery.state
											] || delivery.state
										}
									/>
								</FlexItem>
								<FlexItem>
									{ delivery.updated_at_local }
								</FlexItem>
							</Row>
						) ) }
					</VStack>
				) }
			</CardBody>
		</Card>
	);
}
