/**
 * @jest-environment jsdom
 *
 * Component tests for the reconciliation Budget proposal (#1612): the
 * administrator can review a budget proposed from the selected
 * transactions' Connected Site attribution before confirming a match.
 */
import '@testing-library/jest-dom';
import {
	render,
	screen,
	fireEvent,
	waitFor,
	within,
} from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import ReconciliationApp from '../ReconciliationApp.js';

jest.mock( '@wordpress/api-fetch' );

const budgetA = { id: 3, name: 'Acroyoga club' };
const budgetB = { id: 7, name: 'General fund' };

const entry = {
	id: 1,
	amount: 30,
	entry_type: 'income',
	entry_date: '2026-01-01',
	description: 'Settlement payout',
	budget_id: null,
};

const budgetedEntry = {
	...entry,
	id: 2,
	budget_id: budgetA.id,
};

const txFromSiteA = {
	id: 10,
	amount: 10,
	currency: 'EUR',
	application_fee: 0,
	mollie_fee: 0,
	description: 'From site A',
	created_at: '2026-01-01 10:00:00',
	connected_site_id: 1,
	source_budget_id: budgetA.id,
};

const txFromSiteAToo = {
	id: 11,
	amount: 12,
	currency: 'EUR',
	application_fee: 0,
	mollie_fee: 0,
	description: 'Also from site A',
	created_at: '2026-01-01 11:00:00',
	connected_site_id: 1,
	source_budget_id: budgetA.id,
};

const txFromSiteB = {
	id: 12,
	amount: 8,
	currency: 'EUR',
	application_fee: 0,
	mollie_fee: 0,
	description: 'From site B',
	created_at: '2026-01-01 12:00:00',
	connected_site_id: 2,
	source_budget_id: budgetB.id,
};

const txNoSource = {
	id: 13,
	amount: 5,
	currency: 'EUR',
	application_fee: 0,
	mollie_fee: 0,
	description: 'Local, unattributed',
	created_at: '2026-01-01 13:00:00',
	connected_site_id: null,
	source_budget_id: null,
};

function mockApiFetchByPath( {
	entries = [ entry ],
	transactions = [],
	budgets = [ budgetA, budgetB ],
} = {} ) {
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( path === '/fair-finance/v1/budgets' ) {
			return Promise.resolve( budgets );
		}
		if ( path === '/fair-finance/v1/reconciliation' ) {
			return Promise.resolve( {
				unmatched_entries: entries,
				unmatched_transactions: transactions,
				matched_entries: [],
			} );
		}
		if ( /\/suggest-matches$/.test( path ) ) {
			return Promise.resolve( [] );
		}
		if ( /\/match$/.test( path ) && method === 'POST' ) {
			return Promise.resolve( { ...entry, budget_id: null } );
		}
		return Promise.resolve( {} );
	} );
}

afterEach( () => {
	jest.clearAllMocks();
} );

async function selectEntryAndOpenPanel() {
	render( <ReconciliationApp /> );
	await waitFor( () =>
		expect(
			screen.getByLabelText( 'Filter by description' )
		).toBeInTheDocument()
	);
	// The default filter only matches Mollie settlement transfers; clear it
	// so the fixture entry (an arbitrary description) shows up.
	fireEvent.change( screen.getByLabelText( 'Filter by description' ), {
		target: { value: '' },
	} );
	fireEvent.click( screen.getByRole( 'button', { name: 'Select' } ) );
	await waitFor( () =>
		expect( screen.getByText( 'Matching entry:' ) ).toBeInTheDocument()
	);
}

function checkboxForRow( description ) {
	const row = screen.getByText( description ).closest( 'tr' );
	return within( row ).getByRole( 'checkbox' );
}

