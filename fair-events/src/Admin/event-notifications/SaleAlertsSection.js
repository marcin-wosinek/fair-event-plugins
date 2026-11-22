/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';
import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import { dateI18n, getSettings } from '@wordpress/date';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	Notice,
	TextControl,
	ToggleControl,
} from '@wordpress/components';

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
import { useUnsavedWarning } from './shared.js';

export const SALE_ALERTS_PATH = '/fair-events/v1/sale-alerts';

// The server's own check (TelegramSettings::valid_chat_id()).
const CHAT_ID = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{3,31})$/;

/**
 * Form state from the server's payload.
 *
 * @param {Object} payload Settings payload.
 * @return {Object} `{ enabled, organizers: { [id]: { enabled, chat_id } } }`.
 */
export function toDraft( payload ) {
	return {
		enabled: payload.enabled,
		organizers: Object.fromEntries(
			payload.organizers.map( ( organizer ) => [
				organizer.id,
				{
					enabled: organizer.settings.enabled,
					chat_id: organizer.settings.chat_id,
				},
			] )
		),
	};
}

/**
 * Why each organizer's settings can't be saved, by organizer ID.
 *
 * @param {Object} draft Form state.
 * @return {Object} Messages by organizer ID; empty when the form is valid.
 */
export function draftErrors( draft ) {
	const errors = {};
	Object.entries( draft.organizers ).forEach( ( [ id, organizer ] ) => {
		const chat = organizer.chat_id.trim();
		if ( '' !== chat && ! CHAT_ID.test( chat ) ) {
			errors[ id ] = __(
				'Enter one chat ID (a number such as -1001234567890) or a public @channelname.',
				'fair-events'
			);
		} else if ( '' === chat && organizer.enabled ) {
			errors[ id ] = __(
				'Enter a chat or channel before turning the organizer’s alerts on.',
				'fair-events'
			);
		}
	} );
	return errors;
}

/**
 * What a recorded outcome means, and its tone.
 *
 * @param {Object} alert Recent outcome: `state` and `reason`.
 * @return {{label: string, tone: string}} Status text and tone.
 */
