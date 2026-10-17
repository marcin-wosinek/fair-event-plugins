/**
 * WordPress dependencies
 */
import { __, _n, sprintf } from '@wordpress/i18n';
import { Notice } from '@wordpress/components';

/**
 * Internal dependencies
 */
import { Row, StatusText } from './shared.js';

export const DELIVERY_STATE_LABELS = {
	sending: __( 'Sending', 'fair-events' ),
	sent: __( 'Delivered', 'fair-events' ),
	failed: __( 'Failed', 'fair-events' ),
	uncertain: __( 'Unknown — check the chat before resending', 'fair-events' ),
	skipped: __( 'Not sent — an earlier part failed', 'fair-events' ),
};

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
 * Outcome of a test send, one row per chat.
 *
 * @param {Object} props
 * @param {Array}  props.results Per-chat results of the test.
 * @return {JSX.Element[]|null} The rows.
 */
export function TelegramTestResults( { results } ) {
	if ( ! results ) {
		return null;
	}

	return results.map( ( result ) => (
		<Row key={ result.destination } detail={ result.message }>
			<strong>{ result.destination }</strong>
			<StatusText
				state={ result.state }
				label={ DELIVERY_STATE_LABELS[ result.state ] || result.state }
			/>
		</Row>
	) );
}

/**
 * Preview of the next Telegram summary, built from the saved settings.
 *
 * @param {Object} props
 * @param {Object} props.preview Preview response, or `{ error }`.
 * @return {JSX.Element|null} The preview.
 */
export default function TelegramPreview( { preview } ) {
	if ( ! preview ) {
		return null;
	}
	if ( preview.error ) {
		return (
			<Notice status="error" isDismissible={ false }>
				{ preview.error }
			</Notice>
		);
	}

	return (
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
	);
}
