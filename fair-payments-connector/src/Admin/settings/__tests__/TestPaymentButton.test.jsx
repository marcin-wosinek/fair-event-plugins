/**
 * Component tests for the "Create test payment" button (#1207).
 *
 * Exercises:
 *   - Connected: the button is enabled and no "connect first" hint shows.
 *   - Disconnected: the button is disabled and the hint shows.
 *   - Clicking (connected, test mode): a payment is created, the checkout opens
 *     in a new tab, and the fallback link renders.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import ConnectionTab from '../ConnectionTab.js';

jest.mock('@wordpress/api-fetch');

const CONNECTED_SETTINGS = {
	fair_payment_mollie_connected: true,
	fair_payment_mode: 'test',
	fair_payment_organization_id: 'org_123',
	fair_payment_mollie_profile_id: 'pfl_123',
	fair_payment_mollie_token_expires: 0,
};

const OVERVIEW = {
	profile_name: 'My Webshop',
	profile_id: 'pfl_123',
	mode: 'test',
	methods: [],
	manage_url: 'https://my.mollie.com/dashboard/',
};

const CHECKOUT_URL = 'https://www.mollie.com/checkout/test-1';

function mockApiFetch({ connected, testPaymentResult }) {
	apiFetch.mockImplementation(({ path }) => {
		if (path === '/wp/v2/settings') {
			return Promise.resolve(
				connected
					? CONNECTED_SETTINGS
					: { fair_payment_mollie_connected: false }
			);
		}
		if (path === '/fair-payments-connector/v1/connection/overview') {
			return Promise.resolve(OVERVIEW);
		}
		if (path === '/fair-payments-connector/v1/test-payment') {
			return (
				testPaymentResult ||
				Promise.resolve({
					success: true,
					transaction_id: 42,
					checkout_url: CHECKOUT_URL,
					status: 'open',
					currency: 'EUR',
					mode: 'test',
				})
			);
		}
		return Promise.resolve({});
	});
}

afterEach(() => {
	jest.clearAllMocks();
});

describe('ConnectionTab — test payment button', () => {
	it('enables the button and hides the hint when connected', async () => {
		mockApiFetch({ connected: true });
		render(<ConnectionTab onNotice={() => {}} shouldReload={false} />);

		const button = await screen.findByRole('button', {
			name: 'Create test payment',
		});
		expect(button).toBeEnabled();
		expect(
			screen.queryByText('Connect Mollie first to run a test payment.')
		).not.toBeInTheDocument();

		expect(console).toHaveLogged();
		expect(console).toHaveWarned();
	});

	it('disables the button and shows the hint when disconnected', async () => {
		mockApiFetch({ connected: false });
		render(<ConnectionTab onNotice={() => {}} shouldReload={false} />);

		const button = await screen.findByRole('button', {
			name: 'Create test payment',
		});
		expect(button).toBeDisabled();
		expect(
			screen.getByText('Connect Mollie first to run a test payment.')
		).toBeInTheDocument();

		expect(console).toHaveLogged();
	});

	it('creates a payment, opens the checkout, and shows the fallback link', async () => {
		const openSpy = jest
			.spyOn(window, 'open')
			.mockImplementation(() => null);
		const onNotice = jest.fn();
		mockApiFetch({ connected: true });
		render(<ConnectionTab onNotice={onNotice} shouldReload={false} />);

		const button = await screen.findByRole('button', {
			name: 'Create test payment',
		});
		fireEvent.click(button);

		await waitFor(() =>
			expect(openSpy).toHaveBeenCalledWith(
				CHECKOUT_URL,
				'_blank',
				'noopener'
			)
		);

		const link = await screen.findByRole('link', { name: 'open it here.' });
		expect(link).toHaveAttribute('href', CHECKOUT_URL);
		expect(onNotice).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'success' })
		);

		openSpy.mockRestore();
		expect(console).toHaveLogged();
	});
});
