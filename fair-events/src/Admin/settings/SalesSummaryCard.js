/**
 * WordPress dependencies
 */
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
	__experimentalHStack as HStack,
	__experimentalVStack as VStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import {
	loadSalesSummary,
	previewSalesSummary,
	saveSalesSummary,
	testSalesSummary,
} from './sales-summary-api.js';

const DAYS = [
	{ value: '1', label: __( 'Monday', 'fair-events' ) },
	{ value: '2', label: __( 'Tuesday', 'fair-events' ) },
	{ value: '3', label: __( 'Wednesday', 'fair-events' ) },
	{ value: '4', label: __( 'Thursday', 'fair-events' ) },
	{ value: '5', label: __( 'Friday', 'fair-events' ) },
	{ value: '6', label: __( 'Saturday', 'fair-events' ) },
	{ value: '7', label: __( 'Sunday', 'fair-events' ) },
];

const RUN_STATUS = {
	sent: __( 'Sent', 'fair-events' ),
	partial: __( 'Partly sent: some addresses failed', 'fair-events' ),
	failed: __( 'Failed', 'fair-events' ),
	expired: __( 'Not sent: the period had already passed', 'fair-events' ),
	paused: __( 'Paused while organizer management is off', 'fair-events' ),
	configuration_error: __(
		'Not sent: no valid address was saved',
		'fair-events'
	),
};

