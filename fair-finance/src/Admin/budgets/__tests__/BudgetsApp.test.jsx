/**
 * Component tests for the budgets list "View" links (#1290).
 *
 * The entries screen moved to fair-finance; these links used to point at the
 * retired `fair-payments-connector-entries` slug and 404'd. Pins the hrefs to
 * the live `fair-finance-entries` slug for both a specific budget and the
 * unbudgeted ("none") row.
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
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
