import { computeTicketTotal, formatPrice } from '../src/ticket-pricing.js';

describe('computeTicketTotal', () => {
	it('multiplies unit price by count', () => {
		expect(computeTicketTotal({ unitPrice: 10, count: 3 })).toBe(30);
	});

	it('defaults count to 1', () => {
		expect(computeTicketTotal({ unitPrice: 10 })).toBe(10);
	});

	it('sums in selected option prices', () => {
		expect(
			computeTicketTotal({
				unitPrice: 10,
				count: 2,
				optionPrices: [2.5, 1.5],
			})
		).toBe(24);
	});

	it('returns 0 for a free ticket with no options', () => {
		expect(computeTicketTotal({ unitPrice: 0 })).toBe(0);
	});
});

describe('formatPrice', () => {
	it('formats to two decimal places', () => {
		expect(formatPrice(12)).toBe('12.00');
	});

	it('rounds to two decimal places', () => {
		expect(formatPrice(9.999)).toBe('10.00');
	});
});
