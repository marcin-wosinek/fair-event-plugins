/**
 * EventContextHeader Component
 *
 * Context block shown directly under the Manage Event H1: occurrence
 * date/time, a series/occurrence badge, public-link status, and (for
 * generated occurrences) an explanation of why the Tickets tab is disabled.
 *
 * @package FairEvents
 */

import { __, _n, sprintf } from '@wordpress/i18n';
import { formatSiteLocalDatetime } from 'fair-events-shared';

/**
 * @param {Object} props
 * @param {Object} props.eventDate      Event date object from the REST API.
 * @param {string} props.manageEventUrl Base Manage Event admin URL (no event_date_id).
 */
export default function EventContextHeader({ eventDate, manageEventUrl }) {
	if (!eventDate) return null;

	const dateLine = eventDate.start_datetime
		? formatSiteLocalDatetime(eventDate.start_datetime)
		: '—';

	const linkedPosts = eventDate.linked_posts || [];
	let linkStatus;
	if (eventDate.link_type === 'post' && linkedPosts.length > 0) {
		linkStatus = sprintf(
			/* translators: %s: title or URL of the linked post/page */
			__('Links to: %s', 'fair-events'),
			linkedPosts[0].title
		);
	} else if (eventDate.link_type === 'external' && eventDate.external_url) {
		linkStatus = sprintf(
			/* translators: %s: title or URL of the linked post/page */
			__('Links to: %s', 'fair-events'),
			eventDate.external_url
		);
	} else {
		linkStatus = __('No public page yet', 'fair-events');
	}

	const isMaster = eventDate.occurrence_type === 'master';
	const isGenerated =
		eventDate.occurrence_type === 'generated' && !!eventDate.master;

	const masterUrl = isGenerated
		? `${manageEventUrl}&event_date_id=${eventDate.master.id}`
		: null;

	return (
		<div
			className="fair-events-context-header"
			style={{ margin: '8px 0 16px' }}
		>
			<p style={{ margin: '0 0 4px' }}>
				{dateLine}
				{isMaster &&
					(() => {
						const count =
							1 + (eventDate.generated_occurrences?.length || 0);
						return (
							<span className="fair-events-context-badge">
								{sprintf(
									/* translators: %d: number of dates in the recurring series */
									_n(
										'Recurring series — %d date',
										'Recurring series — %d dates',
										count,
										'fair-events'
									),
									count
								)}
							</span>
						);
					})()}
				{isGenerated && (
					<span className="fair-events-context-badge">
						{sprintf(
							/* translators: 1: master event title, 2: occurrence date */
							__('Occurrence of %1$s on %2$s —', 'fair-events'),
							eventDate.master.title,
							dateLine
						)}{' '}
						<a href={masterUrl}>
							{__('view series', 'fair-events')}
						</a>
					</span>
				)}
			</p>
			<p style={{ margin: '0 0 4px' }}>{linkStatus}</p>
			{isGenerated && (
				<p style={{ margin: 0 }}>
					{__('Tickets are managed on the series —', 'fair-events')}{' '}
					<a href={masterUrl}>
						{__('open the master event', 'fair-events')}
					</a>
					.
				</p>
			)}
		</div>
	);
}
