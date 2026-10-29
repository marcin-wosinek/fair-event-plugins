import apiFetch from '@wordpress/api-fetch';
import { __, _n, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	Notice,
} from '@wordpress/components';

const PATH = '/fair-events-experimental/v1/whatsapp/deliveries';

/** Milliseconds between checks while a message waits for an update. */
export const POLL_INTERVAL = 10000;

/** Checks after a send or a manual refresh before polling stops. */
export const POLL_LIMIT = 30;

/**
 * Title and explanation of a delivery outcome. API acceptance is never
 * presented as delivery.
 *
 * @param {Object} item Delivery from the API.
 * @return {{title: string, message: string}} Outcome text.
 */
export function outcomeText( item ) {
	switch ( item.outcome ) {
		case 'accepted':
			return {
				title: __( 'Accepted', 'fair-events-experimental' ),
				message: __(
					'WhatsApp accepted the message. Waiting for a delivery update.',
					'fair-events-experimental'
				),
			};
		case 'sent':
			return {
				title: __( 'Sent', 'fair-events-experimental' ),
				message: __(
					'WhatsApp sent the message. It has not reached the phone yet.',
					'fair-events-experimental'
				),
			};
		case 'delivered':
			return {
				title: __( 'Delivered', 'fair-events-experimental' ),
				message: __(
					"The message reached the recipient's phone.",
					'fair-events-experimental'
				),
			};
		case 'read':
			return {
				title: __( 'Read', 'fair-events-experimental' ),
				message: __(
					'The recipient opened the message.',
					'fair-events-experimental'
				),
			};
		case 'failed':
			return {
				title: __( 'Not delivered', 'fair-events-experimental' ),
				message: item.failure?.message || '',
			};
		case 'not_accepted':
			return {
				title: __( 'Not accepted', 'fair-events-experimental' ),
				message: item.send_error?.message || '',
			};
		default:
			return {
				title: __( 'Outcome unknown', 'fair-events-experimental' ),
				message: __(
					'WhatsApp did not confirm the send, so it may or may not have gone out. It was not retried.',
					'fair-events-experimental'
				),
			};
	}
}

/**
 * Codes and earlier failures worth showing beside the outcome.
 *
 * @param {Object} item Delivery from the API.
 * @return {string[]} Detail lines.
 */
export function outcomeDetails( item ) {
	const details = [];
	if ( item.failure && 'failed' !== item.outcome ) {
		details.push(
			sprintf(
				/* translators: %s: explanation of the failure */
				__(
					'An earlier update reported a failure: %s',
					'fair-events-experimental'
				),
				item.failure.message
			)
		);
	}
	const code = item.failure?.code || item.send_error?.meta_code;
	if ( code ) {
		details.push(
			sprintf(
				/* translators: %d: numeric error code reported by WhatsApp */
				__( 'WhatsApp error code: %d', 'fair-events-experimental' ),
				code
			)
		);
	}
	return details;
}

/**
 * Recent sends and their delivery state. Checks for updates every few
 * seconds while a message is still waiting and the page is visible, up to
 * {@link POLL_LIMIT} times after each send or manual refresh.
 *
 * @param {Object}   props
 * @param {number}   props.refreshKey Changes after each send.
 * @param {Function} props.onWebhook  Receives the webhook status of each read.
 * @return {Element} The history card.
 */
