/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { Notice } from '@wordpress/components';

/**
 * Internal dependencies
 */
import BulkEmailChannel from './BulkEmailChannel.js';
import HistoryView from './HistoryView.js';
import IndividualEmailChannel from './IndividualEmailChannel.js';
import TelegramChannel from './TelegramChannel.js';
import { linkTo } from './navigation.js';
import { TYPE_LABELS } from './shared.js';

/**
 * The editor of each notification kind. A new kind adds its editor here
 * and its configurations' `type` in the REST response.
 */
const EDITORS = {
	telegram: TelegramChannel,
	bulk_email: BulkEmailChannel,
	individual_email: IndividualEmailChannel,
};

/**
 * One notification: its editor and its own history, as two tabs with
 * their own URLs.
 *
 * The history tab is scoped to this notification and stays available when
 * its kind cannot be edited now. The history of every notification is a
 * separate view, reached by its own link.
 *
 * @param {Object}      props
 * @param {Object}      props.data     Page payload.
 * @param {Array}       props.dirty    IDs of notifications with unsaved changes.
 * @param {Object}      props.location View state.
 * @param {Function}    props.navigate Changes the view.
 * @param {Function}    props.onSaved  Receives the ID and the saved configuration payload.
 * @param {string|null} props.flash    Message about how the view was reached, e.g. after adding.
 * @return {JSX.Element} The view.
 */
export default function ConfigurationView( {
	data,
	dirty,
	location,
	navigate,
	onSaved,
	flash,
} ) {
	const configuration = data.configurations.find(
		( shown ) => shown.id === location.configuration
	);
	const back = (
		<p className="fair-events-notifications__breadcrumbs">
			<a { ...linkTo( navigate, { view: 'list' } ) }>
				{ __( '← All notifications', 'fair-events' ) }
			</a>
			<a { ...linkTo( navigate, { view: 'history', filters: {} } ) }>
				{ __( 'All notification history', 'fair-events' ) }
			</a>
		</p>
	);

	if ( ! configuration ) {
		return (
			<>
				{ back }
				<Notice status="warning" isDismissible={ false }>
					{ __(
						'This notification does not exist. It may have been removed, or the link is incomplete.',
						'fair-events'
					) }
				</Notice>
			</>
		);
	}

	const Editor = EDITORS[ configuration.type ];
	const title = configuration.name || TYPE_LABELS[ configuration.type ];
	const tab = ( name, label ) => (
		<a
			className={ `nav-tab${
				name === location.tab ? ' nav-tab-active' : ''
			}` }
			aria-current={ name === location.tab ? 'page' : undefined }
			{ ...linkTo( navigate, {
				view: 'configuration',
				configuration: configuration.id,
				tab: name,
				filters: {},
			} ) }
		>
			{ label }
		</a>
	);

	return (
		<>
			{ back }
			<h2 className="fair-events-notifications__title">
				{ title }{ ' ' }
				{ configuration.name && (
					<span className="fair-events-notifications__kind">
						{ TYPE_LABELS[ configuration.type ] }
					</span>
				) }{ ' ' }
				{ dirty.includes( configuration.id ) && (
					<span className="fair-events-notifications__unsaved">
						{ __( 'Unsaved changes', 'fair-events' ) }
					</span>
				) }
			</h2>
			<p>
				{ configuration.next_run
					? sprintf(
							/* translators: %s: date and time of the next send */
							__( 'Next send: %s.', 'fair-events' ),
							configuration.next_run.time_local
						)
					: __(
							'Nothing is scheduled. Turn it on and save to schedule sends.',
							'fair-events'
						) }
			</p>
			{ flash && (
				<Notice status="success" isDismissible={ false }>
					{ flash }
				</Notice>
			) }

			<nav
				className="nav-tab-wrapper fair-events-notifications__tabs"
				aria-label={ __( 'Notification sections', 'fair-events' ) }
			>
				{ tab( 'editor', __( 'Settings', 'fair-events' ) ) }
				{ tab( 'history', __( 'History', 'fair-events' ) ) }
			</nav>

			{ 'history' === location.tab ? (
				<HistoryView
					key={ configuration.id }
					scope={ configuration.id }
					configurations={ data.configurations }
					location={ location }
					navigate={ navigate }
				/>
			) : (
				Editor && (
					<Editor
						key={ configuration.id }
						channel={ configuration }
						sources={ data.sources }
						pages={ data.pages }
						onSaved={ onSaved }
					/>
				)
			) }
		</>
	);
}
