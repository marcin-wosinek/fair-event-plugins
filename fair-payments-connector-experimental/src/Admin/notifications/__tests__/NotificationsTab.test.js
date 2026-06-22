/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import NotificationsTab from '../NotificationsTab.js';

jest.mock('@wordpress/api-fetch');

describe('NotificationsTab', () => {
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
					fair_payment_telegram_bot_token: '',
					fair_payment_notification_routes: [],
					...overrides,
				});
			}
			return Promise.resolve({});
		});
	}

	test('loads existing settings and renders bot token field', async () => {
		mockInitialLoad({
			fair_payment_telegram_bot_token: 'BOT:123',
		});

		render(<NotificationsTab onNotice={() => {}} />);

		await waitFor(() =>
			expect(screen.getByDisplayValue('BOT:123')).toBeInTheDocument()
		);
	});

	test('renders existing routes from settings', async () => {
		mockInitialLoad({
			fair_payment_notification_routes: [
				{
					id: 'route-1',
					enabled: true,
					channel: 'telegram',
					destination: '12345',
					frequency: 'immediate',
					include_pii: true,
				},
			],
		});

		render(<NotificationsTab onNotice={() => {}} />);

		await waitFor(() =>
			expect(screen.getByDisplayValue('12345')).toBeInTheDocument()
		);
	});

	test('Add route button creates a new empty route row', async () => {
		mockInitialLoad();

		render(<NotificationsTab onNotice={() => {}} />);

		await waitFor(() =>
			expect(screen.getByText('Add route')).toBeInTheDocument()
		);

		fireEvent.click(screen.getByText('Add route'));

		await waitFor(() => {
			expect(screen.getByText('Send test')).toBeInTheDocument();
			expect(screen.getByText('Remove')).toBeInTheDocument();
		});
	});

	test('Remove button removes the route', async () => {
		mockInitialLoad({
			fair_payment_notification_routes: [
				{
					id: 'route-1',
					enabled: true,
					channel: 'email',
					destination: 'test@example.com',
					frequency: 'daily',
					include_pii: false,
				},
			],
		});

		render(<NotificationsTab onNotice={() => {}} />);

		await waitFor(() =>
			expect(
				screen.getByDisplayValue('test@example.com')
			).toBeInTheDocument()
		);

		fireEvent.click(screen.getByText('Remove'));

		await waitFor(() =>
			expect(
				screen.queryByDisplayValue('test@example.com')
			).not.toBeInTheDocument()
		);
	});

	test('Save button posts routes and bot token to /wp/v2/settings', async () => {
		mockInitialLoad({
			fair_payment_telegram_bot_token: 'BOT:abc',
			fair_payment_notification_routes: [
				{
					id: 'route-1',
					enabled: true,
					channel: 'telegram',
					destination: '99999',
					frequency: 'immediate',
					include_pii: true,
				},
			],
		});

		render(<NotificationsTab onNotice={() => {}} />);

		await waitFor(() =>
			expect(screen.getByDisplayValue('BOT:abc')).toBeInTheDocument()
		);

		apiFetch.mockImplementation((opts) => {
			if (opts.method === 'POST' && opts.path === '/wp/v2/settings') {
				return Promise.resolve({});
			}
			return Promise.resolve({});
		});

		fireEvent.click(screen.getByText('Save settings'));

		await waitFor(() => {
			const saveCall = apiFetch.mock.calls.find(
				([opts]) =>
					opts.method === 'POST' && opts.path === '/wp/v2/settings'
			);
			expect(saveCall).toBeTruthy();
			expect(saveCall[0].data).toMatchObject({
				fair_payment_telegram_bot_token: 'BOT:abc',
				fair_payment_notification_routes: expect.arrayContaining([
					expect.objectContaining({
						channel: 'telegram',
						destination: '99999',
					}),
				]),
			});
		});
	});

	test('Send test calls the notifications test endpoint', async () => {
		mockInitialLoad({
			fair_payment_notification_routes: [
				{
					id: 'route-1',
					enabled: true,
					channel: 'email',
					destination: 'admin@example.com',
					frequency: 'immediate',
					include_pii: true,
				},
			],
		});

		render(<NotificationsTab onNotice={() => {}} />);

		await waitFor(() =>
			expect(
				screen.getByDisplayValue('admin@example.com')
			).toBeInTheDocument()
		);

		apiFetch.mockImplementation((opts) => {
			if (
				opts.path === '/fair-payments-connector/v1/notifications/test'
			) {
				return Promise.resolve({
					success: true,
					message: 'Test notification sent.',
				});
			}
			return Promise.resolve({});
		});

		fireEvent.click(screen.getByText('Send test'));

		await waitFor(() => {
			const testCall = apiFetch.mock.calls.find(
				([opts]) =>
					opts.path ===
					'/fair-payments-connector/v1/notifications/test'
			);
			expect(testCall).toBeTruthy();
			expect(testCall[0].method).toBe('POST');
			expect(testCall[0].data).toEqual({
				channel: 'email',
				destination: 'admin@example.com',
				include_pii: true,
			});
		});

		await waitFor(() => {
			const matches = screen.getAllByText('Test notification sent.');
			expect(matches.length).toBeGreaterThan(0);
		});
	});
});
