/**
 * @jest-environment jsdom
 */

/**
 * Tests for the shared payment-integration lifecycle.
 */

import apiFetch from '@wordpress/api-fetch';
import {
	initiatePayment,
	handlePaymentCallback,
	wireRestartButton,
} from '../src/payment-flow.js';

jest.mock('@wordpress/api-fetch');

function setLocationSearch(search) {
	window.history.pushState({}, '', `/${search}`);
}

beforeEach(() => {
	apiFetch.mockReset();
	setLocationSearch('');
	jest.useFakeTimers();
});

afterEach(() => {
	jest.useRealTimers();
});

describe('initiatePayment', () => {
	it('leaves the button in its loading state when redirecting', async () => {
		// jsdom does not implement navigation, so `window.location.href = …`
		// is a documented no-op there; assert the code took the redirect
		// branch by checking it skips restoring the button, rather than by
		// reading back window.location.
		apiFetch.mockResolvedValue({ checkout_url: 'https://mollie.test/pay' });
		const button = document.createElement('button');
		button.textContent = 'Pay';

		const response = await initiatePayment({
			apiPath: '/fair-payments-connector/v1/payments',
			data: { amount: '10' },
			button,
			loadingText: 'Paying…',
		});

		expect(response.checkout_url).toBe('https://mollie.test/pay');
		expect(button.disabled).toBe(true);
		expect(button.textContent).toBe('Paying…');
	});

	it('restores the button and resolves when there is no checkout_url', async () => {
		apiFetch.mockResolvedValue({ status: 'confirmed' });
		const button = document.createElement('button');
		button.textContent = 'Submit';

		const response = await initiatePayment({
			apiPath: '/fair-events/v1/get-tickets',
			data: {},
			button,
			loadingText: 'Processing…',
		});

		expect(response).toEqual({ status: 'confirmed' });
		expect(button.disabled).toBe(false);
		expect(button.textContent).toBe('Submit');
	});

	it('restores the button and calls onError on failure', async () => {
		apiFetch.mockRejectedValue({ message: 'Nope' });
		const button = document.createElement('button');
		button.textContent = 'Pay';
		const onError = jest.fn();

		await expect(
			initiatePayment({
				apiPath: '/fair-payments-connector/v1/payments',
				data: {},
				button,
				loadingText: 'Paying…',
				defaultErrorMessage: 'Failed',
				onError,
			})
		).rejects.toEqual({ message: 'Nope' });

		expect(onError).toHaveBeenCalledWith('Nope', { message: 'Nope' });
		expect(button.disabled).toBe(false);
		expect(button.textContent).toBe('Pay');
	});
});

describe('handlePaymentCallback', () => {
	it('does nothing when fair_payment_callback is not present', () => {
		setLocationSearch('?transaction_id=5');

		handlePaymentCallback({
			statusPath: '/fair-payments-connector/v1/payments',
			onConfirmed: jest.fn(),
		});

		expect(apiFetch).not.toHaveBeenCalled();
	});

	it('does nothing when there is no transaction id', () => {
		setLocationSearch('?fair_payment_callback=true');

		handlePaymentCallback({
			statusPath: '/fair-payments-connector/v1/payments',
			onConfirmed: jest.fn(),
		});

		expect(apiFetch).not.toHaveBeenCalled();
	});

	it('polls and calls onConfirmed once lifecycle_status is confirmed', async () => {
		setLocationSearch(
			'?fair_payment_callback=true&transaction_id=5&token=abc'
		);
		apiFetch.mockResolvedValue({ lifecycle_status: 'confirmed' });
		const onConfirmed = jest.fn();

		handlePaymentCallback({
			statusPath: '/fair-payments-connector/v1/payments',
			onConfirmed,
			onFailed: jest.fn(),
		});

		await jest.advanceTimersByTimeAsync(0);

		expect(apiFetch).toHaveBeenCalledWith({
			path: '/fair-payments-connector/v1/payments/5/status?token=abc',
		});
		expect(onConfirmed).toHaveBeenCalledWith({
			lifecycle_status: 'confirmed',
		});
	});

	it('polls and calls onFailed once lifecycle_status is failed', async () => {
		setLocationSearch('?fair_payment_callback=true&transaction_id=5');
		apiFetch.mockResolvedValue({ lifecycle_status: 'failed' });
		const onFailed = jest.fn();

		handlePaymentCallback({
			statusPath: '/fair-payments-connector/v1/payments',
			onFailed,
		});

		await jest.advanceTimersByTimeAsync(0);

		expect(apiFetch).toHaveBeenCalledWith({
			path: '/fair-payments-connector/v1/payments/5/status',
		});
		expect(onFailed).toHaveBeenCalled();
	});

	it('reschedules while processing and calls onProcessing', async () => {
		setLocationSearch('?fair_payment_callback=true&transaction_id=5');
		apiFetch.mockResolvedValue({ lifecycle_status: 'processing' });
		const onProcessing = jest.fn();

		handlePaymentCallback({
			statusPath: '/fair-payments-connector/v1/payments',
			onProcessing,
		});

		await jest.advanceTimersByTimeAsync(0);
		expect(onProcessing).toHaveBeenCalledTimes(1);
		expect(apiFetch).toHaveBeenCalledTimes(1);

		await jest.advanceTimersByTimeAsync(3000);
		expect(apiFetch).toHaveBeenCalledTimes(2);
	});

	it('stops polling after MAX_ATTEMPTS', async () => {
		setLocationSearch('?fair_payment_callback=true&transaction_id=5');
		apiFetch.mockResolvedValue({ lifecycle_status: 'processing' });

		handlePaymentCallback({
			statusPath: '/fair-payments-connector/v1/payments',
		});

		await jest.advanceTimersByTimeAsync(0);
		await jest.advanceTimersByTimeAsync(3000 * 12);

		expect(apiFetch).toHaveBeenCalledTimes(10);
	});
});

describe('wireRestartButton', () => {
	it('is a no-op when button is null', () => {
		expect(() =>
			wireRestartButton({ button: null, form: null })
		).not.toThrow();
	});

	it('clears callback params, resets the form, and calls onReset', () => {
		setLocationSearch(
			'?fair_payment_callback=true&transaction_id=5&token=abc&post_id=2'
		);
		const replaceState = jest.spyOn(window.history, 'replaceState');

		const button = document.createElement('button');
		const form = document.createElement('form');
		form.style.display = 'none';
		const reset = jest.spyOn(form, 'reset');
		const onReset = jest.fn();

		wireRestartButton({ button, form, onReset });
		button.dispatchEvent(new window.Event('click'));

		expect(reset).toHaveBeenCalled();
		expect(form.style.display).toBe('');
		expect(onReset).toHaveBeenCalled();

		const [, , url] = replaceState.mock.calls[0];
		expect(url).not.toContain('fair_payment_callback');
		expect(url).not.toContain('transaction_id');
		expect(url).not.toContain('token');
		expect(url).toContain('post_id=2');

		replaceState.mockRestore();
	});
});
