import apiFetch from '@wordpress/api-fetch';
import { __, _n, sprintf } from '@wordpress/i18n';
import { useEffect, useState } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	ConfirmDialog,
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
	const [ token, setToken ] = useState( '' );
	const [ saving, setSaving ] = useState( false );
	const [ testing, setTesting ] = useState( false );
	const [ testResults, setTestResults ] = useState( null );
	const [ previewing, setPreviewing ] = useState( false );
	const [ preview, setPreview ] = useState( null );
	const [ confirmingClear, setConfirmingClear ] = useState( false );

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

	const dirty =
		!! form &&
		( '' !== token ||
			EDITABLE_FIELDS.some(
				( field ) => editableState( config )[ field ] !== form[ field ]
			) );

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
			const next = await apiFetch( {
				path: PATH,
				method: 'POST',
				data: {
					...form,
					page_id: parseInt( form.page_id, 10 ) || 0,
					day_of_week: parseInt( form.day_of_week, 10 ),
					telegram_bot_token: token,
				},
			} );
			applyConfig( next );
			setToken( '' );
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

	const clearToken = async () => {
		setConfirmingClear( false );
		try {
			const next = await apiFetch( {
				path: `${ PATH }/telegram-token`,
				method: 'DELETE',
			} );
			setConfig( next );
			setForm( { ...form } );
			onNotice( {
				status: 'success',
				message: __(
					'Telegram bot token removed.',
					'fair-events-experimental'
				),
			} );
		} catch ( error ) {
			onNotice( {
				status: 'error',
				message: errorMessage(
					error,
					__(
						'Failed to remove the Telegram bot token.',
						'fair-events-experimental'
					)
				),
			} );
		}
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
								'Telegram accepted the test message for every chat.',
								'fair-events-experimental'
							),
					  }
					: {
							status: 'error',
							message: __(
								'The test message did not reach every chat. See the results below.',
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
						'Failed to send the test message.',
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

	const testReady =
		config.telegram_token_configured && config.telegram_chat_ids.length > 0;
	let testBlockedReason = null;
	if ( ! testReady ) {
		testBlockedReason = __(
			'Save a bot token and at least one chat or channel before sending a test message.',
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
						'Turning this off keeps the bot token and chats below.',
						'fair-events-experimental'
					) }
					checked={ !! form.telegram_enabled }
					onChange={ update( 'telegram_enabled' ) }
				/>

				<TextControl
					type="password"
					autoComplete="off"
					label={
						config.telegram_token_configured
							? __(
									'Replace bot token',
									'fair-events-experimental'
							  )
							: __( 'Bot token', 'fair-events-experimental' )
					}
					help={
						config.telegram_token_configured
							? __(
									'A bot token is saved. Leave this empty to keep it.',
									'fair-events-experimental'
							  )
							: __(
									'From @BotFather. It is not shown again after saving.',
									'fair-events-experimental'
							  )
					}
					value={ token }
					onChange={ setToken }
				/>

				{ config.telegram_token_configured && (
					<p>
						<Button
							variant="secondary"
							isDestructive
							onClick={ () => setConfirmingClear( true ) }
							disabled={ saving || testing }
						>
							{ __(
								'Remove bot token',
								'fair-events-experimental'
							) }
						</Button>
					</p>
				) }

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
							'Send Telegram test message',
							'fair-events-experimental'
						) }
					</Button>
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
						<pre
							style={ {
								whiteSpace: 'pre-wrap',
								background: '#f6f7f7',
								padding: '12px',
								maxHeight: '320px',
								overflow: 'auto',
							} }
						>
							{ preview.text }
						</pre>
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

				{ confirmingClear && (
					<ConfirmDialog
						onConfirm={ clearToken }
						onCancel={ () => setConfirmingClear( false ) }
						confirmButtonText={ __(
							'Remove bot token',
							'fair-events-experimental'
						) }
					>
						{ __(
							'Remove the Telegram bot token? Weekly notifications will not reach Telegram until a new token is saved.',
							'fair-events-experimental'
						) }
					</ConfirmDialog>
				) }
			</CardBody>
		</Card>
	);
}
