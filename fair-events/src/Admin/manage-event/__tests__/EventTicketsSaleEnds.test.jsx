/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, act } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import EventTickets from '../EventTickets.js';

jest.mock( '@wordpress/api-fetch' );

const initialData = {
	capacity: null,
	ticket_types: [],
	prices: [],
	options: [],
	settings: { multiple_pricing_periods: true },
	sale_periods: [
		{
			id: 1,
			name: 'Early Bird',
			sale_start: '2026-08-03 00:00:00',
			sale_end: '2026-09-01 00:00:00',
		},
		{
			id: 2,
			name: 'Regular',
			sale_start: '2026-09-01 00:00:00',
			sale_end: '2026-09-25 00:00:00',
		},
		{
			id: 3,
			name: 'Last minute',
			sale_start: '2026-09-25 00:00:00',
			sale_end: '2026-10-04 00:00:00',
		},
	],
};

beforeEach( () => {
	apiFetch.mockImplementation( () => new Promise( () => {} ) );
} );

afterEach( () => jest.clearAllMocks() );

async function renderEditor( onSaveRef = { current: null } ) {
	apiFetch.mockImplementationOnce( () => Promise.resolve( initialData ) );
	let result;
	await act( async () => {
		result = render(
			<EventTickets eventDateId={ 99 } onSaveRef={ onSaveRef } />
		);
	} );
	fireEvent.click( screen.getByRole( 'button', { name: /Sale Periods/i } ) );
	return result.container.querySelectorAll( 'input[type="date"]' );
}

function savePayload( ref ) {
	act( () => {
		ref.current();
	} );
	return apiFetch.mock.calls.find(
		( [ request ] ) => request.method === 'PUT'
	)[ 0 ].data;
}

it( 'shows adjacent periods as distinct inclusive ranges', async () => {
	const inputs = await renderEditor();
	expect( Array.from( inputs ).map( ( input ) => input.value ) ).toEqual( [
		'2026-08-03',
		'2026-08-31',
		'2026-09-01',
		'2026-09-24',
		'2026-09-25',
		'2026-10-03',
	] );
} );

it( 'serializes an edited Until date as the following midnight', async () => {
	const onSaveRef = { current: null };
	const inputs = await renderEditor( onSaveRef );
	fireEvent.change( inputs[ 3 ], { target: { value: '2026-09-27' } } );
	const periods = savePayload( onSaveRef ).sale_periods;
	expect( periods[ 1 ].sale_end ).toBe( '2026-09-28 00:00:00' );
	expect( periods[ 2 ].sale_start ).toBe( '2026-09-28 00:00:00' );
} );

it( 'changing From updates the previous displayed Until date', async () => {
	const inputs = await renderEditor();
	fireEvent.change( inputs[ 2 ], { target: { value: '2026-09-05' } } );
	expect( inputs[ 1 ] ).toHaveValue( '2026-09-04' );
} );

it( 'preserves untouched canonical timestamps', async () => {
	const onSaveRef = { current: null };
	await renderEditor( onSaveRef );
	expect(
		savePayload( onSaveRef ).sale_periods.map(
			( { sale_start, sale_end } ) => ( {
				sale_start,
				sale_end,
			} )
		)
	).toEqual(
		initialData.sale_periods.map( ( { sale_start, sale_end } ) => ( {
			sale_start,
			sale_end,
		} ) )
	);
} );
