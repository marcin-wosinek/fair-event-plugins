/**
 * @jest-environment jsdom
 *
 * Covers frontend.js's viewer-context hydration (#1300): the cache-safe
 * baseline markup is patched in place for the actual viewer after load,
 * regardless of who the page happened to be rendered for. fair-events-shared
 * and @wordpress/api-fetch are mocked so these tests exercise only
 * frontend.js's own DOM-patching logic, not a real fetch or the shared
 * helpers' own behavior (covered by their own unit tests).
 */
import apiFetch from '@wordpress/api-fetch';
import { wireNotYouButton } from 'fair-events-shared';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );
jest.mock( 'fair-events-shared', () => ( {
	showMessage: jest.fn(),
	onDomReady: ( cb ) => {
		global.__fairEventsSignupInitialize = cb;
	},
	initiatePayment: jest.fn( () => Promise.resolve( {} ) ),
	pollPaymentStatus: jest.fn(),
	computeTicketTotal: jest.fn( () => 0 ),
	formatMoney: jest.fn( ( amount ) => String( amount ) ),
	collectQuestionAnswers: jest.fn( () => ( {} ) ),
	validateQuestions: jest.fn( () => null ),
	setupQuestionnaire: jest.fn(),
	extractErrorMessage: jest.fn( ( _error, fallback ) => fallback ),
	setButtonLoading: jest.fn( () => jest.fn() ),
	wireNotYouButton: jest.fn(),
} ) );

// The module registers its DOM-ready callback (captured by the onDomReady
// mock above) once, at import time — reused across every test below.
require( '../frontend.js' );
const initialize = global.__fairEventsSignupInitialize;

function buildBlock( { eventDateId = 42 } = {} ) {
	document.body.innerHTML = `
		<div class="fair-events-get-tickets" data-event-date-id="${ eventDateId }" data-show-ticket-price="1" data-show-option-prices="1" data-currency="EUR">
			<form class="fair-events-get-tickets-form" data-event-date-id="${ eventDateId }" data-min-activities="0" data-currency="EUR">
				<div class="form-row">
					<fieldset class="fair-events-ticket-fieldset">
						<legend>Choose ticket type</legend>
						<label class="fair-events-ticket-option">
							<input type="radio" name="ticket_type_id" value="1" checked />
							General
						</label>
					</fieldset>
				</div>
				<div class="form-row">
					<label>Your Name</label>
					<input type="text" name="name" />
				</div>
				<div class="form-row">
					<label>Your Email</label>
					<input type="email" name="email" />
				</div>
				<div class="form-row form-submit">
					<button type="submit">Get Tickets</button>
				</div>
			</form>
			<div class="message-container"></div>
		</div>
	`;
	return document.querySelector( '.fair-events-get-tickets' );
}

function noopResponse() {
	return {
		viewer_resolved: false,
		suppress_form: false,
		ticket_type_fieldset_html: null,
		ticket_options_fieldset_html: null,
		before_form_html: null,
		before_submit_html: null,
		after_form_html: null,
		occurrences_signed_up: [],
		prefill_name: '',
		prefill_email: '',
	};
}

beforeEach( () => {
	apiFetch.mockReset();
	wireNotYouButton.mockClear();
} );

