import apiFetch from '@wordpress/api-fetch';
import { __, _n, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useState } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	ExternalLink,
	Flex,
	FlexItem,
	Notice,
	TextControl,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import MetaCalendarTest, { CALENDAR_EVENT } from './MetaCalendarTest.js';
import { TestDiagnostics } from './TestDiagnostics.js';
import SentRequests, { RequestDetails } from './SentRequests.js';

export { TestDiagnostics };

const PATH = '/fair-events-experimental/v1/meta-conversions';

const TEST_EVENTS = [
	{
		name: 'PageView',
		label: __( 'Send PageView test', 'fair-events-experimental' ),
	},
	{
		name: 'InitiateCheckout',
		label: __( 'Send InitiateCheckout test', 'fair-events-experimental' ),
	},
	{
		name: 'Purchase',
		label: __( 'Send Purchase test', 'fair-events-experimental' ),
	},
];

const STATE_LABELS = {
	pending: __( 'Pending', 'fair-events-experimental' ),
	sending: __( 'Sending', 'fair-events-experimental' ),
	retry_pending: __( 'Retrying', 'fair-events-experimental' ),
	received: __( 'Received by Meta', 'fair-events-experimental' ),
	// Finished before Meta's event count was checked: HTTP success only.
	accepted: __( 'Delivered (not confirmed)', 'fair-events-experimental' ),
	configuration_error: __(
		'Configuration error',
		'fair-events-experimental'
	),
	retries_exhausted: __(
		'Failed — retries exhausted',
		'fair-events-experimental'
	),
	// Button clicks are sent once, immediately, and never retried.
	immediate_sending: __(
		'Sent immediately — no result recorded',
		'fair-events-experimental'
	),
	immediate_received: __(
		'Received by Meta (sent immediately)',
		'fair-events-experimental'
	),
	immediate_unconfirmed: __(
		'Not confirmed (sent immediately, not retried)',
		'fair-events-experimental'
	),
	immediate_rejected: __(
		'Rejected by Meta (sent immediately)',
		'fair-events-experimental'
	),
	immediate_temporary_error: __(
		'Meta error (sent immediately, not retried)',
		'fair-events-experimental'
	),
	immediate_transport: __(
		'Could not reach Meta (sent immediately, not retried)',
		'fair-events-experimental'
	),
	immediate_configuration: __(
		'Configuration error (sent immediately)',
		'fair-events-experimental'
	),
};

const STATE_COLORS = {
	pending: '#757575',
	sending: '#757575',
	retry_pending: '#b26200',
	received: '#00a32a',
	accepted: '#757575',
	configuration_error: '#d63638',
	retries_exhausted: '#d63638',
	immediate_sending: '#757575',
	immediate_received: '#00a32a',
	immediate_unconfirmed: '#b26200',
	immediate_rejected: '#d63638',
	immediate_temporary_error: '#d63638',
	immediate_transport: '#d63638',
	immediate_configuration: '#d63638',
};

// Only these states carry a safe failure category/code worth surfacing —
// a successful delivery has nothing to diagnose.
const ERROR_DETAIL_STATES = new Set( [
	'retry_pending',
	'configuration_error',
	'retries_exhausted',
	'immediate_unconfirmed',
	'immediate_rejected',
	'immediate_temporary_error',
	'immediate_transport',
	'immediate_configuration',
] );

function stateLabel( state ) {
	return STATE_LABELS[ state ] || state;
}

function paymentModeLabel( mode ) {
	if ( 'test' === mode ) {
		return __( 'Test', 'fair-events-experimental' );
	}
	// Engagement events carry no payment mode.
	return 'live' === mode ? __( 'Live', 'fair-events-experimental' ) : '';
}

function attemptsLabel( count ) {
	return sprintf(
		/* translators: %d: number of delivery attempts made so far */
		_n( '%d attempt', '%d attempts', count, 'fair-events-experimental' ),
		count
	);
}

/**
 * Safe failure category/code for a result, or '' when there's none to show.
 *
 * @param {Object} outcome A recent delivery outcome from the API.
 * @return {string} Combined type/code detail, or an empty string.
 */