describe( 'ReconciliationApp — Connected Site budget proposal (#1612)', () => {
	it( 'proposes the shared source budget when every selected transaction resolves to it', async () => {
		mockApiFetchByPath( {
			transactions: [ txFromSiteA, txFromSiteAToo ],
		} );
		await selectEntryAndOpenPanel();

		fireEvent.click( checkboxForRow( 'From site A' ) );
		fireEvent.click( checkboxForRow( 'Also from site A' ) );

		await waitFor( () =>
			expect( screen.getByLabelText( 'Budget' ).value ).toBe(
				String( budgetA.id )
			)
		);
	} );

	it( 'proposes no budget when selected transactions resolve to different budgets', async () => {
		mockApiFetchByPath( {
			transactions: [ txFromSiteA, txFromSiteB ],
		} );
		await selectEntryAndOpenPanel();

		fireEvent.click( checkboxForRow( 'From site A' ) );
		fireEvent.click( checkboxForRow( 'From site B' ) );

		await waitFor( () =>
			expect( screen.getByLabelText( 'Budget' ).value ).toBe( '' )
		);
	} );

	it( 'proposes no budget when a selected transaction has no source attribution', async () => {
		mockApiFetchByPath( {
			transactions: [ txFromSiteA, txNoSource ],
		} );
		await selectEntryAndOpenPanel();

		fireEvent.click( checkboxForRow( 'From site A' ) );
		fireEvent.click( checkboxForRow( 'Local, unattributed' ) );

		await waitFor( () =>
			expect( screen.getByLabelText( 'Budget' ).value ).toBe( '' )
		);
	} );

	it( 'keeps an administrator override when the selection changes further', async () => {
		mockApiFetchByPath( {
			transactions: [ txFromSiteA, txFromSiteAToo, txNoSource ],
		} );
		await selectEntryAndOpenPanel();

		fireEvent.click( checkboxForRow( 'From site A' ) );
		await waitFor( () =>
			expect( screen.getByLabelText( 'Budget' ).value ).toBe(
				String( budgetA.id )
			)
		);

		// Administrator explicitly clears the proposal.
		fireEvent.change( screen.getByLabelText( 'Budget' ), {
			target: { value: '' },
		} );
		expect( screen.getByLabelText( 'Budget' ).value ).toBe( '' );

		// Adding another transaction would otherwise re-propose budgetA.
		fireEvent.click( checkboxForRow( 'Also from site A' ) );
		expect( screen.getByLabelText( 'Budget' ).value ).toBe( '' );
	} );

	it( 'disables the selector and explains when the entry already has a budget', async () => {
		mockApiFetchByPath( {
			entries: [ budgetedEntry ],
			transactions: [ txFromSiteB ],
		} );
		await selectEntryAndOpenPanel();

		fireEvent.click( checkboxForRow( 'From site B' ) );

		await waitFor( () => {
			const select = screen.getByLabelText( 'Budget' );
			expect( select ).toBeDisabled();
			expect( select.value ).toBe( String( budgetA.id ) );
		} );
		expect(
			screen.getByText(
				'This entry already has a budget; matching keeps it.'
			)
		).toBeInTheDocument();
	} );

	it( 'submits the reviewed budget_id with the match request', async () => {
		mockApiFetchByPath( {
			transactions: [ txFromSiteA ],
		} );
		await selectEntryAndOpenPanel();

		fireEvent.click( checkboxForRow( 'From site A' ) );
		await waitFor( () =>
			expect( screen.getByLabelText( 'Budget' ).value ).toBe(
				String( budgetA.id )
			)
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Confirm Match' } )
		);

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: '/fair-finance/v1/financial-entries/1/match',
					method: 'POST',
					data: {
						transaction_ids: [ txFromSiteA.id ],
						budget_id: budgetA.id,
					},
				} )
			)
		);
	} );

	it( 'submits a null budget_id when no budget is proposed or chosen', async () => {
		mockApiFetchByPath( {
			transactions: [ txNoSource ],
		} );
		await selectEntryAndOpenPanel();

		fireEvent.click( checkboxForRow( 'Local, unattributed' ) );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Confirm Match' } )
		);

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: '/fair-finance/v1/financial-entries/1/match',
					method: 'POST',
					data: {
						transaction_ids: [ txNoSource.id ],
						budget_id: null,
					},
				} )
			)
		);
	} );
} );
