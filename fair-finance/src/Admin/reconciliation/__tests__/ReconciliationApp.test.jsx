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

// Notices are also announced to a shared live region; query the visible one.
const NOTICE = { selector: '.components-notice__content' };

const proposedSplit = {
	status: 'proposed',
	supported: true,
	method: 'settlement_deductions',
	reason: 'Confirming creates one allocation per supported movement. Their amounts sum exactly to this bank entry.',
	rows: [
		{
			kind: 'transaction',
			amount: '10.00',
			description: 'Workshop ticket',
			event_url: 'https://example.test/workshop/',
			budget_id: budgetA.id,
			movement_key: 'payment:tr_1#1',
		},
		{
			kind: 'settlement',
			amount: '-0.45',
			description: 'Settlement fees',
			event_url: null,
			budget_id: null,
			movement_key: 'agg:fee#1',
		},
	],
};

function mockApiFetchByPath( {
	entries = [ entry ],
	transactions = [],
	budgets = [ budgetA, budgetB ],
	connectorStatus = null,
	matchedEntries = [],
	matchPlan = proposedSplit,
	matched = { ...entry, budget_id: null },
} = {} ) {
	apiFetch.mockImplementation( ( { path, method } ) => {
		if ( path === '/fair-payments-connector/v1/oauth/status' ) {
			// No status: the connector is inactive, so the route is missing.
			return connectorStatus
				? Promise.resolve( connectorStatus )
				: Promise.reject( { code: 'rest_no_route' } );
		}
		if ( path === '/fair-finance/v1/budgets' ) {
			return Promise.resolve( budgets );
		}
		if ( path === '/fair-finance/v1/reconciliation' ) {
			return Promise.resolve( {
				unmatched_entries: entries,
				unmatched_transactions: transactions,
				matched_entries: matchedEntries,
			} );
		}
		if ( /\/suggest-matches$/.test( path ) ) {
			return Promise.resolve( [] );
		}
		if ( /\/match-preview$/.test( path ) ) {
			return Promise.resolve( matchPlan );
		}
		if ( /\/match$/.test( path ) && method === 'POST' ) {
			return Promise.resolve( matched );
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
		expect(
			await screen.findByText( proposedSplit.reason, NOTICE )
		).toBeInTheDocument();
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

describe( 'ReconciliationApp — Mollie settlement access (#1693)', () => {
	const NOTICE =
		'Mollie has not authorized this site to read settlements yet';
	// A Notice also announces its text through an a11y live region.
	const NOTICE_CONTENT = {
		exact: false,
		selector: '.components-notice__content',
	};

	async function renderLoaded() {
		render( <ReconciliationApp /> );
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Import settlement CSV' } )
			).toBeInTheDocument()
		);
	}

	it( 'explains the missing permission and links to the connection settings', async () => {
		mockApiFetchByPath( {
			connectorStatus: {
				connected: true,
				scopes_known: false,
				granted_scopes: [],
				settlement_access: false,
			},
		} );
		await renderLoaded();

		expect(
			await screen.findByText( NOTICE, NOTICE_CONTENT )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'link', {
				name: 'Open Mollie connection settings',
			} )
		).toHaveAttribute(
			'href',
			'admin.php?page=fair-payments-connector-settings'
		);
		// Reconciliation itself stays available.
		expect(
			screen.getByRole( 'button', { name: 'Import settlement CSV' } )
		).toBeEnabled();
	} );

	it( 'shows nothing once settlement access is granted', async () => {
		mockApiFetchByPath( {
			connectorStatus: {
				connected: true,
				scopes_known: true,
				granted_scopes: [ 'payments.read', 'settlements.read' ],
				settlement_access: true,
			},
		} );
		await renderLoaded();

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/fair-payments-connector/v1/oauth/status',
			} )
		);
		expect(
			screen.queryByText( NOTICE, NOTICE_CONTENT )
		).not.toBeInTheDocument();
	} );

	it( 'does not ask a site without a Mollie connection to reconnect', async () => {
		mockApiFetchByPath( {
			connectorStatus: {
				connected: false,
				scopes_known: false,
				granted_scopes: [],
				settlement_access: false,
			},
		} );
		await renderLoaded();

		expect(
			screen.queryByText( NOTICE, NOTICE_CONTENT )
		).not.toBeInTheDocument();
	} );

	it( 'treats an unavailable connector separately and keeps the page usable', async () => {
		mockApiFetchByPath();
		await renderLoaded();

		expect(
			screen.queryByText( NOTICE, NOTICE_CONTENT )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'link', {
				name: 'Open Mollie connection settings',
			} )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Import settlement CSV' } )
		).toBeEnabled();
	} );
} );

