/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import {
	ExternalLink,
	Notice,
	SelectControl,
	ToggleControl,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import NotificationEditor from './NotificationEditor.js';
import InstagramPreview from './InstagramPreview.js';
import ScheduleControls from './ScheduleControls.js';
import { RUN_STATUS_LABELS, Row, StatusText, sourceOptions } from './shared.js';
import useNotificationEditor from './useNotificationEditor.js';

const EDITABLE_FIELDS = [
	'name',
	'enabled',
	'source_slug',
	'page_id',
	'day_of_week',
	'time_of_day',
	'week_scope',
];

/**
 * Instagram has no test: every post is public. The preview shows the image
 * and caption instead.
 */
const ADAPTER = {
	fields: EDITABLE_FIELDS,
	toForm: ( channel ) =>
		Object.fromEntries(
			EDITABLE_FIELDS.map( ( field ) => [ field, channel[ field ] ] )
		),
	testNotice: () => null,
	messages: {
		saved: __( 'Instagram settings saved.', 'fair-events' ),
		saveFailed: __(
			'Failed to save the Instagram settings.',
			'fair-events'
		),
		testFailed: '',
	},
};

/**
 * Which account the posts go to, or why there is none.
 *
 * @param {Object} props
 * @param {Object} props.account Account payload.
 * @return {JSX.Element} The notice.
 */
function AccountNotice( { account } ) {
	const link = (
		<ExternalLink href={ account.settings_url }>
			{ __( 'Manage in Fair Events → Instagram', 'fair-events' ) }
		</ExternalLink>
	);

	if ( ! account.usable ) {
		return (
			<Notice status="warning" isDismissible={ false }>
				{ account.message ||
					__(
						'Instagram is not connected. Connect an account before turning on Instagram posts.',
						'fair-events'
					) }{ ' ' }
				{ link }
			</Notice>
		);
	}

	return (
		<Notice status="info" isDismissible={ false }>
			{ account.username
				? sprintf(
						/* translators: %s: Instagram username */
						__( 'Posts are published to @%s.', 'fair-events' ),
						account.username
					)
				: __(
						'Posts are published to the connected Instagram account.',
						'fair-events'
					) }{ ' ' }
			{ link }
		</Notice>
	);
}

/**
 * Posts being published now, and the latest outcome.
 *
 * @param {Object} props
 * @param {Object} props.channel Instagram channel payload.
 * @return {JSX.Element|null} The rows.
 */
function PostStatus( { channel } ) {
	const latest = ( channel.runs || [] )[ 0 ];
	const publishing = channel.publishing || [];
	if ( ! latest && 0 === publishing.length ) {
		return null;
	}

	return (
		<div className="fair-events-notifications__instagram-status">
			<h3>{ __( 'Latest post', 'fair-events' ) }</h3>
			{ latest && (
				<Row detail={ latest.message }>
					<strong>{ latest.week_title || latest.week_start }</strong>
					<StatusText
						state={ latest.status }
						label={
							RUN_STATUS_LABELS[ latest.status ] || latest.status
						}
					/>
					{ latest.permalink && (
						<ExternalLink href={ latest.permalink }>
							{ __( 'View the post', 'fair-events' ) }
						</ExternalLink>
					) }
				</Row>
			) }
			{ 0 < publishing.length && (
				<p className="description">
					{ __(
						'A post is being published: Instagram is processing it, or this site is checking whether it was published. It is never posted twice.',
						'fair-events'
					) }
				</p>
			) }
		</div>
	);
}

/**
 * Instagram section of the Event notifications page.
 *
 * @param {Object}   props
 * @param {Object}   props.channel Instagram channel payload.
 * @param {Array}    props.sources Enabled event sources.
 * @param {Array}    props.pages   Public pages.
 * @param {Function} props.onSaved Receives the key and the saved channel payload.
 * @return {JSX.Element} The section.
 */
export default function InstagramChannel( {
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
	const account = channel.account || {};
	const accountName = account.username
		? `@${ account.username }`
		: __( 'the connected Instagram account', 'fair-events' );

	const pageOptions = [
		{ value: '0', label: __( 'Choose a page', 'fair-events' ) },
		...pages.map( ( page ) => ( {
			value: String( page.id ),
			label: page.title,
		} ) ),
	];

	return (
		<NotificationEditor
			title={ __( 'Instagram', 'fair-events' ) }
			editor={ editor }
			unavailableMessage={
				'active' === channel.state ? null : channel.state_message
			}
			saveLabel={ __( 'Save Instagram settings', 'fair-events' ) }
			previewLabel={ __( 'Preview next Instagram post', 'fair-events' ) }
			notes={ [
				__(
					'The preview draws the image and caption from the saved settings for the selected week. It publishes nothing. There is no test post, because every Instagram post is public.',
					'fair-events'
				),
				dirty &&
					__( 'Save your changes to preview them.', 'fair-events' ),
			] }
			after={
				<>
					<InstagramPreview preview={ editor.preview } />
					<PostStatus channel={ channel } />
				</>
			}
		>
			<p>
				{ __(
					'Publish the week’s events to Instagram as one image, with the same list and the heading page’s link in the caption. Weeks without events are skipped.',
					'fair-events'
				) }
			</p>

			{ channel.configuration_error && (
				<Notice status="warning" isDismissible={ false }>
					{ channel.configuration_error }
				</Notice>
			) }

			<AccountNotice account={ account } />

			<ToggleControl
				label={ __(
					'Publish the weekly post to Instagram automatically',
					'fair-events'
				) }
				help={ sprintf(
					/* translators: %s: Instagram account, e.g. "@example" */
					__(
						'Turning this on lets this site publish a public post to %s every week at the time below, without asking first. Turning it off keeps everything below.',
						'fair-events'
					),
					accountName
				) }
				checked={ !! form.enabled }
				onChange={ ( value ) => setField( 'enabled', value ) }
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
					onChange={ ( value ) => setField( 'source_slug', value ) }
				/>

				<SelectControl
					label={ __( 'Page linked in the caption', 'fair-events' ) }
					help={ __(
						'Any published, public page. Its title heads the image and its link ends the caption.',
						'fair-events'
					) }
					value={ String( form.page_id || 0 ) }
					options={ pageOptions }
					onChange={ ( value ) =>
						setField( 'page_id', Number.parseInt( value, 10 ) || 0 )
					}
				/>

				<ScheduleControls
					values={ form }
					weekHelp={ __(
						'Previews select the week relative to today in the site timezone. Scheduled posts select it relative to their scheduled week.',
						'fair-events'
					) }
					onChange={ setField }
				/>
			</div>
		</NotificationEditor>
	);
}
