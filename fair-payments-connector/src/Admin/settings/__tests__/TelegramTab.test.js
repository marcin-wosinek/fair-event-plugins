/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import TelegramTab from '../TelegramTab.js';

jest.mock('@wordpress/api-fetch');

describe('TelegramTab', () => {
	beforeEach(() => {
		jest.resetAllMocks();
	});

	function mockInitialLoad(overrides = {}) {
		apiFetch.mockImplementation((opts) => {
			if (
				opts.path === '/wp/v2/settings' &&
				(!opts.method || opts.method === 'GET')
			) {
				return Promise.resolve({
					fair_payment_telegram_enabled: false,
					fair_payment_telegram_bot_token: '',
					fair_payment_telegram_chat_ids: '',
					fair_payment_telegram_template: '',
					fair_payment_telegram_include_pii: true,
					...overrides,
				});
			}
			return Promise.resolve({});
		});
	}

	test('loads existing settings and renders fields', async () => {
		mockInitialLoad({
			fair_payment_telegram_enabled: true,
			fair_payment_telegram_bot_token: 'BOT:123',
			fair_payment_telegram_chat_ids: '12345',
			fair_payment_telegram_template: 'hello {amount}',
		});

		render(<TelegramTab onNotice={() => {}} />);

		await waitFor(() =>
			expect(screen.getByDisplayValue('BOT:123')).toBeInTheDocument()
		);
		expect(screen.getByDisplayValue('12345')).toBeInTheDocument();
		expect(screen.getByDisplayValue('hello {amount}')).toBeInTheDocument();
	});

	test('Send test message calls the test endpoint with current field values', async () => {
		mockInitialLoad({
			fair_payment_telegram_bot_token: 'BOT:xyz',
			fair_payment_telegram_chat_ids: '99,100',
			fair_payment_telegram_template: 't',
		});

		render(<TelegramTab onNotice={() => {}} />);

		await waitFor(() =>
			expect(screen.getByDisplayValue('BOT:xyz')).toBeInTheDocument()
		);

		// Switch the mock to return success for the test call.
		apiFetch.mockImplementation((opts) => {
			if (opts.path === '/fair-payments-connector/v1/telegram/test') {
				return Promise.resolve({
					success: true,
					message: 'Telegram test message sent.',
				});
			}
			return Promise.resolve({});
		});

		fireEvent.click(screen.getByText('Send test message'));

		await waitFor(() => {
			const testCall = apiFetch.mock.calls.find(
				([opts]) => opts.path === '/fair-payments-connector/v1/telegram/test'
			);
			expect(testCall).toBeTruthy();
			expect(testCall[0].method).toBe('POST');
			expect(testCall[0].data).toEqual({
				bot_token: 'BOT:xyz',
				chat_ids: '99,100',
				template: 't',
				include_pii: true,
			});
		});

		await waitFor(() => {
			const matches = screen.getAllByText('Telegram test message sent.');
			expect(matches.length).toBeGreaterThan(0);
		});
	});

	test('shows error notice when test endpoint fails', async () => {
		mockInitialLoad({
			fair_payment_telegram_bot_token: 'BOT:fail',
			fair_payment_telegram_chat_ids: 'bad',
		});

		render(<TelegramTab onNotice={() => {}} />);

		await waitFor(() =>
			expect(screen.getByDisplayValue('BOT:fail')).toBeInTheDocument()
		);

		apiFetch.mockImplementation((opts) => {
			if (opts.path === '/fair-payments-connector/v1/telegram/test') {
				return Promise.reject({ message: 'chat not found' });
			}
			return Promise.resolve({});
		});

		fireEvent.click(screen.getByText('Send test message'));

		await waitFor(() => {
			const matches = screen.getAllByText('chat not found');
			expect(matches.length).toBeGreaterThan(0);
		});
	});
});
