import apiFetch from '@wordpress/api-fetch';
import { __, _n, sprintf } from '@wordpress/i18n';
import { useEffect, useRef, useState } from '@wordpress/element';
import {
	Button,
	CheckboxControl,
	Flex,
	FlexItem,
	Notice,
	SelectControl,
	ToggleControl,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { TestDiagnostics } from './TestDiagnostics.js';

const PATH = '/fair-events-experimental/v1/meta-conversions/attempts';
const PER_PAGE = 10;

const EVENT_NAMES = [
	'PageView',
	'InitiateCheckout',
	'Purchase',
	'FairEventCalendarClick',
	'FairEventTicketClick',
];

const OUTCOMES = {
	received: {
		label: __( 'Received by Meta', 'fair-events-experimental' ),
		color: '#00a32a',
	},
	unconfirmed: {
		label: __( 'Not confirmed', 'fair-events-experimental' ),
		color: '#b26200',
	},
	rejected: {
		label: __( 'Rejected by Meta', 'fair-events-experimental' ),
		color: '#d63638',
	},
	temporary_error: {
		label: __( 'Meta error', 'fair-events-experimental' ),
		color: '#d63638',
	},
	transport: {
		label: __( 'Could not reach Meta', 'fair-events-experimental' ),
		color: '#d63638',
	},
};

const CHECKS = {
	valid: __( 'valid Meta browser ID', 'fair-events-experimental' ),
	invalid: __( 'not a valid Meta browser ID', 'fair-events-experimental' ),
	sha256: __( 'SHA-256 hash', 'fair-events-experimental' ),
	not_sha256: __( 'not a SHA-256 hash', 'fair-events-experimental' ),
	uuid: __( 'UUID', 'fair-events-experimental' ),
	other: __( 'neither a hash nor a UUID', 'fair-events-experimental' ),
};

const MONOSPACE = { fontFamily: 'monospace', overflowWrap: 'anywhere' };

/**
 * Outcome label and color of a logged attempt. An attempt without an
 * outcome was logged, but its result was never recorded.
 *
 * @param {Object} attempt Attempt from the API.
 * @return {{label: string, color: string}} Status.
 */
export function attemptOutcome( attempt ) {
	if ( ! attempt.outcome ) {
		return {
			label: __( 'Result unavailable', 'fair-events-experimental' ),
			color: '#757575',
		};
	}
	return (
		OUTCOMES[ attempt.outcome ] || {
			label: attempt.outcome,
			color: '#1e1e1e',
		}
	);
}

/**
 * Who sent an attempt and how, as separate labels: administrator test or
 * production, Meta Test Events routing, payment mode, and delivery path.
 *
 * @param {Object} attempt Attempt from the API.
 * @return {string[]} Labels.
 */
export function attemptLabels( attempt ) {
	const labels = [
		'admin_test' === attempt.origin
			? __( 'Administrator test', 'fair-events-experimental' )
			: __( 'Production', 'fair-events-experimental' ),
		attempt.test_events
			? __( 'Sent to Test Events', 'fair-events-experimental' )
			: __( 'Not sent to Test Events', 'fair-events-experimental' ),
	];
	if ( 'test' === attempt.payment_mode ) {
		labels.push( __( 'Payment test mode', 'fair-events-experimental' ) );
	} else if ( 'live' === attempt.payment_mode ) {
		labels.push( __( 'Payment live mode', 'fair-events-experimental' ) );
	}
	if ( 'immediate' === attempt.delivery_path ) {
		labels.push( __( 'Sent immediately', 'fair-events-experimental' ) );
	} else if ( 'queued' === attempt.delivery_path ) {
		labels.push(
			sprintf(
				/* translators: %d: delivery attempt number of a queued event */
				__( 'Queued, attempt %d', 'fair-events-experimental' ),
				attempt.attempt_number
			)
		);
	}
	return labels;
}

/**
 * What a snapshot says about one field: its value, or why there is none.
 *
 * @param {Object} field Snapshot field.
 * @return {string} Description.
 */
export function describeValue( field ) {
	switch ( field.state ) {
		case 'value':
			return String( field.value );
		case 'null':
			return __( 'null', 'fair-events-experimental' );
		case 'empty':
			if ( 'array' === field.type ) {
				return __( 'Empty list', 'fair-events-experimental' );
			}
			return 'object' === field.type
				? __( 'Empty object', 'fair-events-experimental' )
				: __( 'Empty text', 'fair-events-experimental' );
		case 'structure':
			return 'array' === field.type
				? sprintf(
						/* translators: %d: number of items in a list */
						_n(
							'List of %d item',
							'List of %d items',
							field.count,
							'fair-events-experimental'
						),
						field.count
					)
				: sprintf(
						/* translators: %d: number of fields in an object */
						_n(
							'Object with %d field',
							'Object with %d fields',
							field.count,
							'fair-events-experimental'
						),
						field.count
					);
		case 'redacted':
			return undefined === field.length
				? __( 'Redacted', 'fair-events-experimental' )
				: sprintf(
						/* translators: %d: length of a redacted value */
						_n(
							'Redacted, %d character',
							'Redacted, %d characters',
							field.length,
							'fair-events-experimental'
						),
						field.length
					);
	}
	return '';
}

/**
 * Safe facts about a field beyond its value: identifier validation, the
 * structure of a redacted URL, and truncation.
 *
 * @param {Object} field Snapshot field.
 * @return {string[]} Notes.
 */
export function fieldNotes( field ) {
	const notes = [];
	if ( field.check && CHECKS[ field.check ] ) {
		notes.push( CHECKS[ field.check ] );
	}
	if ( field.url ) {
		if ( field.url.origin ) {
			notes.push(
				sprintf(
					/* translators: %s: scheme and host of a URL, such as https://example.com */
					__( 'Site: %s', 'fair-events-experimental' ),
					field.url.origin
				)
			);
		}
		notes.push(
			field.url.same_site
				? __( 'this site', 'fair-events-experimental' )
				: __( 'not this site', 'fair-events-experimental' )
		);
		if ( field.url.path ) {
			notes.push( __( 'has a path', 'fair-events-experimental' ) );
		}
		if ( field.url.query ) {
			notes.push(
				sprintf(
					/* translators: %d: number of query parameters in a URL */
					_n(
						'%d query parameter',
						'%d query parameters',
						field.url.query,
						'fair-events-experimental'
					),
					field.url.query
				)
			);
		}
		if ( field.url.fragment ) {
			notes.push( __( 'has a fragment', 'fair-events-experimental' ) );
		}
	}
	if ( field.truncated ) {
		notes.push( __( 'shortened', 'fair-events-experimental' ) );
	}
	return notes;
}

function fieldSummary( field ) {
	if ( ! field ) {
		return __( 'Missing', 'fair-events-experimental' );
	}
	return [
		`${ field.type }: ${ describeValue( field ) }`,
		...fieldNotes( field ),
	].join( ' · ' );
}

/**
 * Align two snapshots' fields by path. A field only one request had is
 * missing from the other; any difference in type, state, value, length,
 * validation or URL structure marks the row as different.
 *
 * @param {Object} first  First snapshot.
 * @param {Object} second Second snapshot.
 * @return {Array<{path: string, first: ?Object, second: ?Object, differs: boolean}>} Rows in first-seen order.
 */
export function compareRequests( first, second ) {
	const byPath = ( request ) =>
		new Map(
			( request?.fields || [] ).map( ( field ) => [ field.path, field ] )
		);
	const left = byPath( first );
	const right = byPath( second );
	const paths = [ ...new Set( [ ...left.keys(), ...right.keys() ] ) ];
	return paths.map( ( path ) => {
		const a = left.get( path ) || null;
		const b = right.get( path ) || null;
		return {
			path,
			first: a,
			second: b,
			differs: JSON.stringify( a ) !== JSON.stringify( b ),
		};
	} );
}

/**
 * The destination and fields of one sanitized request.
 *
 * @param {Object}  props
 * @param {?Object} props.request Snapshot from the API, or null.
 * @param {boolean} props.notSent Whether nothing was sent at all.
 * @return {Element} Request details.
 */
export function RequestDetails( { request, notSent = false } ) {
	if ( notSent ) {
		return (
			<p>
				{ __(
					'No request was sent to Meta.',
					'fair-events-experimental'
				) }
			</p>
		);
	}
	if ( ! request ) {
		return (
			<p>
				{ __(
					'Request details are unavailable for this entry.',
					'fair-events-experimental'
				) }
			</p>
		);
	}
	return (
		<div>
			<p style={ { margin: '0 0 4px', overflowWrap: 'anywhere' } }>
				{ sprintf(
					/* translators: 1: HTTP method, 2: Meta dataset ID, 3: Graph API version such as v26.0 */
					__(
						'%1$s to dataset %2$s, Graph API %3$s',
						'fair-events-experimental'
					),
					request.method,
					request.dataset_id,
					request.api_version
				) }
			</p>
			<p style={ { margin: '0 0 8px' } }>
				{ request.test_events_code
					? __(
							'Test Events code included',
							'fair-events-experimental'
						)
					: __( 'No Test Events code', 'fair-events-experimental' ) }
			</p>
			{ request.truncated && (
				<p style={ { margin: '0 0 8px' } }>
					{ __(
						'Some values or fields were shortened to keep this record small.',
						'fair-events-experimental'
					) }
				</p>
			) }
			<div
				role="region"
				aria-label={ __(
					'Sent request fields',
					'fair-events-experimental'
				) }
				// Keyboard users can scroll the bounded list.
				// eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
				tabIndex={ 0 }
				style={ {
					maxHeight: '360px',
					overflowY: 'auto',
					border: '1px solid #e0e0e0',
					padding: '0 8px',
				} }
			>
				<dl style={ { margin: 0 } }>
					{ request.fields.map( ( field ) => (
						<div
							key={ field.path }
							style={ {
								padding: '6px 0',
								borderBottom: '1px solid #f0f0f0',
							} }
						>
							<dt style={ MONOSPACE }>
								{ field.path }{ ' ' }
								<span style={ { color: '#757575' } }>
									{ field.type }
								</span>
							</dt>
							<dd
								style={ {
									margin: 0,
									overflowWrap: 'anywhere',
								} }
							>
								{ describeValue( field ) }
								{ fieldNotes( field ).length > 0 && (
									<span style={ { color: '#757575' } }>
										{ ' · ' }
										{ fieldNotes( field ).join( ' · ' ) }
									</span>
								) }
							</dd>
						</div>
					) ) }
				</dl>
			</div>
		</div>
	);
}

/**
 * Meta's side of an attempt: its diagnostics, or why there are none.
 *
 * @param {Object} props
 * @param {Object} props.attempt Attempt from the API.
 * @return {Element} Response details.
 */
function AttemptResponse( { attempt } ) {
	if ( ! attempt.outcome ) {
		return (
			<p>
				{ __(
					'The request was logged, but its result was not recorded.',
					'fair-events-experimental'
				) }
			</p>
		);
	}
	if ( 'transport' === attempt.outcome ) {
		return (
			<p>
				{ __(
					'No response was received from Meta.',
					'fair-events-experimental'
				) }
			</p>
		);
	}
	const detail = [ attempt.type, attempt.code ]
		.filter( Boolean )
		.join( ': ' );
	return (
		<>
			{ detail && 'received' !== attempt.outcome && (
				<div>
					{ sprintf(
						/* translators: %s: safe failure category/code reported by Meta */
						__( 'Error: %s', 'fair-events-experimental' ),
						detail
					) }
				</div>
			) }
			{ attempt.response ? (
				<TestDiagnostics diagnostics={ attempt.response } />
			) : (
				<p>
					{ __(
						'Response details are unavailable.',
						'fair-events-experimental'
					) }
				</p>
			) }
		</>
	);
}

function AttemptSummary( { attempt } ) {
	const status = attemptOutcome( attempt );
	return (
		<Flex wrap justify="flex-start" gap={ 3 }>
			<FlexItem>
				<strong>
					{ attempt.event_name ||
						__( '(unnamed event)', 'fair-events-experimental' ) }
				</strong>
			</FlexItem>
			<FlexItem>
				<span style={ { color: status.color, fontWeight: 600 } }>
					{ status.label }
				</span>
			</FlexItem>
			{ attemptLabels( attempt ).map( ( label ) => (
				<FlexItem key={ label }>{ label }</FlexItem>
			) ) }
			<FlexItem>{ attempt.created_at_local }</FlexItem>
		</Flex>
	);
}

/**
 * Two attempts side by side: who sent them, where, and every field aligned
 * by path.
 *
 * @param {Object} props
 * @param {Object} props.first  First selected attempt.
 * @param {Object} props.second Second selected attempt.
 * @return {Element} Comparison.
 */
export function AttemptComparison( { first, second } ) {
	const [ onlyDifferences, setOnlyDifferences ] = useState( true );
	const letters = [ 'A', 'B' ];
	const describeRouting = ( attempt ) =>
		attemptLabels( attempt ).join( ' · ' );
	const destination = ( request ) =>
		request
			? `${ request.dataset_id } · ${ request.api_version } · ${
					request.test_events_code
						? __(
								'Test Events code included',
								'fair-events-experimental'
							)
						: __(
								'No Test Events code',
								'fair-events-experimental'
							)
				}`
			: __( 'Unavailable', 'fair-events-experimental' );
	const meta = [
		{
			label: __( 'Sent', 'fair-events-experimental' ),
			values: [ first, second ].map( ( attempt ) =>
				[
					attempt.event_name,
					attemptOutcome( attempt ).label,
					attempt.created_at_local,
				].join( ' · ' )
			),
		},
		{
			label: __( 'Routing', 'fair-events-experimental' ),
			values: [ first, second ].map( describeRouting ),
		},
		{
			label: __( 'Destination', 'fair-events-experimental' ),
			values: [ first, second ].map( ( attempt ) =>
				destination( attempt.request )
			),
		},
	];
	const unavailable = ! first.request || ! second.request;
	const rows = unavailable
		? []
		: compareRequests( first.request, second.request );
	const shown = onlyDifferences
		? rows.filter( ( row ) => row.differs )
		: rows;
	const renderPair = ( values, differs ) =>
		values.map( ( value, index ) => (
			<div
				key={ letters[ index ] }
				style={ { overflowWrap: 'anywhere' } }
			>
				<strong>{ letters[ index ] }:</strong> { value }
				{ differs && index === 1 && (
					<span className="screen-reader-text">
						{ __( '(different)', 'fair-events-experimental' ) }
					</span>
				) }
			</div>
		) );
	return (
		<div
			role="region"
			aria-label={ __(
				'Request comparison',
				'fair-events-experimental'
			) }
			style={ {
				border: '1px solid #e0e0e0',
				padding: '8px 12px',
				marginBottom: '16px',
			} }
		>
			<h4 style={ { marginTop: 0 } }>
				{ __(
					'Comparing two sent requests',
					'fair-events-experimental'
				) }
			</h4>
			<VStack spacing={ 2 }>
				{ meta.map( ( row ) => (
					<div key={ row.label }>
						<div style={ { fontWeight: 600 } }>{ row.label }</div>
						{ renderPair(
							row.values,
							row.values[ 0 ] !== row.values[ 1 ]
						) }
					</div>
				) ) }
			</VStack>
			{ unavailable ? (
				<p>
					{ __(
						'Request details are unavailable for at least one of these requests, so their fields cannot be compared.',
						'fair-events-experimental'
					) }
				</p>
			) : (
				<>
					<div style={ { marginTop: '12px' } }>
						<ToggleControl
							__nextHasNoMarginBottom
							label={ __(
								'Show only differences',
								'fair-events-experimental'
							) }
							checked={ onlyDifferences }
							onChange={ setOnlyDifferences }
						/>
					</div>
					{ shown.length === 0 ? (
						<p>
							{ __(
								'The two requests have the same fields, types and safe values.',
								'fair-events-experimental'
							) }
						</p>
					) : (
						<div
							style={ {
								maxHeight: '420px',
								overflowY: 'auto',
								marginTop: '8px',
							} }
						>
							{ shown.map( ( row ) => (
								<div
									key={ row.path }
									style={ {
										padding: '6px 0 6px 8px',
										borderBottom: '1px solid #f0f0f0',
										borderLeft: row.differs
											? '3px solid #b26200'
											: '3px solid transparent',
									} }
								>
									<div style={ MONOSPACE }>{ row.path }</div>
									{ renderPair(
										[
											fieldSummary( row.first ),
											fieldSummary( row.second ),
										],
										row.differs
									) }
								</div>
							) ) }
						</div>
					) }
				</>
			) }
		</div>
	);
}

/**
 * The log of requests sent to Meta, newest first, loaded on request. Each
 * entry pairs the sanitized request with Meta's answer; any two can be
 * compared.
 *
 * @param {Object} props
 * @param {number} props.refreshKey Changes when a new request may have been logged.
 * @return {Element} Sent requests section.
 */
export default function SentRequests( { refreshKey } ) {
	const [ opened, setOpened ] = useState( false );
	const [ page, setPage ] = useState( 1 );
	const [ origin, setOrigin ] = useState( '' );
	const [ eventName, setEventName ] = useState( '' );
	const [ result, setResult ] = useState( null );
	const [ loading, setLoading ] = useState( false );
	const [ error, setError ] = useState( false );
	const [ expanded, setExpanded ] = useState( [] );
	// Selected attempts, kept whole so they survive paging and filters.
	const [ selected, setSelected ] = useState( [] );
	const latestRequest = useRef( 0 );

	useEffect( () => {
		if ( ! opened ) {
			return;
		}
		const requestId = ++latestRequest.current;
		const params = new URLSearchParams( {
			page: String( page ),
			per_page: String( PER_PAGE ),
		} );
		if ( origin ) {
			params.append( 'origin', origin );
		}
		if ( eventName ) {
			params.append( 'event_name', eventName );
		}
		setLoading( true );
		setError( false );
		apiFetch( { path: `${ PATH }?${ params.toString() }` } )
			.then( ( next ) => {
				if ( requestId !== latestRequest.current ) {
					return;
				}
				if ( ! Array.isArray( next?.items ) ) {
					throw new Error( 'invalid' );
				}
				setResult( next );
			} )
			.catch( () => {
				if ( requestId === latestRequest.current ) {
					setError( true );
				}
			} )
			.finally( () => {
				if ( requestId === latestRequest.current ) {
					setLoading( false );
				}
			} );
	}, [ opened, page, origin, eventName, refreshKey ] );

	const toggleExpanded = ( id ) =>
		setExpanded( ( current ) =>
			current.includes( id )
				? current.filter( ( other ) => other !== id )
				: [ ...current, id ]
		);
	const toggleSelected = ( attempt ) =>
		setSelected( ( current ) =>
			current.some( ( other ) => other.id === attempt.id )
				? current.filter( ( other ) => other.id !== attempt.id )
				: [ ...current, attempt ].slice( 0, 2 )
		);

	const intro = (
		<p>
			{ __(
				'Each request sent to Meta — administrator tests, immediate clicks and every queued retry — with Meta’s answer. Credentials and personal identifiers are removed before a request is logged; entries are kept for 30 days, up to 1,000 requests.',
				'fair-events-experimental'
			) }
		</p>
	);

	if ( ! opened ) {
		return (
			<>
				<h3>{ __( 'Sent requests', 'fair-events-experimental' ) }</h3>
				{ intro }
				<p>
					<Button
						variant="secondary"
						onClick={ () => setOpened( true ) }
					>
						{ __(
							'Show sent requests',
							'fair-events-experimental'
						) }
					</Button>
				</p>
			</>
		);
	}

	const items = result?.items || [];
	const totalPages = result?.total_pages || 1;
	let selectionNote = __(
		'Select two requests to compare them.',
		'fair-events-experimental'
	);
	if ( selected.length === 1 ) {
		selectionNote = __(
			'Select one more request to compare.',
			'fair-events-experimental'
		);
	} else if ( selected.length === 2 ) {
		selectionNote = __(
			'Two requests are selected. Clear one to choose another.',
			'fair-events-experimental'
		);
	}

	return (
		<>
			<h3>{ __( 'Sent requests', 'fair-events-experimental' ) }</h3>
			{ intro }
			<Flex wrap justify="flex-start" align="flex-end" gap={ 3 }>
				<FlexItem>
					<SelectControl
						__nextHasNoMarginBottom
						__next40pxDefaultSize
						label={ __( 'Sent by', 'fair-events-experimental' ) }
						value={ origin }
						options={ [
							{
								value: '',
								label: __(
									'Everyone',
									'fair-events-experimental'
								),
							},
							{
								value: 'admin_test',
								label: __(
									'Administrator tests',
									'fair-events-experimental'
								),
							},
							{
								value: 'production',
								label: __(
									'Production',
									'fair-events-experimental'
								),
							},
						] }
						onChange={ ( next ) => {
							setOrigin( next );
							setPage( 1 );
						} }
					/>
				</FlexItem>
				<FlexItem>
					<SelectControl
						__nextHasNoMarginBottom
						__next40pxDefaultSize
						label={ __( 'Event', 'fair-events-experimental' ) }
						value={ eventName }
						options={ [
							{
								value: '',
								label: __(
									'All events',
									'fair-events-experimental'
								),
							},
							...EVENT_NAMES.map( ( name ) => ( {
								value: name,
								label: name,
							} ) ),
						] }
						onChange={ ( next ) => {
							setEventName( next );
							setPage( 1 );
						} }
					/>
				</FlexItem>
			</Flex>
			<p className="description">{ selectionNote }</p>
			{ selected.length === 2 && (
				<AttemptComparison
					key={ selected
						.map( ( attempt ) => attempt.id )
						.join( '-' ) }
					first={ selected[ 0 ] }
					second={ selected[ 1 ] }
				/>
			) }
			{ error && (
				<Notice status="error" isDismissible={ false }>
					{ __(
						'The sent requests could not be loaded.',
						'fair-events-experimental'
					) }
				</Notice>
			) }
			{ loading && ! result && (
				<p>
					{ __(
						'Loading sent requests…',
						'fair-events-experimental'
					) }
				</p>
			) }
			{ result && items.length === 0 && (
				<p>
					{ origin || eventName
						? __(
								'No sent requests match these filters.',
								'fair-events-experimental'
							)
						: __(
								'No requests have been sent to Meta in the last 30 days.',
								'fair-events-experimental'
							) }
				</p>
			) }
			<VStack spacing={ 3 } style={ { marginBottom: '16px' } }>
				{ items.map( ( attempt ) => {
					const isSelected = selected.some(
						( other ) => other.id === attempt.id
					);
					const isExpanded = expanded.includes( attempt.id );
					return (
						<div
							key={ attempt.id }
							style={ {
								borderBottom: '1px solid #e0e0e0',
								paddingBottom: '8px',
							} }
						>
							<AttemptSummary attempt={ attempt } />
							<Flex wrap justify="flex-start" gap={ 3 }>
								<FlexItem>
									<CheckboxControl
										__nextHasNoMarginBottom
										label={ __(
											'Compare',
											'fair-events-experimental'
										) }
										checked={ isSelected }
										disabled={
											! isSelected && selected.length >= 2
										}
										onChange={ () =>
											toggleSelected( attempt )
										}
									/>
								</FlexItem>
								<FlexItem>
									<Button
										variant="link"
										aria-expanded={ isExpanded }
										onClick={ () =>
											toggleExpanded( attempt.id )
										}
									>
										{ isExpanded
											? __(
													'Hide details',
													'fair-events-experimental'
												)
											: __(
													'Show details',
													'fair-events-experimental'
												) }
									</Button>
								</FlexItem>
							</Flex>
							{ isExpanded && (
								<div
									style={ {
										display: 'grid',
										gridTemplateColumns:
											'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
										gap: '16px',
										marginTop: '8px',
									} }
								>
									<section>
										<h4 style={ { margin: '0 0 4px' } }>
											{ __(
												'Sent request',
												'fair-events-experimental'
											) }
										</h4>
										<RequestDetails
											request={ attempt.request }
										/>
									</section>
									<section>
										<h4 style={ { margin: '0 0 4px' } }>
											{ __(
												'Meta’s answer',
												'fair-events-experimental'
											) }
										</h4>
										<AttemptResponse attempt={ attempt } />
									</section>
								</div>
							) }
						</div>
					);
				} ) }
			</VStack>
			{ totalPages > 1 && (
				<Flex wrap justify="flex-start" align="center" gap={ 3 }>
					<FlexItem>
						<Button
							variant="secondary"
							disabled={ page <= 1 || loading }
							onClick={ () => setPage( page - 1 ) }
						>
							{ __( 'Newer', 'fair-events-experimental' ) }
						</Button>
					</FlexItem>
					<FlexItem>
						{ sprintf(
							/* translators: 1: current page number, 2: number of pages */
							__(
								'Page %1$d of %2$d',
								'fair-events-experimental'
							),
							page,
							totalPages
						) }
					</FlexItem>
					<FlexItem>
						<Button
							variant="secondary"
							disabled={ page >= totalPages || loading }
							onClick={ () => setPage( page + 1 ) }
						>
							{ __( 'Older', 'fair-events-experimental' ) }
						</Button>
					</FlexItem>
				</Flex>
			) }
		</>
	);
}