export function outcomeLabel( alert ) {
	const { state, reason } = alert;
	if ( 'sent' === state ) {
		return { label: __( 'Sent', 'fair-events' ), tone: 'success' };
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
 * Telegram ticket sale alerts (#2448): one message to the event’s
 * organizer for each paid ticket purchase. Saved on its own, with its own
 * recent outcomes.
 *
 * @return {JSX.Element} The section.
 */
export default function SaleAlertsSection() {
	const [ payload, setPayload ] = useState( null );
	const [ draft, setDraft ] = useState( null );
	const [ loadError, setLoadError ] = useState( null );
	const [ saving, setSaving ] = useState( false );
	const [ notice, setNotice ] = useState( null );
	const [ serverErrors, setServerErrors ] = useState( {} );
	const savingRef = useRef( false );

	const load = useCallback( () => {
		setLoadError( null );
		apiFetch( { path: SALE_ALERTS_PATH } ).then(
			( response ) => {
				setPayload( response );
				setDraft( toDraft( response ) );
			},
			( error ) =>
				setLoadError(
					error?.message ||
						__(
							'The ticket sale alert settings could not be loaded.',
							'fair-events'
						)
				)
		);
	}, [] );

	useEffect( () => {
		load();
	}, [ load ] );

	const isDirty =
		!! payload &&
		!! draft &&
		JSON.stringify( draft ) !== JSON.stringify( toDraft( payload ) );
	useUnsavedWarning( isDirty );

	const header = (
		<CardHeader>
			<h2>{ __( 'Telegram ticket sales', 'fair-events' ) }</h2>
		</CardHeader>
	);

	if ( ! payload || ! draft ) {
		return (
			<Card className="fair-events-notifications__channel">
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

	const errors = draftErrors( draft );
	const blocked = Object.keys( errors ).length > 0;

	const updateOrganizer = ( id, field ) => ( value ) => {
		setServerErrors( ( current ) => ( { ...current, [ id ]: undefined } ) );
		setDraft( ( current ) => ( {
			...current,
			organizers: {
				...current.organizers,
				[ id ]: { ...current.organizers[ id ], [ field ]: value },
			},
		} ) );
	};

	const save = () => {
		if ( savingRef.current || blocked ) {
			return;
		}
		savingRef.current = true;
		setSaving( true );
		setNotice( null );
		setServerErrors( {} );
		apiFetch( {
			path: SALE_ALERTS_PATH,
			method: 'PUT',
			data: {
				enabled: draft.enabled,
				organizers: Object.fromEntries(
					Object.entries( draft.organizers ).map(
						( [ id, organizer ] ) => [
							id,
							{ ...organizer, chat_id: organizer.chat_id.trim() },
						]
					)
				),
			},
		} )
			.then( ( response ) => {
				setPayload( response );
				setDraft( toDraft( response ) );
				setNotice( {
					status: 'success',
					message: __( 'Ticket sale alerts saved.', 'fair-events' ),
				} );
			} )
			.catch( ( error ) => {
				const byOrganizer = {};
				Object.entries( error?.data?.params || {} ).forEach(
					( [ field, message ] ) => {
						const match = /^organizers\.([^.]+)\./.exec( field );
						if ( match ) {
							byOrganizer[ match[ 1 ] ] = message;
						}
					}
				);
				setServerErrors( byOrganizer );
				setNotice( {
					status: 'error',
					message:
						error?.message ||
						__(
							'The ticket sale alerts were not saved. Try again.',
							'fair-events'
						),
				} );
			} )
			.finally( () => {
				savingRef.current = false;
				setSaving( false );
			} );
	};

	// Saved state only: the warning describes what is sent now.
	const missing = payload.enabled
		? payload.organizers.filter(
				( organizer ) => ! organizer.settings.chat_id
			)
		: [];
	const dateFormat = getSettings().formats.datetime;

	return (
		<Card className="fair-events-notifications__channel">
			{ header }
			<CardBody>
				<p style={ { marginTop: 0 } }>
					{ __(
						'Post a message to the event’s organizer for each paid ticket purchase, as soon as the payment is confirmed. It names the event, its dates, each ticket type with its quantity and the total paid, never the buyer. Events without an organizer of their own go to the sitewide organizer; an event’s sales never go to another organizer’s chat.',
						'fair-events'
					) }
				</p>

				{ payload.credential_problem && draft.enabled && (
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
				{ missing.length > 0 && ! isDirty && (
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

				<ToggleControl
					__nextHasNoMarginBottom
					label={ __(
						'Send ticket sale alerts to Telegram',
						'fair-events'
					) }
					help={ __(
						'Off by default. Each organizer below also needs its own switch and chat.',
						'fair-events'
					) }
					checked={ draft.enabled }
					onChange={ ( enabled ) =>
						setDraft( ( current ) => ( { ...current, enabled } ) )
					}
					disabled={ saving }
				/>

				{ payload.organizers.map( ( organizer ) => {
					const value = draft.organizers[ organizer.id ];
					const error =
						serverErrors[ organizer.id ] || errors[ organizer.id ];
					return (
						<div
							key={ organizer.id }
							className="fair-events-notifications__sale-alert-organizer"
						>
							<h3>
								{ organizer.sitewide
									? sprintf(
											/* translators: %s: organizer name */
											__(
												'%s (sitewide organizer)',
												'fair-events'
											),
											organizer.name
										)
									: organizer.name }
							</h3>
							<div className="fair-events-notifications__fields">
								<ToggleControl
									__nextHasNoMarginBottom
									label={ __(
										'Send this organizer’s sales',
										'fair-events'
									) }
									checked={ value.enabled }
									onChange={ updateOrganizer(
										organizer.id,
										'enabled'
									) }
									disabled={ saving }
								/>
								<TextControl
									__nextHasNoMarginBottom
									__next40pxDefaultSize
									label={ __(
										'Chat or channel',
										'fair-events'
									) }
									help={
										error ||
										__(
											'A private chat or channel ID such as -1001234567890, or @channelname. Add the bot to it first. Only administrators see it.',
											'fair-events'
										)
									}
									className={
										error ? 'has-error' : undefined
									}
									value={ value.chat_id }
									onChange={ updateOrganizer(
										organizer.id,
										'chat_id'
									) }
									disabled={ saving }
								/>
							</div>
						</div>
					);
				} ) }

				{ notice && (
					<Notice
						status={ notice.status }
						onRemove={ () => setNotice( null ) }
					>
						{ notice.message }
					</Notice>
				) }
				<div className="fair-events-notifications__actions">
					<Button
						variant="primary"
						onClick={ save }
						isBusy={ saving }
						disabled={ saving || ! isDirty || blocked }
						accessibleWhenDisabled
					>
						{ __( 'Save ticket sale alerts', 'fair-events' ) }
					</Button>
					{ isDirty && (
						<span className="fair-events-notifications__unsaved">
							{ blocked
								? __(
										'Unsaved changes: correct the highlighted chat first.',
										'fair-events'
									)
								: __( 'Unsaved changes', 'fair-events' ) }
						</span>
					) }
				</div>

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
							'No ticket sale alert yet. Sales are listed here once alerts are on.',
							'fair-events'
						) }
					</p>
				) }
			</CardBody>
		</Card>
	);
}
