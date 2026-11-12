/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';

/**
 * Shared dependencies
 */
import {
	AdminTableCell,
	ItemIdentity,
	RowActions,
	StatusLabel,
} from 'fair-events-shared/src/admin-table/index.js';

/**
 * Internal dependencies
 */
import useDeleteAction from './useDeleteAction.js';
import useDuplicateAction from './useDuplicateAction.js';
import {
	ORIGIN_LABELS,
	OUTCOME_STATES,
	formatTime,
	outcomeLabel,
} from './historyFormat.js';
import { linkTo } from './navigation.js';
import { TYPE_LABELS } from './shared.js';

/**
 * Shared status tone of each execution outcome state.
 */
const OUTCOME_TONES = {
	sent: 'success',
	partial: 'warning',
	uncertain: 'warning',
	failed: 'error',
};

/**
 * One notification in the list: its name, kind, unsaved changes and the
 * problem keeping it from sending, then where it sends, whether it is on,
 * its next send and its latest send or test, and its actions: Edit, then
 * History, Duplicate and Delete in the row menu.
 *
 * Links keep real URLs, so they open in a new tab, and change the view in
 * place on a plain click. Duplicate's progress and failure, and Delete's
 * confirmation, are shown with the row, outside the menu.
 *
 * @param {Object}      props
 * @param {Object}      props.configuration Configuration payload.
 * @param {string}      props.audience      Who or where it sends to.
 * @param {string|null} props.problem       What keeps it from sending, if anything.
 * @param {boolean}     props.isDirty       Whether it has unsaved changes.
 * @param {Function}    props.navigate      Changes the view.
 * @param {Function}    props.onDuplicated  Receives the copy's payload.
 * @param {Function}    props.onDeleted     Receives the deleted payload.
 * @return {JSX.Element} The row.
 */
export default function NotificationRow( {
	configuration,
	audience,
	problem,
	isDirty,
	navigate,
	onDuplicated,
	onDeleted,
} ) {
	const duplicate = useDuplicateAction( { configuration, onDuplicated } );
	const remove = useDeleteAction( {
		configuration,
		audience,
		isDirty,
		onDeleted,
	} );

	const kind = TYPE_LABELS[ configuration.type ];
	const name = configuration.name || kind;
	const latest = configuration.latest_execution;
	const open = ( tab, extra = {} ) =>
		linkTo( navigate, {
			view: 'configuration',
			configuration: configuration.id,
			tab,
			filters: {},
			...extra,
		} );
	const asAction = ( link ) => ( {
		href: link.href,
		onLinkClick: link.onClick,
	} );
	const editor = open( 'editor' );

	return (
		<tr>
			<AdminTableCell variant="identity">
				<ItemIdentity
					title={ configuration.name }
					fallback={ kind }
					href={ editor.href }
					onClick={ editor.onClick }
					meta={ configuration.name ? kind : null }
				>
					{ isDirty && (
						<span className="fair-events-notifications__unsaved">
							{ __( 'Unsaved changes', 'fair-events' ) }
						</span>
					) }
					{ problem && (
						<span className="fair-admin-table__warning">
							{ problem }
						</span>
					) }
				</ItemIdentity>
			</AdminTableCell>
			<AdminTableCell label={ __( 'Sends to', 'fair-events' ) }>
				<span className="fair-events-notifications__audience">
					{ audience }
				</span>
			</AdminTableCell>
			<AdminTableCell
				label={ __( 'Status', 'fair-events' ) }
				variant="status"
			>
				{ configuration.enabled ? (
					<StatusLabel tone="success">
						{ __( 'On', 'fair-events' ) }
					</StatusLabel>
				) : (
					<StatusLabel tone="neutral">
						{ __( 'Paused', 'fair-events' ) }
					</StatusLabel>
				) }
			</AdminTableCell>
			<AdminTableCell label={ __( 'Next send', 'fair-events' ) }>
				{ configuration.next_run
					? configuration.next_run.time_local
					: __( 'Not scheduled', 'fair-events' ) }
			</AdminTableCell>
			<AdminTableCell
				label={ __( 'Latest send or test', 'fair-events' ) }
			>
				{ latest ? (
					<div className="fair-events-notifications__latest">
						<a { ...open( 'history', { execution: latest.id } ) }>
							{ sprintf(
								/* translators: 1: "Scheduled" or "Test", 2: date and time it started */
								__( '%1$s, %2$s', 'fair-events' ),
								ORIGIN_LABELS[ latest.origin ] || latest.origin,
								formatTime( latest.started_at )
							) }
						</a>
						<span className="fair-events-notifications__reason">
							<StatusLabel
								tone={
									OUTCOME_TONES[
										OUTCOME_STATES[ latest.outcome ]
									] || 'neutral'
								}
							>
								{ outcomeLabel( latest ) }
							</StatusLabel>
						</span>
					</div>
				) : (
					__( 'Nothing sent yet', 'fair-events' )
				) }
			</AdminTableCell>
			<AdminTableCell variant="actions">
				<RowActions
					primary={ {
						label: __( 'Edit', 'fair-events' ),
						accessibleLabel: sprintf(
							/* translators: %s: notification name */
							__( 'Edit “%s”', 'fair-events' ),
							name
						),
						...asAction( editor ),
					} }
					secondary={ [
						{
							label: __( 'History', 'fair-events' ),
							...asAction( open( 'history' ) ),
						},
						duplicate.action,
						remove.action,
					] }
					moreLabel={ sprintf(
						/* translators: %s: notification name */
						__( 'More actions for “%s”', 'fair-events' ),
						name
					) }
				/>
				{ duplicate.feedback }
				{ remove.dialog }
			</AdminTableCell>
		</tr>
	);
}