export default function DeliveryHistory( { refreshKey, onWebhook } ) {
	const [ data, setData ] = useState( null );
	const [ loading, setLoading ] = useState( false );
	const [ error, setError ] = useState( false );
	const [ budget, setBudget ] = useState( POLL_LIMIT );
	const loadingRef = useRef( false );
	const onWebhookRef = useRef( onWebhook );
	onWebhookRef.current = onWebhook;

	const load = useCallback( () => {
		if ( loadingRef.current ) {
			return Promise.resolve();
		}
		loadingRef.current = true;
		setLoading( true );
		return apiFetch( { path: PATH } )
			.then( ( next ) => {
				setData( next );
				setError( false );
				onWebhookRef.current( next.webhook );
			} )
			.catch( () => setError( true ) )
			.finally( () => {
				loadingRef.current = false;
				setLoading( false );
			} );
	}, [] );

	useEffect( () => {
		setBudget( POLL_LIMIT );
		load();
	}, [ refreshKey, load ] );

	const pending = !! data?.items.some( ( item ) => item.pending );
	useEffect( () => {
		if ( ! pending || budget <= 0 ) {
			return undefined;
		}
		const timer = setTimeout( () => {
			if ( 'hidden' === document.visibilityState ) {
				return;
			}
			setBudget( ( current ) => current - 1 );
			load();
		}, POLL_INTERVAL );
		return () => clearTimeout( timer );
	}, [ pending, budget, data, load ] );

	// A hidden page skips checks; catch up as soon as it is shown again.
	useEffect( () => {
		const onVisible = () => {
			if ( 'visible' === document.visibilityState && pending ) {
				load();
			}
		};
		document.addEventListener( 'visibilitychange', onVisible );
		return () =>
			document.removeEventListener( 'visibilitychange', onVisible );
	}, [ pending, load ] );

	const refresh = () => {
		setBudget( POLL_LIMIT );
		load();
	};

	return (
		<Card style={ { marginTop: '16px' } }>
			<CardHeader>
				<h2>{ __( 'Recent messages', 'fair-events-experimental' ) }</h2>
			</CardHeader>
			<CardBody>
				{ data && (
					<p>
						{ sprintf(
							/* translators: %d: number of days */
							_n(
								'Messages sent in the last %d day, with their latest delivery update. Only the last three digits of each recipient number are kept.',
								'Messages sent in the last %d days, with their latest delivery update. Only the last three digits of each recipient number are kept.',
								data.retention_days,
								'fair-events-experimental'
							),
							data.retention_days
						) }
					</p>
				) }
				<Button
					variant="secondary"
					onClick={ refresh }
					isBusy={ loading }
					disabled={ loading }
				>
					{ __( 'Refresh statuses', 'fair-events-experimental' ) }
				</Button>
				{ error && (
					<Notice
						status="error"
						isDismissible={ false }
						style={ { marginTop: '16px' } }
					>
						{ __(
							'Failed to load the delivery updates. Refresh to try again.',
							'fair-events-experimental'
						) }
					</Notice>
				) }
				{ ! data && ! error && (
					<p>
						{ __(
							'Loading messages…',
							'fair-events-experimental'
						) }
					</p>
				) }
				{ data && ! data.items.length && (
					<p>
						{ __(
							'No messages sent yet.',
							'fair-events-experimental'
						) }
					</p>
				) }
				{ pending && budget <= 0 && (
					<p className="description">
						{ __(
							'Some messages are still waiting for an update. Refresh to check again.',
							'fair-events-experimental'
						) }
					</p>
				) }
				{ data && !! data.items.length && (
					<ul
						aria-label={ __(
							'Recent messages',
							'fair-events-experimental'
						) }
						style={ {
							margin: '16px 0 0',
							overflowWrap: 'anywhere',
						} }
					>
						{ data.items.map( ( item ) => {
							const text = outcomeText( item );
							return (
								<li
									key={ item.id }
									style={ {
										borderTop: '1px solid #e0e0e0',
										padding: '8px 0',
									} }
								>
									<strong>{ text.title }</strong>
									<div>
										{ sprintf(
											/* translators: 1: template name, 2: template language code, 3: recipient number with most digits hidden, 4: date and time of the send */
											__(
												'%1$s (%2$s) to %3$s, sent on %4$s',
												'fair-events-experimental'
											),
											item.template.name,
											item.template.language,
											item.recipient,
											item.created_at_local
										) }
									</div>
									{ text.message && (
										<div>{ text.message }</div>
									) }
									{ outcomeDetails( item ).map( ( line ) => (
										<div
											key={ line }
											style={ { color: '#757575' } }
										>
											{ line }
										</div>
									) ) }
								</li>
							);
						} ) }
					</ul>
				) }
			</CardBody>
		</Card>
	);
}
