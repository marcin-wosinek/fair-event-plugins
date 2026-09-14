/**
 * Unit tests for the signup export text builder (#1568).
 */
import { buildSignupExportText } from '../signup-export.js';

const columns = [
	{ id: 'name', label: 'Name', getValue: ( { item } ) => item.name },
	{ id: 'email', label: 'Email', getValue: ( { item } ) => item.email },
];

const rows = [
	{ id: 1, name: 'Ada Lovelace', email: 'ada@example.com' },
	{ id: 2, name: 'Bob, Jr.', email: 'bob@example.com' },
];

describe( 'buildSignupExportText — csv', () => {
	it( 'builds a header row and one row per signup', () => {
		const text = buildSignupExportText( { rows, columns, format: 'csv' } );
		const lines = text.split( '\r\n' );
		expect( lines[ 0 ] ).toBe( 'Name,Email' );
		expect( lines ).toHaveLength( 3 );
		expect( lines[ 1 ] ).toBe( 'Ada Lovelace,ada@example.com' );
	} );

	it( 'quotes a field containing a comma, doubling interior quotes', () => {
		const text = buildSignupExportText( { rows, columns, format: 'csv' } );
		expect( text ).toContain( '"Bob, Jr."' );
	} );

	it( 'quotes a field containing a double quote', () => {
		const quoted = [
			{ id: 3, name: 'Alice "Ally" Smith', email: 'a@x.com' },
		];
		const text = buildSignupExportText( {
			rows: quoted,
			columns,
			format: 'csv',
		} );
		expect( text ).toContain( '"Alice ""Ally"" Smith"' );
	} );

	it( 'renders an empty string for a missing value', () => {
		const missing = [ { id: 4, name: '', email: undefined } ];
		const text = buildSignupExportText( {
			rows: missing,
			columns,
			format: 'csv',
		} );
		expect( text.split( '\r\n' )[ 1 ] ).toBe( ',' );
	} );
} );

describe( 'buildSignupExportText — oneline', () => {
	it( 'joins column values per row with a space, one line per row', () => {
		const text = buildSignupExportText( {
			rows,
			columns,
			format: 'oneline',
		} );
		expect( text.split( '\r\n' ) ).toEqual( [
			'Ada Lovelace ada@example.com',
			'Bob, Jr. bob@example.com',
		] );
	} );

	it( 'drops empty values instead of leaving stray whitespace', () => {
		const partial = [ { id: 5, name: 'No Email', email: '' } ];
		const text = buildSignupExportText( {
			rows: partial,
			columns,
			format: 'oneline',
		} );
		expect( text ).toBe( 'No Email' );
	} );
} );

describe( 'buildSignupExportText — markdown', () => {
	it( 'headings the signup by name and lists each column as a bold field', () => {
		const text = buildSignupExportText( {
			rows: [ rows[ 0 ] ],
			columns,
			format: 'markdown',
		} );
		expect( text ).toBe(
			'## Ada Lovelace\n\n**Name:** Ada Lovelace\n\n**Email:** ada@example.com'
		);
	} );

	it( 'separates multiple rows with a horizontal rule', () => {
		const text = buildSignupExportText( {
			rows,
			columns,
			format: 'markdown',
		} );
		expect( text ).toContain( '\n\n---\n\n' );
	} );

	it( 'falls back to email, then #id, for the heading', () => {
		const noName = [ { id: 7, name: '', email: 'e@example.com' } ];
		expect(
			buildSignupExportText( {
				rows: noName,
				columns,
				format: 'markdown',
			} )
		).toContain( '## e@example.com' );

		const noNameOrEmail = [ { id: 8, name: '', email: '' } ];
		expect(
			buildSignupExportText( {
				rows: noNameOrEmail,
				columns,
				format: 'markdown',
			} )
		).toContain( '## #8' );
	} );
} );
