/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import {
	ExternalLink,
	Notice,
	SelectControl,
	TextareaControl,
	ToggleControl,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import NotificationEditor from './NotificationEditor.js';
import ScheduleControls from './ScheduleControls.js';
import TelegramHistory from './TelegramHistory.js';
import TelegramPreview, { TelegramTestResults } from './TelegramPreview.js';
import { sourceOptions } from './shared.js';
import useNotificationEditor from './useNotificationEditor.js';

const EDITABLE_FIELDS = [
	'name',
	'enabled',
	'source_slug',
	'page_id',
	'day_of_week',
	'time_of_day',
	'week_scope',
	'chat_ids',
];

/**
 * What differs about Telegram: chats are edited one per line and saved as
 * a list, and a test reports a result per chat.
 */
const ADAPTER = {
	fields: EDITABLE_FIELDS,
	toForm: ( channel ) => ( {
		...Object.fromEntries(
			EDITABLE_FIELDS.map( ( field ) => [ field, channel[ field ] ] )
		),
		chat_ids: ( channel.chat_ids || [] ).join( '\n' ),
	} ),
	testNotice: ( response ) =>
		response.success
			? {
					status: 'success',
					message: __(
						'Telegram accepted the test summary for every chat.',
						'fair-events'
					),
				}
			: {
					status: 'error',
					message: __(
						'The test summary did not reach every chat. See the results below.',
						'fair-events'
					),
				},
	messages: {
		saved: __( 'Telegram settings saved.', 'fair-events' ),
		saveFailed: __(
			'Failed to save the Telegram settings.',
			'fair-events'
		),
		testFailed: __( 'Failed to send the test summary.', 'fair-events' ),
	},
};

/**
 * What the administrator should know about the bot token: whether one is
 * configured, where it comes from, and whether it can be used at all.
 * A configured token is not proof that Telegram accepts it.
 *
 * @param {Object} channel Telegram channel payload.
 * @return {{status: string, message: string}} Notice status and text.
 */
export function tokenStatus( channel ) {
	const source = channel.token_source;
	const name = channel.token_override_name;

	if ( ! channel.token_configured ) {
		return {
			status: 'warning',
			message: __(
				'No bot token is configured. Add one in Connectors to post to Telegram.',
				'fair-events'
			),
		};
	}

	if ( ! channel.token_valid ) {
		if ( 'env' === source ) {
			return {
				status: 'warning',
				message: sprintf(
					/* translators: %s: environment variable name */
					__(
						'The %s environment variable does not hold a valid Telegram bot token, so nothing can be sent. Correct it where it is set.',
						'fair-events'
					),
					name
				),
			};
		}
		if ( 'constant' === source ) {
			return {
				status: 'warning',
				message: sprintf(
					/* translators: %s: PHP constant name */
					__(
						'The %s constant does not hold a valid Telegram bot token, so nothing can be sent. Correct it where it is defined.',
						'fair-events'
					),
					name
				),
			};
		}
		return {
			status: 'warning',
			message: __(
				'The saved bot token is not a valid Telegram bot token, so nothing can be sent. Replace it in Connectors.',
				'fair-events'
			),
		};
	}

	if ( 'env' === source ) {
		return {
			status: 'info',
			message: sprintf(
				/* translators: %s: environment variable name */
				__(
					'The bot token comes from the %s environment variable, which overrides any token saved in Connectors. Send a test to confirm Telegram accepts it.',
					'fair-events'
				),
				name
			),
		};
	}
	if ( 'constant' === source ) {
		return {
			status: 'info',
			message: sprintf(
				/* translators: %s: PHP constant name */
				__(
					'The bot token comes from the %s constant, which overrides any token saved in Connectors. Send a test to confirm Telegram accepts it.',
					'fair-events'
				),
				name
			),
		};
	}
	return {
		status: 'info',
		message: __(
			'A bot token is saved in Connectors. It is not shown here. Send a test to confirm Telegram accepts it.',
			'fair-events'
		),
	};
}

/**
 * Telegram section of the Event notifications page.
 *
 * @param {Object}   props
 * @param {Object}   props.channel Telegram channel payload.
 * @param {Array}    props.sources Enabled event sources.
 * @param {Array}    props.pages   Public pages.
 * @param {Function} props.onSaved Receives the key and the saved channel payload.
 * @return {JSX.Element} The section.
 */
export default function TelegramChannel( {
	channel,
	sources,
	pages,
	onSaved,
} ) {
	const editor = useNotificationEditor( {
		channel,
		adapter: ADAPTER,
		onSaved,
	} );
	const { form, dirty, setField } = editor;
	const update = ( field ) => ( value ) => setField( field, value );

	const pageOptions = [
		{ value: '0', label: __( 'Choose a page', 'fair-events' ) },
		...pages.map( ( page ) => ( {
			value: String( page.id ),
			label: page.title,
		} ) ),
	];

	const token = tokenStatus( channel );
	const tokenUsable = channel.token_configured && channel.token_valid;
	let testBlockedReason = null;
	if ( ! tokenUsable ) {
		testBlockedReason = __(
			'Fix the bot token in Connectors before sending a test message.',
			'fair-events'
		);
	} else if ( 0 === channel.chat_ids.length ) {
		testBlockedReason = __(
			'Save at least one chat or channel before sending a test message.',
			'fair-events'
		);
	} else if ( dirty ) {
		testBlockedReason = __(
			'Save your changes first — the test uses the saved settings.',
			'fair-events'
		);
	}

	return (
		<NotificationEditor
			title={ __( 'Telegram', 'fair-events' ) }
			editor={ editor }
			unavailableMessage={
				'active' === channel.state ? null : channel.state_message
			}
			saveLabel={ __( 'Save Telegram settings', 'fair-events' ) }
			previewLabel={ __(
				'Preview next Telegram message',
				'fair-events'
			) }
			testLabel={ __( 'Send test to the saved chats', 'fair-events' ) }
			testBlocked={ !! testBlockedReason }
			notes={ [
				channel.chat_ids.length > 0
					? sprintf(
							/* translators: %s: comma-separated list of Telegram chats */
							__(
								'The test posts the selected week’s summary to: %s. It works while posting is off and is not recorded as a weekly send.',
								'fair-events'
							),
							channel.chat_ids.join( ', ' )
						)
					: __(
							'The test posts the selected week’s summary to every saved chat. It works while posting is off and is not recorded as a weekly send.',
							'fair-events'
						),
				testBlockedReason,
				dirty &&
					! testBlockedReason &&
					__( 'Save your changes to preview them.', 'fair-events' ),
			] }
			after={
				<>
					<TelegramTestResults
						results={ editor.testResult?.results }
					/>
					<TelegramPreview preview={ editor.preview } />
					<TelegramHistory channel={ channel } />
				</>
			}
		>
			<p>
				{ __(
					'Post the week’s events to Telegram chats and channels, in the same format as the calendar’s “Copy summary” button.',
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
					'Post the weekly summary to Telegram',
					'fair-events'
				) }
				help={ __(
					'Turning this off keeps the bot token in Connectors and everything below.',
					'fair-events'
				) }
				checked={ !! form.enabled }
				onChange={ update( 'enabled' ) }
			/>

			<div className="fair-events-notifications__fields">
				<SelectControl
					label={ __( 'Events to include', 'fair-events' ) }
					help={ __(
						'The event feed whose events are listed.',
						'fair-events'
					) }
					value={ form.source_slug }
					options={ sourceOptions( sources, form.source_slug ) }
					onChange={ update( 'source_slug' ) }
				/>

				<SelectControl
					label={ __( 'Page linked in the heading', 'fair-events' ) }
					help={ __(
						'Any published, public page. Its title and link head the message.',
						'fair-events'
					) }
					value={ String( form.page_id || 0 ) }
					options={ pageOptions }
					onChange={ ( value ) =>
						setField( 'page_id', parseInt( value, 10 ) || 0 )
					}
				/>

				<ScheduleControls
					values={ form }
					weekHelp={ __(
						'Previews and tests select the week relative to today in the site timezone. Scheduled sends select it relative to their scheduled week.',
						'fair-events'
					) }
					onChange={ setField }
				/>

				<TextareaControl
					className="is-wide"
					label={ __( 'Chats and channels', 'fair-events' ) }
					help={ __(
						'One per line: a numeric chat ID (e.g. -1001234567890) or a public @channel username. Add the bot to each chat or channel with permission to post.',
						'fair-events'
					) }
					value={ form.chat_ids }
					onChange={ update( 'chat_ids' ) }
					rows={ 3 }
				/>
			</div>

			<Notice status={ token.status } isDismissible={ false }>
				{ token.message }{ ' ' }
				<ExternalLink href={ channel.connectors_url }>
					{ __( 'Manage in Connectors', 'fair-events' ) }
				</ExternalLink>
			</Notice>
		</NotificationEditor>
	);
}
