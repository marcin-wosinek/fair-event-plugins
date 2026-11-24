/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';
import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useState } from '@wordpress/element';
import { dateI18n, getSettings } from '@wordpress/date';
import { Card, CardBody, CardHeader, Notice } from '@wordpress/components';

/**
 * Shared dependencies
 */
import {
	AdminTable,
	AdminTableCell,
	AdminTableHeaderCell,
	StatusLabel,
} from 'fair-events-shared/src/admin-table/index.js';

/**
 * Internal dependencies
 */
import { SALE_ALERTS_PATH } from '../settings/SaleAlertCard.js';

export { SALE_ALERTS_PATH };

/**
 * What a recorded outcome means, and its tone.
 *
 * @param {Object} alert Recent outcome: `state` and `reason`.
 * @return {{label: string, tone: string}} Status text and tone.
 */
export function outcomeLabel( alert ) {
	const { state, reason } = alert;
	if ( 'sent' === state ) {
		return {
			label: alert.digest
				? __( 'Sent in a digest', 'fair-events' )
				: __( 'Sent', 'fair-events' ),
			tone: 'success',
		};
	}
	if ( 'pending' === state ) {
		const refused = /^http_(\d+)$/.exec( reason );
		if ( refused || reason ) {
			return {
				label: refused
					? sprintf(
							/* translators: %s: HTTP status code returned by Telegram */
							__(
								'Waiting for the next digest: Telegram refused the last one (error %s)',
								'fair-events'
							),
							refused[ 1 ]
						)
					: __(
							'Waiting for the next digest: the last one was not sent',
							'fair-events'
						),
				tone: 'warning',
			};
		}
		return {
			label: __( 'Waiting for the next digest', 'fair-events' ),
			tone: 'info',
		};
	}
	if ( 'queued' === state || 'claimed' === state || 'sending' === state ) {
		return { label: __( 'Sending', 'fair-events' ), tone: 'info' };
	}
	if ( 'uncertain' === state ) {
		return {
			label: __(
				'Outcome unknown: Telegram may have posted it, so it is not resent',
				'fair-events'
			),
			tone: 'warning',
		};
	}
	if ( 'failed' === state ) {
		const status = /^http_(\d+)$/.exec( reason );
		return {
			label: status
				? sprintf(
						/* translators: %s: HTTP status code returned by Telegram */
						__(
							'Failed: Telegram refused the message (error %s)',
							'fair-events'
						),
						status[ 1 ]
					)
				: __( 'Failed: the message was not sent', 'fair-events' ),
			tone: 'error',
		};
	}

	const skipped = {
		disabled: [
			__( 'Not sent: ticket sale alerts were off', 'fair-events' ),
			'neutral',
		],
		organizer_disabled: [
			__( 'Not sent: alerts are off for this organizer', 'fair-events' ),
			'neutral',
		],
		missing_destination: [
			__(
				'Not sent: the organizer has no chat or channel',
				'fair-events'
			),
			'warning',
		],
		organizer_unavailable: [
			__(
				'Not sent: the event’s organizer could not be found',
				'fair-events'
			),
			'warning',
		],
		assignment_changed: [
			__(
				'Not sent: the event moved to another organizer before sending',
				'fair-events'
			),
			'neutral',
		],
		missing_token: [
			__( 'Not sent: no Telegram bot token', 'fair-events' ),
			'warning',
		],
		invalid_token: [
			__(
				'Not sent: the Telegram bot token is not valid',
				'fair-events'
			),
			'warning',
		],
		incomplete: [
			__(
				'Not sent: the purchase was not fully confirmed',
				'fair-events'
			),
			'warning',
		],
	};
	const [ label, tone ] = skipped[ reason ] || [
		__(
			'Not sent: the payment could not be matched to one confirmed purchase',
			'fair-events'
		),
		'warning',
	];
	return { label, tone };
}

/**
 * Telegram ticket sale alerts (#2448): what is set up and the recent
 * outcomes. Each organizer's switch, chat or channel and schedule are
 * edited with the organizer, on the page `settings_url` names.
 *
 * @return {JSX.Element} The section.
 */
