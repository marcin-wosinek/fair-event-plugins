/**
 * @jest-environment jsdom
 */
import {
	createCheckoutKeyStore,
	generateCheckoutKey,
	purchaseSignature,
} from '../checkout-key.js';

const purchase = {
	event_date_id: 7,
	name: 'Ada',
	email: 'ada@example.test',
	ticket_type_id: 3,
	quantity: 2,
	ticket_activities: [ [ 1 ], [ 2 ] ],
	mailing_opt_in: false,
	questionnaire_answers: [],
};

function sequence() {
	let count = 0;
	return () => `key-${ ++count }`;
}

describe( 'createCheckoutKeyStore', () => {
	it( 'keeps the key while the same purchase is submitted again', () => {
		const store = createCheckoutKeyStore( sequence() );

		expect( store.keyFor( purchase ) ).toBe( 'key-1' );
		expect( store.keyFor( { ...purchase } ) ).toBe( 'key-1' );
	} );

	it( 'ignores fields that do not describe the purchase', () => {
		const store = createCheckoutKeyStore( sequence() );

		expect( store.keyFor( purchase ) ).toBe( 'key-1' );
		expect(
			store.keyFor( {
				...purchase,
				meta_fbp: 'fb.1.1700000000.abc',
				participant_token: 'token',
				_honeypot: '',
			} )
		).toBe( 'key-1' );
	} );

	it( 'starts a new key when the purchase details change', () => {
		const store = createCheckoutKeyStore( sequence() );

		expect( store.keyFor( purchase ) ).toBe( 'key-1' );
		expect( store.keyFor( { ...purchase, quantity: 3 } ) ).toBe( 'key-2' );
		expect(
			store.keyFor( {
				...purchase,
				quantity: 3,
				ticket_activities: [ [ 1 ], [ 2 ], [ 2 ] ],
			} )
		).toBe( 'key-3' );
	} );

	it( 'starts a new key after a reset', () => {
		const store = createCheckoutKeyStore( sequence() );

		expect( store.keyFor( purchase ) ).toBe( 'key-1' );
		store.reset();
		expect( store.keyFor( purchase ) ).toBe( 'key-2' );
	} );
	it( 'gives a deliberate repeat of the same purchase its own key, kept while it is retried', () => {
		const store = createCheckoutKeyStore( sequence() );

		expect( store.keyFor( purchase ) ).toBe( 'key-1' );
		// The first purchase completed; the same participant buys the same
		// ticket again.
		store.reset();
		expect( store.keyFor( { ...purchase } ) ).toBe( 'key-2' );
		expect( store.keyFor( { ...purchase } ) ).toBe( 'key-2' );
	} );
} );

describe( 'purchaseSignature', () => {
	it( 'treats a missing field like an absent one', () => {
		expect( purchaseSignature( { name: 'Ada' } ) ).toBe(
			purchaseSignature( { name: 'Ada', ticket_type_id: undefined } )
		);
	} );
} );

describe( 'generateCheckoutKey', () => {
	const originalCrypto = window.crypto;

	beforeAll( () => {
		Object.defineProperty( window, 'crypto', {
			configurable: true,
			value: require( 'crypto' ).webcrypto,
		} );
	} );

	afterAll( () => {
		Object.defineProperty( window, 'crypto', {
			configurable: true,
			value: originalCrypto,
		} );
	} );

	it( 'returns a random key in the format the route accepts', () => {
		const first = generateCheckoutKey();

		expect( first ).toMatch( /^[a-f0-9]{32}$/ );
		expect( generateCheckoutKey() ).not.toBe( first );
	} );
} );
