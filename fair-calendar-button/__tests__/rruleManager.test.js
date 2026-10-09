import {
	RRuleManager,
	rruleManager,
} from '../src/blocks/calendar-button/utils/rruleManager.js';
import {
	buildRRule,
	expandRRulePreview,
} from 'fair-events-shared/src/recurrence.js';

/**
 * Format the generated dates as local "Y-m-d" strings.
 *
 * @param {Date[]} dates Generated occurrence dates.
 * @return {string[]} Local date strings.
 */
function toDateStrings( dates ) {
	return dates.map(
		( date ) =>
			`${ date.getFullYear() }-${ String( date.getMonth() + 1 ).padStart(
				2,
				'0'
			) }-${ String( date.getDate() ).padStart( 2, '0' ) }`
	);
}

describe( 'RRuleManager', () => {
	let manager;

	beforeEach( () => {
		manager = new RRuleManager();
	} );

	describe( 'toRRule', () => {
		it( 'returns an empty string without a frequency', () => {
			expect( manager.toRRule( {} ) ).toBe( '' );
			expect( manager.toRRule( null ) ).toBe( '' );
			expect( manager.toRRule( undefined ) ).toBe( '' );
		} );

		it.each( [
			[ 'DAILY', 'FREQ=DAILY' ],
			[ 'WEEKLY', 'FREQ=WEEKLY' ],
			[ 'BIWEEKLY', 'FREQ=WEEKLY;INTERVAL=2' ],
			[ 'MONTHLY', 'FREQ=MONTHLY' ],
		] )( 'builds the %s rule', ( frequency, expected ) => {
			expect( manager.toRRule( { frequency } ) ).toBe( expected );
		} );

		it( 'produces the rule the shared builder gives for the same input', () => {
			expect(
				manager.toRRule( { frequency: 'BIWEEKLY', count: 5 } )
			).toBe(
				buildRRule( {
					enabled: true,
					frequency: 'biweekly',
					endType: 'count',
					count: 5,
					until: '',
				} )
			);
			expect(
				manager.toRRule( { frequency: 'MONTHLY', until: '2024-12-31' } )
			).toBe(
				buildRRule( {
					enabled: true,
					frequency: 'monthly',
					endType: 'until',
					count: 10,
					until: '2024-12-31',
				} )
			);
		} );

		describe( 'interval normalization', () => {
			it( 'reads a stored two-week interval as biweekly', () => {
				expect(
					manager.toRRule( { frequency: 'WEEKLY', interval: 2 } )
				).toBe( 'FREQ=WEEKLY;INTERVAL=2' );
			} );

			it( 'drops intervals outside the shared vocabulary', () => {
				expect(
					manager.toRRule( { frequency: 'DAILY', interval: 3 } )
				).toBe( 'FREQ=DAILY' );
				expect(
					manager.toRRule( { frequency: 'WEEKLY', interval: 3 } )
				).toBe( 'FREQ=WEEKLY' );
				expect(
					manager.toRRule( { frequency: 'MONTHLY', interval: 2 } )
				).toBe( 'FREQ=MONTHLY' );
			} );

			it( 'falls back to weekly for an unknown frequency', () => {
				expect( manager.toRRule( { frequency: 'YEARLY' } ) ).toBe(
					'FREQ=WEEKLY'
				);
			} );
		} );

		describe( 'COUNT', () => {
			it( 'adds COUNT when positive', () => {
				expect(
					manager.toRRule( { frequency: 'WEEKLY', count: 10 } )
				).toBe( 'FREQ=WEEKLY;COUNT=10' );
			} );

			it.each( [ 0, -1, null, undefined ] )(
				'omits COUNT for %p',
				( count ) => {
					expect(
						manager.toRRule( { frequency: 'WEEKLY', count } )
					).toBe( 'FREQ=WEEKLY' );
				}
			);
		} );

		describe( 'UNTIL', () => {
			it( 'adds UNTIL for a valid date', () => {
				expect(
					manager.toRRule( {
						frequency: 'WEEKLY',
						until: '2024-12-31',
					} )
				).toBe( 'FREQ=WEEKLY;UNTIL=20241231' );
			} );

			it.each( [ '', null, undefined, 'invalid-date', '2024-1-1' ] )(
				'omits UNTIL for %p',
				( until ) => {
					expect(
						manager.toRRule( { frequency: 'WEEKLY', until } )
					).toBe( 'FREQ=WEEKLY' );
				}
			);
		} );

		describe( 'COUNT and UNTIL together', () => {
			it( 'ends by count when both are set', () => {
				expect(
					manager.toRRule( {
						frequency: 'WEEKLY',
						count: 5,
						until: '2024-12-31',
					} )
				).toBe( 'FREQ=WEEKLY;COUNT=5' );
			} );

			it.each( [ 0, null ] )(
				'ends by date when count is %p',
				( count ) => {
					expect(
						manager.toRRule( {
							frequency: 'WEEKLY',
							count,
							until: '2024-12-31',
						} )
					).toBe( 'FREQ=WEEKLY;UNTIL=20241231' );
				}
			);
		} );
	} );

	describe( 'generateEvents', () => {
		it( 'returns an empty array for invalid inputs', () => {
			expect( manager.generateEvents( null, '2024-01-01' ) ).toEqual(
				[]
			);
			expect( manager.generateEvents( {}, '2024-01-01' ) ).toEqual( [] );
			expect(
				manager.generateEvents( { frequency: 'WEEKLY' }, '' )
			).toEqual( [] );
			expect(
				manager.generateEvents( { frequency: 'WEEKLY' }, null )
			).toEqual( [] );
			expect(
				manager.generateEvents(
					{ frequency: 'WEEKLY' },
					'invalid-date'
				)
			).toEqual( [] );
		} );

		it( 'returns local-midnight Date objects', () => {
			const events = manager.generateEvents(
				{ frequency: 'WEEKLY', count: 2 },
				'2024-01-01T10:00:00'
			);

			expect( events ).toEqual( [
				new Date( 2024, 0, 1 ),
				new Date( 2024, 0, 8 ),
			] );
		} );

		it( 'returns the dates the shared preview gives for the same rule', () => {
			const events = manager.generateEvents(
				{ frequency: 'BIWEEKLY', until: '2024-03-31' },
				'2024-01-08T18:30',
				50
			);

			expect( toDateStrings( events ) ).toEqual(
				expandRRulePreview(
					'FREQ=WEEKLY;INTERVAL=2;UNTIL=20240331',
					'2024-01-08T18:30:00',
					50
				).dates
			);
		} );

		describe( 'frequencies', () => {
			it( 'generates daily events', () => {
				const events = manager.generateEvents(
					{ frequency: 'DAILY' },
					'2024-01-30',
					4
				);

				expect( toDateStrings( events ) ).toEqual( [
					'2024-01-30',
					'2024-01-31',
					'2024-02-01',
					'2024-02-02',
				] );
			} );

			it( 'generates weekly events across a leap-year February', () => {
				const events = manager.generateEvents(
					{ frequency: 'WEEKLY' },
					'2024-02-19',
					4
				);

				expect( toDateStrings( events ) ).toEqual( [
					'2024-02-19',
					'2024-02-26',
					'2024-03-04',
					'2024-03-11',
				] );
			} );

			it( 'generates biweekly events across a year boundary', () => {
				const events = manager.generateEvents(
					{ frequency: 'BIWEEKLY' },
					'2024-12-16',
					4
				);

				expect( toDateStrings( events ) ).toEqual( [
					'2024-12-16',
					'2024-12-30',
					'2025-01-13',
					'2025-01-27',
				] );
			} );

			it( 'generates monthly events', () => {
				const events = manager.generateEvents(
					{ frequency: 'MONTHLY', count: 4 },
					'2024-11-15T19:00'
				);

				expect( toDateStrings( events ) ).toEqual( [
					'2024-11-15',
					'2024-12-15',
					'2025-01-15',
					'2025-02-15',
				] );
			} );

			it( 'expands a stored out-of-vocabulary interval as the normalized rule', () => {
				const events = manager.generateEvents(
					{ frequency: 'WEEKLY', interval: 3 },
					'2024-01-01',
					3
				);

				expect( toDateStrings( events ) ).toEqual( [
					'2024-01-01',
					'2024-01-08',
					'2024-01-15',
				] );
			} );
		} );

		describe( 'COUNT', () => {
			it( 'stops at the count', () => {
				expect(
					manager.generateEvents(
						{ frequency: 'DAILY', count: 3 },
						'2024-01-01',
						10
					)
				).toHaveLength( 3 );
			} );

			it( 'returns a single event for a count of 1', () => {
				expect(
					toDateStrings(
						manager.generateEvents(
							{ frequency: 'WEEKLY', count: 1 },
							'2024-01-01'
						)
					)
				).toEqual( [ '2024-01-01' ] );
			} );
		} );

		describe( 'UNTIL', () => {
			it( 'stops before a date past the until date', () => {
				const events = manager.generateEvents(
					{ frequency: 'WEEKLY', until: '2024-01-20' },
					'2024-01-01',
					10
				);

				expect( toDateStrings( events ) ).toEqual( [
					'2024-01-01',
					'2024-01-08',
					'2024-01-15',
				] );
			} );

			it( 'includes an all-day occurrence on the until date', () => {
				const events = manager.generateEvents(
					{ frequency: 'WEEKLY', until: '2024-01-15' },
					'2024-01-01',
					10
				);

				expect( toDateStrings( events ) ).toEqual( [
					'2024-01-01',
					'2024-01-08',
					'2024-01-15',
				] );
			} );

			it( 'includes a timed occurrence on the until date', () => {
				const events = manager.generateEvents(
					{ frequency: 'DAILY', until: '2024-01-03' },
					'2024-01-01T10:00:00',
					10
				);

				expect( toDateStrings( events ) ).toEqual( [
					'2024-01-01',
					'2024-01-02',
					'2024-01-03',
				] );
			} );

			it( 'ends by count when both count and until are set', () => {
				const events = manager.generateEvents(
					{ frequency: 'DAILY', count: 10, until: '2024-01-03' },
					'2024-01-01',
					15
				);

				expect( events ).toHaveLength( 10 );
			} );

			it( 'ignores an invalid until date', () => {
				expect(
					manager.generateEvents(
						{ frequency: 'DAILY', until: 'invalid-date' },
						'2024-01-01',
						5
					)
				).toHaveLength( 5 );
			} );
		} );

		describe( 'preview limits', () => {
			it( 'returns 10 instances by default', () => {
				expect(
					manager.generateEvents(
						{ frequency: 'DAILY' },
						'2024-01-01'
					)
				).toHaveLength( 10 );
			} );

			it( 'caps an open-ended rule at maxInstances', () => {
				expect(
					manager.generateEvents(
						{ frequency: 'DAILY' },
						'2024-01-01',
						7
					)
				).toHaveLength( 7 );
			} );

			it( 'caps a larger count at maxInstances', () => {
				expect(
					manager.generateEvents(
						{ frequency: 'DAILY', count: 20 },
						'2024-01-01',
						5
					)
				).toHaveLength( 5 );
			} );

			it( 'never returns more than the shared preview maximum', () => {
				expect(
					manager.generateEvents(
						{ frequency: 'DAILY' },
						'2024-01-01',
						500
					)
				).toHaveLength( 100 );
			} );
		} );
	} );

	describe( 'exported instance', () => {
		it( 'exports a default instance', () => {
			expect( rruleManager ).toBeInstanceOf( RRuleManager );
		} );
	} );
} );
