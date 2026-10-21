import { __, sprintf } from '@wordpress/i18n';
import { Flex, FlexItem } from '@wordpress/components';

/**
 * Meta's answer to a test send or delivery: HTTP status, received event
 * count, trace ID and messages. A field Meta did not report is shown as
 * such, distinct from zero events or an empty message list. Renders nothing
 * for entries recorded before these diagnostics existed.
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
