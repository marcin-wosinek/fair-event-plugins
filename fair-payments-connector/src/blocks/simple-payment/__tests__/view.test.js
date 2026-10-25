/**
 * @jest-environment jsdom
 */
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch' );

const KEY_PREFIX = 'fairPaymentsConnector.accessToken.';

// Mirrors the markup render.php emits for one block.
const BLOCK_HTML = `
	<div class="fair-payments-connector-block">
		<div class="fair-payments-connector-callback">
			<div class="fair-payments-connector-success" data-status="confirmed" style="display: none;"></div>
			<div class="fair-payments-connector-processing" data-status="processing"></div>
			<div class="fair-payments-connector-failed" data-status="failed" style="display: none;"></div>
			<div class="fair-payments-connector-unverified" data-status="unverified" style="display: none;"></div>
			<div class="fair-payments-connector-callback-dismiss"><button type="button">Continue</button></div>
			<div class="fair-payments-connector-restart" style="display: none;"><button type="button">Try Again</button></div>
		</div>
		<div class="fair-payments-connector-payment-form">
			<button class="fair-payments-connector-button" data-amount="10" data-currency="EUR" data-description="" data-post-id="3" data-block-id="block-1">Pay Now</button>
			<div class="fair-payments-connector-loading" style="display: none;"></div>
			<div class="fair-payments-connector-error" style="display: none;"></div>
		</div>
	</div>
`;

function setUrl( search ) {
	window.history.replaceState( {}, '', `/page/${ search }` );
}

function loadView() {
	jest.isolateModules( () => {
		require( '../view.js' );
	} );
}

function flush() {
	return new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
}

function visible( selector ) {
	return document.querySelector( selector ).style.display !== 'none';
}

beforeEach( () => {
	document.body.innerHTML = BLOCK_HTML;
	window.sessionStorage.clear();
	apiFetch.mockReset();
	setUrl( '' );
} );

describe( 'paying', () => {
	test( 'stores the access token for the created transaction before checkout', async () => {
		apiFetch.mockImplementation( ( { path } ) =>
			Promise.resolve(
				path.endsWith( '/nonce' )
					? { nonce: 'n' }
					: {
							checkout_url: '#checkout',
							transaction_id: 9,
							access_token: 'tok-9',
						}
			)
		);
		loadView();

		document.querySelector( '.fair-payments-connector-button' ).click();
		await flush();

		expect( window.sessionStorage.getItem( KEY_PREFIX + '9' ) ).toBe(
			'tok-9'
		);
	} );

	test( 'refuses to create a payment when site data is blocked', async () => {
		apiFetch.mockResolvedValue( { nonce: 'n' } );
		const spy = jest
			.spyOn( window, 'sessionStorage', 'get' )
			.mockImplementation( () => {
				throw new Error( 'SecurityError' );
			} );
		loadView();

		document.querySelector( '.fair-payments-connector-button' ).click();
		await flush();
		spy.mockRestore();

		expect( visible( '.fair-payments-connector-error' ) ).toBe( true );
		expect(
			document.querySelector( '.fair-payments-connector-error' )
				.textContent
		).toContain( 'blocking site data' );
		expect( visible( '.fair-payments-connector-loading' ) ).toBe( false );
		expect(
			apiFetch.mock.calls.filter( ( [ options ] ) => options.method )
		).toHaveLength( 0 );
	} );
} );

describe( 'returning from checkout', () => {
	test( 'reads the status with the stored token in a header, not the URL', async () => {
		setUrl( '?fair_payment_callback=true&transaction_id=9&post_id=3' );
		window.sessionStorage.setItem( KEY_PREFIX + '9', 'tok-9' );
		apiFetch.mockResolvedValue( { lifecycle_status: 'confirmed' } );
		loadView();
		await flush();

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-payments-connector/v1/payments/9/status',
			headers: { 'X-Fair-Payment-Token': 'tok-9' },
		} );
		expect( visible( '.fair-payments-connector-success' ) ).toBe( true );
		expect( visible( '.fair-payments-connector-processing' ) ).toBe(
			false
		);
	} );

	test( 'shows "can\'t verify", not a failure, when the status cannot be read', async () => {
		setUrl( '?fair_payment_callback=true&transaction_id=9&post_id=3' );
		apiFetch.mockImplementation( ( { path } ) =>
			path.endsWith( '/nonce' )
				? Promise.resolve( { nonce: 'n' } )
				: Promise.reject( { code: 'transaction_not_found' } )
		);
		loadView();
		await flush();

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/fair-payments-connector/v1/payments/9/status',
		} );
		expect( visible( '.fair-payments-connector-unverified' ) ).toBe( true );
		expect( visible( '.fair-payments-connector-failed' ) ).toBe( false );
		expect( visible( '.fair-payments-connector-restart' ) ).toBe( false );
		expect( visible( '.fair-payments-connector-callback-dismiss' ) ).toBe(
			true
		);
	} );

	test( 'Continue forgets only this transaction’s token', async () => {
		setUrl( '?fair_payment_callback=true&transaction_id=9&post_id=3' );
		window.sessionStorage.setItem( KEY_PREFIX + '9', 'tok-9' );
		window.sessionStorage.setItem( KEY_PREFIX + '8', 'tok-8' );
		apiFetch.mockResolvedValue( { lifecycle_status: 'confirmed' } );
		loadView();
		await flush();

		document
			.querySelector( '.fair-payments-connector-callback-dismiss button' )
			.click();

		expect( window.sessionStorage.getItem( KEY_PREFIX + '9' ) ).toBeNull();
		expect( window.sessionStorage.getItem( KEY_PREFIX + '8' ) ).toBe(
			'tok-8'
		);
		expect( window.location.search ).toBe( '?post_id=3' );
	} );

	test( 'Try Again forgets the failed transaction’s token', async () => {
		setUrl( '?fair_payment_callback=true&transaction_id=9&post_id=3' );
		window.sessionStorage.setItem( KEY_PREFIX + '9', 'tok-9' );
		apiFetch.mockResolvedValue( { lifecycle_status: 'failed' } );
		loadView();
		await flush();

		expect( visible( '.fair-payments-connector-restart' ) ).toBe( true );
		document
			.querySelector( '.fair-payments-connector-restart button' )
			.click();

		expect( window.sessionStorage.getItem( KEY_PREFIX + '9' ) ).toBeNull();
	} );
} );