describe( 'Event Signup frontend.js — viewer-context hydration', () => {
	test( 'fetches viewer-context with the event date and display flags, disabling submit until it resolves', async () => {
		const block = buildBlock( { eventDateId: 42 } );
		const submitButton = block.querySelector( 'button[type="submit"]' );
		let resolveFetch;
		apiFetch.mockReturnValue(
			new Promise( ( resolve ) => {
				resolveFetch = resolve;
			} )
		);

		initialize();

		expect( submitButton.disabled ).toBe( true );
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		const { path } = apiFetch.mock.calls[ 0 ][ 0 ];
		expect( path ).toContain(
			'/fair-events/v1/get-tickets/viewer-context'
		);
		expect( path ).toContain( 'event_date_id=42' );
		expect( path ).toContain( 'show_ticket_price=1' );
		expect( path ).toContain( 'show_option_prices=1' );

		resolveFetch( noopResponse() );
		await Promise.resolve();
		await Promise.resolve();

		expect( submitButton.disabled ).toBe( false );
	} );

	test( 'anonymous (viewer_resolved: false) response leaves the baseline markup untouched', async () => {
		const block = buildBlock();
		const nameField = block.querySelector( 'input[name="name"]' );
		apiFetch.mockResolvedValue( noopResponse() );

		initialize();
		await Promise.resolve();
		await Promise.resolve();

		expect( nameField.value ).toBe( '' );
		expect(
			block.querySelector( '.fair-events-get-tickets-viewer-slot' )
		).toBeNull();
		expect(
			block.querySelector( '.fair-events-get-tickets-form' )
		).not.toBeNull();
	} );

	test( 'a recognised viewer: patches the ticket-type fieldset, prefill, and render-slot fragments', async () => {
		const block = buildBlock();
		const form = block.querySelector( '.fair-events-get-tickets-form' );

		apiFetch.mockResolvedValue( {
			viewer_resolved: true,
			suppress_form: false,
			ticket_type_fieldset_html:
				'<div class="form-row"><fieldset class="fair-events-ticket-fieldset">' +
				'<legend>Choose ticket type</legend>' +
				'<label class="fair-events-ticket-option"><input type="radio" name="ticket_type_id" value="2" data-recurrence-scope="single_instance" checked /> Member</label>' +
				'</fieldset></div>',
			ticket_options_fieldset_html: null,
			before_form_html:
				'<p class="fair-events-not-you-marker">not you</p>',
			before_submit_html:
				'<p class="fair-events-get-tickets-discount-note">10% off</p>',
			after_form_html: '<div class="fair-events-add-activities"></div>',
			occurrences_signed_up: [],
			prefill_name: 'Ada Lovelace',
			prefill_email: 'ada@example.com',
		} );

		initialize();
		await Promise.resolve();
		await Promise.resolve();

		// Fieldset swapped to the personalized markup.
		expect(
			form.querySelector( 'input[name="ticket_type_id"]' ).value
		).toBe( '2' );
		expect(
			form.querySelector( '.fair-events-ticket-option' ).textContent
		).toContain( 'Member' );

		// Prefill applied.
		expect( form.querySelector( 'input[name="name"]' ).value ).toBe(
			'Ada Lovelace'
		);
		expect( form.querySelector( 'input[name="email"]' ).value ).toBe(
			'ada@example.com'
		);

		// Render-slot fragments injected: before_form at the top, before_submit
		// just ahead of the submit row, after_form at the end.
		expect(
			form.querySelector( '.fair-events-not-you-marker' )
		).not.toBeNull();
		expect(
			form.querySelector( '.fair-events-get-tickets-discount-note' )
		).not.toBeNull();
		expect(
			form.querySelector( '.fair-events-add-activities' )
		).not.toBeNull();

		const submitRow = form.querySelector( '.form-submit' );
		const discountSlot = form
			.querySelector( '.fair-events-get-tickets-discount-note' )
			.closest( '.fair-events-get-tickets-viewer-slot' );
		expect( discountSlot.nextElementSibling ).toBe( submitRow );

		// The swapped-in radio was re-wired: changing it must not throw, and
		// the submit gate recomputes without error.
		const submitButton = form.querySelector( 'button[type="submit"]' );
		form.querySelector( 'input[name="ticket_type_id"]' ).dispatchEvent(
			new window.Event( 'change', { bubbles: true } )
		);
		expect( submitButton.disabled ).toBe( false );
	} );

	test( 'marks a signed-up occurrence in the single-occurrence dropdown', async () => {
		const block = buildBlock();
		const form = block.querySelector( '.fair-events-get-tickets-form' );
		const select = document.createElement( 'select' );
		select.name = 'event_date_id_single';
		const option = document.createElement( 'option' );
		option.value = '99';
		option.textContent = 'Sat, 1 Jan';
		select.appendChild( option );
		form.insertBefore( select, form.querySelector( '.form-submit' ) );

		apiFetch.mockResolvedValue( {
			...noopResponse(),
			viewer_resolved: true,
			occurrences_signed_up: [ 99 ],
		} );

		initialize();
		await Promise.resolve();
		await Promise.resolve();

		expect( option.textContent ).toContain( 'already signed up' );
	} );

	test( 'suppress_form: true swaps the <form> for the companion wrapper', async () => {
		const block = buildBlock();

		apiFetch.mockResolvedValue( {
			...noopResponse(),
			viewer_resolved: true,
			suppress_form: true,
			before_form_html:
				'<div class="fair-events-signed-up-card">You are signed up</div>',
			after_form_html: '',
		} );

		initialize();
		await Promise.resolve();
		await Promise.resolve();

		expect(
			block.querySelector( '.fair-events-get-tickets-form' )
		).toBeNull();
		const companion = block.querySelector(
			'.fair-events-get-tickets-companion'
		);
		expect( companion ).not.toBeNull();
		expect(
			companion.querySelector( '.fair-events-signed-up-card' )
		).not.toBeNull();
	} );

	test( 're-enables the submit button after a timeout even if the fetch never resolves', () => {
		jest.useFakeTimers();
		const block = buildBlock();
		const submitButton = block.querySelector( 'button[type="submit"]' );
		apiFetch.mockReturnValue( new Promise( () => {} ) );

		initialize();
		expect( submitButton.disabled ).toBe( true );

		jest.advanceTimersByTime( 3000 );

		expect( submitButton.disabled ).toBe( false );
		jest.useRealTimers();
	} );

	test( 'a block with no data-event-date-id is left alone (no fetch)', () => {
		document.body.innerHTML = '<div class="fair-events-get-tickets"></div>';

		initialize();

		expect( apiFetch ).not.toHaveBeenCalled();
	} );
} );
