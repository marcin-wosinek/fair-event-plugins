/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { SelectControl, ToggleControl } from '@wordpress/components';

/**
 * Internal dependencies
 */
import EmailContentControls from './EmailContentControls.js';
import EmailPreview from './EmailPreview.js';
import NotificationEditor from './NotificationEditor.js';
import ScheduleControls from './ScheduleControls.js';
import { sourceOptions } from './shared.js';
import useNotificationEditor from './useNotificationEditor.js';

const EDITABLE_FIELDS = [
	'name',
	'enabled',
	'source_slug',
	'day_of_week',
	'time_of_day',
	'week_scope',
	'skip_empty',
	'subject',
	'intro',
	'outro',
];

/**
 * What differs about bulk email: the test goes to the current administrator.
 */
const ADAPTER = {
	fields: EDITABLE_FIELDS,
	toForm: ( channel ) =>
		Object.fromEntries(
			EDITABLE_FIELDS.map( ( field ) => [ field, channel[ field ] ] )
		),
	testNotice: ( response ) => ( {
		status: 'success',
		message: sprintf(
			/* translators: %s: email address the test was sent to */
			__(
				'Test email sent to %s. No subscriber received it.',
				'fair-events'
			),
			response.sent_to
		),
	} ),
	messages: {
		saved: __( 'Bulk email settings saved.', 'fair-events' ),
		saveFailed: __(
			'Failed to save the bulk email settings.',
			'fair-events'
		),
		testFailed: __( 'Failed to send the test email.', 'fair-events' ),
	},
};

/**
 * Bulk email section of the Event notifications page.
 *
 * Fair Audience decides who receives the email and sends it; without it the
 * section explains that sending is paused and leaves the saved settings alone.
 *
 * @param {Object}   props
 * @param {Object}   props.channel Bulk email channel payload.
 * @param {Array}    props.sources Enabled event sources.
 * @param {Function} props.onSaved Receives the key and the saved channel payload.
 * @return {JSX.Element} The section.
 */
export default function BulkEmailChannel( { channel, sources, onSaved } ) {
	const editor = useNotificationEditor( {
		channel,
		adapter: ADAPTER,
		onSaved,
	} );
	const { form, dirty, setField } = editor;

	return (
		<NotificationEditor
			title={ __( 'Bulk email', 'fair-events' ) }
			editor={ editor }
			unavailableMessage={
				'active' === channel.state ? null : channel.state_message
			}
			saveLabel={ __( 'Save bulk email settings', 'fair-events' ) }
			previewLabel={ __( 'Preview next email', 'fair-events' ) }
			testLabel={ sprintf(
				/* translators: %s: the administrator's own email address */
				__( 'Send test email to %s', 'fair-events' ),
				channel.test_recipient
			) }
			notes={ [
				__(
					'The test goes to your address only, never to subscribers, and does not count as the week’s send.',
					'fair-events'
				),
				dirty &&
					__(
						'Save your changes first — the preview and the test use the saved settings.',
						'fair-events'
					),
			] }
			after={
				<>
					<EmailPreview
						preview={ editor.preview }
						skipEmpty={ editor.saved.skip_empty }
					/>
				</>
			}
		>
			<p>
				{ __(
					'Email the week’s events to your subscribers. Fair Audience decides who receives it: only participants who agreed to marketing emails and did not opt out of the weekly summary, each with their own unsubscribe link.',
					'fair-events'
				) }
			</p>

			<ToggleControl
				label={ __(
					'Email the weekly summary to subscribers',
					'fair-events'
				) }
				help={ __(
					'Turning this off keeps everything below.',
					'fair-events'
				) }
				checked={ !! form.enabled }
				onChange={ ( value ) => setField( 'enabled', value ) }
			/>

			<div className="fair-events-notifications__fields">
				<SelectControl
					className="is-wide"
					label={ __( 'Events to include', 'fair-events' ) }
					help={ __(
						'The event feed whose events are listed.',
						'fair-events'
					) }
					value={ form.source_slug }
					options={ sourceOptions( sources, form.source_slug ) }
					onChange={ ( value ) => setField( 'source_slug', value ) }
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
