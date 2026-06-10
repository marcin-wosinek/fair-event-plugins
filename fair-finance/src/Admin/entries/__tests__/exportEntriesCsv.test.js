/**
 * Internal dependencies
 */
import { escapeCsvField, buildEntriesCsv } from '../exportEntriesCsv.js';

describe( 'escapeCsvField', () => {
	it( 'returns a plain string unchanged', () => {
		expect( escapeCsvField( 'hello' ) ).toBe( 'hello' );
	} );

	it( 'quotes a field containing a comma', () => {
		expect( escapeCsvField( 'a,b' ) ).toBe( '"a,b"' );
	} );

	it( 'quotes a field containing a double-quote and doubles it', () => {
		expect( escapeCsvField( 'say "hi"' ) ).toBe( '"say ""hi"""' );
	} );

	it( 'quotes a field containing a newline', () => {
		expect( escapeCsvField( 'line1\nline2' ) ).toBe( '"line1\nline2"' );
	} );

	it( 'prefixes = with a single quote to prevent formula injection', () => {
		expect( escapeCsvField( '=SUM(A1)' ) ).toBe( "'=SUM(A1)" );
	} );

	it( 'prefixes + with a single quote', () => {
		expect( escapeCsvField( '+100' ) ).toBe( "'+100" );
	} );

	it( 'prefixes - with a single quote', () => {
		expect( escapeCsvField( '-100' ) ).toBe( "'-100" );
	} );

	it( 'prefixes @ with a single quote', () => {
		expect( escapeCsvField( '@user' ) ).toBe( "'@user" );
	} );

	it( 'returns empty string for null', () => {
		expect( escapeCsvField( null ) ).toBe( '' );
	} );

	it( 'returns empty string for undefined', () => {
		expect( escapeCsvField( undefined ) ).toBe( '' );
	} );

	it( 'coerces numbers to string', () => {
		expect( escapeCsvField( 42.5 ) ).toBe( '42.5' );
	} );
} );

describe( 'buildEntriesCsv', () => {
	const budgets = [
		{ id: 1, name: 'Marketing' },
		{ id: 2, name: 'Operations' },
	];

	const entry = {
		entry_date: '2025-01-15',
		entry_type: 'cost',
		amount: 99.5,
		description: 'Venue hire',
		budget_id: 1,
		event_date_id: null,
		imported_at: '2025-01-16 10:00:00',
	};

	it( 'starts with a UTF-8 BOM', () => {
		const csv = buildEntriesCsv( [ entry ], budgets );
		expect( csv.charCodeAt( 0 ) ).toBe( 0xfeff );
	} );

	it( 'includes a header row', () => {
		const csv = buildEntriesCsv( [ entry ], budgets );
		const firstLine = csv.replace( /^﻿/, '' ).split( '\n' )[ 0 ];
		expect( firstLine ).toContain( 'Date' );
		expect( firstLine ).toContain( 'Amount' );
		expect( firstLine ).toContain( 'Budget' );
	} );

	it( 'resolves budget name from the budgets array', () => {
		const csv = buildEntriesCsv( [ entry ], budgets );
		expect( csv ).toContain( 'Marketing' );
	} );

	it( 'leaves budget empty when budget_id is not in the budgets array', () => {
		const entryUnknownBudget = { ...entry, budget_id: 999 };
		const csv = buildEntriesCsv( [ entryUnknownBudget ], budgets );
		const dataLine = csv.replace( /^﻿/, '' ).split( '\n' )[ 1 ];
		// Budget column (index 4) should be empty — check that no budget name appears
		expect( dataLine ).not.toContain( 'Marketing' );
		expect( dataLine ).not.toContain( 'Operations' );
	} );

	it( 'leaves budget empty when budget_id is null', () => {
		const entryNoBudget = { ...entry, budget_id: null };
		const csv = buildEntriesCsv( [ entryNoBudget ], budgets );
		expect( csv ).not.toContain( 'Marketing' );
	} );

	it( 'outputs amount as a raw decimal', () => {
		const csv = buildEntriesCsv( [ entry ], budgets );
		expect( csv ).toContain( '99.5' );
	} );

	it( 'quotes a description that contains a comma', () => {
		const entryWithComma = {
			...entry,
			description: 'Food, drinks',
		};
		const csv = buildEntriesCsv( [ entryWithComma ], budgets );
		expect( csv ).toContain( '"Food, drinks"' );
	} );

	it( 'produces one header row + one data row for a single entry', () => {
		const csv = buildEntriesCsv( [ entry ], budgets );
		const lines = csv.replace( /^﻿/, '' ).split( '\n' );
		expect( lines ).toHaveLength( 2 );
	} );

	it( 'handles an empty entries array (header only)', () => {
		const csv = buildEntriesCsv( [], budgets );
		const lines = csv.replace( /^﻿/, '' ).split( '\n' );
		expect( lines ).toHaveLength( 1 );
	} );
} );
