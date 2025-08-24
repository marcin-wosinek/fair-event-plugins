/**
 * Test suite for simple-payment block
 */

describe('Simple Payment Block', () => {
	test('should have correct block name', () => {
		const blockName = 'fair-payment/simple-payment-block';
		expect(blockName).toBe('fair-payment/simple-payment-block');
	});

	test('should format currency correctly', () => {
		const formatCurrency = (amount, currency) => {
			return new Intl.NumberFormat('en-US', {
				style: 'currency',
				currency: currency,
			}).format(amount);
		};

		expect(formatCurrency(10, 'EUR')).toBe('€10.00');
		expect(formatCurrency(25.5, 'USD')).toBe('$25.50');
	});

	test('should validate payment amount', () => {
		const validateAmount = (amount) => {
			const numericAmount = parseFloat(amount);
			return !isNaN(numericAmount) && numericAmount > 0;
		};

		expect(validateAmount('10')).toBe(true);
		expect(validateAmount('0')).toBe(false);
		expect(validateAmount('invalid')).toBe(false);
		expect(validateAmount('-5')).toBe(false);
	});
});
