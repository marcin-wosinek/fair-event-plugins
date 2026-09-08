/**
 * @jest-environment jsdom
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
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

function renderEditor( onDataRef = null ) {
	const result = render(
		<EventTickets
			eventDateId={ 99 }
			initialData={ initialData }
			onSaveRef={ { current: null } }
			onDataRef={ onDataRef }
		/>
	);
	fireEvent.click( screen.getByRole( 'button', { name: /Sale Periods/i } ) );
	return result.container.querySelectorAll( 'input[type="date"]' );
}

it( 'shows adjacent periods as distinct inclusive ranges', () => {
	const inputs = renderEditor();
	expect( Array.from( inputs ).map( ( input ) => input.value ) ).toEqual( [
		'2026-08-03',
		'2026-08-31',
		'2026-09-01',
		'2026-09-24',
		'2026-09-25',
		'2026-10-03',
	] );
} );

it( 'serializes an edited Until date as the following midnight', () => {
	const onDataRef = { current: null };
	const inputs = renderEditor( onDataRef );
	fireEvent.change( inputs[ 3 ], { target: { value: '2026-09-27' } } );
	const periods = onDataRef.current().sale_periods;
	expect( periods[ 1 ].sale_end ).toBe( '2026-09-28 00:00:00' );
	expect( periods[ 2 ].sale_start ).toBe( '2026-09-28 00:00:00' );
} );

it( 'changing From updates the previous displayed Until date', () => {
	const inputs = renderEditor();
	fireEvent.change( inputs[ 2 ], { target: { value: '2026-09-05' } } );
	expect( inputs[ 1 ] ).toHaveValue( '2026-09-04' );
} );

it( 'preserves untouched canonical timestamps', () => {
	const onDataRef = { current: null };
	renderEditor( onDataRef );
	expect(
		onDataRef
			.current()
			.sale_periods.map( ( { sale_start, sale_end } ) => ( {
				sale_start,
				sale_end,
			} ) )
	).toEqual(
		initialData.sale_periods.map( ( { sale_start, sale_end } ) => ( {
			sale_start,
			sale_end,
		} ) )
	);
} );