describe( 'ReconciliationApp — links to the focused entry view (#1914)', () => {
	const matchedEntry = {
		...entry,
		id: 4,
		entry_date: '2026-02-03',
		transactions: [ { ...txFromSiteA, match_amount: 10 } ],
	};

	it( 'links the unmatched entry date and keeps Select as a separate control', async () => {
		mockApiFetchByPath();
		await selectEntryAndOpenPanel();

		const link = screen.getByRole( 'link', {
			name: 'Entry #1, 2026-01-01',
		} );
		expect( link ).toHaveAttribute(
			'href',
			'admin.php?page=fair-finance-entries&entry_id=1'
		);
		expect( link ).toHaveTextContent( '2026-01-01' );

		const selectButton = within( link.closest( 'tr' ) ).getByRole(
			'button',
			{ name: 'Selected' }
		);
		expect( selectButton ).not.toContainElement( link );
		expect( link ).not.toContainElement( selectButton );
	} );

	it( 'links the matched entry date and keeps Unmatch All working', async () => {
		mockApiFetchByPath( { entries: [], matchedEntries: [ matchedEntry ] } );
		render( <ReconciliationApp /> );

		fireEvent.click(
			await screen.findByRole( 'button', {
				name: 'Matched Entries (1)',
			} )
		);

		expect(
			screen.getByRole( 'link', { name: 'Entry #4, 2026-02-03' } )
		).toHaveAttribute(
			'href',
			'admin.php?page=fair-finance-entries&entry_id=4'
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Unmatch All' } )
		);

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/fair-finance/v1/financial-entries/4/match',
				method: 'DELETE',
			} )
		);
	} );
} );

