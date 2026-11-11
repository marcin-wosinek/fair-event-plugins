import { __, _n, sprintf } from '@wordpress/i18n';
import {
	Button,
	CheckboxControl,
	Notice,
	RadioControl,
	Spinner,
} from '@wordpress/components';

/**
 * The edits a participant's saved weekly preferences start from.
 *
 * Feed subscriptions are always explicit: no saved feeds is the
 * "No event feeds" choice.
 *
 * @param {Object} saved Participant detail response.
 * @return {{summary: boolean, choice: string, feedIds: number[]}} Edits.
 */
export function weeklyEditsFrom( saved ) {
	const feedIds = saved.weekly_feed_ids || [];
	const choice = feedIds.length > 0 ? 'selected' : 'none';
	return { summary: ! saved.weekly_summary_opt_out, choice, feedIds };
}

const SECTION_STYLE = { marginTop: '16px' };
const HEADING_STYLE = {
	fontSize: '14px',
	fontWeight: '600',
	margin: '0 0 8px',
};
const LABEL_STYLE = { fontWeight: '600', margin: '8px 0' };
const FEEDS_STYLE = {
	maxHeight: '200px',
	overflowY: 'auto',
	border: '1px solid #ddd',
	padding: '8px',
	borderRadius: '4px',
	marginTop: '8px',
	overflowWrap: 'anywhere',
};
const NOTE_STYLE = { color: '#50575e', marginTop: '8px' };

const sameIds = ( a, b ) =>
	a.length === b.length && a.every( ( id ) => b.includes( id ) );

/**
 * The weekly preference fields an update request sends: only what changed,
 * so an omitted preference keeps what is stored. Feed changes are left out
 * while the feed list cannot be read.
 *
 * @param {Object}        saved   Participant detail response.
 * @param {Object}        edits   Current edits.
 * @param {number[]|null} offered IDs of feeds that can be chosen now; null
 *                                when the feed list is not available.
 * @return {Object} Request fields.
 */
export function weeklyChanges( saved, edits, offered ) {
	const initial = weeklyEditsFrom( saved );
	const changes = {};

	if ( edits.summary !== initial.summary ) {
		changes.weekly_summary_opt_out = ! edits.summary;
	}

	if ( ! offered ) {
		return changes;
	}

	const chosen = edits.feedIds.filter( ( id ) => offered.includes( id ) );
	const wasChosen = initial.feedIds.filter( ( id ) =>
		offered.includes( id )
	);
	if (
		edits.choice !== initial.choice ||
		( edits.choice === 'selected' && ! sameIds( chosen, wasChosen ) )
	) {
		changes.weekly_feed_mode = edits.choice;
		if ( edits.choice === 'selected' ) {
			changes.weekly_feed_ids = chosen;
		}
	}

	return changes;
}

/**
 * Weekly summary and event feed fields of the participant popup. They are
 * independent of the email profile: feeds go to confirmed participants
 * whatever their marketing consent.
 *
 * @param {Object}                  props
 * @param {Object}                  props.saved        Saved preferences: `{ status, data }`.
 * @param {Object}                  props.catalog      Feed list: `{ status, available, feeds }`.
 * @param {Object}                  props.edits        Current edits, or null before loading.
 * @param {boolean}                 props.disabled     Whether a save is running.
 * @param {(edits: Object) => void} props.onChange     Receives the new edits.
 * @param {() => void}              props.onRetrySaved Reloads the saved preferences.
 * @param {() => void}              props.onRetryFeeds Reloads the feed list.
 */
export default function WeeklyPreferencesFields( {
	saved,
	catalog,
	edits,
	disabled,
	onChange,
	onRetrySaved,
	onRetryFeeds,
} ) {
	const heading = (
		<h3 style={ HEADING_STYLE }>
			{ __( 'Weekly summary', 'fair-audience' ) }
		</h3>
	);

	if ( saved.status === 'loading' ) {
		return (
			<div style={ SECTION_STYLE }>
				{ heading }
				<Spinner />
			</div>
		);
	}

	if ( saved.status === 'error' || ! edits ) {
		return (
			<div style={ SECTION_STYLE }>
				{ heading }
				<Notice status="warning" isDismissible={ false }>
					<p>
						{ __(
							'Weekly summary preferences could not be loaded. Saving now keeps them unchanged.',
							'fair-audience'
						) }
					</p>
					<Button
						variant="secondary"
						onClick={ onRetrySaved }
						disabled={ disabled }
					>
						{ __( 'Try again', 'fair-audience' ) }
					</Button>
				</Notice>
			</div>
		);
	}

	const isEligible = saved.data.status === 'confirmed';

	return (
		<div style={ SECTION_STYLE }>
			{ heading }
			<CheckboxControl
				label={ __(
					'Send the weekly events summary',
					'fair-audience'
				) }
				checked={ edits.summary }
				disabled={ disabled }
				onChange={ ( summary ) => onChange( { ...edits, summary } ) }
				help={
					isEligible
						? null
						: __(
								'Saved preference only: weekly summaries go to participants who confirmed their email address.',
								'fair-audience'
							)
				}
			/>
			<FeedFields
				saved={ saved.data }
				catalog={ catalog }
				edits={ edits }
				disabled={ disabled }
				onChange={ onChange }
				onRetry={ onRetryFeeds }
			/>
		</div>
	);
}

