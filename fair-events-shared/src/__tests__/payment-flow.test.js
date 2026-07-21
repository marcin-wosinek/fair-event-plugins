import { renderPaymentError } from '../payment-flow.js';

describe('renderPaymentError', () => {
	let container;

	beforeEach(() => {
		jest.useFakeTimers();
		container = document.createElement('div');
		container.className = 'fair-payments-connector-error';
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	test('no-ops when container is null', () => {
		expect(() =>
			renderPaymentError(
				null,
				{},
				'Default message',
				'fair-payments-connector'
			)
		).not.toThrow();
	});

	test('shows the generic message and no admin block for a plain error', () => {
		const error = { message: 'The payment could not be started.' };

		renderPaymentError(
			container,
			error,
			'Default message',
			'fair-payments-connector'
		);

		expect(container.style.display).toBe('block');
		expect(container.textContent).toContain(
			'The payment could not be started.'
		);
		expect(
			container.querySelector(
				'.fair-payments-connector-message-admin-cause'
			)
		).toBeNull();
		expect(
			container.querySelector(
				'.fair-payments-connector-message-admin-links'
			)
		).toBeNull();
	});

	test('preserves the container original class so callers can re-query it', () => {
		renderPaymentError(
			container,
			{ message: 'Failed' },
			'Default message',
			'fair-payments-connector'
		);

		expect(
			container.classList.contains('fair-payments-connector-error')
		).toBe(true);
	});

	test('renders the interpreted cause and links when error.data.admin is present', () => {
		const error = {
			message: 'The payment could not be started.',
			data: {
				admin: {
					cause: 'The connected Mollie profile has no suitable payment method enabled.',
					links: [
						{
							label: 'Payment settings',
							url: 'https://example.test/wp-admin/admin.php?page=fair-payments-connector-settings',
						},
						{
							label: 'Payment log',
							url: 'https://example.test/wp-admin/admin.php?page=fair-payments-connector-transaction&transaction_id=42',
						},
						{
							label: 'Mollie dashboard',
							url: 'https://my.mollie.com/dashboard',
						},
					],
				},
			},
		};

		renderPaymentError(
			container,
			error,
			'Default message',
			'fair-payments-connector'
		);

		const causeEl = container.querySelector(
			'.fair-payments-connector-message-admin-cause'
		);
		expect(causeEl).not.toBeNull();
		expect(causeEl.textContent).toBe(
			'The connected Mollie profile has no suitable payment method enabled.'
		);

		const links = container.querySelectorAll(
			'.fair-payments-connector-message-admin-links a'
		);
		expect(links).toHaveLength(3);
		expect(links[0].textContent).toBe('Payment settings');
		expect(links[0].getAttribute('href')).toBe(
			'https://example.test/wp-admin/admin.php?page=fair-payments-connector-settings'
		);
		expect(links[2].textContent).toBe('Mollie dashboard');
	});

	test('does not auto-hide when admin detail is present', () => {
		const error = {
			message: 'The payment could not be started.',
			data: { admin: { cause: 'Cause', links: [] } },
		};

		renderPaymentError(
			container,
			error,
			'Default message',
			'fair-payments-connector'
		);
		jest.advanceTimersByTime(10000);

		expect(container.style.display).toBe('block');
	});

	test('auto-hides after 8s when there is no admin detail', () => {
		renderPaymentError(
			container,
			{ message: 'Failed' },
			'Default message',
			'fair-payments-connector'
		);
		jest.advanceTimersByTime(8000);

		expect(container.style.display).toBe('none');
	});

	test('clears previously rendered content on re-render', () => {
		renderPaymentError(
			container,
			{
				message: 'First failure',
				data: { admin: { cause: 'First cause', links: [] } },
			},
			'Default message',
			'fair-payments-connector'
		);
		renderPaymentError(
			container,
			{ message: 'Second failure' },
			'Default message',
			'fair-payments-connector'
		);

		expect(container.textContent).toContain('Second failure');
		expect(container.textContent).not.toContain('First cause');
		expect(
			container.querySelector(
				'.fair-payments-connector-message-admin-cause'
			)
		).toBeNull();
	});
});