function errorDetail( outcome ) {
	if ( ! ERROR_DETAIL_STATES.has( outcome.state ) ) {
		return '';
	}
	return [ outcome.meta_error_type, outcome.meta_error_code ]
		.filter( Boolean )
		.join( ': ' );
}

/**
 * Safe failure category/code for a failed test send, or '' for a successful
 * one — a successful test has nothing to diagnose.
 *
 * @param {Object} entry A test-send entry or result.
 * @return {string} Combined type/code detail, or an empty string.
 */
function testHistoryDetail( entry ) {
	if ( entry.accepted ) {
		return '';
	}
	return [ entry.type, entry.code ].filter( Boolean ).join( ': ' );
}

/**
 * Status of a test send. Entries recorded before Meta's event count was
 * checked have no `outcome`; their success was an HTTP success only.
 *
 * @param {Object} entry A test-send entry or result.
 * @return {Object} `label` and `color`.
 */
function testStatus( entry ) {
	if ( entry.accepted ) {
		return entry.outcome
			? {
					label: __( 'Received by Meta', 'fair-events-experimental' ),
					color: STATE_COLORS.received,
				}
			: {
					label: __(
						'Accepted (not confirmed)',
						'fair-events-experimental'
					),
					color: STATE_COLORS.accepted,
				};
	}
	if ( 'not_sent' === entry.outcome ) {
		return {
			label: __( 'Test not sent', 'fair-events-experimental' ),
			color: STATE_COLORS.retry_pending,
		};
	}
	if ( 'unconfirmed' === entry.outcome ) {
		return {
			label: __( 'Not confirmed', 'fair-events-experimental' ),
			color: STATE_COLORS.retry_pending,
		};
	}
	return {
		label: __( 'Rejected', 'fair-events-experimental' ),
		color: STATE_COLORS.configuration_error,
	};
}

/**
 * Whether the request behind a history entry or delivery outcome is in the
 * sent-request log. Entries recorded before requests were logged — and
 * those whose log entry failed or expired — say their details are
 * unavailable.
 *
 * @param {Object} props
 * @param {number} props.logged Logged requests for the entry.
 * @return {Element} Note.
 */
function LoggedRequestNote( { logged } ) {
	return (
		<div style={ { marginTop: '4px', color: '#757575' } }>
			{ logged > 0
				? sprintf(
						/* translators: %d: number of logged requests for a delivery or test */
						_n(
							'%d sent request is listed under Sent requests.',
							'%d sent requests are listed under Sent requests.',
							logged,
							'fair-events-experimental'
						),
						logged
					)
				: __(
						'Sent request details are unavailable for this entry.',
						'fair-events-experimental'
					) }
		</div>
	);
}

/**
 * The sanitized request of the latest test, behind a toggle. A test that
 * was not sent says so instead.
 *
 * @param {Object} props
 * @param {Object} props.entry Latest test result.
 * @return {Element} Request details.
 */
function LatestRequest( { entry } ) {
	const [ open, setOpen ] = useState( false );
	const notSent = [ 'not_sent', 'configuration' ].includes( entry.outcome );
	if ( notSent ) {
		return <RequestDetails notSent />;
	}
	return (
		<>
			<Button
				variant="link"
				aria-expanded={ open }
				onClick={ () => setOpen( ! open ) }
			>
				{ open
					? __( 'Hide sent request', 'fair-events-experimental' )
					: __( 'Show sent request', 'fair-events-experimental' ) }
			</Button>
			{ open && <RequestDetails request={ entry.request } /> }
		</>
	);
}

/**
 * One test-send result: event name, status, time and Meta's diagnostics.
 * The latest result also shows its sent request; a history entry says
 * whether its request was logged.
 *
 * @param {Object}  props
 * @param {Object}  props.entry  Test-send entry or result.
 * @param {boolean} props.latest Whether this is the result just received.
 * @return {Element} Result row.
 */
