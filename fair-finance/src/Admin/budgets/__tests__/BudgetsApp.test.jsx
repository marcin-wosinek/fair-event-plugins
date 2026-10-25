/**
 * Component tests for the budgets list "View" links (#1290).
 *
 * The entries screen moved to fair-finance; these links used to point at the
 * retired `fair-payments-connector-entries` slug and 404'd. Pins the hrefs to
 * the live `fair-finance-entries` slug for both a specific budget and the
 * unbudgeted ("none") row.
 */
import '@testing-library/jest-dom';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import BudgetsApp from '../BudgetsApp.js';

jest.mock( '@wordpress/api-fetch' );

const BUDGETS = [ { id: 7, name: 'Venue', description: '' } ];

const STATS = {
	7: {
		total_cost: 100,
		total_income: 0,
		balance: -100,
		total_count: 1,
	},
	unbudgeted: {
		total_cost: 0,
		total_income: 50,
		balance: 50,
		cost_count: 0,
		income_count: 1,
		total_count: 1,
	},
};

beforeEach( () => {
	apiFetch.mockImplementation( ( { path } ) => {
		if ( path === '/fair-finance/v1/budgets' ) {
			return Promise.resolve( BUDGETS );
		}
		if ( path === '/fair-finance/v1/budgets/stats' ) {
			return Promise.resolve( STATS );
		}
		return Promise.resolve( {} );
	} );
} );

afterEach( () => {
	jest.clearAllMocks();
} );

describe( 'BudgetsApp — view entries links', () => {
	it( 'links a budget row to its filtered entries on the live fair-finance slug', async () => {
		render( <BudgetsApp /> );

		const links = await screen.findAllByRole( 'link', { name: 'View' } );
		const budgetLink = links.find(
			( l ) =>
				l.getAttribute( 'href' ) ===
				'admin.php?page=fair-finance-entries&budget_id=7'
		);
		expect( budgetLink ).toBeInTheDocument();
	} );

	it( 'links the unbudgeted row to entries filtered to budget_id=none', async () => {
		render( <BudgetsApp /> );

		const links = await screen.findAllByRole( 'link', { name: 'View' } );
		const unbudgetedLink = links.find(
			( l ) =>
				l.getAttribute( 'href' ) ===
				'admin.php?page=fair-finance-entries&budget_id=none'
		);
		expect( unbudgetedLink ).toBeInTheDocument();
	} );
} );

describe( 'BudgetsApp — deleting a budget', () => {
	const deleteCalls = () =>
		apiFetch.mock.calls.filter(
			( [ options ] ) => options.method === 'DELETE'
		);

	const openDelete = async () => {
		render( <BudgetsApp /> );
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Delete' } )
		);
		return screen.getByRole( 'dialog', { name: 'Delete budget — Venue' } );
	};

	it( 'names the budget and its entries, and cancelling sends nothing', async () => {
		const dialog = await openDelete();

		expect(
			within( dialog ).getByText(
				'Its 1 financial entry is kept and moves to Unbudgeted.'
			)
		).toBeInTheDocument();

		fireEvent.click(
			within( dialog ).getByRole( 'button', { name: 'Cancel' } )
		);

		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect( deleteCalls() ).toHaveLength( 0 );
	} );

	it( 'keeps the dialog open on failure and retries', async () => {
		let attempts = 0;
		apiFetch.mockImplementation( ( { path, method } ) => {
			if ( method === 'DELETE' ) {
				attempts++;
				return attempts === 1
					? Promise.reject( { message: 'Failed to delete budget.' } )
					: Promise.resolve( { deleted: true } );
			}
			if ( path === '/fair-finance/v1/budgets' ) {
				return Promise.resolve( BUDGETS );
			}
			return Promise.resolve( STATS );
		} );
		const dialog = await openDelete();
		const confirm = within( dialog ).getByRole( 'button', {
			name: 'Delete budget',
		} );

		await act( async () => fireEvent.click( confirm ) );

		expect(
			within( dialog ).getByText( 'Failed to delete budget.', {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();

		await act( async () => fireEvent.click( confirm ) );

		expect( deleteCalls() ).toHaveLength( 2 );
		expect( deleteCalls()[ 1 ][ 0 ].path ).toBe(
			'/fair-finance/v1/budgets/7'
		);
		expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument();
		expect(
			await screen.findByText( 'Budget “Venue” deleted.', {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();
	} );
} );
