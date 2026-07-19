/**
 * Component tests for the connection overview section (#1208).
 *
 * Exercises:
 *   - Connected: profile name, enabled methods, and the "manage in Mollie" link render.
 *   - Disconnected: none of the overview section renders.
 *   - Error: the overview section shows a warning while the rest of the
 *     connected controls (mode switch, disconnect) still render.
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
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
	methods: [
		{ id: 'ideal', description: 'iDEAL', image: '' },
		{ id: 'creditcard', description: 'Credit card', image: '' },
	],
	manage_url: 'https://my.mollie.com/dashboard/',
};

function mockApiFetchFor({ connected, overview, overviewError }) {
	apiFetch.mockImplementation(({ path }) => {
		if (path === '/wp/v2/settings') {
			return Promise.resolve(
				connected
					? CONNECTED_SETTINGS
					: { fair_payment_mollie_connected: false }
			);
		}
		if (path === '/fair-payments-connector/v1/connection/overview') {
			if (overviewError) {
				return Promise.reject(
					new Error('Failed to load payment methods.')
				);
			}
			return Promise.resolve(overview);
		}
		return Promise.resolve({});
	});
}

afterEach(() => {
	jest.clearAllMocks();
});

describe('ConnectionTab — connection overview', () => {
	it('shows profile name, enabled methods, and the manage link when connected', async () => {
		mockApiFetchFor({ connected: true, overview: OVERVIEW });
		render(<ConnectionTab onNotice={() => {}} shouldReload={false} />);

		expect(await screen.findByText('My Webshop')).toBeInTheDocument();
		expect(screen.getByText('iDEAL')).toBeInTheDocument();
		expect(screen.getByText('Credit card')).toBeInTheDocument();

		const link = screen.getByRole('link', {
			name: 'Manage payment methods in Mollie',
		});
		expect(link).toHaveAttribute(
			'href',
			'https://my.mollie.com/dashboard/'
		);
		expect(link).toHaveAttribute('target', '_blank');

		// Pre-existing settings-load logging and the @wordpress/components
		// ButtonGroup deprecation warning are expected, not under test here.
		expect(console).toHaveLogged();
		expect(console).toHaveWarned();
	});

	it('renders nothing from the overview section when disconnected', async () => {
		mockApiFetchFor({ connected: false });
		render(<ConnectionTab onNotice={() => {}} shouldReload={false} />);

		expect(
			await screen.findByText('Connect your Mollie account', {
				exact: false,
			})
		).toBeInTheDocument();
		expect(screen.queryByText('My Webshop')).not.toBeInTheDocument();
		expect(
			screen.queryByRole('link', {
				name: 'Manage payment methods in Mollie',
			})
		).not.toBeInTheDocument();

		expect(console).toHaveLogged();
	});

	it('shows a warning but keeps the connected controls when the overview fetch fails', async () => {
		mockApiFetchFor({ connected: true, overviewError: true });
		render(<ConnectionTab onNotice={() => {}} shouldReload={false} />);

		const notice = await screen.findByText(
			'Failed to load payment methods.',
			{ selector: '.components-notice__content' }
		);
		expect(notice).toBeInTheDocument();

		// Rest of the connected view still renders.
		expect(screen.getByText('Mode')).toBeInTheDocument();
		expect(
			screen.getByRole('button', { name: 'Disconnect' })
		).toBeInTheDocument();

		expect(console).toHaveLogged();
	});
});