function TestResult( { entry, latest = false } ) {
	const status = testStatus( entry );
	const detail = testHistoryDetail( entry );
	return (
		<>
			<Flex wrap justify="flex-start" gap={ 3 }>
				<FlexItem>
					<strong>{ entry.event_name }</strong>
				</FlexItem>
				<FlexItem>
					<span style={ { color: status.color, fontWeight: 600 } }>
						{ status.label }
					</span>
				</FlexItem>
				{ entry.time_local && (
					<FlexItem>{ entry.time_local }</FlexItem>
				) }
			</Flex>
			{ entry.message && (
				<div style={ { marginTop: '4px' } }>{ entry.message }</div>
			) }
			{ detail && (
				<div style={ { marginTop: '4px', color: '#757575' } }>
					{ sprintf(
						/* translators: %s: safe failure category/code reported by Meta */
						__( 'Error: %s', 'fair-events-experimental' ),
						detail
					) }
				</div>
			) }
			<TestDiagnostics diagnostics={ entry } />
			{ latest ? (
				<LatestRequest entry={ entry } />
			) : (
				<LoggedRequestNote logged={ entry.request_logged ? 1 : 0 } />
			) }
		</>
	);
}

/**
 * Warning shown while queued delivery could not be scheduled in the
 * background. Nothing is shown once scheduling has recovered.
 *
 * @param {Object} props
 * @param {Object} props.schedule `delivery_schedule` from the settings payload.
 * @return {Element|null} Warning notice, or null while scheduling is healthy.
 */
export function DeliveryScheduleWarning( { schedule } ) {
	if ( ! schedule || schedule.healthy ) {
		return null;
	}
	return (
		<Notice status="warning" isDismissible={ false }>
			<p>
				{ schedule.last_failure_at_local
					? sprintf(
							/* translators: %s: date and time when background delivery last failed to be scheduled */
							__(
								'Background delivery to Meta could not be scheduled (last failure: %s). Queued checkout and purchase events wait until it can.',
								'fair-events-experimental'
							),
							schedule.last_failure_at_local
						)
					: __(
							'Background delivery to Meta could not be scheduled. Queued checkout and purchase events wait until it can.',
							'fair-events-experimental'
						) }
			</p>
			<p>
				{ __(
					'Scheduling is retried automatically on later site visits, and queued events are delivered once it succeeds. Payments are not affected. If this warning stays, check that WP-Cron runs on this site.',
					'fair-events-experimental'
				) }
			</p>
		</Notice>
	);
}

/**
 * What the administrator should know about the access token: whether one is
 * configured and where it comes from. A configured token is not proof that
 * Meta accepts it.
 *
 * @param {Object} config Meta Conversions settings payload.
 * @return {{status: string, message: string}} Notice status and text.
 */
export function tokenStatus( config ) {
	const name = config.token_override_name;
	if ( ! config.token_configured ) {
		return {
			status: 'warning',
			message: __(
				'No access token is configured, so no conversions are delivered to Meta. Add one in Connectors.',
				'fair-events-experimental'
			),
		};
	}
	if ( 'env' === config.token_source ) {
		return {
			status: 'info',
			message: sprintf(
				/* translators: %s: environment variable name */
				__(
					'The access token comes from the %s environment variable, which overrides any token saved in Connectors. Removing a token in Connectors does not stop delivery while it is set. Send a test event to confirm Meta accepts it.',
					'fair-events-experimental'
				),
				name
			),
		};
	}
	if ( 'constant' === config.token_source ) {
		return {
			status: 'info',
			message: sprintf(
				/* translators: %s: PHP constant name */
				__(
					'The access token comes from the %s constant, which overrides any token saved in Connectors. Removing a token in Connectors does not stop delivery while it is defined. Send a test event to confirm Meta accepts it.',
					'fair-events-experimental'
				),
				name
			),
		};
	}
	return {
		status: 'info',
		message: __(
			'An access token is saved in Connectors. It is not shown here. Send a test event to confirm Meta accepts it.',
			'fair-events-experimental'
		),
	};
}

const TOKEN_FIELDS = [ 'token_configured', 'token_source' ];

