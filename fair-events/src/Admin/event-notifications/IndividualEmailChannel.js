/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import {
	Notice,
	SelectControl,
	TextControl,
	ToggleControl,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import EmailContentControls from './EmailContentControls.js';
import EmailHistory from './EmailHistory.js';
import EmailPreview from './EmailPreview.js';
import NotificationEditor from './NotificationEditor.js';
import ScheduleControls from './ScheduleControls.js';
import { RUN_STATUS_LABELS } from './shared.js';
import useNotificationEditor from './useNotificationEditor.js';

/**
 * Event selection meaning every published event of this site. Mirrors
 * IndividualEmailSettings::LOCAL_EVENTS; any other value is a source slug.
 */
const LOCAL_EVENTS = '@local';

const EDITABLE_FIELDS = [
	'name',
	'enabled',
	'recipient',
	'event_selection',
	'day_of_week',
	'time_of_day',
	'week_scope',
	'skip_empty',
	'subject',
	'intro',
	'outro',
];

// Sending succeeded only as far as this site can tell.
const STATUS_LABELS = {
	...RUN_STATUS_LABELS,
	sent: __( 'Handed over for delivery', 'fair-events' ),
};

/**
 * Whether a value is one plain email address. The server has the final say;
 * this only catches lists and typos before a save.
 *
 * @param {string} value Typed recipient.
 * @return {boolean} Whether it looks like one address.
 */
export function isSingleEmail( value ) {
	return /^[^\s@,;<>()"'\\]+@[^\s@,;<>()"'\\]+\.[^\s@,;<>()"'\\]+$/.test(
		value
	);
}

/**
 * Options for the event selection: every local event, then each event
 * source. A saved source that is no longer available stays visible instead
 * of silently becoming another selection.
 *
 * @param {Array}  sources Enabled event sources.
 * @param {string} current Selected value.
 * @return {Array} Select options.
 */
function selectionOptions( sources, current ) {
	const options = [
		{
			value: LOCAL_EVENTS,
			label: __( 'All published local events', 'fair-events' ),
		},
		...sources.map( ( source ) => ( {
			value: source.slug,
			label: source.name,
		} ) ),
	];
	if ( ! options.some( ( option ) => option.value === current ) ) {
		options.push( {
			value: current,
			label: sprintf(
				/* translators: %s: event feed slug */
				__( '%s (unavailable)', 'fair-events' ),
				current
			),
		} );
	}
	return options;
}

/**
 * What differs about individual email: one typed address, trimmed and
 * checked before a save, which is also where the test goes.
 */
const ADAPTER = {
	fields: EDITABLE_FIELDS,
	toForm: ( channel ) =>
		Object.fromEntries(
			EDITABLE_FIELDS.map( ( field ) => [ field, channel[ field ] ] )
		),
	toPayload: ( form ) => ( { ...form, recipient: form.recipient.trim() } ),
	problem: ( form ) => {
		const recipient = form.recipient.trim();
		if ( '' !== recipient && ! isSingleEmail( recipient ) ) {
			return __(
				'Enter exactly one email address, for example name@example.com.',
				'fair-events'
			);
		}
		if ( '' === recipient && form.enabled ) {
			return __(
				'Enter the email address that receives the weekly email before turning it on.',
				'fair-events'
			);
		}
		return null;
	},
	testNotice: ( response ) => ( {
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
	messages: {
		saved: __( 'Individual email settings saved.', 'fair-events' ),
		saveFailed: __(
			'Failed to save the individual email settings.',
			'fair-events'
		),
		testFailed: __( 'Failed to send the test email.', 'fair-events' ),
	},
};

/**
 * Individual email section of the Event notifications page.
 *
 * Sends the week's events to one address typed in here. Fair Events sends it
 * on its own: no other plugin, user account or participant is involved.
 *
 * @param {Object}   props
 * @param {Object}   props.channel Individual email channel payload.
 * @param {Array}    props.sources Enabled event sources.
 * @param {Function} props.onSaved Receives the key and the saved channel payload.
 * @return {JSX.Element} The section.
 */
export default function IndividualEmailChannel( {
	channel,
	sources,
	onSaved,
} ) {
	const editor = useNotificationEditor( {
		channel,
		adapter: ADAPTER,
		onSaved,
	} );
	const { form, dirty, setField } = editor;
	const update = ( field ) => ( value ) => setField( field, value );

	let testBlockedReason = null;
	if ( dirty ) {
		testBlockedReason = __(
			'Save your changes first — the preview and the test use the saved settings.',
			'fair-events'
		);
	} else if ( ! channel.recipient ) {
		testBlockedReason = __(
			'Save an email address before sending a test.',
			'fair-events'
		);
	}

	return (
		<NotificationEditor
			title={ __( 'Individual email', 'fair-events' ) }
			editor={ editor }
			saveLabel={ __( 'Save individual email settings', 'fair-events' ) }
			previewLabel={ __( 'Preview next email', 'fair-events' ) }
			testLabel={
				channel.recipient
					? sprintf(
							/* translators: %s: the saved recipient email address */
							__( 'Send test email to %s', 'fair-events' ),
							channel.recipient
						)
					: __( 'Send test email', 'fair-events' )
			}
			testBlocked={ !! testBlockedReason }
			notes={ [
				__(
					'The test goes to the saved address only. It works while the weekly email is off, does not count as the week’s send and does not move the next one.',
					'fair-events'
				),
				testBlockedReason,
			] }
			after={
				<>
					<EmailPreview
						preview={ editor.preview }
						skipEmpty={ editor.preview?.skip_empty }
						showRecipient
					/>
					<EmailHistory
						channel={ channel }
						statusLabels={ STATUS_LABELS }
						showDestination
					/>
				</>
			}
		>
			<p>
				{ __(
					'Email the week’s events to one address you enter here, for example your own inbox or a shared mailbox. Fair Events sends it on its own; no other plugin is needed.',
					'fair-events'
				) }
			</p>

			{ channel.configuration_error && (
				<Notice status="warning" isDismissible={ false }>
					{ channel.configuration_error }
				</Notice>
			) }

			<ToggleControl
				label={ __(
					'Email the weekly summary to this address',
					'fair-events'
				) }
				help={ __(
					'Turning this off keeps everything below.',
					'fair-events'
				) }
				checked={ !! form.enabled }
				onChange={ update( 'enabled' ) }
			/>

			<div className="fair-events-notifications__fields">
				<TextControl
					className="is-wide"
					type="email"
					label={ __( 'Send to', 'fair-events' ) }
					help={ __(
						'One email address. It does not need to belong to a user of this site.',
						'fair-events'
					) }
					value={ form.recipient }
					onChange={ update( 'recipient' ) }
					autoComplete="off"
				/>

				<SelectControl
					className="is-wide"
					label={ __( 'Events to include', 'fair-events' ) }
					help={ __(
						'Drafts and private events are never included.',
						'fair-events'
					) }
					value={ form.event_selection }
					options={ selectionOptions(
						sources,
						form.event_selection
					) }
					onChange={ update( 'event_selection' ) }
				/>

				<ScheduleControls
					values={ form }
					weekHelp={ __(
						'Weeks run from Monday to Sunday. Previews and tests select the week relative to today in the site timezone. Scheduled sends select it relative to their scheduled week.',
						'fair-events'
					) }
					onChange={ setField }
				/>

				<EmailContentControls values={ form } onChange={ setField } />
			</div>
		</NotificationEditor>
	);
}
