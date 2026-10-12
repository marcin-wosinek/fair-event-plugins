/**
 * WordPress dependencies
 */
import { __, _n, sprintf } from '@wordpress/i18n';
import { Notice } from '@wordpress/components';

/**
 * One recipient-level outcome line.
 *
 * @param {Object} props       Component props.
 * @param {Object} props.entry Outcome with name, email and reason.
 * @return {JSX.Element} List item.
 */
function OutcomeItem( { entry } ) {
	const who =
		[ entry.name, entry.email ].filter( Boolean ).join( ' — ' ) ||
		__( '(unknown recipient)', 'fair-audience' );
	return (
		<li>
			{ entry.reason
				? sprintf(
						/* translators: 1: recipient name and email, 2: reason */
						__( '%1$s: %2$s', 'fair-audience' ),
						who,
						entry.reason
				  )
				: who }
		</li>
	);
}

/**
 * Outcome of the last send: how many emails went out, who was left out and
 * why, and whether the message reached Mail History.
 *
 * @param {Object}   props           Component props.
 * @param {Object}   props.result    Response of the send endpoint.
 * @param {Function} props.onDismiss Called when the notice is closed.
 * @return {JSX.Element|null} The notices.
 */
export default function SendResult( { result, onDismiss } ) {
	if ( ! result ) {
		return null;
	}

	const failed = result.failed || [];
	const skipped = result.skipped || [];
	const sentCount = result.sent_count || 0;

	let status = 'success';
	let heading = sprintf(
		/* translators: %d: number of emails sent */
		_n(
			'%d email was sent.',
			'%d emails were sent.',
			sentCount,
			'fair-audience'
		),
		sentCount
	);
	if ( failed.length > 0 && sentCount === 0 ) {
		status = 'error';
		heading = __( 'No emails were sent.', 'fair-audience' );
	} else if ( failed.length > 0 ) {
		status = 'warning';
	}

	return (
		<div className="fair-audience-custom-mail__result">
			<Notice status={ status } isDismissible onRemove={ onDismiss }>
				<p>
					<strong>{ heading }</strong>
				</p>
				{ failed.length > 0 && (
					<>
						<p>
							{ sprintf(
								/* translators: %d: number of emails that could not be sent */
								_n(
									'%d email could not be sent:',
									'%d emails could not be sent:',
									failed.length,
									'fair-audience'
								),
								failed.length
							) }
						</p>
						<ul className="fair-audience-custom-mail__outcomes">
							{ failed.map( ( entry, index ) => (
								<OutcomeItem key={ index } entry={ entry } />
							) ) }
						</ul>
					</>
				) }
				{ skipped.length > 0 && (
					<>
						<p>
							{ sprintf(
								/* translators: %d: number of people left out of the send */
								_n(
									'%d person was left out:',
									'%d people were left out:',
									skipped.length,
									'fair-audience'
								),
								skipped.length
							) }
						</p>
						<ul className="fair-audience-custom-mail__outcomes">
							{ skipped.map( ( entry, index ) => (
								<OutcomeItem key={ index } entry={ entry } />
							) ) }
						</ul>
					</>
				) }
				{ failed.length > 0 && sentCount > 0 && (
					<p>
						{ __(
							'Sending the message again would also reach the people who already received it.',
							'fair-audience'
						) }
					</p>
				) }
			</Notice>
			{ result.history_saved === false && (
				<Notice status="warning" isDismissible={ false }>
					{ __(
						'The emails were processed as shown above, but this message could not be saved to Mail History. Do not send it again.',
						'fair-audience'
					) }
				</Notice>
			) }
		</div>
	);
}
