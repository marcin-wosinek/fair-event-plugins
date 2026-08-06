/**
 * Public entry point for consuming fair-events components from other
 * plugin workspaces (e.g. fair-events-experimental's duplicate-event wizard).
 *
 * @package FairEvents
 */

export { default as EventTickets } from './Admin/manage-event/EventTickets.js';
export {
	default as SalePeriodsCalendar,
	salePeriodColor,
} from './Admin/manage-event/SalePeriodsCalendar.js';
export { default as SeriesModal } from './Admin/manage-event/SeriesModal.js';
