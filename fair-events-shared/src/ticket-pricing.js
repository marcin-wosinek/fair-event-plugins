/**
 * Ticket pricing display math shared between the get-tickets and
 * event-signup blocks' frontend scripts.
 *
 * @package FairEventsShared
 */

/**
 * Compute a ticket purchase total: unit price times count, plus any
 * selected add-on option prices.
 *
 * @param {Object}   params               Options.
 * @param {number}   params.unitPrice     Per-unit/base ticket price.
 * @param {number}   [params.count]       Quantity or instance count (default 1).
 * @param {number[]} [params.optionPrices] Selected add-on option prices to sum in.
 * @return {number} The computed total.
 */
export function computeTicketTotal({ unitPrice, count = 1, optionPrices = [] }) {
	const optionsTotal = optionPrices.reduce((sum, price) => sum + price, 0);
	return unitPrice * count + optionsTotal;
}

/**
 * Format a price amount as a fixed 2-decimal string (e.g. '12.00').
 *
 * @param {number} amount Amount to format.
 * @return {string} Formatted amount.
 */
export function formatPrice(amount) {
	return amount.toFixed(2);
}
