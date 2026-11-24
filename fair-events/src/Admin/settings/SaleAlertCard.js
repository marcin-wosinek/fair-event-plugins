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
	__experimentalHStack as HStack,
	__experimentalVStack as VStack,
} from '@wordpress/components';

export const SALE_ALERTS_PATH = '/fair-events/v1/sale-alerts';
export const SALE_ALERTS_TEST_PATH = '/fair-events/v1/sale-alerts/test';

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

const DAYS = [
	{ value: '1', label: __( 'Monday', 'fair-events' ) },
	{ value: '2', label: __( 'Tuesday', 'fair-events' ) },
	{ value: '3', label: __( 'Wednesday', 'fair-events' ) },
	{ value: '4', label: __( 'Thursday', 'fair-events' ) },
	{ value: '5', label: __( 'Friday', 'fair-events' ) },
	{ value: '6', label: __( 'Saturday', 'fair-events' ) },
	{ value: '7', label: __( 'Sunday', 'fair-events' ) },
];

/**
 * Whether an organizer's sales are collected into a digest.
 *
 * @param {Object} settings Organizer settings.
 * @return {boolean} True for a daily or weekly digest.
 */
export function isDigest( settings ) {
	return 'daily' === settings.frequency || 'weekly' === settings.frequency;
}

/**
 * Form state from an organizer's saved settings.
 *
 * @param {Object} settings Saved settings from the payload.
 * @return {Object} `{ enabled, chat_id, frequency, time_of_day, day_of_week }`.
 */
export function toDraft( settings ) {
	return {
		enabled: settings.enabled,
		chat_id: settings.chat_id,
		frequency: settings.frequency || 'immediate',
		time_of_day: settings.time_of_day || '08:00',
		day_of_week: settings.day_of_week || 1,
	};
}

/**
 * Why the chat or channel can't be used, or null.
 *
 * @param {string} chatId Field value.
 * @return {string|null} Message.
 */
export function chatError( chatId ) {
	const chat = chatId.trim();
	if ( '' !== chat && ! CHAT_ID.test( chat ) ) {
		return __(
			'Enter one chat ID (a number such as -1001234567890) or a public @channelname.',
			'fair-events'
		);
	}
	return null;
}

/**
 * Why the form can't be saved, by field.
 *
 * @param {Object} draft Form state.
 * @return {Object} Messages by field; empty when the form is valid.
 */
