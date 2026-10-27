/**
 * @jest-environment jsdom
 */
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch' );

const KEY_PREFIX = 'fairPaymentsConnector.accessToken.';
const STATUS_PATH = '/fair-payments-connector/v1/payments/9/status';
const RETURN = '?fair_payment_callback=true&transaction_id=9';

function setUrl( search ) {
	window.history.replaceState( {}, '', `/page/${ search }` );
}

function load() {
	jest.isolateModules( () => {
		require( '../payment-callback.js' );
	} );
}

function flush() {
	return new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
}

function notices() {
	return document.querySelectorAll( '.fair-payments-connector-notification' );
}

function text() {
	return document.querySelector(
		'.fair-payments-connector-notification__message'
	).textContent;
}

beforeEach( () => {
	jest.useRealTimers();
	document.documentElement.lang = 'en-US';
	document.body.innerHTML = '<main><p>Page</p></main>';
	window.sessionStorage.clear();
	apiFetch.mockReset();
	setUrl( RETURN );
} );

describe( 'when to show', () => {
	test.each( [
		[ 'no marker', '?transaction_id=9' ],
		[
			'a marker other than true',
			'?fair_payment_callback=1&transaction_id=9',
		],
		[ 'no transaction id', '?fair_payment_callback=true' ],
		[ 'a zero id', '?fair_payment_callback=true&transaction_id=0' ],
		[ 'a non-numeric id', '?fair_payment_callback=true&transaction_id=9x' ],
	] )( 'stays silent with %s', async ( label, search ) => {
		setUrl( search );
		load();
		await flush();

		expect( notices() ).toHaveLength( 0 );
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	test.each( [
		[
			'Simple Payment',
			'<div class="fair-payments-connector-callback"></div>',
		],
		[
			'event signup',
			'<div class="fair-events-get-tickets-callback fair-events-get-tickets-callback-processing"></div>',
		],
	] )(
		'leaves the return to a rendered %s result, without a request',
		async ( label, html ) => {
			document.body.innerHTML = `<main>${ html }</main>`;
			load();
			await flush();

			expect( notices() ).toHaveLength( 0 );
			expect( apiFetch ).not.toHaveBeenCalled();
		}
	);

	test( 'a signup form without a result does not suppress the notice', async () => {
		document.body.innerHTML =
			'<main><div class="fair-events-get-tickets"><form></form></div></main>';
		apiFetch.mockResolvedValue( { lifecycle_status: 'confirmed' } );
		load();
		await flush();

		expect( notices() ).toHaveLength( 1 );
	} );

	test( 'waits for DOMContentLoaded while the document is loading', async () => {
		const state = jest
			.spyOn( document, 'readyState', 'get' )
			.mockReturnValue( 'loading' );
		apiFetch.mockResolvedValue( { lifecycle_status: 'confirmed' } );
		load();
		await flush();
		expect( notices() ).toHaveLength( 0 );

		state.mockRestore();
		document.dispatchEvent( new Event( 'DOMContentLoaded' ) );
		await flush();
		expect( notices() ).toHaveLength( 1 );
	} );
} );

describe( 'credentials', () => {
	test( 'sends the stored token in a header and never in the URL', async () => {
		window.sessionStorage.setItem( KEY_PREFIX + '9', 'tok-9' );
		setUrl( `${ RETURN }&token=url-token` );
		apiFetch.mockResolvedValue( { lifecycle_status: 'confirmed' } );
		load();
		await flush();

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: STATUS_PATH,
			headers: { 'X-Fair-Payment-Token': 'tok-9' },
		} );
		expect( JSON.stringify( apiFetch.mock.calls ) ).not.toContain(
			'url-token'
		);
		// Kept for a same-tab reload.
		expect( window.sessionStorage.getItem( KEY_PREFIX + '9' ) ).toBe(
			'tok-9'
		);
	} );

	test( 'without a stored token, asks with the session only', async () => {
		apiFetch.mockResolvedValue( { lifecycle_status: 'confirmed' } );
		load();
		await flush();

		expect( apiFetch ).toHaveBeenCalledWith( { path: STATUS_PATH } );
	} );
} );

