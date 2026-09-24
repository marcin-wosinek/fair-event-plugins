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
import {
	initiatePayment,
	pollPaymentStatus,
	showMessage,
	wireNotYouButton,
} from 'fair-events-shared';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );
jest.mock( 'fair-events-shared', () => ( {
	showMessage: jest.fn(),
	onDomReady: ( cb ) => {
		global.__fairEventsSignupInitialize = cb;
	},
	initiatePayment: jest.fn( () => Promise.resolve( {} ) ),
	pollPaymentStatus: jest.fn(),
	computeTicketTotal: jest.fn(
		( { unitPrice, count = 1, optionPrices = [] } ) =>
			unitPrice * count +
			optionPrices.reduce( ( sum, price ) => sum + price, 0 )
	),
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
		token_identity_validated: false,
	};
}

beforeEach( () => {
	apiFetch.mockReset();
	wireNotYouButton.mockClear();
	initiatePayment.mockClear();
	pollPaymentStatus.mockClear();
	showMessage.mockClear();
} );

describe( 'Event Signup frontend.js — processing payment recovery', () => {
	function buildProcessingCard() {
		document.body.innerHTML = `
			<div class="fair-events-get-tickets-callback fair-events-get-tickets-callback-processing" data-transaction-id="77" data-token="owner-token">
				<p class="fair-events-get-tickets-callback-status">Checking</p>
				<div class="fair-events-get-tickets-callback-status-retry" style="display:none"><button class="fair-events-get-tickets-callback-status-retry-button">Check payment status again</button></div>
				<a href="#" class="fair-events-get-tickets-callback-cancel-link">Cancel and start over</a>
				<div class="fair-events-get-tickets-callback-message"></div>
			</div>`;
		initialize();
		return document.querySelector(
			'.fair-events-get-tickets-callback-processing'
		);
	}

	test( 'keeps cancellation usable while polling and offers retry after exhaustion', () => {
		const card = buildProcessingCard();
		expect( pollPaymentStatus ).toHaveBeenCalledTimes( 1 );
		expect(
			card.querySelector(
				'.fair-events-get-tickets-callback-cancel-link'
			)
		).not.toBeNull();

		pollPaymentStatus.mock.calls[ 0 ][ 0 ].onExhausted();
		const retry = card.querySelector(
			'.fair-events-get-tickets-callback-status-retry-button'
		);
		expect( retry.parentElement.style.display ).toBe( '' );
		retry.click();
		expect( pollPaymentStatus ).toHaveBeenCalledTimes( 2 );
	} );

	test( 'offers status retry after a request error without calling it a failed payment', () => {
		const card = buildProcessingCard();
		pollPaymentStatus.mock.calls[ 0 ][ 0 ].onError();
		expect(
			card.querySelector( '.fair-events-get-tickets-callback-status' )
				.textContent
		).toContain( 'could not check your payment status' );
		expect(
			card.querySelector(
				'.fair-events-get-tickets-callback-status-retry-button'
			).disabled
		).toBe( false );
	} );

	test( 'disables duplicate cancellation and restores the action after failure', async () => {
		let rejectCancel;
		apiFetch.mockReturnValue(
			new Promise( ( _resolve, reject ) => {
				rejectCancel = reject;
			} )
		);
		const card = buildProcessingCard();
		const cancel = card.querySelector(
			'.fair-events-get-tickets-callback-cancel-link'
		);
		cancel.click();
		cancel.click();
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		expect( cancel.textContent ).toBe( 'Cancelling…' );
		expect( cancel.getAttribute( 'aria-disabled' ) ).toBe( 'true' );

		rejectCancel( new Error( 'Try later' ) );
		await Promise.resolve();
		await Promise.resolve();
		expect( cancel.textContent ).toBe( 'Cancel and start over' );
		expect( cancel.hasAttribute( 'aria-disabled' ) ).toBe( false );
		expect( showMessage ).toHaveBeenCalled();
	} );

	test( 'renders confirmation when payment wins the cancellation race', async () => {
		apiFetch.mockResolvedValue( {
			state: 'confirmed',
			amount: 12,
			currency: 'EUR',
		} );
		const card = buildProcessingCard();
		card.querySelector(
			'.fair-events-get-tickets-callback-cancel-link'
		).click();
		await Promise.resolve();
		await Promise.resolve();
		expect( card.classList ).toContain(
			'fair-events-get-tickets-callback-confirmed'
		);
		expect( card.textContent ).toContain( 'Payment confirmed' );
	} );
} );

describe( 'Event Signup frontend.js — ticket extension rules (#1521)', () => {
	function buildRulesBlock() {
		const block = buildBlock();
		const form = block.querySelector( 'form' );
		form.querySelector( '.fair-events-ticket-fieldset' ).innerHTML = `
			<label><input type="radio" name="ticket_type_id" value="1" data-activities-enabled="1" data-min-activities="1" data-max-activities="2" data-recurrence-scope="single_instance" checked>Pick activities</label>
			<label><input type="radio" name="ticket_type_id" value="2" data-activities-enabled="0" data-min-activities="0" data-max-activities="" data-recurrence-scope="single_instance">Full pass</label>
			<label><input type="radio" name="ticket_type_id" value="3" data-activities-enabled="1" data-min-activities="0" data-max-activities="1" data-recurrence-scope="single_instance">One activity</label>`;
		form.querySelector( '.form-submit' ).insertAdjacentHTML(
			'beforebegin',
			`<div class="form-row"><fieldset class="fair-events-ticket-options">
				<p class="fair-events-ticket-options-min-hint"></p>
				<p class="fair-events-ticket-options-max-hint"></p>
				<p class="fair-events-ticket-options-unavailable"></p>
				<label><input type="checkbox" name="ticket_option_ids[]" value="10" data-option-price="5"></label>
				<label><input type="checkbox" name="ticket_option_ids[]" value="11" data-option-price="7"></label>
				<label><input type="checkbox" name="ticket_option_ids[]" value="12" data-option-price="9"></label>
			</fieldset></div>`
		);
		apiFetch.mockResolvedValue( noopResponse() );
		initialize();
		return { block, form };
	}

	test( 'switching to a disabled type hides and clears extensions', () => {
		const { form } = buildRulesBlock();
		const choices = form.querySelectorAll(
			'input[name="ticket_option_ids[]"]'
		);
		choices[ 0 ].click();
		form.querySelector( 'input[value="2"]' ).click();
		expect( choices[ 0 ].checked ).toBe( false );
		expect(
			form
				.querySelector( '.fair-events-ticket-options' )
				.closest( '.form-row' ).style.display
		).toBe( 'none' );
	} );

	test( 'reaching the maximum disables unchecked extensions with an explanation', () => {
		const { form } = buildRulesBlock();
		const choices = form.querySelectorAll(
			'input[name="ticket_option_ids[]"]'
		);
		choices[ 0 ].click();
		choices[ 1 ].click();
		expect( choices[ 2 ].disabled ).toBe( true );
		expect(
			form.querySelector( '.fair-events-ticket-options-max-hint' )
				.textContent
		).toBe( 'You can select at most 2 extensions.' );
	} );

	test( 'switching to a lower maximum keeps the earliest selection', () => {
		const { form } = buildRulesBlock();
		const choices = form.querySelectorAll(
			'input[name="ticket_option_ids[]"]'
		);
		choices[ 0 ].click();
		choices[ 1 ].click();
		form.querySelector( 'input[value="3"]' ).click();
		expect( choices[ 0 ].checked ).toBe( true );
		expect( choices[ 1 ].checked ).toBe( false );
	} );
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

	test( 'adds a page participant token to viewer-context hydration', () => {
		window.history.replaceState(
			{},
			'',
			'/?participant_token=signed-token'
		);
		buildBlock();
		apiFetch.mockResolvedValue( noopResponse() );

		initialize();

		expect( apiFetch.mock.calls[ 0 ][ 0 ].path ).toContain(
			'participant_token=signed-token'
		);
		window.history.replaceState( {}, '', '/' );
	} );

	test( 'carries a server-validated page token into signup submission', async () => {
		window.history.replaceState(
			{},
			'',
			'/?participant_token=signed-token'
		);
		const block = buildBlock();
		apiFetch.mockResolvedValue( {
			...noopResponse(),
			viewer_resolved: true,
			token_identity_validated: true,
		} );

		initialize();
		await Promise.resolve();
		await Promise.resolve();
		block.querySelector( 'input[name="name"]' ).value = 'Ada';
		block.querySelector( 'input[name="email"]' ).value = 'ada@example.test';
		block.querySelector( 'form' ).dispatchEvent(
			new window.Event( 'submit', {
				bubbles: true,
				cancelable: true,
			} )
		);

		expect(
			initiatePayment.mock.calls[ 0 ][ 0 ].data.participant_token
		).toBe( 'signed-token' );
		window.history.replaceState( {}, '', '/' );
	} );

	test( 'does not trust an unresolved page token for signup submission', async () => {
		window.history.replaceState(
			{},
			'',
			'/?participant_token=invalid-token'
		);
		const block = buildBlock();
		apiFetch.mockResolvedValue( noopResponse() );

		initialize();
		await Promise.resolve();
		await Promise.resolve();
		block.querySelector( 'input[name="name"]' ).value = 'Ada';
		block.querySelector( 'input[name="email"]' ).value = 'ada@example.test';
		block.querySelector( 'form' ).dispatchEvent(
			new window.Event( 'submit', {
				bubbles: true,
				cancelable: true,
			} )
		);

		expect(
			initiatePayment.mock.calls[ 0 ][ 0 ].data.participant_token
		).toBeUndefined();
		window.history.replaceState( {}, '', '/' );
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

	test( 'wires start fresh after hydration swaps in a signed-up companion card', async () => {
		const block = buildBlock();

		apiFetch.mockResolvedValue( {
			...noopResponse(),
			viewer_resolved: true,
			suppress_form: true,
			before_form_html:
				'<div class="fair-events-signed-up-card"><button class="fair-events-not-you-button">Not you? Start fresh</button></div>',
		} );

		initialize();
		await Promise.resolve();
		await Promise.resolve();

		const button = block.querySelector( '.fair-events-not-you-button' );
		expect( wireNotYouButton ).toHaveBeenCalledWith( button );
	} );

	test( 'wires a personalized registered-card selector to its public occurrence URL', async () => {
		const block = buildBlock();
		let destination = '';
		const click = jest
			.spyOn( window.HTMLAnchorElement.prototype, 'click' )
			.mockImplementation( function () {
				destination = this.href;
			} );

		apiFetch.mockResolvedValue( {
			...noopResponse(),
			viewer_resolved: true,
			suppress_form: true,
			before_form_html:
				'<div class="fair-events-signed-up-card"><select class="fair-events-occurrence-select fair-events-signed-up-occurrence-select"><option data-event-url="https://example.test/events/series/?event_date=2036-01-08">8 Jan</option></select></div>',
		} );

		initialize();
		await Promise.resolve();
		await Promise.resolve();

		block
			.querySelector( '.fair-events-signed-up-occurrence-select' )
			.dispatchEvent( new window.Event( 'change', { bubbles: true } ) );

		expect( destination ).toBe(
			'https://example.test/events/series/?event_date=2036-01-08'
		);
		click.mockRestore();
	} );

	test( 'does not add navigation behavior to the normal signup occurrence selector', async () => {
		const block = buildBlock();
		const form = block.querySelector( '.fair-events-get-tickets-form' );
		form.insertAdjacentHTML(
			'afterbegin',
			'<select name="event_date_id_single" class="fair-events-occurrence-select"><option data-event-url="https://example.test/wrong">8 Jan</option></select>'
		);
		const click = jest
			.spyOn( window.HTMLAnchorElement.prototype, 'click' )
			.mockImplementation( () => {} );
		apiFetch.mockResolvedValue( noopResponse() );

		initialize();
		await Promise.resolve();
		await Promise.resolve();
		form.querySelector(
			'select[name="event_date_id_single"]'
		).dispatchEvent( new window.Event( 'change', { bubbles: true } ) );

		expect( click ).not.toHaveBeenCalled();
		click.mockRestore();
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

describe( 'Event Signup frontend.js — checkout total (#1666)', () => {
	function buildTotalBlock( {
		ticketTypes = '<label><input type="radio" name="ticket_type_id" value="1" data-ticket-price="15.00" data-recurrence-scope="single_instance" checked>General</label>',
		extraRows = '',
		decimalPoint = '.',
		thousandsSep = ',',
	} = {} ) {
		document.body.innerHTML = `
			<div class="fair-events-get-tickets" data-event-date-id="42" data-currency="EUR">
				<form class="fair-events-get-tickets-form" data-event-date-id="42" data-min-activities="0" data-currency="EUR">
					<div class="form-row"><fieldset class="fair-events-ticket-fieldset">${ ticketTypes }</fieldset></div>
					${ extraRows }
					<div class="form-row fair-events-quantity-row">
						<input type="number" name="quantity" value="1" min="1" max="10" />
					</div>
					<div class="form-row fair-events-signup-checkout-total" data-amount="0.00" data-currency="EUR" data-decimal-point="${ decimalPoint }" data-thousands-sep="${ thousandsSep }">
						<span class="fair-events-signup-checkout-total-label">Total</span>
						<span class="fair-events-signup-checkout-total-amount">0.00 EUR</span>
					</div>
					<div class="form-row form-submit"><button type="submit">Get Tickets</button></div>
				</form>
				<div class="message-container"></div>
			</div>`;
		return document.querySelector( 'form' );
	}

	function readTotal( form ) {
		const total = form.querySelector(
			'.fair-events-signup-checkout-total'
		);
		return {
			amount: total.dataset.amount,
			currency: total.dataset.currency,
			text: total.querySelector(
				'.fair-events-signup-checkout-total-amount'
			).textContent,
		};
	}

	function change( input ) {
		input.dispatchEvent( new window.Event( 'change', { bubbles: true } ) );
	}

	beforeEach( () => {
		apiFetch.mockResolvedValue( noopResponse() );
	} );

	test( 'shows the paid default selection on load', () => {
		const form = buildTotalBlock();
		initialize();
		expect( readTotal( form ) ).toEqual( {
			amount: '15.00',
			currency: 'EUR',
			text: '15.00 EUR',
		} );
	} );

	test( 'shows an explicit zero for a free signup with no ticket types', () => {
		const form = buildTotalBlock( { ticketTypes: '' } );
		initialize();
		expect( readTotal( form ) ).toMatchObject( {
			amount: '0.00',
			text: '0.00 EUR',
		} );
	} );

	test( 'follows the ticket type and quantity', () => {
		const form = buildTotalBlock( {
			ticketTypes:
				'<label><input type="radio" name="ticket_type_id" value="1" data-ticket-price="15.00" data-recurrence-scope="single_instance" checked>General</label>' +
				'<label><input type="radio" name="ticket_type_id" value="2" data-ticket-price="40.00" data-recurrence-scope="whole_series">Pass</label>',
		} );
		initialize();

		const quantity = form.querySelector( 'input[name="quantity"]' );
		quantity.value = '3';
		quantity.dispatchEvent(
			new window.Event( 'input', { bubbles: true } )
		);
		expect( readTotal( form ).amount ).toBe( '45.00' );

		const pass = form.querySelector( 'input[value="2"]' );
		pass.checked = true;
		change( pass );
		expect( readTotal( form ) ).toMatchObject( {
			amount: '120.00',
			text: '120.00 EUR',
		} );
	} );

	test( 'multiplies a multiple-instances price by the checked occurrences', () => {
		const form = buildTotalBlock( {
			ticketTypes:
				'<label><input type="radio" name="ticket_type_id" value="3" data-ticket-price="10.00" data-recurrence-scope="multiple_instances" data-min-instances="0" checked>Pick</label>',
			extraRows: `<div class="form-row fair-events-instance-picker">
				<input type="checkbox" name="event_date_ids[]" value="51" />
				<input type="checkbox" name="event_date_ids[]" value="52" />
				<p class="fair-events-instance-picker-hint"></p>
			</div>`,
		} );
		initialize();
		expect( readTotal( form ).amount ).toBe( '0.00' );

		const boxes = form.querySelectorAll( 'input[name="event_date_ids[]"]' );
		boxes[ 0 ].checked = true;
		change( boxes[ 0 ] );
		boxes[ 1 ].checked = true;
		change( boxes[ 1 ] );
		expect( readTotal( form ) ).toMatchObject( {
			amount: '20.00',
			text: '20.00 EUR',
		} );
	} );

	test( 'adds activity prices to the ticket price', () => {
		const form = buildTotalBlock( {
			extraRows: `<div class="form-row"><fieldset class="fair-events-ticket-options">
				<label><input type="checkbox" name="ticket_option_ids[]" value="10" data-option-price="5.50"></label>
				<label><input type="checkbox" name="ticket_option_ids[]" value="11" data-option-price="7.25"></label>
			</fieldset></div>`,
		} );
		initialize();

		form.querySelectorAll( 'input[name="ticket_option_ids[]"]' ).forEach(
			( box ) => {
				box.checked = true;
				change( box );
			}
		);
		expect( readTotal( form ) ).toMatchObject( {
			amount: '27.75',
			text: '27.75 EUR',
		} );
	} );

	test( 'floors a total reduced below zero at an explicit zero', () => {
		const form = buildTotalBlock( {
			ticketTypes:
				'<label><input type="radio" name="ticket_type_id" value="1" data-ticket-price="0.00" data-recurrence-scope="single_instance" checked>Free</label>',
			extraRows: `<div class="form-row"><fieldset class="fair-events-ticket-options">
				<label><input type="checkbox" name="ticket_option_ids[]" value="10" data-option-price="-5.00"></label>
			</fieldset></div>`,
		} );
		initialize();
		const box = form.querySelector( 'input[name="ticket_option_ids[]"]' );
		box.checked = true;
		change( box );
		expect( readTotal( form ) ).toMatchObject( {
			amount: '0.00',
			text: '0.00 EUR',
		} );
	} );

	test( 'applies a hydrated discount and keeps the note ahead of the total', async () => {
		const form = buildTotalBlock();
		apiFetch.mockResolvedValue( {
			...noopResponse(),
			viewer_resolved: true,
			ticket_type_fieldset_html:
				'<div class="form-row"><fieldset class="fair-events-ticket-fieldset">' +
				'<label><input type="radio" name="ticket_type_id" value="1" data-ticket-price="12.00" data-recurrence-scope="single_instance" checked>General</label>' +
				'</fieldset></div>',
			before_submit_html:
				'<p class="fair-audience-signup-discount-note">20% off</p>',
		} );

		initialize();
		await Promise.resolve();
		await Promise.resolve();

		expect( readTotal( form ) ).toMatchObject( {
			amount: '12.00',
			text: '12.00 EUR',
		} );
		const total = form.querySelector(
			'.fair-events-signup-checkout-total'
		);
		expect( total.nextElementSibling ).toBe(
			form.querySelector( '.form-submit' )
		);
		expect( total.previousElementSibling.textContent ).toContain(
			'20% off'
		);
	} );

	test( 'localizes the visible amount while data-amount stays a plain decimal', () => {
		const form = buildTotalBlock( {
			ticketTypes:
				'<label><input type="radio" name="ticket_type_id" value="1" data-ticket-price="1234.50" data-recurrence-scope="single_instance" checked>VIP</label>',
			decimalPoint: ',',
			thousandsSep: '.',
		} );
		initialize();
		expect( readTotal( form ) ).toMatchObject( {
			amount: '1234.50',
			text: '1.234,50 EUR',
		} );
	} );
} );
