import apiFetch from '@wordpress/api-fetch';
import { __, _n, sprintf } from '@wordpress/i18n';
import { useEffect, useState } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	__experimentalConfirmDialog as ConfirmDialog,
	ExternalLink,
	Flex,
	FlexItem,
	Notice,
	TextControl,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import MetaCalendarTest, { CALENDAR_EVENT } from './MetaCalendarTest.js';

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
};

const STATE_COLORS = {
	pending: '#757575',
	sending: '#757575',
	retry_pending: '#b26200',
	received: '#00a32a',
	accepted: '#757575',
	configuration_error: '#d63638',
	retries_exhausted: '#d63638',
};

// Only these states carry a safe failure category/code worth surfacing —
// a successful delivery has nothing to diagnose.
const ERROR_DETAIL_STATES = new Set( [
	'retry_pending',
	'configuration_error',
	'retries_exhausted',
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
 * Meta's answer to a test send: HTTP status, received event count, trace ID
 * and messages. A field Meta did not report is shown as such, distinct from
 * zero events or an empty message list. Renders nothing for entries
 * recorded before these diagnostics existed.
 *
 * @param {Object} props
 * @param {Object} props.diagnostics Diagnostics from the API, if any.
 * @return {Element|null} Diagnostic details.
 */
export function TestDiagnostics( { diagnostics } ) {
	if ( ! diagnostics || ! ( 'http_status' in diagnostics ) ) {
		return null;
	}
	const { http_status: status, events_received: received } = diagnostics;
	const messages = diagnostics.messages;
	return (
		<div style={ { marginTop: '4px', color: '#757575' } }>
			<Flex wrap justify="flex-start" gap={ 3 }>
				<FlexItem>
					{ null === status
						? __( 'No HTTP response', 'fair-events-experimental' )
						: sprintf(
								/* translators: %d: HTTP status code of Meta's answer */
								__( 'HTTP %d', 'fair-events-experimental' ),
								status
							) }
				</FlexItem>
				{ null !== status && (
					<FlexItem>
						{ null === received || undefined === received
							? __(
									'Events received: not reported',
									'fair-events-experimental'
								)
							: sprintf(
									/* translators: %d: number of events Meta reported as received */
									__(
										'Events received: %d',
										'fair-events-experimental'
									),
									received
								) }
					</FlexItem>
				) }
				{ diagnostics.fbtrace_id && (
					<FlexItem>
						{ sprintf(
							/* translators: %s: Meta trace ID for support requests */
							__( 'Trace ID: %s', 'fair-events-experimental' ),
							diagnostics.fbtrace_id
						) }
					</FlexItem>
				) }
			</Flex>
			{ null !== status && Array.isArray( messages ) && (
				<>
					{ messages.length === 0 ? (
						<div>
							{ __(
								'Messages: none',
								'fair-events-experimental'
							) }
						</div>
					) : (
						<>
							<div>
								{ __(
									'Messages:',
									'fair-events-experimental'
								) }
							</div>
							<ul style={ { margin: '0 0 0 16px' } }>
								{ messages.map( ( message, index ) => (
									<li key={ index }>{ message }</li>
								) ) }
							</ul>
						</>
					) }
				</>
			) }
			{ null !== status && ! Array.isArray( messages ) && (
				<div>
					{ __(
						'Messages: not reported',
						'fair-events-experimental'
					) }
				</div>
			) }
		</div>
	);
}

/**
 * One test-send result: event name, status, time and Meta's diagnostics.
 *
 * @param {Object} props
 * @param {Object} props.entry Test-send entry or result.
 * @return {Element} Result row.
 */
function TestResult( { entry } ) {
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
		</>
	);
}

export default function MetaConversions( { onNotice } ) {
	const [ config, setConfig ] = useState( null );
	const [ savedConfig, setSavedConfig ] = useState( null );
	const [ token, setToken ] = useState( '' );
	const [ busy, setBusy ] = useState( false );
	const [ sendingEvent, setSendingEvent ] = useState( null );
	const [ confirming, setConfirming ] = useState( false );
	// The latest test result stays visible after the transient notice.
	const [ lastResult, setLastResult ] = useState( null );
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
	const ready =
		config.dataset_id && config.token_configured && config.test_event_code;
	const dirty =
		'' !== token ||
		config.dataset_id !== savedConfig.dataset_id ||
		config.test_event_code !== savedConfig.test_event_code;
	let testingBlocker = null;
	if ( ! ready ) {
		testingBlocker = __(
			'Configure the dataset ID, access token, and Test Events code before sending a test event.',
			'fair-events-experimental'
		);
	} else if ( dirty ) {
		testingBlocker = __(
			'Save or discard your changes before sending a test event — testing now would use the previously saved configuration, not what is in the fields. A browser password manager can fill the access token field for you.',
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
	const discardChanges = () => {
		setConfig( savedConfig );
		setToken( '' );
	};
	const save = async () => {
		setBusy( true );
		try {
			const next = await apiFetch( {
				path: PATH,
				method: 'POST',
				data: {
					dataset_id: config.dataset_id,
					test_event_code: config.test_event_code,
					access_token: token,
				},
			} );
			setConfig( next );
			setSavedConfig( next );
			setToken( '' );
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
	const clearToken = async () => {
		setBusy( true );
		const next = await apiFetch( {
			path: `${ PATH }/token`,
			method: 'DELETE',
		} );
		setConfig( next );
		setSavedConfig( next );
		setConfirming( false );
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
			setLastResult( {
				event_name: eventName,
				accepted: false,
				outcome: error?.data?.outcome,
				code: error?.data?.code || error?.code || '',
				type: error?.data?.category || '',
				message,
				...( error?.data?.diagnostics || {} ),
			} );
			onNotice( { status: 'error', message } );
		}
		await load();
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
						'Send consented checkout and purchase measurements to Meta. Matching identifiers are removed when delivery finishes and records are deleted after 90 days.',
						'fair-events-experimental'
					) }
				</p>
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
				<TextControl
					type="password"
					label={
						config.token_configured
							? __(
									'Replace access token',
									'fair-events-experimental'
								)
							: __( 'Access token', 'fair-events-experimental' )
					}
					help={
						config.token_configured
							? __(
									'A token is configured. Leave this empty to keep it.',
									'fair-events-experimental'
								)
							: __(
									'The token is write-only and will not be shown again.',
									'fair-events-experimental'
								)
					}
					value={ token }
					// Keep password managers from filling a saved login in.
					autoComplete="new-password"
					data-1p-ignore
					data-lpignore="true"
					onChange={ setToken }
				/>
				{ config.token_configured && (
					<Button
						isDestructive
						variant="secondary"
						onClick={ () => setConfirming( true ) }
						disabled={ busy || !! sendingEvent }
					>
						{ __(
							'Clear access token',
							'fair-events-experimental'
						) }
					</Button>
				) }
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
						<TestResult entry={ lastResult } />
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
										</div>
									);
								}
							) }
						</VStack>
					</>
				) }
				{ confirming && (
					<ConfirmDialog
						onConfirm={ clearToken }
						onCancel={ () => setConfirming( false ) }
						confirmButtonText={ __(
							'Clear access token',
							'fair-events-experimental'
						) }
					>
						{ __(
							'Clear the Meta access token? Conversion delivery will stop until a new token is saved.',
							'fair-events-experimental'
						) }
					</ConfirmDialog>
				) }
			</CardBody>
		</Card>
	);
}
