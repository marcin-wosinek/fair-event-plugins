/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';
import { __, _n, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import { dateI18n, getSettings } from '@wordpress/date';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	Notice,
	SelectControl,
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
import { DAYS, useUnsavedWarning } from './shared.js';

export const SALE_ALERTS_PATH = '/fair-events/v1/sale-alerts';

// The server's own check (TelegramSettings::valid_chat_id()).
const CHAT_ID = /^(-?\d{1,20}|@[A-Za-z][A-Za-z0-9_]{3,31})$/;

// The server's own check (TelegramSettings::valid_time()).
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

const FREQUENCIES = [
	{
		value: 'immediate',
		label: __( 'Immediately, one message per sale', 'fair-events' ),
	},
	{ value: 'daily', label: __( 'Daily digest', 'fair-events' ) },
	{ value: 'weekly', label: __( 'Weekly digest', 'fair-events' ) },
];

/**
 * Whether an organizer's sales are collected into a digest.
 *
 * @param {Object} organizer Organizer settings.
 * @return {boolean} True for a daily or weekly digest.
 */
export function isDigest( organizer ) {
	return 'daily' === organizer.frequency || 'weekly' === organizer.frequency;
}

/**
 * Form state from the server's payload.
 *
 * @param {Object} payload Settings payload.
 * @return {Object} `{ enabled, organizers: { [id]: { enabled, chat_id, frequency, time_of_day, day_of_week } } }`.
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
					frequency: organizer.settings.frequency || 'immediate',
					time_of_day: organizer.settings.time_of_day || '08:00',
					day_of_week: organizer.settings.day_of_week || 1,
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
 * Why each digest organizer's delivery time can't be saved, by organizer ID.
 *
 * @param {Object} draft Form state.
 * @return {Object} Messages by organizer ID; empty when every time is valid.
 */
export function scheduleErrors( draft ) {
	const errors = {};
	Object.entries( draft.organizers ).forEach( ( [ id, organizer ] ) => {
		if ( isDigest( organizer ) && ! TIME.test( organizer.time_of_day ) ) {
			errors[ id ] = __(
				'Enter the delivery time as hours and minutes, for example 08:00.',
				'fair-events'
			);
		}
	} );
	return errors;
}

/**
 * When an organizer's sales are sent, from its saved settings.
 *
 * @param {Object} organizer  Organizer from the payload.
 * @param {string} dateFormat Date and time format.
 * @param {string} timezone   Site timezone name.
 * @return {string} One or two sentences.
 */
export function deliveryText( organizer, dateFormat, timezone ) {
	if ( ! isDigest( organizer.settings ) ) {
		return __(
			'Each sale is sent as soon as its payment is confirmed.',
			'fair-events'
		);
	}
	const waiting = organizer.pending
		? ' ' +
			sprintf(
				/* translators: %d: number of ticket sales waiting for the digest */
				_n(
					'%d sale is waiting for it.',
					'%d sales are waiting for it.',
					organizer.pending,
					'fair-events'
				),
				organizer.pending
			)
		: '';
	if ( ! organizer.next_digest ) {
		return (
			__(
				'No digest is scheduled while alerts are off for this organizer or sitewide. Sales already waiting are kept for the next digest.',
				'fair-events'
			) + waiting
		);
	}
	return (
		sprintf(
			/* translators: 1: date and time of the next digest, 2: site timezone name, for example Europe/Madrid */
			__( 'Next digest: %1$s (%2$s).', 'fair-events' ),
			dateI18n( dateFormat, organizer.next_digest ),
			timezone
		) +
		waiting +
		' ' +
		__( 'Days without sales send nothing.', 'fair-events' )
	);
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

	const errors = draftErrors( draft );
	const timeErrors = scheduleErrors( draft );
	const blocked =
		Object.keys( errors ).length > 0 ||
		Object.keys( timeErrors ).length > 0;

	const updateOrganizer = ( id, field ) => ( value ) => {
		setServerErrors( ( current ) => ( {
			...current,
			[ id ]: undefined,
		} ) );
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
						const match = /^organizers\.([^.]+)\.(.+)$/.exec(
							field
						);
						if ( match ) {
							byOrganizer[ match[ 1 ] ] = {
								...byOrganizer[ match[ 1 ] ],
								[ match[ 2 ] ]: message,
							};
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
		<Card className="fair-events-notifications__channel fair-events-notifications__sale-alerts">
			{ header }
			<CardBody>
				<p style={ { marginTop: 0 } }>
					{ __(
						'Post the event’s organizer a message for each paid ticket purchase as soon as the payment is confirmed, or a daily or weekly digest of them. Messages name the event, its dates, each ticket type with its quantity and the total paid, never the buyer. Events without an organizer of their own go to the sitewide organizer; an event’s sales never go to another organizer’s chat.',
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
					const fieldErrors = serverErrors[ organizer.id ] || {};
					const error =
						fieldErrors.chat_id ||
						fieldErrors.enabled ||
						errors[ organizer.id ];
					const timeError =
						fieldErrors.time_of_day || timeErrors[ organizer.id ];
					const organizerDirty =
						JSON.stringify( value ) !==
						JSON.stringify(
							toDraft( { ...payload, organizers: [ organizer ] } )
								.organizers[ organizer.id ]
						);
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
								<SelectControl
									__nextHasNoMarginBottom
									__next40pxDefaultSize
									label={ __( 'How often', 'fair-events' ) }
									help={ fieldErrors.frequency }
									className={
										fieldErrors.frequency
											? 'has-error'
											: undefined
									}
									value={ value.frequency }
									options={ FREQUENCIES }
									onChange={ updateOrganizer(
										organizer.id,
										'frequency'
									) }
									disabled={ saving }
								/>
								{ 'weekly' === value.frequency && (
									<SelectControl
										__nextHasNoMarginBottom
										__next40pxDefaultSize
										label={ __( 'Weekday', 'fair-events' ) }
										help={ fieldErrors.day_of_week }
										className={
											fieldErrors.day_of_week
												? 'has-error'
												: undefined
										}
										value={ String( value.day_of_week ) }
										options={ DAYS }
										onChange={ ( day ) =>
											updateOrganizer(
												organizer.id,
												'day_of_week'
											)( Number.parseInt( day, 10 ) )
										}
										disabled={ saving }
									/>
								) }
								{ isDigest( value ) && (
									<TextControl
										__nextHasNoMarginBottom
										__next40pxDefaultSize
										type="time"
										label={ __(
											'Delivery time',
											'fair-events'
										) }
										help={
											timeError ||
											sprintf(
												/* translators: %s: site timezone name, for example Europe/Madrid */
												__(
													'In the site’s timezone (%s).',
													'fair-events'
												),
												payload.timezone
											)
										}
										className={
											timeError ? 'has-error' : undefined
										}
										value={ value.time_of_day }
										onChange={ updateOrganizer(
											organizer.id,
											'time_of_day'
										) }
										disabled={ saving }
									/>
								) }
								<p className="is-wide fair-events-notifications__sale-alert-delivery">
									{ organizerDirty
										? __(
												'Save to see when this organizer’s sales are sent. Sales already waiting for a digest are kept; switching to Immediately sends them in one final digest.',
												'fair-events'
											)
										: deliveryText(
												organizer,
												dateFormat,
												payload.timezone
											) }
								</p>
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
										'Unsaved changes: correct the highlighted fields first.',
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
