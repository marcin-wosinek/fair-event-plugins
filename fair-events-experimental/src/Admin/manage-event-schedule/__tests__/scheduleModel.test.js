/**
 * Tests for the schedule editor's pure helpers (#1767).
 */
import {
	addMinutes,
	entryFromItem,
	errorsByEntry,
	newEntry,
	overlapsByEntry,
	serialize,
	toPayload,
	validateEntries,
} from '../scheduleModel.js';

const item = ( overrides = {} ) => ( {
	id: 5,
	ticket_option_id: 101,
	bookable: true,
	title: 'Acro',
	start_datetime: '2027-05-15 10:00:00',
	end_datetime: '2027-05-15 11:30:00',
	description: '',
	location: 'Main hall',
	...overrides,
} );

describe( 'entryFromItem / toPayload', () => {
	it( 'round-trips a saved item without touching its wall-clock times', () => {
		const [ payload ] = toPayload( [ entryFromItem( item() ) ] );

		expect( payload ).toEqual( {
			key: 'saved-5',
			id: 5,
			ticket_option_id: 101,
			bookable: true,
			// The name of a workshop lives on its add-on.
			title: '',
			start_datetime: '2027-05-15 10:00:00',
			end_datetime: '2027-05-15 11:30:00',
			description: '',
			location: 'Main hall',
		} );
	} );

	it( 'sends an incomplete date or time as empty for the server to reject', () => {
		const entry = { ...entryFromItem( item() ), endTime: '' };

		expect( toPayload( [ entry ] )[ 0 ].end_datetime ).toBe( '' );
	} );

	it( 'ignores editor keys when comparing with the saved state', () => {
		const saved = entryFromItem( item() );

		expect( serialize( [ { ...saved, key: 'other' } ] ) ).toBe(
			serialize( [ saved ] )
		);
		expect( serialize( [ { ...saved, location: 'Garden' } ] ) ).not.toBe(
			serialize( [ saved ] )
		);
	} );
} );

describe( 'newEntry', () => {
	const eventDate = { start_datetime: '2027-05-15 09:00:00' };

	it( 'starts a program item with the event, not bookable', () => {
		expect( newEntry( eventDate ) ).toMatchObject( {
			id: null,
			ticket_option_id: null,
			bookable: false,
			title: '',
			startDate: '2027-05-15',
			startTime: '09:00',
			endDate: '2027-05-15',
			endTime: '10:00',
		} );
	} );

	it( 'links a workshop to its add-on, bookable', () => {
		expect(
			newEntry( eventDate, { id: 102, name: 'Juggling' } )
		).toMatchObject( {
			ticket_option_id: 102,
			bookable: true,
			title: 'Juggling',
		} );
	} );

	it( 'leaves the dates empty when the event has none', () => {
		expect( newEntry( {} ) ).toMatchObject( {
			startDate: '',
			startTime: '',
			endDate: '',
			endTime: '',
		} );
	} );
} );

describe( 'addMinutes', () => {
	it( 'rolls over midnight and the end of a month', () => {
		expect( addMinutes( '2027-01-31', '23:30', 60 ) ).toEqual( {
			date: '2027-02-01',
			time: '00:30',
		} );
	} );

	it( 'stays on the wall clock across a daylight-saving change', () => {
		// Clocks in Madrid go from 02:00 to 03:00 on this night.
		expect( addMinutes( '2027-03-28', '01:30', 60 ) ).toEqual( {
			date: '2027-03-28',
			time: '02:30',
		} );
	} );
} );

describe( 'validateEntries', () => {
	it( 'accepts overlapping and overnight entries', () => {
		const entries = [
			entryFromItem( item() ),
			entryFromItem( item( { id: 6, ticket_option_id: 102 } ) ),
			entryFromItem(
				item( {
					id: 7,
					ticket_option_id: null,
					title: 'Night jam',
					start_datetime: '2027-05-15 22:00:00',
					end_datetime: '2027-05-16 02:00:00',
				} )
			),
		];

		expect( validateEntries( entries ) ).toEqual( {} );
	} );

	it( 'names the field of each problem', () => {
		const backwards = entryFromItem(
			item( { end_datetime: '2027-05-15 09:00:00' } )
		);
		const untitled = {
			...entryFromItem(
				item( { id: 8, ticket_option_id: null, title: '  ' } )
			),
			startTime: '',
		};

		expect( validateEntries( [ backwards, untitled ] ) ).toEqual( {
			'saved-5': { end_datetime: 'The end must be after the start.' },
			'saved-8': {
				title: 'Enter a title.',
				start_datetime: 'Enter a valid start date and time.',
			},
		} );
	} );
} );

describe( 'errorsByEntry', () => {
	it( 'groups server errors by entry and keeps the first message per field', () => {
		expect(
			errorsByEntry( [
				{ key: 'a', field: 'end_datetime', message: 'First' },
				{ key: 'a', field: 'end_datetime', message: 'Second' },
				{ key: 'a', field: 'bookable', message: 'Held' },
				{ key: 'b', field: 'title', message: 'Enter a title.' },
			] )
		).toEqual( {
			a: { end_datetime: 'First', bookable: 'Held' },
			b: { title: 'Enter a title.' },
		} );
		expect( errorsByEntry( undefined ) ).toEqual( {} );
	} );
} );

describe( 'overlapsByEntry', () => {
	it( 'finds entries sharing time, not those that only touch', () => {
		const acro = entryFromItem( item() );
		const parallel = entryFromItem(
			item( {
				id: 6,
				start_datetime: '2027-05-15 11:00:00',
				end_datetime: '2027-05-15 12:00:00',
			} )
		);
		const after = entryFromItem(
			item( {
				id: 7,
				start_datetime: '2027-05-15 12:00:00',
				end_datetime: '2027-05-15 13:00:00',
			} )
		);

		const overlaps = overlapsByEntry( [ acro, parallel, after ] );

		expect( overlaps[ acro.key ] ).toEqual( [ parallel ] );
		expect( overlaps[ parallel.key ] ).toEqual( [ acro ] );
		expect( overlaps[ after.key ] ).toBeUndefined();
	} );
} );
