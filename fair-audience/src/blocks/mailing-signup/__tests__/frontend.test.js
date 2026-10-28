/**
 * The published Mailing Signup form (#2042): each form keeps its own weekly
 * state, validates the feed choice before sending, sends once while a
 * request runs, and keeps the input when the server only sends a message.
 */

let apiFetch;

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

const form = ( id, weekly ) => `
	<div class="fair-audience-mailing-signup" data-success-message="Check your inbox">
		<form class="fair-audience-mailing-form" id="${ id }">
			<input name="mailing_name" value="Ana" />
			<input name="mailing_surname" value="Ruiz" />
			<input name="mailing_email" value="${ id }@example.test" />
			${ weekly }
			<button type="submit" class="fair-audience-mailing-submit-button">Subscribe</button>
			<div class="fair-audience-mailing-message" role="status"></div>
		</form>
	</div>`;

const multiselect = `
	<fieldset class="fair-audience-mailing-weekly" data-weekly-config="multi-config" data-weekly-feeds="multiselect">
		<input type="checkbox" name="mailing_weekly" value="1" checked />
		<input type="checkbox" name="mailing_weekly_feeds[]" value="3" />
		<input type="checkbox" name="mailing_weekly_feeds[]" value="5" />
	</fieldset>`;

const hidden = `
	<fieldset class="fair-audience-mailing-weekly" data-weekly-config="hidden-config" data-weekly-feeds="hidden">
		<input type="checkbox" name="mailing_weekly" value="1" />
	</fieldset>`;

const $ = ( selector ) => document.querySelector( selector );
const check = ( selector, checked = true ) => {
	const input = $( selector );
	input.checked = checked;
	input.dispatchEvent( new Event( 'change', { bubbles: true } ) );
};
const submit = ( id ) =>
	$( `#${ id }` ).dispatchEvent(
		new Event( 'submit', { bubbles: true, cancelable: true } )
	);
const flush = () => new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

beforeEach( () => {
	jest.resetModules();
	apiFetch = require( '@wordpress/api-fetch' );
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );
	document.body.innerHTML =
		form( 'multi', multiselect ) +
		form( 'single', hidden ) +
		form( 'plain', '' );
	require( '../frontend.js' );
} );

afterEach( () => {
	console.error.mockRestore();
} );

it( 'asks for a feed before sending a checked weekly update', () => {
	submit( 'multi' );

	expect( apiFetch ).not.toHaveBeenCalled();
	expect( $( '#multi .fair-audience-mailing-message' ).textContent ).toMatch(
		/at least one event feed/
	);
} );

it( 'keeps each form on the page separate', async () => {
	apiFetch.mockResolvedValue( { status: 'pending', message: '' } );
	check( '#multi [value="5"]' );
	check( '#multi [value="3"]' );
	check( '#single [name="mailing_weekly"]' );

	submit( 'multi' );
	submit( 'single' );
	submit( 'plain' );
	await flush();

	const sent = apiFetch.mock.calls.map( ( [ call ] ) => call.data );
	expect( sent[ 0 ] ).toMatchObject( {
		weekly_config: 'multi-config',
		weekly_summary: true,
		weekly_feed_ids: [ 3, 5 ],
	} );
	expect( sent[ 1 ] ).toMatchObject( {
		weekly_config: 'hidden-config',
		weekly_summary: true,
	} );
	expect( sent[ 1 ] ).not.toHaveProperty( 'weekly_feed_ids' );
	expect( sent[ 2 ] ).not.toHaveProperty( 'weekly_config' );
	expect( sent[ 2 ] ).not.toHaveProperty( 'weekly_summary' );
} );

it( 'sends once while a signup is running', async () => {
	let finish;
	apiFetch.mockReturnValue(
		new Promise( ( resolve ) => {
			finish = resolve;
		} )
	);

	submit( 'single' );
	submit( 'single' );
	expect( apiFetch ).toHaveBeenCalledTimes( 1 );

	finish( { status: 'pending', message: '' } );
	await flush();
	submit( 'single' );
	expect( apiFetch ).toHaveBeenCalledTimes( 2 );
} );

it( 'shows the server message and keeps the choice when only a link is sent', async () => {
	apiFetch.mockResolvedValue( {
		status: 'manage_link_sent',
		message: 'We sent it a link.',
	} );
	check( '#multi [value="3"]' );

	submit( 'multi' );
	await flush();

	expect( $( '#multi .fair-audience-mailing-message' ).textContent ).toBe(
		'We sent it a link.'
	);
	expect( $( '#multi [value="3"]' ).checked ).toBe( true );
} );

it( 'keeps the input after an error and resets the state after a new signup', async () => {
	apiFetch.mockRejectedValueOnce( {
		message: 'One of the chosen event feeds is not available.',
	} );
	check( '#multi [value="3"]' );

	submit( 'multi' );
	await flush();
	expect( $( '#multi .fair-audience-mailing-message' ).textContent ).toBe(
		'One of the chosen event feeds is not available.'
	);
	expect( $( '#multi [value="3"]' ).checked ).toBe( true );

	apiFetch.mockResolvedValueOnce( { status: 'pending', message: '' } );
	submit( 'multi' );
	await flush();
	expect( $( '#multi .fair-audience-mailing-message' ).textContent ).toBe(
		'Check your inbox'
	);
	expect( $( '#multi [value="3"]' ).checked ).toBe( false );

	submit( 'multi' );
	expect( apiFetch ).toHaveBeenCalledTimes( 2 );
} );