function FeedFields( { saved, catalog, edits, disabled, onChange, onRetry } ) {
	const label = (
		<p style={ LABEL_STYLE }>{ __( 'Event feeds', 'fair-audience' ) }</p>
	);

	if ( catalog.status === 'loading' ) {
		return (
			<>
				{ label }
				<Spinner />
			</>
		);
	}

	if ( catalog.status === 'error' || ! catalog.available ) {
		return (
			<>
				{ label }
				<Notice status="warning" isDismissible={ false }>
					<p>
						{ __(
							'Event feeds cannot be listed right now. Saving now keeps the feed choice unchanged.',
							'fair-audience'
						) }
					</p>
					<Button
						variant="secondary"
						onClick={ onRetry }
						disabled={ disabled }
					>
						{ __( 'Try again', 'fair-audience' ) }
					</Button>
				</Notice>
			</>
		);
	}

	const offered = catalog.feeds.map( ( feed ) => feed.id );
	const kept = edits.feedIds.filter( ( id ) => ! offered.includes( id ) );
	const described = ( saved.weekly_feed_summary?.unavailable || [] ).filter(
		( feed ) => kept.includes( feed.id )
	);
	const undescribed = kept.length - described.length;

	const toggle = ( id, checked ) =>
		onChange( {
			...edits,
			feedIds: checked
				? [ ...edits.feedIds, id ]
				: edits.feedIds.filter( ( feedId ) => feedId !== id ),
		} );

	return (
		<>
			<RadioControl
				label={ __( 'Event feeds', 'fair-audience' ) }
				selected={ edits.choice }
				disabled={ disabled }
				options={ [
					{
						label: __( 'Selected event feeds', 'fair-audience' ),
						value: 'selected',
					},
					{
						label: __( 'No event feeds', 'fair-audience' ),
						value: 'none',
					},
				] }
				onChange={ ( choice ) => onChange( { ...edits, choice } ) }
				help={ __(
					'Only the selected event feeds are sent. New event feeds are not added automatically.',
					'fair-audience'
				) }
			/>
			{ edits.choice === 'selected' && (
				<>
					<div style={ FEEDS_STYLE }>
						{ catalog.feeds.length === 0 ? (
							<p>
								{ __(
									'No event feeds can be chosen right now.',
									'fair-audience'
								) }
							</p>
						) : (
							catalog.feeds.map( ( feed ) => (
								<CheckboxControl
									key={ feed.id }
									label={ feed.name }
									checked={ edits.feedIds.includes(
										feed.id
									) }
									disabled={ disabled }
									onChange={ ( checked ) =>
										toggle( feed.id, checked )
									}
								/>
							) )
						) }
					</div>
					{ kept.length > 0 && (
						<div style={ NOTE_STYLE }>
							{ described.length > 0 && (
								<ul>
									{ described.map( ( feed ) => (
										<li key={ feed.id }>
											{ sprintf(
												/* translators: %s: event feed name. */
												__(
													'%s (not available right now)',
													'fair-audience'
												),
												feed.name
											) }
										</li>
									) ) }
								</ul>
							) }
							{ undescribed > 0 && (
								<p>
									{ sprintf(
										/* translators: %d: number of saved event feeds that are unavailable or deleted. */
										_n(
											'%d more saved feed is unavailable or was deleted.',
											'%d more saved feeds are unavailable or were deleted.',
											undescribed,
											'fair-audience'
										),
										undescribed
									) }
								</p>
							) }
							<p>
								{ __(
									'Saved feeds that cannot be chosen now stay saved. Choose “No event feeds” to clear them.',
									'fair-audience'
								) }
							</p>
						</div>
					) }
				</>
			) }
		</>
	);
}
