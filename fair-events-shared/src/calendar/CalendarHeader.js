/**
 * Calendar Header Component
 *
 * Month/year title with Previous, Today, Next and an optional Add event button.
 *
 * @package FairEventsShared
 */

import { Button } from '@wordpress/components';
import { formatMonthLabel } from '../dateTime.js';

export default function CalendarHeader( {
	currentDate,
	onPrevMonth,
	onNextMonth,
	onToday,
	onAddEvent,
	labels,
} ) {
	return (
		<div className="fair-events-calendar-header">
			<h2 className="fair-events-calendar-title">
				{ formatMonthLabel( currentDate ) }
			</h2>
			<div className="fair-events-calendar-nav">
				<Button variant="secondary" onClick={ onPrevMonth }>
					{ labels.previous }
				</Button>
				<Button variant="primary" onClick={ onToday }>
					{ labels.today }
				</Button>
				<Button variant="secondary" onClick={ onNextMonth }>
					{ labels.next }
				</Button>
				{ onAddEvent && (
					<Button variant="primary" onClick={ onAddEvent }>
						{ labels.addEvent }
					</Button>
				) }
			</div>
		</div>
	);
}