export default function MetaConversions( { onNotice } ) {
	const [ config, setConfig ] = useState( null );
	const [ savedConfig, setSavedConfig ] = useState( null );
	const [ busy, setBusy ] = useState( false );
	const [ sendingEvent, setSendingEvent ] = useState( null );
	// The latest test result stays visible after the transient notice.
	const [ lastResult, setLastResult ] = useState( null );
	// Bumped to reset the calendar picker and reload its events.
	const [ calendarPicker, setCalendarPicker ] = useState( 0 );
	// Bumped after each test send so an open sent-request log reloads.
	const [ sentRequests, setSentRequests ] = useState( 0 );
	const load = () =>
		apiFetch( { path: PATH } )
			.then( ( next ) => {
				setConfig( next );
				setSavedConfig( next );
			} )
			.catch( () =>
				onNotice( {
					status: 'error',
					message: __(
						'Failed to load Meta Conversions settings.',
						'fair-events-experimental'
					),
				} )
			);
	useEffect( () => {
		load();
	}, [] );
	// The token is managed in Connectors, usually in another tab. Coming
	// back re-reads only its status, so unsaved edits here are kept.
	const refreshToken = useCallback( () => {
		if ( 'hidden' === document.visibilityState ) {
			return;
		}
		apiFetch( { path: PATH } )
			.then( ( next ) => {
				const token = Object.fromEntries(
					TOKEN_FIELDS.map( ( field ) => [ field, next[ field ] ] )
				);
				setConfig( ( current ) =>
					current ? { ...current, ...token } : current
				);
				setSavedConfig( ( current ) =>
					current ? { ...current, ...token } : current
				);
			} )
			.catch( () => {} );
	}, [] );
	useEffect( () => {
		window.addEventListener( 'focus', refreshToken );
		document.addEventListener( 'visibilitychange', refreshToken );
		return () => {
			window.removeEventListener( 'focus', refreshToken );
			document.removeEventListener( 'visibilitychange', refreshToken );
		};
	}, [ refreshToken ] );
	if ( ! config ) {
		return (
			<p>
				{ __(
					'Loading Meta Conversions settings…',
					'fair-events-experimental'
				) }
			</p>
		);
	}
	const dirty =
		config.dataset_id !== savedConfig.dataset_id ||
		config.test_event_code !== savedConfig.test_event_code;
	let testingBlocker = null;
	if ( ! config.token_configured ) {
		testingBlocker = __(
			'Add a Meta access token in Connectors before sending a test event.',
			'fair-events-experimental'
		);
	} else if ( ! savedConfig.dataset_id || ! savedConfig.test_event_code ) {
		testingBlocker = __(
			'Save the dataset ID and Test Events code before sending a test event.',
			'fair-events-experimental'
		);
	} else if ( dirty ) {
		testingBlocker = __(
			'Save or discard your changes before sending a test event — testing now would use the previously saved configuration, not what is in the fields.',
			'fair-events-experimental'
		);
	} else if ( busy ) {
		testingBlocker = __(
			'Wait until the Meta settings are saved.',
			'fair-events-experimental'
		);
	} else if ( sendingEvent ) {
		testingBlocker = __(
			'Wait until the current test event is sent.',
			'fair-events-experimental'
		);
	}
	const discardChanges = () => setConfig( savedConfig );
	const token = tokenStatus( config );
	const save = async () => {
		setBusy( true );
		try {
			const next = await apiFetch( {
				path: PATH,
				method: 'POST',
				data: {
					dataset_id: config.dataset_id,
					test_event_code: config.test_event_code,
				},
			} );
			setConfig( next );
			setSavedConfig( next );
			onNotice( {
				status: 'success',
				message: __(
					'Meta Conversions settings saved.',
					'fair-events-experimental'
				),
			} );
		} catch {
			onNotice( {
				status: 'error',
				message: __(
					'Failed to save Meta Conversions settings.',
					'fair-events-experimental'
				),
			} );
		}
		setBusy( false );
	};
	const sendTest = async ( eventName, extra = {} ) => {
		setSendingEvent( eventName );
		try {
			const response = await apiFetch( {
				path: `${ PATH }/test`,
				method: 'POST',
				data: { event_name: eventName, ...extra },
			} );
			setLastResult( {
				event_name: eventName,
				accepted: true,
				outcome: response?.outcome,
				...( response?.diagnostics || {} ),
				request: response?.request ?? null,
			} );
			onNotice( {
				status: 'success',
				message: sprintf(
					/* translators: %s: Meta event name, such as PageView or FairEventCalendarClick */
					__(
						'Meta confirmed receiving the %s test event.',
						'fair-events-experimental'
					),
					eventName
				),
			} );
		} catch ( error ) {
			const fallback = sprintf(
				/* translators: %s: Meta event name, such as PageView or FairEventCalendarClick */
				__(
					'Meta rejected the %s test event. Check the configuration and try again.',
					'fair-events-experimental'
				),
				eventName
			);
			const message =
				typeof error?.message === 'string' && error?.code
					? error.message
					: fallback;
			// The event or date the calendar test was built for is no longer
			// eligible: nothing reached Meta, and the picker starts over.
			const notSent = error?.code === 'invalid_event';
			if ( notSent ) {
				setCalendarPicker( ( count ) => count + 1 );
			}
			setLastResult( {
				event_name: eventName,
				accepted: false,
				outcome: notSent ? 'not_sent' : error?.data?.outcome,
				code: error?.data?.code || error?.code || '',
				type: error?.data?.category || '',
				message,
				...( error?.data?.diagnostics || {} ),
				request: error?.data?.request ?? null,
			} );
			onNotice( { status: 'error', message } );
		}
		await load();
		setSentRequests( ( count ) => count + 1 );
		setSendingEvent( null );
	};
	return (
		<Card style={ { marginTop: '16px' } }>
			<CardHeader>
				<h2>
					{ __( 'Meta Conversions', 'fair-events-experimental' ) }
				</h2>
			</CardHeader>
			<CardBody>
				<p>
					{ __(
						'Send consented event-button clicks and checkout and purchase measurements to Meta. Matching identifiers are removed when delivery finishes and records are deleted after 90 days. Sent requests are logged without credentials or personal identifiers and kept for 30 days.',
						'fair-events-experimental'
					) }
				</p>
				<DeliveryScheduleWarning
					schedule={ config.delivery_schedule }
				/>
				{ ! config.consent_api_available && (
					<Notice status="warning" isDismissible={ false }>
						<p>
							{ __(
								'Live checkout and purchase tracking will stay inactive until the WP Consent API is available. An existing consent banner is not enough on its own — it also needs to report marketing-consent decisions through that API.',
								'fair-events-experimental'
							) }
						</p>
						<p>
							{ __(
								'The WP Consent API is an interoperability layer, not a replacement for your consent banner: installing it does not by itself establish valid consent, and it does not affect synthetic Test Events below.',
								'fair-events-experimental'
							) }
						</p>
						<p>
							<ExternalLink href="https://wordpress.org/plugins/wp-consent-api/">
								{ __(
									'Get the WP Consent API plugin',
									'fair-events-experimental'
								) }
							</ExternalLink>
						</p>
					</Notice>
				) }
				<TextControl
					label={ __(
						'Dataset / Pixel ID',
						'fair-events-experimental'
					) }
					value={ config.dataset_id }
					autoComplete="off"
					onChange={ ( dataset_id ) =>
						setConfig( { ...config, dataset_id } )
					}
				/>
				<Notice status={ token.status } isDismissible={ false }>
					{ token.message }{ ' ' }
					<ExternalLink href={ config.connectors_url }>
						{ __(
							'Manage in Connectors',
							'fair-events-experimental'
						) }
					</ExternalLink>
				</Notice>
				<TextControl
					label={ __(
						'Test Events code',
						'fair-events-experimental'
					) }
					value={ config.test_event_code }
					autoComplete="off"
					onChange={ ( test_event_code ) =>
						setConfig( { ...config, test_event_code } )
					}
				/>
				<p>
					<Button
						variant="primary"
						onClick={ save }
						isBusy={ busy }
						disabled={ busy || !! sendingEvent }
					>
						{ __(
							'Save Meta settings',
							'fair-events-experimental'
						) }
					</Button>
				</p>
				<Flex
					wrap
					justify="flex-start"
					gap={ 2 }
					style={ { marginBottom: '8px' } }
				>
					{ TEST_EVENTS.map( ( { name, label } ) => (
						<FlexItem key={ name }>
							<Button
								variant="secondary"
								onClick={ () => sendTest( name ) }
								isBusy={ sendingEvent === name }
								disabled={ !! testingBlocker }
							>
								{ label }
							</Button>
						</FlexItem>
					) ) }
				</Flex>
				{ testingBlocker && (
					<p className="description">{ testingBlocker }</p>
				) }
				{ dirty && (
					<p>
						<Button
							variant="secondary"
							onClick={ discardChanges }
							disabled={ busy || !! sendingEvent }
						>
							{ __(
								'Discard changes',
								'fair-events-experimental'
							) }
						</Button>
					</p>
				) }
				<MetaCalendarTest
					key={ calendarPicker }
					disabledReason={ testingBlocker }
					sending={ sendingEvent === CALENDAR_EVENT }
					onSend={ ( data ) => sendTest( CALENDAR_EVENT, data ) }
				/>
				{ lastResult && (
					<div
						role="status"
						style={ {
							border: '1px solid #e0e0e0',
							padding: '8px 12px',
							marginBottom: '16px',
						} }
					>
						<h3 style={ { marginTop: 0 } }>
							{ __(
								'Latest test result',
								'fair-events-experimental'
							) }
						</h3>
						<TestResult entry={ lastResult } latest />
					</div>
				) }
				<h3>
					{ __( 'Recent test sends', 'fair-events-experimental' ) }
				</h3>
				{ ( config.test_history || [] ).length === 0 ? (
					<p>
						{ __(
							'No test events sent yet.',
							'fair-events-experimental'
						) }
					</p>
				) : (
					<VStack spacing={ 3 } style={ { marginBottom: '16px' } }>
						{ config.test_history.map( ( entry, index ) => (
							<div
								key={ `${ entry.time }-${ index }` }
								style={ {
									borderBottom: '1px solid #e0e0e0',
									paddingBottom: '8px',
								} }
							>
								<TestResult entry={ entry } />
							</div>
						) ) }
					</VStack>
				) }
				<h3>
					{ __(
						'Recent delivery outcomes',
						'fair-events-experimental'
					) }
				</h3>
				{ ( config.diagnostics.recent || [] ).length === 0 ? (
					<p>
						{ __(
							'No delivery attempts yet.',
							'fair-events-experimental'
						) }
					</p>
				) : (
					<>
						<ul style={ { marginBottom: '16px' } }>
							{ Object.entries(
								config.diagnostics.counts || {}
							).map( ( [ state, count ] ) => (
								<li key={ state }>
									{ stateLabel( state ) }: { count }
								</li>
							) ) }
						</ul>
						<VStack spacing={ 3 }>
							{ config.diagnostics.recent.map(
								( outcome, index ) => {
									const detail = errorDetail( outcome );
									return (
										<div
											key={ `${ outcome.updated_at }-${ index }` }
											style={ {
												borderBottom:
													'1px solid #e0e0e0',
												paddingBottom: '8px',
											} }
										>
											<Flex
												wrap
												justify="flex-start"
												gap={ 3 }
											>
												<FlexItem>
													<strong>
														{ outcome.event_name }
													</strong>
												</FlexItem>
												<FlexItem>
													<span
														style={ {
															color:
																STATE_COLORS[
																	outcome
																		.state
																] || '#1e1e1e',
															fontWeight: 600,
														} }
													>
														{ stateLabel(
															outcome.state
														) }
													</span>
												</FlexItem>
												{ paymentModeLabel(
													outcome.payment_mode
												) && (
													<FlexItem>
														{ paymentModeLabel(
															outcome.payment_mode
														) }
													</FlexItem>
												) }
												<FlexItem>
													{ outcome.updated_at_local }
												</FlexItem>
											</Flex>
											<Flex
												wrap
												justify="flex-start"
												gap={ 3 }
												style={ {
													marginTop: '4px',
													color: '#757575',
												} }
											>
												<FlexItem>
													{ attemptsLabel(
														outcome.attempt_count
													) }
												</FlexItem>
												{ detail && (
													<FlexItem>
														{ sprintf(
															/* translators: %s: safe failure category/code reported by Meta */
															__(
																'Error: %s',
																'fair-events-experimental'
															),
															detail
														) }
													</FlexItem>
												) }
											</Flex>
											<TestDiagnostics
												diagnostics={ outcome }
											/>
											<LoggedRequestNote
												logged={
													outcome.logged_attempts || 0
												}
											/>
										</div>
									);
								}
							) }
						</VStack>
					</>
				) }
				<SentRequests refreshKey={ sentRequests } />
			</CardBody>
		</Card>
	);
}
