import apiFetch from '@wordpress/api-fetch';
import {
	actionFor,
	initialize,
	stop,
	TICKET_BUTTON_CLASS,
} from '../meta-engagement.js';

jest.mock( '@wordpress/api-fetch' );

const CONTEXT = { postId: 12, eventDateId: 34 };
const FBP = 'fb.1.1712345678901.browser';
const UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function grantConsent() {
	window.wp_has_consent = jest.fn( () => true );
	document.cookie = `_fbp=${ FBP }`;
}

/**
 * Render the supported buttons: a calendar button, a ticket link designated
 * on its wrapper (same-page jump), a ticket link designated on the link
 * itself (another purchase page), and an undesignated link.
 */
function renderButtons() {
	document.body.innerHTML = `
		<div class="wp-block-button">
			<a class="wp-block-button__link" data-calendar-button="true" href="#"><span>Add to calendar</span></a>
		</div>
		<div class="wp-block-button ${ TICKET_BUTTON_CLASS }" id="wrapper">
			<a class="wp-block-button__link" href="#tickets"><strong>Get tickets</strong></a>
		</div>
		<div class="wp-block-button">
			<a class="wp-block-button__link ${ TICKET_BUTTON_CLASS }" href="https://shop.example.test/buy?coupon=SECRET">Buy</a>
		</div>
		<a id="other" href="#elsewhere">Read more</a>
		<div id="tickets"></div>
	`;
}

/**
 * Click like the browser does, and keep jsdom from attempting navigation.
 * Records whether anything before the link prevented the default action.
 *
 * @param {Element} element Element to click.
 * @return {boolean} Whether the default action had been prevented.
 */
function click( element ) {
	let prevented = null;
	const link = element.closest( 'a' ) || element;
	const record = ( event ) => {
		prevented = event.defaultPrevented;
		event.preventDefault();
	};
	link.addEventListener( 'click', record );
	element.click();
	link.removeEventListener( 'click', record );
	return prevented;
}

const sent = () => apiFetch.mock.calls.map( ( [ options ] ) => options );

