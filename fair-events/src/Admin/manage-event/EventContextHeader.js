/**
 * EventContextHeader Component
 *
 * Structured context header shown directly under the Manage Event H1:
 * breadcrumb, date/time/venue meta line, a chip row (link status, series
 * badge, categories), and link-state actions (view/edit the linked page,
 * open an external link, or set one up). For generated occurrences, also
 * explains why the Tickets tab is disabled.
 *
 * @package FairEvents
 */

import { Button, __experimentalHStack as HStack } from '@wordpress/components';
import { createInterpolateElement } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import { dateI18n, getSettings } from '@wordpress/date';
import {
	formatSiteLocalDatetime,
	formatSiteLocalTime,
	getEventDisplayTitle,
} from 'fair-events-shared';

/**
 * @param {Object}      props
 * @param {Object}      props.eventDate      Event date object from the REST API.
 * @param {string}      props.manageEventUrl Base Manage Event admin URL (no event_date_id).
 * @param {string}      props.calendarUrl    Base Calendar admin URL.
 * @param {Array}       props.venues         Venues loaded for the site (id, name).
 * @param {Function}    [props.onManageLink] Called to open the link-target popup. Omitted → no link actions render (read-only contexts).
 */
export default function EventContextHeader({
	eventDate,
	manageEventUrl,
	calendarUrl,
	venues = [],
	onManageLink,
}) {
	if (!eventDate) return null;

	const dateLine = eventDate.start_datetime
		? formatSiteLocalDatetime(eventDate.start_datetime)
		: '—';
	const timeRangeLine = eventDate.end_datetime
		? `${dateLine} – ${formatSiteLocalTime(eventDate.end_datetime)}`
		: dateLine;

	const venue = venues.find((v) => v.id === eventDate.venue_id);
	const venueLine = venue?.name || eventDate.address || null;

	const linkedPosts = eventDate.linked_posts || [];

	// Drives both the status chip and the action buttons below it, so the two
	// never disagree about what state the event's public page is in. The
	// junction table (linked_posts) is the source of truth for a linked page —
	// the same signal the link modal and the backend's get_display_url() trust —
	// because link_type can drift out of sync (e.g. a details save re-sending a
	// stale value) and must not override an actually-linked post. Precedence
	// mirrors get_display_url(): external URL first, then any linked post.
	let linkState;
	let primaryPost = null;
	if (eventDate.link_type === 'external' && eventDate.external_url) {
		linkState = 'external';
	} else if (linkedPosts.length > 0) {
		linkState = 'post';
		primaryPost = linkedPosts.find((lp) => lp.is_primary) || linkedPosts[0];
	} else {
		linkState = 'none';
	}

	let linkChip;
	if (linkState === 'post') {
		linkChip = {
			label: sprintf(
				/* translators: %s: title of the linked post/page */
				__('Public page: %s', 'fair-events'),
				primaryPost.title
			),
			className: 'fair-events-context-badge is-linked',
		};
	} else if (linkState === 'external') {
		linkChip = {
			label: sprintf(
				/* translators: %s: external URL the event links to */
				__('External page: %s', 'fair-events'),
				eventDate.external_url
			),
			className: 'fair-events-context-badge',
		};
	} else {
		linkChip = {
			label: __('No public page yet', 'fair-events'),
			className: 'fair-events-context-badge',
		};
	}

	let linkActions = null;
	if (linkState === 'post') {
		linkActions = (
			<HStack spacing={2} alignment="left" wrap>
				{eventDate.display_url && (
					<Button
						variant="secondary"
						href={eventDate.display_url}
						target="_blank"
						rel="noreferrer"
					>
						{__('View public page', 'fair-events')}
					</Button>
				)}
				{primaryPost?.edit_url && (
					<Button variant="secondary" href={primaryPost.edit_url}>
						{__('Edit page', 'fair-events')}
					</Button>
				)}
				{onManageLink && (
					<Button variant="tertiary" onClick={onManageLink}>
						{__('Change link', 'fair-events')}
					</Button>
				)}
			</HStack>
		);
	} else if (linkState === 'external') {
		linkActions = (
			<HStack spacing={2} alignment="left" wrap>
				<Button
					variant="secondary"
					href={eventDate.external_url}
					target="_blank"
					rel="noreferrer"
				>
					{__('Open link', 'fair-events')}
				</Button>
				{onManageLink && (
					<Button variant="tertiary" onClick={onManageLink}>
						{__('Change link', 'fair-events')}
					</Button>
				)}
			</HStack>
		);
	} else if (onManageLink) {
		linkActions = (
			<HStack spacing={2} alignment="left" wrap>
				<Button variant="primary" onClick={onManageLink}>
					{__('Set up event page…', 'fair-events')}
				</Button>
			</HStack>
		);
	}

	const isMaster = eventDate.occurrence_type === 'master';
	const isGenerated =
		eventDate.occurrence_type === 'generated' && !!eventDate.master;

	const masterUrl = isGenerated
		? `${manageEventUrl}&event_date_id=${eventDate.master.id}`
		: null;

	const seriesCount = isMaster
		? 1 + (eventDate.generated_occurrences?.length || 0)
		: 0;

	const eventTitle = getEventDisplayTitle(eventDate.title);

	let calendarLinkLabel = __('Calendar', 'fair-events');
	let calendarHref = calendarUrl;
	if (calendarUrl && eventDate.start_datetime) {
		const month = eventDate.start_datetime.slice(0, 7);
		calendarHref = `${calendarUrl}&month=${month}`;
		const { formats } = getSettings();
		const monthLabel = dateI18n(
			formats.month || 'F Y',
			`${eventDate.start_datetime.replace(' ', 'T')}Z`,
			true
		);
		calendarLinkLabel = sprintf(
			/* translators: %s: month and year, e.g. "July 2026" */
			__('Calendar · %s', 'fair-events'),
			monthLabel
		);
	}

	const categories = eventDate.categories || [];

	return (
		<div
			className="fair-events-context-header"
			style={{
				margin: '8px 0 16px',
				borderLeft: '3px solid #2271b1',
				paddingLeft: '12px',
			}}
		>
			<nav aria-label={__('Breadcrumb', 'fair-events')}>
				{createInterpolateElement(
					sprintf(
						/* translators: 1: calendar link label (wrapped in <calendarlink> tags), 2: event title — breadcrumb trail after "Fair Events ›" */
						__(
							'Fair Events › <calendarlink>%1$s</calendarlink> › %2$s',
							'fair-events'
						),
						calendarLinkLabel,
						eventTitle
					),
					{
						calendarlink: calendarHref ? (
							<a href={calendarHref} />
						) : (
							<span />
						),
					}
				)}
			</nav>
			<p style={{ margin: '4px 0' }}>
				{timeRangeLine}
				{venueLine && ` · ${venueLine}`}
			</p>
			<p style={{ margin: '0 0 4px' }}>
				<span className={linkChip.className}>{linkChip.label}</span>
				{isMaster && (
					<span className="fair-events-context-badge">
						{sprintf(
							/* translators: %d: number of dates in the recurring series */
							_n(
								'Recurring series — %d date',
								'Recurring series — %d dates',
								seriesCount,
								'fair-events'
							),
							seriesCount
						)}
					</span>
				)}
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
				{categories.map((category) => (
					<span
						key={category.id}
						className="fair-events-context-badge"
					>
						{category.name}
					</span>
				))}
			</p>
			{linkActions && (
				<div style={{ margin: '0 0 4px' }}>{linkActions}</div>
			)}
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
