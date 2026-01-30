/**
 * Calendar Header Component
 *
 * Navigation header with month/year display and navigation buttons.
 *
 * @package FairEvents
 */

import { Button } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

export default function CalendarHeader({
	currentDate,
	onPrevMonth,
	onNextMonth,
	onToday,
}) {
	const monthYear = currentDate.toLocaleDateString(undefined, {
		month: 'long',
		year: 'numeric',
	});

	return (
		<div className="fair-events-calendar-header">
			<div className="fair-events-calendar-nav">
				<Button variant="secondary" onClick={onPrevMonth}>
					{__('Previous', 'fair-events')}
				</Button>
				<Button variant="secondary" onClick={onToday}>
					{__('Today', 'fair-events')}
				</Button>
				<Button variant="secondary" onClick={onNextMonth}>
					{__('Next', 'fair-events')}
				</Button>
			</div>
			<h2 className="fair-events-calendar-title">{monthYear}</h2>
		</div>
	);
}