export function draftErrors( draft ) {
	const errors = {};
	const chat = chatError( draft.chat_id );
	if ( chat ) {
		errors.chat_id = chat;
	} else if ( '' === draft.chat_id.trim() && draft.enabled ) {
		errors.chat_id = __(
			'Enter a chat or channel before turning the organizer’s alerts on.',
			'fair-events'
		);
	}
	if ( isDigest( draft ) && ! TIME.test( draft.time_of_day ) ) {
		errors.time_of_day = __(
			'Enter the delivery time as hours and minutes, for example 08:00.',
			'fair-events'
		);
	}
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
	if ( ! organizer.settings.enabled ) {
		return __(
			'Off: this organizer’s sales are not sent to Telegram.',
			'fair-events'
		);
	}
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
				'No digest is scheduled yet. Sales already waiting are kept for the next digest.',
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
 * Telegram ticket sale alerts of one organizer (#2448): its switch, chat
 * or channel with a test, and how often its sales are sent. Saved on its
 * own, separately from the organizer's details. Recent outcomes stay on
 * the Event notifications page.
 *
 * @param {Object} props
 * @param {string} props.organizer `default` or an organizer UUID.
 * @return {JSX.Element} The card.
 */
export default function SaleAlertCard( { organizer: organizerId } ) {
	const [ payload, setPayload ] = useState( null );
	const [ draft, setDraft ] = useState( null );
	const [ loadError, setLoadError ] = useState( null );
	const [ saving, setSaving ] = useState( false );
	const [ notice, setNotice ] = useState( null );
	const [ serverErrors, setServerErrors ] = useState( {} );
	// { status: 'pending' | 'success' | 'error', message, chat }.
	const [ test, setTest ] = useState( null );
	const savingRef = useRef( false );
	const testingRef = useRef( false );

	const apply = useCallback(
		( response ) => {
			setPayload( response );
			const found = response.organizers.find(
				( item ) => item.id === organizerId
			);
			setDraft( found ? toDraft( found.settings ) : null );
		},
		[ organizerId ]
	);

	const load = useCallback( () => {
		setLoadError( null );
		apiFetch( { path: SALE_ALERTS_PATH } ).then( apply, ( error ) =>
			setLoadError(
				error?.message ||
					__(
						'The Telegram ticket sales settings could not be loaded.',
						'fair-events'
					)
			)
		);
	}, [ apply ] );

	useEffect( () => {
		load();
	}, [ load ] );

	const organizer = payload
		? payload.organizers.find( ( item ) => item.id === organizerId )
		: null;
	const isDirty =
		!! organizer &&
		!! draft &&
		JSON.stringify( draft ) !==
			JSON.stringify( toDraft( organizer.settings ) );

	useEffect( () => {
		if ( ! isDirty ) {
			return undefined;
		}
		const onBeforeUnload = ( event ) => {
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener( 'beforeunload', onBeforeUnload );
		return () =>
			window.removeEventListener( 'beforeunload', onBeforeUnload );
	}, [ isDirty ] );

	const header = (
		<CardHeader>
			<h2>{ __( 'Telegram ticket sales', 'fair-events' ) }</h2>
		</CardHeader>
	);

	if ( ! payload || ( organizer && ! draft ) ) {
		return (
			<Card className="fair-events-sale-alerts">
				{ header }
				<CardBody>
					{ loadError ? (
						<VStack spacing={ 2 }>
							<Notice status="error" isDismissible={ false }>
								{ loadError }
							</Notice>
							<div>
								<Button variant="secondary" onClick={ load }>
									{ __( 'Try again', 'fair-events' ) }
								</Button>
							</div>
						</VStack>
					) : (
						<p>
							{ __(
								'Loading Telegram ticket sales settings…',
								'fair-events'
							) }
						</p>
					) }
				</CardBody>
			</Card>
		);
	}

	if ( ! organizer ) {
		return (
			<Card className="fair-events-sale-alerts">
				{ header }
				<CardBody>
					<p>
						{ __(
							'This organizer’s Telegram ticket sales can be set up once organizer management lists it. Reload the page to try again.',
							'fair-events'
						) }
					</p>
				</CardBody>
			</Card>
		);
	}

	const errors = draftErrors( draft );
	const blocked = Object.keys( errors ).length > 0;
	const chatMessage =
		serverErrors.chat_id || serverErrors.enabled || errors.chat_id;
	const timeMessage = serverErrors.time_of_day || errors.time_of_day;
	const testChat = draft.chat_id.trim();
	const testBlocked = '' === testChat || !! chatError( draft.chat_id );
	// A result describes the destination it was sent to only.
	const testResult = test && test.chat === testChat ? test : null;

	const update = ( field ) => ( value ) => {
		setServerErrors( ( current ) => ( {
			...current,
			[ field ]: undefined,
		} ) );
		setDraft( ( current ) => ( { ...current, [ field ]: value } ) );
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
				organizers: {
					[ organizerId ]: {
						...draft,
						chat_id: draft.chat_id.trim(),
					},
				},
			},
		} )
			.then( ( response ) => {
				apply( response );
				setNotice( {
					status: 'success',
					message: __(
						'Telegram ticket sales saved.',
						'fair-events'
					),
				} );
			} )
			.catch( ( error ) => {
				const prefix = `organizers.${ organizerId }.`;
				const fields = {};
				Object.entries( error?.data?.params || {} ).forEach(
					( [ field, message ] ) => {
						if ( field.startsWith( prefix ) ) {
							fields[ field.slice( prefix.length ) ] = message;
						}
					}
				);
				setServerErrors( fields );
				setNotice( {
					status: 'error',
					message:
						error?.message ||
						__(
							'The Telegram ticket sales were not saved. Try again.',
							'fair-events'
						),
				} );
			} )
			.finally( () => {
				savingRef.current = false;
				setSaving( false );
			} );
	};

	const sendTest = () => {
		if ( testingRef.current || testBlocked ) {
			return;
		}
		testingRef.current = true;
		const chat = testChat;
		setTest( { status: 'pending', chat } );
		apiFetch( {
			path: SALE_ALERTS_TEST_PATH,
			method: 'POST',
			data: { chat_id: chat },
		} )
			.then( () =>
				setTest( {
					status: 'success',
					chat,
					message: sprintf(
						/* translators: %s: Telegram chat ID or @channelname */
						__(
							'Test message sent to %s. Check that it arrived. Nothing was saved.',
							'fair-events'
						),
						chat
					),
				} )
			)
			.catch( ( error ) =>
				setTest( {
					status: 'error',
					chat,
					message:
						error?.message ||
						__(
							'The test message could not be sent. Try again.',
							'fair-events'
						),
					connectors:
						'fair_events_telegram_credential' === error?.code
							? error?.data?.connectors_url ||
								payload.connectors_url
							: null,
				} )
			)
			.finally( () => {
				testingRef.current = false;
			} );
	};

	const testing = 'pending' === test?.status;
	const dateFormat = getSettings().formats.datetime;

	return (
		<Card className="fair-events-sale-alerts">
			{ header }
			<CardBody>
				<VStack spacing={ 4 }>
					<p className="description" style={ { margin: 0 } }>
						{ __(
							'Post this organizer a Telegram message for each paid ticket purchase of its events as soon as the payment is confirmed, or a daily or weekly digest of them. Messages name the event, its dates, each ticket type with its quantity and the total paid, never the buyer. Saved separately from the organizer details.',
							'fair-events'
						) }
					</p>
					{ payload.credential_problem && (
						<Notice status="warning" isDismissible={ false }>
							{ payload.credential_problem }{ ' ' }
							<a href={ payload.connectors_url }>
								{ __( 'Open Connectors', 'fair-events' ) }
							</a>
						</Notice>
					) }
					<ToggleControl
						__nextHasNoMarginBottom
						label={ __(
							'Send this organizer’s sales',
							'fair-events'
						) }
						help={ __(
							'Off by default. Turns both immediate messages and digests on or off for this organizer.',
							'fair-events'
						) }
						checked={ draft.enabled }
						onChange={ update( 'enabled' ) }
						disabled={ saving }
					/>
					<div>
						<TextControl
							__nextHasNoMarginBottom
							__next40pxDefaultSize
							label={ __( 'Chat or channel', 'fair-events' ) }
							help={
								chatMessage ||
								__(
									'A private chat or channel ID such as -1001234567890, or @channelname. Add the bot to it first. Only administrators see it.',
									'fair-events'
								)
							}
							className={ chatMessage ? 'has-error' : undefined }
							value={ draft.chat_id }
							onChange={ update( 'chat_id' ) }
							disabled={ saving }
						/>
						<HStack
							justify="flex-start"
							alignment="center"
							wrap
							spacing={ 2 }
							style={ { marginTop: '8px' } }
						>
							<Button
								variant="secondary"
								onClick={ sendTest }
								isBusy={ testing }
								disabled={ testing || testBlocked }
								accessibleWhenDisabled
							>
								{ testing
									? __( 'Sending test…', 'fair-events' )
									: __( 'Send test message', 'fair-events' ) }
							</Button>
							{ testBlocked && ! testing && (
								<span className="description">
									{ __(
										'Enter a valid chat or channel to test it.',
										'fair-events'
									) }
								</span>
							) }
						</HStack>
						{ testResult && 'pending' !== testResult.status && (
							<div style={ { marginTop: '8px' } }>
								<Notice
									status={
										'success' === testResult.status
											? 'success'
											: 'error'
									}
									isDismissible={ false }
								>
									<span
										style={ { overflowWrap: 'anywhere' } }
									>
										{ testResult.message }
									</span>
									{ testResult.connectors && (
										<>
											{ ' ' }
											<a href={ testResult.connectors }>
												{ __(
													'Open Connectors',
													'fair-events'
												) }
											</a>
										</>
									) }
								</Notice>
							</div>
						) }
					</div>
					<SelectControl
						__nextHasNoMarginBottom
						__next40pxDefaultSize
						label={ __( 'How often', 'fair-events' ) }
						help={ serverErrors.frequency }
						className={
							serverErrors.frequency ? 'has-error' : undefined
						}
						value={ draft.frequency }
						options={ FREQUENCIES }
						onChange={ update( 'frequency' ) }
						disabled={ saving }
					/>
					{ 'weekly' === draft.frequency && (
						<SelectControl
							__nextHasNoMarginBottom
							__next40pxDefaultSize
							label={ __( 'Weekday', 'fair-events' ) }
							help={ serverErrors.day_of_week }
							className={
								serverErrors.day_of_week
									? 'has-error'
									: undefined
							}
							value={ String( draft.day_of_week ) }
							options={ DAYS }
							onChange={ ( day ) =>
								update( 'day_of_week' )(
									Number.parseInt( day, 10 )
								)
							}
							disabled={ saving }
						/>
					) }
					{ isDigest( draft ) && (
						<TextControl
							__nextHasNoMarginBottom
							__next40pxDefaultSize
							type="time"
							label={ __( 'Delivery time', 'fair-events' ) }
							help={
								timeMessage ||
								sprintf(
									/* translators: %s: site timezone name, for example Europe/Madrid */
									__(
										'In the site’s timezone (%s).',
										'fair-events'
									),
									payload.timezone
								)
							}
							className={ timeMessage ? 'has-error' : undefined }
							value={ draft.time_of_day }
							onChange={ update( 'time_of_day' ) }
							disabled={ saving }
						/>
					) }
					<p style={ { margin: 0 } }>
						{ isDirty
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
					{ notice && (
						<Notice
							status={ notice.status }
							onRemove={ () => setNotice( null ) }
						>
							{ notice.message }
						</Notice>
					) }
					<HStack justify="flex-start" alignment="center" wrap>
						<Button
							variant="primary"
							onClick={ save }
							isBusy={ saving }
							disabled={ saving || ! isDirty || blocked }
							accessibleWhenDisabled
						>
							{ __(
								'Save Telegram ticket sales',
								'fair-events'
							) }
						</Button>
						{ isDirty && (
							<span className="description">
								{ blocked
									? __(
											'Unsaved changes: correct the highlighted fields first.',
											'fair-events'
										)
									: __( 'Unsaved changes', 'fair-events' ) }
							</span>
						) }
					</HStack>
					{ payload.notifications_url && (
						<p className="description" style={ { margin: 0 } }>
							<a href={ payload.notifications_url }>
								{ __(
									'See recent ticket sale alerts in Event notifications',
									'fair-events'
								) }
							</a>
						</p>
					) }
				</VStack>
			</CardBody>
		</Card>
	);
}
