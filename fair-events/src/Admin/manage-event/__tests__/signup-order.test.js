/**
 * Unit tests for the List tab's alphabetical order (#2217).
 */
import { compareSignupsByName, sortSignupsByName } from '../signup-order.js';

const names = ( list ) => list.map( ( signup ) => signup.name );

describe( 'sortSignupsByName', () => {
	it( 'orders by the complete stored name, ignoring case and accents', () => {
		const sorted = sortSignupsByName( [
			{ id: 1, name: 'Émile Zola' },
			{ id: 2, name: 'adam Smith' },
			{ id: 3, name: 'Ángela Ruiz' },
			{ id: 4, name: 'Bob' },
		] );

		expect( names( sorted ) ).toEqual( [
			'adam Smith',
			'Ángela Ruiz',
			'Bob',
			'Émile Zola',
		] );
	} );

	it( 'compares compound names as one value, never splitting a surname', () => {
		const sorted = sortSignupsByName( [
			{ id: 1, name: 'Ana María López' },
			{ id: 2, name: 'Ana Beltrán' },
			{ id: 3, name: 'Ana' },
		] );

		expect( names( sorted ) ).toEqual( [
			'Ana',
			'Ana Beltrán',
			'Ana María López',
		] );
	} );

	it( 'breaks ties between equal names by registration ID', () => {
		const sorted = sortSignupsByName( [
			{ id: 30, name: 'José Pérez' },
			{ id: 4, name: 'jose perez' },
			{ id: 12, name: 'José Pérez' },
		] );

		expect( sorted.map( ( signup ) => signup.id ) ).toEqual( [
			4, 12, 30,
		] );
	} );

	it( 'sorts empty and missing names first, as empty text', () => {
		const sorted = sortSignupsByName( [
			{ id: 3, name: 'Ada' },
			{ id: 2, name: null },
			{ id: 1, name: '' },
			{ id: 4 },
		] );

		expect( sorted.map( ( signup ) => signup.id ) ).toEqual( [
			1, 2, 4, 3,
		] );
	} );

	it( 'returns a new array and leaves the registrations untouched', () => {
		const input = [
			{ id: 2, name: 'Bea' },
			{ id: 1, name: 'Ada' },
		];
		const snapshot = JSON.parse( JSON.stringify( input ) );

		const sorted = sortSignupsByName( input );

		expect( sorted ).not.toBe( input );
		expect( input ).toEqual( snapshot );
		expect( sorted[ 0 ] ).toBe( input[ 1 ] );
	} );

	it( 'returns an empty list for a missing response', () => {
		expect( sortSignupsByName( undefined ) ).toEqual( [] );
	} );
} );

describe( 'compareSignupsByName', () => {
	it( 'is zero only for the same name and ID', () => {
		expect(
			compareSignupsByName( { id: 1, name: 'A' }, { id: 1, name: 'a' } )
		).toBe( 0 );
		expect(
			compareSignupsByName( { id: 1, name: 'A' }, { id: 2, name: 'a' } )
		).toBeLessThan( 0 );
	} );
} );
