/**
 * Calendar Legend Component
 *
 * Explains the four event-pill icon/color variants shown on the grid.
 *
 * @package FairEvents
 */

import { getLinkTypeVariants } from './linkTypes.js';

export default function CalendarLegend() {
	return (
		<div className="fair-events-calendar-legend">
			{getLinkTypeVariants().map(({ type, icon, label }) => (
				<span
					key={type}
					className={`fair-events-calendar-event-row link-type-${type}`}
				>
					<span className="fair-events-calendar-event">
						<span
							className={`dashicons ${icon} fair-events-calendar-event-icon`}
						/>
						{label}
					</span>
				</span>
			))}
		</div>
	);
}