// Characters the server never accepts in an address: whitespace, list
// separators, display-name and quoting characters.
const FORBIDDEN_EMAIL_CHARACTERS = /[\s,;<>()"'\\]/;

/**
 * Whether a value looks like one email address, as the server checks it
 * before saving: one `@`, a local part, and a domain with an inner dot.
 * Checked without a backtracking pattern.
 *
 * @param {string} value Trimmed value.
 * @return {boolean} Whether it looks like an address.
 */
export function isEmailAddress( value ) {
	if ( FORBIDDEN_EMAIL_CHARACTERS.test( value ) ) {
		return false;
	}
	const parts = value.split( '@' );
	if ( 2 !== parts.length || '' === parts[ 0 ] ) {
		return false;
	}
	// A dot with at least one character on each side.
	return parts[ 1 ].slice( 1, -1 ).includes( '.' );
}

/**
 * Form state from a report payload.
 *
 * @param {Object} settings Saved settings.
 * @return {Object} Form state; the weekday is a string for SelectControl.
 */
export function toFormState( settings ) {
	return {
		frequency: settings.frequency,
		time_of_day: settings.time_of_day,
		day_of_week: String( settings.day_of_week ),
		fallback_email: settings.fallback_email,
	};
}

/**
 * Turn a failed request into a message, preferring the server's per-field
 * detail.
 *
 * @param {Object} error    apiFetch rejection.
 * @param {string} fallback Message when the server gave none.
 * @return {string} Message.
 */
function errorMessage( error, fallback ) {
	const params = error?.data?.params;
	const detail = params ? Object.values( params ).filter( Boolean ) : [];
	if ( detail.length ) {
		return detail.join( ' ' );
	}
	return error?.message || fallback;
}

/**
 * Why the form can't be saved yet, or null.
 *
 * @param {Object} draft Form state.
 * @return {string|null} Reason.
 */
export function blockedReason( draft ) {
	const email = draft.fallback_email.trim();
	if ( '' !== email && ! isEmailAddress( email ) ) {
		return __( 'Enter one valid fallback email address.', 'fair-events' );
	}
	if ( 'off' !== draft.frequency && '' === email ) {
		return __(
			'Add a fallback email address before turning the sales summary on.',
			'fair-events'
		);
	}
	if (
		'off' !== draft.frequency &&
		! /^([01]\d|2[0-3]):[0-5]\d$/.test( draft.time_of_day )
	) {
		return __(
			'Enter the delivery time as hours and minutes, for example 08:00.',
			'fair-events'
		);
	}
	return null;
}

/**
 * Sales summary settings of one report (#2306): how often it is sent,
 * when, and the fallback address used when its organizer has no valid
 * notification address. Saves, previews and tests only this report.
 *
 * @param {Object} props
 * @param {string} props.report      `central`, `default` or an organizer UUID.
 * @param {string} props.title       Card heading.
 * @param {string} props.description What the report contains and who receives it.
 * @return {JSX.Element} The card.
 */
export default function SalesSummaryCard( { report, title, description } ) {
	const [ payload, setPayload ] = useState( null );
	const [ draft, setDraft ] = useState( null );
	const [ loadError, setLoadError ] = useState( null );
	const [ busy, setBusy ] = useState( null );
	const [ notice, setNotice ] = useState( null );
	const [ preview, setPreview ] = useState( null );
	const busyRef = useRef( false );

	const load = useCallback( () => {
		setLoadError( null );
		return loadSalesSummary( report )
			.then( ( response ) => {
				setPayload( response );
				setDraft( toFormState( response.settings ) );
			} )
			.catch( ( error ) =>
				setLoadError(
					errorMessage(
						error,
						__(
							'The sales summary settings could not be loaded.',
							'fair-events'
						)
					)
				)
			);
	}, [ report ] );

	useEffect( () => {
		load();
	}, [ load ] );

	const saved = payload ? toFormState( payload.settings ) : null;
	const isDirty =
		!! draft && JSON.stringify( draft ) !== JSON.stringify( saved );

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

	// Run one request at a time; a double click can't start a second one.
	const run = ( kind, request, onSuccess, failure ) => {
		if ( busyRef.current ) {
			return;
		}
		busyRef.current = true;
		setBusy( kind );
		setNotice( null );
		request()
			.then( onSuccess )
			.catch( ( error ) =>
				setNotice( {
					status: 'error',
					message: errorMessage( error, failure ),
				} )
			)
			.finally( () => {
				busyRef.current = false;
				setBusy( null );
			} );
	};

	if ( ! payload || ! draft ) {
		return (
			<Card className="fair-events-sales-summary">
				<CardHeader>
					<h2>{ title }</h2>
				</CardHeader>
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
								'Loading sales summary settings…',
								'fair-events'
							) }
						</p>
					) }
				</CardBody>
			</Card>
		);
	}

	const reason = blockedReason( draft );
	const savedFrequency = payload.settings.frequency;
	const previewFrequency = 'daily' === savedFrequency ? 'daily' : 'weekly';
	const update = ( field ) => ( value ) =>
		setDraft( ( current ) => ( { ...current, [ field ]: value } ) );

	const handleSave = () =>
		run(
			'save',
			() =>
				saveSalesSummary( report, {
					...draft,
					fallback_email: draft.fallback_email.trim(),
					day_of_week: Number( draft.day_of_week ),
				} ),
			( response ) => {
				setPayload( response );
				setDraft( toFormState( response.settings ) );
				setPreview( null );
				setNotice( {
					status: 'success',
					message: __( 'Sales summary saved.', 'fair-events' ),
				} );
			},
			__( 'The sales summary was not saved. Try again.', 'fair-events' )
		);

	const handlePreview = () =>
		run(
			'preview',
			() => previewSalesSummary( report, previewFrequency ),
			setPreview,
			__( 'The preview could not be built.', 'fair-events' )
		);

	const handleTest = () =>
		run(
			'test',
			() => testSalesSummary( report, previewFrequency ),
			( response ) =>
				setNotice( {
					status: 'success',
					message: sprintf(
						/* translators: %s: email address the test was sent to */
						__(
							'Test email handed over for delivery to %s. The schedule is unchanged.',
							'fair-events'
						),
						response.sent_to
					),
				} ),
			__( 'The test email could not be sent.', 'fair-events' )
		);

	const recipients = payload.recipient_count;
	const recipientText = recipients
		? sprintf(
				/* translators: %d: number of notification email addresses */
				_n(
					'It is sent separately to the %d notification address saved for the organizer.',
					'It is sent separately to each of the %d notification addresses saved for the organizer.',
					recipients,
					'fair-events'
				),
				recipients
			)
		: __(
				'The organizer has no notification address yet, so it is sent to the fallback address.',
				'fair-events'
			);

	const dateFormat = getSettings().formats.datetime;
	const lastRun = payload.last_run;

	return (
		<Card className="fair-events-sales-summary">
			<CardHeader>
				<h2>{ title }</h2>
			</CardHeader>
			<CardBody>
				<VStack spacing={ 4 }>
					{ description && (
						<p className="description" style={ { margin: 0 } }>
							{ description }
						</p>
					) }
					{ ! payload.available && (
						<Notice status="warning" isDismissible={ false }>
							{ __(
								'This sales summary is paused while organizer management is off. Its settings are kept and it resumes when organizer management is back.',
								'fair-events'
							) }
						</Notice>
					) }
					<SelectControl
						__nextHasNoMarginBottom
						__next40pxDefaultSize
						label={ __( 'How often', 'fair-events' ) }
						value={ draft.frequency }
						options={ [
							{ value: 'off', label: __( 'Off', 'fair-events' ) },
							{
								value: 'daily',
								label: __(
									'Daily — the previous day',
									'fair-events'
								),
							},
							{
								value: 'weekly',
								label: __(
									'Weekly — the previous Monday to Sunday',
									'fair-events'
								),
							},
						] }
						onChange={ update( 'frequency' ) }
						disabled={ !! busy || ! payload.available }
					/>
					{ 'weekly' === draft.frequency && (
						<SelectControl
							__nextHasNoMarginBottom
							__next40pxDefaultSize
							label={ __( 'Weekday', 'fair-events' ) }
							value={ draft.day_of_week }
							options={ DAYS }
							onChange={ update( 'day_of_week' ) }
							disabled={ !! busy || ! payload.available }
						/>
					) }
					{ 'off' !== draft.frequency && (
						<TextControl
							__nextHasNoMarginBottom
							__next40pxDefaultSize
							type="time"
							label={ __( 'Delivery time', 'fair-events' ) }
							help={ __(
								'In the site’s timezone.',
								'fair-events'
							) }
							value={ draft.time_of_day }
							onChange={ update( 'time_of_day' ) }
							disabled={ !! busy || ! payload.available }
						/>
					) }
					<TextControl
						__nextHasNoMarginBottom
						__next40pxDefaultSize
						type="email"
						label={ __( 'Fallback email address', 'fair-events' ) }
						help={ sprintf(
							/* translators: %s: sentence saying who receives the summary */
							__(
								'%s Required to turn the summary on. Addresses are private and never shown on the site.',
								'fair-events'
							),
							recipientText
						) }
						value={ draft.fallback_email }
						onChange={ update( 'fallback_email' ) }
						disabled={ !! busy || ! payload.available }
					/>
					{ payload.next_run && ! isDirty && (
						<p style={ { margin: 0 } }>
							{ sprintf(
								/* translators: %s: date and time of the next send */
								__( 'Next send: %s', 'fair-events' ),
								dateI18n( dateFormat, payload.next_run.time )
							) }
						</p>
					) }
					{ lastRun && (
						<p style={ { margin: 0 } }>
							{ sprintf(
								/* translators: 1: run status, 2: first day of the reported period, 3: last day of the reported period */
								__(
									'Last send: %1$s (sales from %2$s to %3$s).',
									'fair-events'
								),
								RUN_STATUS[ lastRun.status ] || lastRun.status,
								lastRun.period_start,
								lastRun.period_end
							) }
							{ lastRun.fallback &&
								' ' +
									__(
										'It went to the fallback address.',
										'fair-events'
									) }
						</p>
					) }
					{ isDirty && (
						<p className="description" style={ { margin: 0 } }>
							{ __( 'Unsaved changes', 'fair-events' ) }
						</p>
					) }
					{ notice && (
						<Notice
							status={ notice.status }
							onRemove={ () => setNotice( null ) }
						>
							{ notice.message }
						</Notice>
					) }
					{ reason && isDirty && (
						<p
							className="description"
							style={ { margin: 0, color: '#b32d2e' } }
						>
							{ reason }
						</p>
					) }
					<HStack justify="flex-start" wrap spacing={ 2 }>
						<Button
							variant="primary"
							onClick={ handleSave }
							isBusy={ 'save' === busy }
							disabled={
								!! busy ||
								! isDirty ||
								!! reason ||
								! payload.available
							}
						>
							{ __( 'Save sales summary', 'fair-events' ) }
						</Button>
						<Button
							variant="secondary"
							onClick={ handlePreview }
							isBusy={ 'preview' === busy }
							disabled={ !! busy || ! payload.available }
						>
							{ __( 'Preview', 'fair-events' ) }
						</Button>
						<Button
							variant="secondary"
							onClick={ handleTest }
							isBusy={ 'test' === busy }
							disabled={ !! busy || ! payload.available }
						>
							{ __( 'Send test email to me', 'fair-events' ) }
						</Button>
					</HStack>
					<p className="description" style={ { margin: 0 } }>
						{ __(
							'The preview and the test show the last completed period as of now, with the saved schedule. The test goes only to your own email address and does not count as a scheduled send.',
							'fair-events'
						) }
					</p>
					{ preview && (
						<VStack spacing={ 2 }>
							<p style={ { margin: 0 } }>
								<strong>
									{ __( 'Subject:', 'fair-events' ) }
								</strong>{ ' ' }
								{ preview.subject }
							</p>
							<div
								className="fair-events-sales-summary__preview"
								role="group"
								aria-label={ __(
									'Sales summary preview',
									'fair-events'
								) }
								style={ {
									border: '1px solid #dcdcde',
									padding: '12px',
									overflowX: 'auto',
									overflowWrap: 'anywhere',
								} }
								// The server sanitizes the body with wp_kses_post().
								dangerouslySetInnerHTML={ {
									__html: preview.html,
								} }
							/>
						</VStack>
					) }
				</VStack>
			</CardBody>
		</Card>
	);
}
