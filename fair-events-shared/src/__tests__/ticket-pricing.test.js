import {
	formatMoney,
	formatMoneyInline,
	CURRENCY_SYMBOLS,
} from '../ticket-pricing.js';

describe( 'formatMoney', () => {
	it( 'formats an amount with its currency code', () => {
		expect( formatMoney( 12.5, 'EUR' ) ).toBe( '12.50 EUR' );
		expect( formatMoney( 12.5, 'PLN' ) ).toBe( '12.50 PLN' );
	} );
} );

describe( 'formatMoneyInline', () => {
	it( 'prefixes the symbol for prefix-position currencies', () => {
		expect( formatMoneyInline( 12.5, 'EUR' ) ).toBe( '€12.50' );
		expect( formatMoneyInline( 12.5, 'USD' ) ).toBe( '$12.50' );
		expect( formatMoneyInline( 12.5, 'GBP' ) ).toBe( '£12.50' );
	} );

	it( 'suffixes the symbol for suffix-position currencies', () => {
		expect( formatMoneyInline( 12.5, 'PLN' ) ).toBe( '12.50 zł' );
		expect( formatMoneyInline( 12.5, 'CZK' ) ).toBe( '12.50 Kč' );
		expect( formatMoneyInline( 12.5, 'HUF' ) ).toBe( '12.50 Ft' );
	} );

	it( 'falls back to the code form for an unmapped currency', () => {
		expect( formatMoneyInline( 12.5, 'CHF' ) ).toBe( '12.50 CHF' );
	} );
} );

describe( 'CURRENCY_SYMBOLS', () => {
	// Mirrors FairEventsShared\Money::SYMBOLS on the PHP side (see
	// fair-payments-connector/__tests__/Shared/MoneyTest.php) — keep both
	// lists in sync so a currency added to one is caught if missed on the
	// other.
	it( 'matches the PHP-side currency map', () => {
		expect( Object.keys( CURRENCY_SYMBOLS ) ).toEqual( [
			'EUR',
			'USD',
			'GBP',
			'PLN',
			'CZK',
			'HUF',
		] );
	} );
} );
