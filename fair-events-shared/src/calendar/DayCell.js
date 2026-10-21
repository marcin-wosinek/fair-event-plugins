/**
 * Day Cell Component
 *
 * Individual day cell with day number, optional add button, and event list.
 *
 * @package FairEventsShared
 */

import { Button } from '@wordpress/components';
import {
	getEventLinkType,
	getLinkTypeIcon,
	getEventUrl,
} from './eventLinks.js';

/**
 * Grid mode shows this many event rows per day, then "+N more". The clamp
 * itself is CSS (style.css) so the mobile agenda can list every event; keep
 * both in sync.
 */
export const MAX_VISIBLE_EVENTS = 3;

/**
 * Title shown for an event, falling back to the consumer's translated label
 * so an untitled event never renders as a blank pill.
 *
 * @param {string|undefined} title    Event title.
 * @param {string}           untitled Fallback label.
 * @return {string} Display title.
 */
function getDisplayTitle( title, untitled ) {
	return title && title.trim() ? title.trim() : untitled;
}

export default function DayCell( {
	date,
	events,
	isCurrentMonth,
	isToday,
	isPast,
	onAddEvent,
	manageEventUrl,
	labels,
} ) {
	const dayNumber = date.getDate();
	const monthName = date.toLocaleDateString( undefined, { month: 'long' } );
	const hasEvents = events.length > 0;
	const hiddenCount = events.length - MAX_VISIBLE_EVENTS;

	const cellClasses = [
		'fair-events-calendar-day',
		isCurrentMonth ? 'current-month' : 'other-month',
		isToday ? 'today' : '',
		isPast ? 'past' : '',
		hasEvents ? 'has-events' : '',
	]
		.filter( Boolean )
		.join( ' ' );

	const handleAddClick = ( e ) => {
		e.stopPropagation();
		onAddEvent( date );
	};

	return (
		<div className={ cellClasses }>
			<div className="fair-events-calendar-day-header">
				<span
					className="fair-events-calendar-day-number"
					data-month-name={ monthName }
				>
					{ dayNumber }
				</span>
				{ onAddEvent && (
					<Button
						className="fair-events-calendar-add-btn"
						onClick={ handleAddClick }
						label={ labels.addEvent }
						icon="plus"
						size="small"
					/>
				) }
			</div>
			{ hasEvents && (
				<div className="fair-events-calendar-day-events">
					{ events.map( ( event, index ) => {
						const linkType = getEventLinkType( event );
						const linkTypeIcon = getLinkTypeIcon( linkType );
						const categoryNames =
							event.categories?.map( ( c ) => c.name ) || [];
						const displayTitle = getDisplayTitle(
							event.title,
							labels.untitled
						);
						const tooltip = categoryNames.length
							? `${ displayTitle }\n${ categoryNames.join( ', ' ) }`
							: displayTitle;
						const eventUrl = getEventUrl( event, manageEventUrl );
						const content = (
							<>
								<span
									className={ `dashicons ${ linkTypeIcon } fair-events-calendar-event-icon` }
								/>
								{ displayTitle }
								{ categoryNames.length > 0 && (
									<span className="fair-events-calendar-event-categories">
										{ categoryNames.join( ', ' ) }
									</span>
								) }
							</>
						);
						return (
							<div
								key={ index }
								className={ `fair-events-calendar-event-row link-type-${ linkType }` }
							>
								{ eventUrl ? (
									<a
										href={ eventUrl }
										className="fair-events-calendar-event"
										title={ tooltip }
									>
										{ content }
									</a>
								) : (
									<span
										className="fair-events-calendar-event fair-events-calendar-event-readonly"
										title={ tooltip }
									>
										{ content }
									</span>
								) }
								{ event.url && (
									<a
										href={ event.url }
										className="fair-events-calendar-destination-link"
										title={ labels.openDestination }
										target={
											linkType === 'external'
												? '_blank'
												: undefined
										}
										rel={
											linkType === 'external'
												? 'noopener noreferrer'
												: undefined
										}
										onClick={ ( e ) => e.stopPropagation() }
									>
										<span className="dashicons dashicons-external" />
									</a>
								) }
							</div>
						);
					} ) }
					{ hiddenCount > 0 && (
						<span className="fair-events-calendar-more">
							{ labels.more( hiddenCount ) }
						</span>
					) }
				</div>
			) }
		</div>
	);
}
