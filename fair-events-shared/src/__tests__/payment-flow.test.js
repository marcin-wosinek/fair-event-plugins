import apiFetch from '@wordpress/api-fetch';
import { renderPaymentError, pollPaymentStatus } from '../payment-flow.js';

jest.mock('@wordpress/api-fetch');

describe('pollPaymentStatus', () => {
	beforeEach(() => {
		jest.useFakeTimers();
		apiFetch.mockReset();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	test('calls onConfirmed once lifecycle_status is confirmed', async () => {
		apiFetch.mockResolvedValueOnce({ lifecycle_status: 'confirmed' });
		const onConfirmed = jest.fn();

		pollPaymentStatus({
			path: '/fair-events/v1/get-tickets/payment-state',
			onConfirmed,
		});
		await flushPromises();

		expect(onConfirmed).toHaveBeenCalledWith({
			lifecycle_status: 'confirmed',
		});
	});

	test('calls onFailed once lifecycle_status is failed', async () => {
		apiFetch.mockResolvedValueOnce({ lifecycle_status: 'failed' });
		const onFailed = jest.fn();

		pollPaymentStatus({ path: '/some/path', onFailed });
		await flushPromises();

		expect(onFailed).toHaveBeenCalledWith({ lifecycle_status: 'failed' });
	});

	test('calls onProcessing and schedules another tick while still in progress', async () => {
		apiFetch.mockResolvedValue({
			lifecycle_status: 'processing',
			state: 'resume',
		});
		const onProcessing = jest.fn();

		pollPaymentStatus({
			path: '/some/path',
			onProcessing,
			intervalMs: 1000,
		});
		await flushPromises();

		expect(onProcessing).toHaveBeenCalledWith({
			lifecycle_status: 'processing',
			state: 'resume',
		});
		expect(apiFetch).toHaveBeenCalledTimes(1);

		jest.advanceTimersByTime(1000);
		await flushPromises();

		expect(apiFetch).toHaveBeenCalledTimes(2);
	});

	test('stops after maxAttempts ticks', async () => {
		apiFetch.mockResolvedValue({ lifecycle_status: 'processing' });

		pollPaymentStatus({
			path: '/some/path',
			maxAttempts: 1,
			intervalMs: 1000,
		});
		await flushPromises();

		expect(apiFetch).toHaveBeenCalledTimes(1);

		jest.advanceTimersByTime(1000);
		await flushPromises();

		// maxAttempts reached on the first tick — no second call is scheduled.
		expect(apiFetch).toHaveBeenCalledTimes(1);
	});

	test('stops silently on a fetch error', async () => {
		apiFetch.mockRejectedValueOnce(new Error('network error'));

		expect(() => pollPaymentStatus({ path: '/some/path' })).not.toThrow();
		await flushPromises();

		jest.advanceTimersByTime(10000);
		expect(apiFetch).toHaveBeenCalledTimes(1);
	});

	function flushPromises() {
		return Promise.resolve().then(() => Promise.resolve());
	}
});

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
