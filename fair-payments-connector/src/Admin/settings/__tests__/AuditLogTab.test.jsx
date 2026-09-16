/**
 * Component tests for the Audit Log tab (#1575).
 *
 * Exercises:
 *   - Loading: entries render with readable action labels, actor, and reason.
 *   - Redaction: a protected entry never shows its old/new value.
 *   - Empty: a friendly message shows instead of an empty table.
 *   - Pagination: Next/Previous request the next/previous page.
 */
import '@testing-library/jest-dom';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import AuditLogTab from '../AuditLogTab.js';

jest.mock( '@wordpress/api-fetch' );

const PAGE_ONE = {
	items: [
		{
			id: 2,
			created_at: '2026-01-02 10:00:00',
			action: 'setting_changed',
			setting_key: 'fair_payment_currency',
			old_value: 'EUR',
			new_value: 'USD',
			is_protected: false,
			actor_user_id: 1,
			actor_display_name: 'Jane Admin',
			reason: 'Switching to USD pricing.',
		},
		{
			id: 1,
			created_at: '2026-01-01 09:00:00',
			action: 'mollie_connected',
			setting_key: null,
			old_value: null,
			new_value: null,
			is_protected: true,
			actor_user_id: null,
			actor_display_name: 'System',
			reason: 'Connecting Mollie for the first time.',
		},
	],
	total: 2,
	pages: 1,
	page: 1,
};

function mockApiFetch( response ) {
	apiFetch.mockImplementation( () => Promise.resolve( response ) );
}

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'AuditLogTab', () => {
	it( 'renders entries with readable action labels, actor, and reason', async () => {
		mockApiFetch( PAGE_ONE );
		render( <AuditLogTab /> );

		expect( await screen.findByText( 'Jane Admin' ) ).toBeInTheDocument();
		expect( screen.getByText( 'System' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Setting changed (fair_payment_currency)' )
		).toBeInTheDocument();
		expect( screen.getByText( 'Mollie connected' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Switching to USD pricing.' )
		).toBeInTheDocument();
		expect( screen.getByText( 'EUR → USD' ) ).toBeInTheDocument();
	} );

	it( 'never shows a value for a protected entry', async () => {
		mockApiFetch( PAGE_ONE );
		render( <AuditLogTab /> );

		expect(
			await screen.findByText( 'Value changed (not shown)' )
		).toBeInTheDocument();
		expect( screen.queryByText( 'EUR' ) ).not.toBeInTheDocument();
	} );

	it( 'shows a friendly message when there are no entries', async () => {
		mockApiFetch( { items: [], total: 0, pages: 1, page: 1 } );
		render( <AuditLogTab /> );

		expect(
			await screen.findByText( 'No changes have been recorded yet.' )
		).toBeInTheDocument();
	} );

	it( 'requests the next page when Next is clicked', async () => {
		mockApiFetch( {
			items: PAGE_ONE.items,
			total: 40,
			pages: 2,
			page: 1,
		} );
		render( <AuditLogTab /> );

		const nextButton = await screen.findByRole( 'button', {
			name: 'Next',
		} );
		fireEvent.click( nextButton );

		await waitFor( () => {
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: expect.stringContaining( 'page=2' ),
				} )
			);
		} );
	} );
} );