describe( 'status', () => {
	test( 'reports a confirmed payment with a localized amount and test mode', async () => {
		apiFetch.mockResolvedValue( {
			lifecycle_status: 'confirmed',
			amount: '12.50',
			currency: 'EUR',
			testmode: true,
		} );
		load();
		await flush();

		const notice = notices()[ 0 ];
		expect( notice.getAttribute( 'role' ) ).toBe( 'status' );
		expect( notice.parentNode.tagName ).toBe( 'MAIN' );
		expect( text() ).toBe(
			'Thank you! Your payment of €12.50 has been received and confirmed.'
		);
		expect(
			notice.querySelector(
				'.fair-payments-connector-notification__testmode'
			).hidden
		).toBe( false );
	} );

	test( 'reports a failed payment without asking to pay again', async () => {
		apiFetch.mockResolvedValue( {
			lifecycle_status: 'failed',
			amount: '12.50',
			currency: 'EUR',
			testmode: false,
		} );
		load();
		await flush();

		expect( text() ).toBe( 'Your payment of €12.50 was not completed.' );
		expect(
			notices()[ 0 ].querySelector(
				'.fair-payments-connector-notification__testmode'
			).hidden
		).toBe( true );
	} );

	test( 'updates one notice from processing to confirmed', async () => {
		jest.useFakeTimers();
		apiFetch
			.mockResolvedValueOnce( {
				lifecycle_status: 'processing',
				amount: '12.50',
				currency: 'EUR',
			} )
			.mockResolvedValueOnce( {
				lifecycle_status: 'confirmed',
				amount: '12.50',
				currency: 'EUR',
			} );
		load();
		expect( text() ).toBe( 'Checking your payment status…' );

		await jest.advanceTimersByTimeAsync( 0 );
		expect( text() ).toBe(
			'Thank you! Your payment of €12.50 is being processed.'
		);

		await jest.advanceTimersByTimeAsync( 3000 );
		expect( notices() ).toHaveLength( 1 );
		expect( text() ).toContain( 'has been received and confirmed' );
	} );

	test( 'keeps the processing message once polling runs out', async () => {
		jest.useFakeTimers();
		apiFetch.mockResolvedValue( {
			lifecycle_status: 'processing',
			amount: '12.50',
			currency: 'EUR',
		} );
		load();

		await jest.advanceTimersByTimeAsync( 60000 );
		expect( apiFetch ).toHaveBeenCalledTimes( 10 );
		expect( text() ).toBe(
			'Thank you! Your payment of €12.50 is being processed.'
		);
	} );

	test.each( [
		[
			'a rejected credential',
			() =>
				Promise.reject( {
					code: 'rest_forbidden',
					message: 'Sorry, raw error',
				} ),
		],
		[ 'a network failure', () => Promise.reject( new Error( 'offline' ) ) ],
		[ 'an unusable response', () => Promise.resolve( { status: 'paid' } ) ],
		[ 'an empty response', () => Promise.resolve( null ) ],
	] )( 'says it cannot verify on %s', async ( label, respond ) => {
		apiFetch.mockImplementation( respond );
		load();
		await flush();

		expect( text() ).toContain( 'couldn’t verify your payment status' );
		expect( text() ).not.toMatch( /not completed|try again|raw error/i );
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
	} );
} );

describe( 'dismissing', () => {
	test( 'removes the notice and stops polling', async () => {
		jest.useFakeTimers();
		apiFetch.mockResolvedValue( { lifecycle_status: 'processing' } );
		load();
		await jest.advanceTimersByTimeAsync( 0 );

		const dismiss = document.querySelector(
			'.fair-payments-connector-notification__dismiss'
		);
		expect( dismiss.tagName ).toBe( 'BUTTON' );
		expect( dismiss.getAttribute( 'aria-label' ) ).toBe(
			'Dismiss payment notice'
		);
		dismiss.click();
		await jest.advanceTimersByTimeAsync( 30000 );

		expect( notices() ).toHaveLength( 0 );
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'a response arriving after dismissal does not bring it back', async () => {
		let resolve;
		apiFetch.mockReturnValue(
			new Promise( ( r ) => {
				resolve = r;
			} )
		);
		load();
		document
			.querySelector( '.fair-payments-connector-notification__dismiss' )
			.click();
		resolve( { lifecycle_status: 'confirmed' } );
		await flush();

		expect( notices() ).toHaveLength( 0 );
	} );
} );