describe( 'Meta engagement capture', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		apiFetch.mockResolvedValue( { received: true } );
		renderButtons();
	} );

	afterEach( () => {
		stop();
		delete window.wp_has_consent;
		document.cookie = '_fbp=; Max-Age=0';
		document.cookie = '_fbc=; Max-Age=0';
		document.body.innerHTML = '';
	} );

	it( 'classifies calendar, designated ticket links and nested targets', () => {
		expect(
			actionFor( document.querySelector( '[data-calendar-button] span' ) )
		).toBe( 'calendar' );
		expect( actionFor( document.querySelector( '#wrapper strong' ) ) ).toBe(
			'ticket'
		);
		expect(
			actionFor( document.querySelector( `a.${ TICKET_BUTTON_CLASS }` ) )
		).toBe( 'ticket' );
		expect( actionFor( document.querySelector( '#other' ) ) ).toBeNull();
		// The wrapper's padding is not the link.
		expect( actionFor( document.querySelector( '#wrapper' ) ) ).toBeNull();
	} );

	it( 'sends nothing on page load', () => {
		grantConsent();
		initialize( CONTEXT );
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'sends a calendar event with event context and identifiers only', () => {
		grantConsent();
		initialize( CONTEXT );
		const prevented = click(
			document.querySelector( '[data-calendar-button] span' )
		);

		expect( prevented ).toBe( false );
		expect( sent() ).toHaveLength( 1 );
		const [ request ] = sent();
		expect( request ).toMatchObject( {
			path: '/fair-events-experimental/v1/meta-engagement',
			method: 'POST',
			keepalive: true,
		} );
		expect( request.data ).toEqual( {
			action: 'calendar',
			activation_id: expect.stringMatching( UUID ),
			post_id: 12,
			event_date_id: 34,
			marketing_consent: true,
			meta_fbp: FBP,
		} );
	} );

	it( 'sends ticket events for same-page jumps and other purchase pages without the destination', () => {
		grantConsent();
		initialize( CONTEXT );
		expect( click( document.querySelector( '#wrapper strong' ) ) ).toBe(
			false
		);
		expect(
			click( document.querySelector( `a.${ TICKET_BUTTON_CLASS }` ) )
		).toBe( false );

		expect( sent().map( ( { data } ) => data.action ) ).toEqual( [
			'ticket',
			'ticket',
		] );
		for ( const { data } of sent() ) {
			expect( JSON.stringify( data ) ).not.toMatch(
				/shop\.example|SECRET|tickets|Buy/
			);
		}
	} );

	it( 'treats keyboard activation as one event and ignores the keydown itself', () => {
		grantConsent();
		initialize( CONTEXT );
		const link = document.querySelector( '#wrapper a' );
		link.dispatchEvent(
			new KeyboardEvent( 'keydown', { key: 'Enter', bubbles: true } )
		);
		expect( apiFetch ).not.toHaveBeenCalled();
		// Enter on a link makes the browser fire one click with detail 0.
		click( link );
		expect( sent() ).toHaveLength( 1 );
	} );

	it( 'counts repeated deliberate clicks separately with distinct activation IDs', () => {
		grantConsent();
		initialize( CONTEXT );
		const link = document.querySelector( '#wrapper a' );
		click( link );
		click( link );
		const ids = sent().map( ( { data } ) => data.activation_id );
		expect( ids ).toHaveLength( 2 );
		expect( ids[ 0 ] ).not.toBe( ids[ 1 ] );
	} );

	it( 'listens once when initialized repeatedly', () => {
		grantConsent();
		initialize( CONTEXT );
		initialize( CONTEXT );
		click( document.querySelector( '#wrapper a' ) );
		expect( sent() ).toHaveLength( 1 );
	} );

	it( 'does not count calendar provider links again', () => {
		grantConsent();
		initialize( CONTEXT );
		// The calendar dropdown is appended to <body>, outside the button.
		const dropdown = document.createElement( 'div' );
		dropdown.className = 'calendar-dropdown';
		dropdown.innerHTML =
			'<a class="calendar-dropdown-option" href="#google">Google</a>';
		document.body.appendChild( dropdown );
		click( dropdown.querySelector( 'a' ) );
		click( document.querySelector( '#other' ) );
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'rechecks marketing consent at activation time', () => {
		document.cookie = `_fbp=${ FBP }`;
		initialize( CONTEXT );
		const link = document.querySelector( '#wrapper a' );

		click( link );
		expect( apiFetch ).not.toHaveBeenCalled();

		window.wp_has_consent = jest.fn( () => true );
		click( link );
		expect( sent() ).toHaveLength( 1 );

		window.wp_has_consent = jest.fn( () => false );
		click( link );
		expect( sent() ).toHaveLength( 1 );
	} );

	it( 'sends nothing without a valid Meta identifier', () => {
		window.wp_has_consent = jest.fn( () => true );
		document.cookie = '_fbp=invalid';
		initialize( CONTEXT );
		click( document.querySelector( '#wrapper a' ) );
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'does not listen without valid event context', () => {
		grantConsent();
		expect( initialize( { postId: 12, eventDateId: 0 } ) ).toBe( false );
		expect( initialize( undefined ) ).toBe( false );
		click( document.querySelector( '#wrapper a' ) );
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'keeps the action working when consent checks or delivery fail', async () => {
		initialize( CONTEXT );
		const link = document.querySelector( '#wrapper a' );

		window.wp_has_consent = jest.fn( () => {
			throw new Error( 'consent plugin broke' );
		} );
		document.cookie = `_fbp=${ FBP }`;
		expect( click( link ) ).toBe( false );

		window.wp_has_consent = jest.fn( () => true );
		apiFetch.mockImplementationOnce( () => {
			throw new Error( 'synchronous failure' );
		} );
		expect( click( link ) ).toBe( false );

		apiFetch.mockRejectedValueOnce( new Error( 'offline' ) );
		expect( click( link ) ).toBe( false );
		// A rejected delivery is swallowed rather than left unhandled.
		await expect( apiFetch.mock.results[ 1 ].value ).rejects.toThrow(
			'offline'
		);
	} );
} );
