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
export function computeTicketTotal({
	unitPrice,
	count = 1,
	optionPrices = [],
}) {
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

/**
 * Currency symbols, keyed by ISO code. Mirrors
 * `FairEventsShared\Money::SYMBOLS` on the PHP side — keep both maps in
 * sync. Missing keys have no symbol form and fall back to the code form in
 * formatMoneyInline().
 */
export const CURRENCY_SYMBOLS = {
	EUR: { symbol: '€', position: 'prefix' },
	USD: { symbol: '$', position: 'prefix' },
	GBP: { symbol: '£', position: 'prefix' },
	PLN: { symbol: 'zł', position: 'suffix' },
	CZK: { symbol: 'Kč', position: 'suffix' },
	HUF: { symbol: 'Ft', position: 'suffix' },
};

/**
 * Format an amount with its currency code (e.g. '12.50 EUR').
 *
 * @param {number} amount   Amount to format.
 * @param {string} currency Currency code, e.g. 'EUR'.
 * @return {string} Display-formatted amount.
 */
export function formatMoney(amount, currency) {
	return `${formatPrice(amount)} ${currency}`;
}

/**
 * Format an amount with its currency symbol (e.g. '€12.50', '12.50 zł') for
 * tight block labels. Currencies with no mapped symbol fall back to
 * formatMoney().
 *
 * @param {number} amount   Amount to format.
 * @param {string} currency Currency code, e.g. 'EUR'.
 * @return {string} Inline-formatted amount.
 */
export function formatMoneyInline(amount, currency) {
	const entry = CURRENCY_SYMBOLS[currency];

	if (!entry) {
		return formatMoney(amount, currency);
	}

	const formatted = formatPrice(amount);

	return entry.position === 'prefix'
		? `${entry.symbol}${formatted}`
		: `${formatted} ${entry.symbol}`;
}