describe( 'ReconciliationApp — saved settlement suggestions (#1854)', () => {
	const suggestion = {
		id: 21,
		reference: 'PAY.2605.01',
		provider_id: null,
		account: { id: 3, label: 'Example account' },
		amount: '30.00',
		currency: 'EUR',
		settled_at: '2026-01-02 00:00:00',
		completeness: 'unverified',
		state: null,
		score: 13,
		reasons: [
			'Payout reference appears in the bank description.',
			'The amount matches exactly.',
		],
		context_mismatch: false,
	};
	const preview = {
		settlement: {
			id: 21,
			reference: 'PAY.2605.01',
			amount: '30.00',
			currency: 'EUR',
			completeness: 'unverified',
		},
		account: { id: 3, label: 'Example account' },
		revisions: {},
		fingerprint: 'abc',
		bank: { id: 1, amount: '30.00' },
		bank_rows: [],
		context: null,
		explanation: { net: '30.00' },
		difference: '0.00',
		movements: [],
		issues: [],
		bank_issues: [],
		can_partial: false,
		can_full: false,
		allocation: { supported: false, rows: [], reason: '' },
		decision: null,
		history: [],
	};

	function mockSuggestions( respond, extra = {} ) {
		mockApiFetchByPath( extra );
		const fallback = apiFetch.getMockImplementation();
		apiFetch.mockImplementation( ( request ) => {
			if ( /\/settlement-suggestions\?page=\d+$/.test( request.path ) ) {
				return respond( request );
			}
			if ( request.path.endsWith( '/preview' ) ) {
				return Promise.resolve( preview );
			}
			if ( request.path.endsWith( '/candidates' ) ) {
				return Promise.resolve( [] );
			}
			return fallback( request );
		} );
	}

	afterEach( () => {
		window.history.replaceState( null, '', '/' );
	} );

	it( 'suggests saved settlements for the selected bank entry and opens the review with it', async () => {
		mockSuggestions( () =>
			Promise.resolve( {
				items: [ suggestion ],
				total: 1,
				page: 1,
				pages: 1,
				ambiguous: false,
			} )
		);
		await selectEntryAndOpenPanel();

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-finance/v1/reconciliation/entries/1/settlement-suggestions?page=1',
		} );
		expect( await screen.findByText( 'PAY.2605.01' ) ).toBeInTheDocument();
		expect(
			screen.getByText(
				'Payout reference appears in the bank description.'
			)
		).toBeInTheDocument();
		expect(
			screen.getByText( /Example account · 30.00 EUR/ )
		).toHaveTextContent( 'Not reconciled' );
		// The manual transaction workflow stays alongside.
		expect( screen.getByText( 'Matching entry:' ) ).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Review settlement' } )
		);
		await screen.findByText( 'Reconcile settlement PAY.2605.01' );
		expect( window.location.search ).toBe( '?settlement=21&entry_id=1' );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-finance/v1/reconciliation/settlements/21/preview',
			method: 'POST',
			data: { entry_id: 1 },
		} );
	} );

	it( 'warns about ambiguity and context conflicts and pages through suggestions', async () => {
		mockSuggestions( ( { path } ) =>
			Promise.resolve( {
				items: path.endsWith( 'page=2' )
					? [ { ...suggestion, id: 22, reference: 'PAY.2605.02' } ]
					: [ { ...suggestion, context_mismatch: true } ],
				total: 2,
				page: path.endsWith( 'page=2' ) ? 2 : 1,
				pages: 2,
				ambiguous: true,
			} )
		);
		await selectEntryAndOpenPanel();

		expect(
			await screen.findByText(
				/Several saved settlements have equally strong evidence/
			)
		).toBeInTheDocument();
		expect(
			screen.getByText( /conflicting confirmed account or currency/, {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Next suggestions' } )
		);
		expect( await screen.findByText( 'PAY.2605.02' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Page 2 of 2' ) ).toBeInTheDocument();
	} );

	it( 'shows empty and error states without blocking transaction matching', async () => {
		mockSuggestions( () =>
			Promise.resolve( { items: [], total: 0, page: 1, pages: 1 } )
		);
		await selectEntryAndOpenPanel();
		expect(
			await screen.findByText(
				'No saved settlement has this payout reference or exact amount.'
			)
		).toBeInTheDocument();

		mockSuggestions( () =>
			Promise.reject( { message: 'Local evidence unavailable.' } )
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Selected' } ) );
		expect(
			await screen.findByText( 'Local evidence unavailable.', {
				selector: '.components-notice__content',
			} )
		).toBeInTheDocument();
		expect( screen.getByText( 'Matching entry:' ) ).toBeInTheDocument();
	} );

	it( 'shows a settlement association once and reviews it instead of offering Unmatch', async () => {
		mockSuggestions( () => Promise.resolve( { items: [] } ), {
			entries: [],
			matchedEntries: [
				{
					...entry,
					id: 5,
					transactions: [],
					settlement: {
						id: 21,
						reference: 'PAY.2605.01',
						amount: '30.00',
						currency: 'EUR',
						state: 'full',
						current_state: 'needs_review',
					},
				},
			],
		} );
		render( <ReconciliationApp /> );
		fireEvent.click(
			await screen.findByRole( 'button', {
				name: 'Matched Entries (1)',
			} )
		);
		expect(
			screen.getByText(
				'Settlement PAY.2605.01 · 30.00 EUR · Needs review'
			)
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Unmatch All' } )
		).not.toBeInTheDocument();
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Review settlement' } )
		);
		await screen.findByText( 'Reconcile settlement PAY.2605.01' );
		expect( window.location.search ).toBe( '?settlement=21' );
	} );
} );

describe( 'ReconciliationApp — shared allocation proposal (#1854)', () => {
	it( 'shows the server proposal, with the reviewed budget, before matching', async () => {
		mockApiFetchByPath( { transactions: [ txFromSiteA ] } );
		await selectEntryAndOpenPanel();

		fireEvent.click( checkboxForRow( 'From site A' ) );

		expect(
			await screen.findByText( proposedSplit.reason, NOTICE )
		).toBeInTheDocument();
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-finance/v1/financial-entries/1/match-preview',
			method: 'POST',
			data: { transaction_ids: [ txFromSiteA.id ] },
		} );
		const fee = screen.getByText( 'Settlement fees' ).closest( 'tr' );
		expect( within( fee ).getByText( '-0.45 EUR' ) ).toBeInTheDocument();
		expect(
			within( fee ).getByText( 'Settlement-level fee or adjustment' )
		).toBeInTheDocument();
		// The reviewed budget applies to every allocation it creates.
		expect( within( fee ).getByText( budgetA.name ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'link', {
				name: 'https://example.test/workshop/',
			} )
		).toBeInTheDocument();
	} );

	it( 'explains an unsupported allocation and reports it after matching', async () => {
		const unsupported = {
			status: 'unsupported',
			supported: false,
			method: null,
			rows: [],
			reason: 'The supported amounts total 40, which does not equal the bank entry amount of 30.00.',
		};
		mockApiFetchByPath( {
			transactions: [ txFromSiteA ],
			matchPlan: unsupported,
			matched: { ...entry, allocation: unsupported },
		} );
		await selectEntryAndOpenPanel();

		fireEvent.click( checkboxForRow( 'From site A' ) );
		expect(
			await screen.findByText( unsupported.reason, NOTICE )
		).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Confirm Match' } )
		);
		expect(
			await screen.findByText(
				`Transactions matched. The allocation still needs review: ${ unsupported.reason }`,
				NOTICE
			)
		).toBeInTheDocument();
	} );

	it( 'reports the split a match created', async () => {
		mockApiFetchByPath( {
			transactions: [ txFromSiteA ],
			matched: {
				...entry,
				allocation: { ...proposedSplit, allocation_ids: [ 4, 5 ] },
			},
		} );
		await selectEntryAndOpenPanel();

		fireEvent.click( checkboxForRow( 'From site A' ) );
		await screen.findByText( proposedSplit.reason, NOTICE );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Confirm Match' } )
		);
		expect(
			await screen.findByText(
				'Transactions matched and the entry was split into 2 allocations.',
				NOTICE
			)
		).toBeInTheDocument();
	} );
} );