export default function SaleAlertsSection() {
	const [ payload, setPayload ] = useState( null );
	const [ loadError, setLoadError ] = useState( null );

	const load = useCallback( () => {
		setLoadError( null );
		apiFetch( { path: SALE_ALERTS_PATH } ).then( setPayload, ( error ) =>
			setLoadError(
				error?.message ||
					__(
						'The ticket sale alerts could not be loaded.',
						'fair-events'
					)
			)
		);
	}, [] );

	useEffect( () => {
		load();
	}, [ load ] );

	const header = (
		<CardHeader>
			<h2>{ __( 'Telegram ticket sales', 'fair-events' ) }</h2>
		</CardHeader>
	);

	if ( ! payload ) {
		return (
			<Card className="fair-events-notifications__channel fair-events-notifications__sale-alerts">
				{ header }
				<CardBody>
					{ loadError ? (
						<Notice
							status="error"
							isDismissible={ false }
							actions={ [
								{
									label: __( 'Try again', 'fair-events' ),
									onClick: load,
								},
							] }
						>
							{ loadError }
						</Notice>
					) : (
						<p>
							{ __(
								'Loading ticket sale alerts…',
								'fair-events'
							) }
						</p>
					) }
				</CardBody>
			</Card>
		);
	}

	const sending = payload.organizers.filter(
		( organizer ) => organizer.settings.enabled
	);
	// Sales of these organizers' events are recorded as not sent.
	const missing = sending.length
		? payload.organizers.filter(
				( organizer ) => ! organizer.settings.chat_id
			)
		: [];
	const dateFormat = getSettings().formats.datetime;

	return (
		<Card className="fair-events-notifications__channel fair-events-notifications__sale-alerts">
			{ header }
			<CardBody>
				<p style={ { marginTop: 0 } }>
					{ __(
						'Post the event’s organizer a message for each paid ticket purchase as soon as the payment is confirmed, or a daily or weekly digest of them. Messages name the event, its dates, each ticket type with its quantity and the total paid, never the buyer. Events without an organizer of their own go to the sitewide organizer; an event’s sales never go to another organizer’s chat.',
						'fair-events'
					) }
				</p>

				{ payload.credential_problem && sending.length > 0 && (
					<Notice status="warning" isDismissible={ false }>
						{ payload.credential_problem }{ ' ' }
						<a href={ payload.connectors_url }>
							{ __( 'Open Connectors', 'fair-events' ) }
						</a>
					</Notice>
				) }
				{ ! payload.organizer_resolution_available && (
					<Notice status="warning" isDismissible={ false }>
						{ __(
							'Organizer management is off, so only the sitewide organizer is listed. Sales of events assigned to another organizer are not sent anywhere until it is back; their settings are kept.',
							'fair-events'
						) }
					</Notice>
				) }
				{ missing.length > 0 && (
					<Notice status="warning" isDismissible={ false }>
						{ sprintf(
							/* translators: %s: comma-separated organizer names */
							__(
								'These organizers have no chat or channel, so their sales are not sent: %s.',
								'fair-events'
							),
							missing
								.map( ( organizer ) => organizer.name )
								.join( ', ' )
						) }
					</Notice>
				) }

				<p>
					{ sending.length
						? sprintf(
								/* translators: %s: comma-separated organizer names */
								__(
									'Sending the sales of: %s.',
									'fair-events'
								),
								sending
									.map( ( organizer ) => organizer.name )
									.join( ', ' )
							)
						: __(
								'No organizer sends its sales to Telegram yet.',
								'fair-events'
							) }{ ' ' }
					<a href={ payload.settings_url }>
						{ payload.organizer_resolution_available
							? __(
									'Set up each organizer’s chat or channel, schedule and switch on the Organizers page',
									'fair-events'
								)
							: __(
									'Set up the organizer’s chat or channel, schedule and switch in Settings → Organizer',
									'fair-events'
								) }
					</a>
				</p>

				<h3>{ __( 'Recent ticket sale alerts', 'fair-events' ) }</h3>
				{ payload.recent.length ? (
					<AdminTable
						caption={ __(
							'Recent ticket sale alerts',
							'fair-events'
						) }
					>
						<thead>
							<tr>
								<AdminTableHeaderCell variant="identity">
									{ __( 'Event', 'fair-events' ) }
								</AdminTableHeaderCell>
								<AdminTableHeaderCell>
									{ __( 'Organizer', 'fair-events' ) }
								</AdminTableHeaderCell>
								<AdminTableHeaderCell variant="status">
									{ __( 'Status', 'fair-events' ) }
								</AdminTableHeaderCell>
								<AdminTableHeaderCell>
									{ __( 'Sale', 'fair-events' ) }
								</AdminTableHeaderCell>
							</tr>
						</thead>
						<tbody>
							{ payload.recent.map( ( alert ) => {
								const outcome = outcomeLabel( alert );
								return (
									<tr key={ alert.id }>
										<AdminTableCell
											label={ __(
												'Event',
												'fair-events'
											) }
											variant="identity"
										>
											{ alert.event_title ||
												__(
													'(unknown event)',
													'fair-events'
												) }
										</AdminTableCell>
										<AdminTableCell
											label={ __(
												'Organizer',
												'fair-events'
											) }
										>
											{ alert.organizer_name || '—' }
										</AdminTableCell>
										<AdminTableCell
											label={ __(
												'Status',
												'fair-events'
											) }
											variant="status"
										>
											<StatusLabel tone={ outcome.tone }>
												{ outcome.label }
											</StatusLabel>
										</AdminTableCell>
										<AdminTableCell
											label={ __(
												'Sale',
												'fair-events'
											) }
										>
											{ dateI18n(
												dateFormat,
												alert.created_at
											) }
										</AdminTableCell>
									</tr>
								);
							} ) }
						</tbody>
					</AdminTable>
				) : (
					<p className="description">
						{ __(
							'No ticket sale alert yet. Sales are listed here once an organizer is switched on.',
							'fair-events'
						) }
					</p>
				) }
			</CardBody>
		</Card>
	);
}
