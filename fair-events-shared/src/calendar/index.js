/**
 * Shared admin month calendar. See README.md for the component contract and
 * the intentional differences between its consumers.
 *
 * Import this module directly (`fair-events-shared/src/calendar/index.js`)
 * rather than the package root, which also exports editor components.
 * Consumers import `./style.css` from their own entry point.
 *
 * @package FairEventsShared
 */

export { default as CalendarHeader } from './CalendarHeader.js';
export { default as CalendarGrid } from './CalendarGrid.js';
export { default as DayCell, MAX_VISIBLE_EVENTS } from './DayCell.js';
export * from './eventLinks.js';
export * from './month.js';
