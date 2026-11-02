/**
 * Feed header - name, status, configured sources and the main actions.
 *
 * @package FairEventsExperimental
 */

import { Button } from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';

/**
 * Explains why a feed has no public-page link: none chosen, or the chosen
 * page isn't published (the API only returns published pages' URLs).
 *
 * @param {Object} source Event feed
 * @return {string} Explanation
 */
function missingPageText( source ) {
	return source.page_id
		? __(
				'Public page: the selected page isn’t published yet.',
				'fair-events-experimental'
			)
		: __(
				'Public page: none selected. Choose one in the feed settings.',
				'fair-events-experimental'
			);
}

/**
 * @param {Object}   props
 * @param {Object}   props.source Event feed
 * @param {Function} props.onEdit Opens the feed editor
 * @return {JSX.Element} The header
 */
export default function FeedHeader( { source, onEdit } ) {
	const sourceCount = source.data_sources?.length || 0;

	return (
		<div className="fair-events-feed-header">
			<div className="fair-events-feed-header__main">
				<h1 className="fair-events-feed-header__title">
					{ sprintf(
						/* translators: %s: event feed name */
						__( 'Event feed: %s', 'fair-events-experimental' ),
						source.name
					) }
				</h1>
				<p className="fair-events-feed-header__meta">
					<span
						className={ `fair-events-feed-status ${
							source.enabled
								? 'fair-events-feed-status--enabled'
								: 'fair-events-feed-status--disabled'
						}` }
					>
						{ source.enabled
							? __( 'Enabled', 'fair-events-experimental' )
							: __( 'Disabled', 'fair-events-experimental' ) }
					</span>
					<span>
						{ sprintf(
							/* translators: %d: number of sources (categories, other feeds…) the event feed collects events from; not a number of events */
							_n(
								'%d configured source',
								'%d configured sources',
								sourceCount,
								'fair-events-experimental'
							),
							sourceCount
						) }
					</span>
				</p>
				<p className="fair-events-feed-header__page">
					{ source.page_url
						? sprintf(
								/* translators: %s: title of the feed's public page */
								__(
									'Public page: %s',
									'fair-events-experimental'
								),
								source.page_title ||
									__(
										'(untitled page)',
										'fair-events-experimental'
									)
							)
						: missingPageText( source ) }
				</p>
				{ ! source.enabled && (
					<p className="fair-events-feed-header__note">
						{ __(
							'This feed is disabled: its calendar subscription and weekly summary stop working until you enable it.',
							'fair-events-experimental'
						) }
					</p>
				) }
			</div>
			<div className="fair-events-feed-header__actions">
				<Button variant="primary" onClick={ onEdit }>
					{ __( 'Edit event feed', 'fair-events-experimental' ) }
				</Button>
				{ source.page_url && (
					<Button
						variant="secondary"
						href={ source.page_url }
						target="_blank"
						rel="noopener noreferrer"
					>
						{ __( 'Open public page', 'fair-events-experimental' ) }
						<span className="screen-reader-text">
							{ __(
								'(opens in a new tab)',
								'fair-events-experimental'
							) }
						</span>
						<span aria-hidden="true">&nbsp;&#8599;</span>
					</Button>
				) }
			</div>
		</div>
	);
}
