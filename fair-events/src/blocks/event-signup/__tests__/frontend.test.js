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
	applyQuestionAnswers,
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
	applyQuestionAnswers: jest.fn(),
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
	applyQuestionAnswers.mockClear();
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

describe( 'Event Signup frontend.js — total follows the submit button (#1730)', () => {
	// Mirrors render.php: the total starts hidden and the button disabled.
	function buildGatedBlock( {
		ticketPrice = '15.00',
		minActivities = '1',
	} = {} ) {
		document.body.innerHTML = `
			<div class="fair-events-get-tickets" data-event-date-id="42" data-currency="EUR">
				<form class="fair-events-get-tickets-form" data-event-date-id="42" data-min-activities="0" data-currency="EUR">
					<div class="form-row"><fieldset class="fair-events-ticket-fieldset">
						<label><input type="radio" name="ticket_type_id" value="1" data-ticket-price="${ ticketPrice }" data-activities-enabled="1" data-min-activities="${ minActivities }" data-max-activities="" data-recurrence-scope="single_instance" checked>General</label>
					</fieldset></div>
					<div class="form-row"><fieldset class="fair-events-ticket-options">
						<label><input type="checkbox" name="ticket_option_ids[]" value="10" data-option-price="5.50"></label>
					</fieldset></div>
					<div class="form-row"><input type="text" name="name" value="Buyer" required /></div>
					<div class="form-row"><input type="email" name="email" value="buyer@example.test" required /></div>
					<div class="form-row fair-events-signup-checkout-total" data-amount="${ ticketPrice }" data-currency="EUR" hidden>
						<span class="fair-events-signup-checkout-total-label">Total</span>
						<span class="fair-events-signup-checkout-total-amount">${ ticketPrice } EUR</span>
					</div>
					<div class="form-row form-submit"><button type="submit" class="is-disabled" disabled>Get Tickets</button></div>
				</form>
				<div class="message-container"></div>
			</div>`;
		return document.querySelector( 'form' );
	}

	function readState( form ) {
		const total = form.querySelector(
			'.fair-events-signup-checkout-total'
		);
		const button = form.querySelector( 'button[type="submit"]' );
		return {
			totalHidden: total.hidden,
			buttonDisabled: button.disabled,
			buttonMarked: button.classList.contains( 'is-disabled' ),
			label: button.textContent,
			amount: total.dataset.amount,
			currency: total.dataset.currency,
			text: total.querySelector(
				'.fair-events-signup-checkout-total-amount'
			).textContent,
		};
	}

	function setActivity( form, checked ) {
		const box = form.querySelector( 'input[name="ticket_option_ids[]"]' );
		box.checked = checked;
		box.dispatchEvent( new window.Event( 'change', { bubbles: true } ) );
	}

	const submit = ( form ) =>
		form.dispatchEvent(
			new window.Event( 'submit', { cancelable: true } )
		);
	const settle = () => new Promise( ( resolve ) => setTimeout( resolve ) );

	async function hydrated( options ) {
		const form = buildGatedBlock( options );
		apiFetch.mockResolvedValue( noopResponse() );
		initialize();
		await settle();
		return form;
	}

	test( 'keeps the total hidden and the button disabled while viewer context loads', async () => {
		const form = buildGatedBlock( { minActivities: '0' } );
		let resolveFetch;
		apiFetch.mockReturnValue(
			new Promise( ( resolve ) => {
				resolveFetch = resolve;
			} )
		);

		initialize();
		expect( readState( form ) ).toMatchObject( {
			totalHidden: true,
			buttonDisabled: true,
			buttonMarked: true,
			amount: '15.00',
			currency: 'EUR',
		} );

		// A selection made while loading keeps the hidden amount current but
		// does not release the gate.
		setActivity( form, true );
		expect( readState( form ) ).toMatchObject( {
			totalHidden: true,
			buttonDisabled: true,
			amount: '20.50',
			text: '20.50 EUR',
		} );

		resolveFetch( noopResponse() );
		await settle();
		expect( readState( form ) ).toMatchObject( {
			totalHidden: false,
			buttonDisabled: false,
			buttonMarked: false,
			amount: '20.50',
		} );
	} );

	test( 'reveals the total when a viewer-context error releases the gate', async () => {
		const form = buildGatedBlock( { minActivities: '0' } );
		const consoleError = jest
			.spyOn( console, 'error' )
			.mockImplementation( () => {} );
		apiFetch.mockRejectedValue( new Error( 'offline' ) );

		initialize();
		await settle();

		expect( readState( form ) ).toMatchObject( {
			totalHidden: false,
			buttonDisabled: false,
			amount: '15.00',
		} );
		consoleError.mockRestore();
	} );

	test( 'reveals the total when the viewer-context timeout releases the gate', () => {
		jest.useFakeTimers();
		const form = buildGatedBlock( { minActivities: '0' } );
		apiFetch.mockReturnValue( new Promise( () => {} ) );

		initialize();
		expect( readState( form ).totalHidden ).toBe( true );

		jest.advanceTimersByTime( 3000 );
		expect( readState( form ) ).toMatchObject( {
			totalHidden: false,
			buttonDisabled: false,
		} );
		jest.useRealTimers();
	} );

	test( 'keeps an unmet minimum hidden after loading, with accurate attributes', async () => {
		const form = await hydrated();
		expect( readState( form ) ).toMatchObject( {
			totalHidden: true,
			buttonDisabled: true,
			amount: '15.00',
			currency: 'EUR',
			text: '15.00 EUR',
		} );
	} );

	test( 'shows the total when a selection enables the button and hides it again when one disables it', async () => {
		const form = await hydrated();

		setActivity( form, true );
		expect( readState( form ) ).toMatchObject( {
			totalHidden: false,
			buttonDisabled: false,
			buttonMarked: false,
			amount: '20.50',
			text: '20.50 EUR',
		} );
		expect(
			form.querySelector( '.fair-events-signup-checkout-total' )
				.nextElementSibling
		).toBe( form.querySelector( '.form-submit' ) );

		setActivity( form, false );
		expect( readState( form ) ).toMatchObject( {
			totalHidden: true,
			buttonDisabled: true,
			buttonMarked: true,
			amount: '15.00',
			text: '15.00 EUR',
		} );
	} );

	test( 'shows an explicit zero for an enabled free signup', async () => {
		const form = await hydrated( {
			ticketPrice: '0.00',
			minActivities: '0',
		} );
		expect( readState( form ) ).toMatchObject( {
			totalHidden: false,
			buttonDisabled: false,
			amount: '0.00',
			text: '0.00 EUR',
		} );
	} );

	test( 'hides the total while a purchase is processing and restores both after a failure', async () => {
		const form = await hydrated( { minActivities: '0' } );
		let fail;
		initiatePayment.mockImplementationOnce(
			() =>
				new Promise( ( _resolve, reject ) => {
					fail = reject;
				} )
		);

		submit( form );
		expect( initiatePayment.mock.calls[ 0 ][ 0 ].button ).toBeUndefined();
		expect( readState( form ) ).toMatchObject( {
			totalHidden: true,
			buttonDisabled: true,
			label: 'Processing…',
			amount: '15.00',
		} );

		// A selection change while processing must not release the form.
		setActivity( form, true );
		expect( readState( form ) ).toMatchObject( {
			totalHidden: true,
			buttonDisabled: true,
			amount: '20.50',
		} );

		fail( { code: 'fetch_error' } );
		await settle();
		expect( readState( form ) ).toMatchObject( {
			totalHidden: false,
			buttonDisabled: false,
			label: 'Get Tickets',
			amount: '20.50',
		} );

		submit( form );
		expect( initiatePayment ).toHaveBeenCalledTimes( 2 );
		await settle();
	} );

	test( 'stays in processing while the browser is redirected to checkout', async () => {
		const form = await hydrated( { minActivities: '0' } );
		initiatePayment.mockResolvedValueOnce( {
			checkout_url: 'https://pay.example.test/checkout',
		} );

		submit( form );
		await settle();

		expect( readState( form ) ).toMatchObject( {
			totalHidden: true,
			buttonDisabled: true,
			label: 'Processing…',
		} );
	} );

	test( 'keeps each form on a page independent', async () => {
		const first = buildGatedBlock();
		document.body.insertAdjacentHTML(
			'beforeend',
			document.body.innerHTML
		);
		const second = document.querySelectorAll( 'form' )[ 1 ];
		apiFetch.mockResolvedValue( noopResponse() );
		initialize();
		await settle();

		setActivity( second, true );
		expect( readState( first ).totalHidden ).toBe( true );
		expect( readState( first ).buttonDisabled ).toBe( true );
		expect( readState( second ).totalHidden ).toBe( false );
		expect( readState( second ).buttonDisabled ).toBe( false );
	} );
} );

describe( 'Event Signup frontend.js — activities for each ticket (#1697)', () => {
	function buildPerTicketBlock( { minActivities = '0' } = {} ) {
		document.body.innerHTML = `
			<div class="fair-events-get-tickets" data-event-date-id="42" data-currency="EUR">
				<form class="fair-events-get-tickets-form" data-event-date-id="42" data-min-activities="0" data-currency="EUR">
					<div class="form-row"><fieldset class="fair-events-ticket-fieldset">
						<label><input type="radio" name="ticket_type_id" value="1" data-ticket-price="10.00" data-activities-enabled="1" data-min-activities="${ minActivities }" data-max-activities="" data-recurrence-scope="single_instance" checked>General</label>
					</fieldset></div>
					<div class="form-row"><fieldset class="fair-events-ticket-options">
						<legend>Select activities</legend>
						<p class="fair-events-ticket-options-min-hint"></p>
						<p class="fair-events-ticket-options-max-hint"></p>
						<p class="fair-events-ticket-options-unavailable"></p>
						<label for="f-opt-10"><input type="checkbox" id="f-opt-10" name="ticket_option_ids[]" value="10" data-option-price="5"></label>
						<label for="f-opt-11"><input type="checkbox" id="f-opt-11" name="ticket_option_ids[]" value="11" data-option-price="7"></label>
					</fieldset></div>
					<div class="form-row fair-events-quantity-row">
						<input type="number" name="quantity" value="1" min="1" max="10" />
					</div>
					<div class="form-row fair-events-signup-checkout-total" data-amount="0.00" data-currency="EUR">
						<span class="fair-events-signup-checkout-total-amount">0.00 EUR</span>
					</div>
					<div class="form-row"><input type="text" name="name" value="Buyer" required /></div>
					<div class="form-row"><input type="email" name="email" value="buyer@example.test" required /></div>
					<div class="form-row form-submit"><button type="submit">Get Tickets</button></div>
				</form>
				<div class="message-container"></div>
			</div>`;
		apiFetch.mockResolvedValue( noopResponse() );
		initialize();
		return document.querySelector( 'form' );
	}

	function setQuantity( form, value ) {
		const quantity = form.querySelector( 'input[name="quantity"]' );
		quantity.value = String( value );
		quantity.dispatchEvent(
			new window.Event( 'input', { bubbles: true } )
		);
	}

	function fieldsets( form ) {
		return Array.from(
			form.querySelectorAll( '.fair-events-ticket-options' )
		);
	}

	function tick( fieldset, value ) {
		const box = fieldset.querySelector( `input[value="${ value }"]` );
		box.checked = true;
		box.dispatchEvent( new window.Event( 'change', { bubbles: true } ) );
	}

	test( 'keeps the quantity field and one selection for a single ticket', () => {
		const form = buildPerTicketBlock();
		expect(
			form.querySelector( '.fair-events-quantity-row' ).style.display
		).toBe( '' );
		expect( fieldsets( form ) ).toHaveLength( 1 );
		expect( form.querySelector( 'legend' ).textContent ).toBe(
			'Select activities'
		);
	} );

	test( 'shows an empty, labelled selection for each further ticket', () => {
		const form = buildPerTicketBlock();
		tick( fieldsets( form )[ 0 ], 10 );
		setQuantity( form, 3 );

		const all = fieldsets( form );
		expect( all ).toHaveLength( 3 );
		expect(
			all.map( ( f ) => f.querySelector( 'legend' ).textContent )
		).toEqual( [
			'Ticket 1: select activities',
			'Ticket 2: select activities',
			'Ticket 3: select activities',
		] );
		expect( all[ 1 ].querySelectorAll( 'input:checked' ) ).toHaveLength(
			0
		);
		const copyInput = all[ 2 ].querySelector( 'input[value="11"]' );
		expect( copyInput.name ).toBe( 'ticket_activities_2[]' );
		expect(
			all[ 2 ].querySelector( `label[for="${ copyInput.id }"]` )
		).not.toBeNull();

		setQuantity( form, 2 );
		expect( fieldsets( form ) ).toHaveLength( 2 );
		setQuantity( form, 1 );
		expect( fieldsets( form ) ).toHaveLength( 1 );
		expect( form.querySelector( 'legend' ).textContent ).toBe(
			'Select activities'
		);
	} );

	test( 'applies the first ticket’s activities to all tickets only on request', () => {
		const form = buildPerTicketBlock();
		setQuantity( form, 2 );
		tick( fieldsets( form )[ 0 ], 11 );
		expect(
			fieldsets( form )[ 1 ].querySelector( 'input[value="11"]' ).checked
		).toBe( false );

		form.querySelector(
			'.fair-events-ticket-activities-apply-all'
		).click();
		expect(
			fieldsets( form )[ 1 ].querySelector( 'input[value="11"]' ).checked
		).toBe( true );
	} );

	test( 'charges every ticket’s activities and gates each ticket’s minimum', async () => {
		const form = buildPerTicketBlock( { minActivities: '1' } );
		// The gate only opens once viewer-context hydration has settled.
		await new Promise( ( resolve ) => setTimeout( resolve ) );
		setQuantity( form, 2 );
		tick( fieldsets( form )[ 0 ], 10 );
		const submit = form.querySelector( 'button[type="submit"]' );
		expect( submit.disabled ).toBe( true );

		tick( fieldsets( form )[ 1 ], 11 );
		expect( submit.disabled ).toBe( false );
		expect(
			form.querySelector( '.fair-events-signup-checkout-total' ).dataset
				.amount
		).toBe( '32.00' );
	} );

	test( 'submits one selection per ticket', () => {
		const form = buildPerTicketBlock();
		setQuantity( form, 2 );
		tick( fieldsets( form )[ 0 ], 10 );
		tick( fieldsets( form )[ 1 ], 10 );
		tick( fieldsets( form )[ 1 ], 11 );

		form.dispatchEvent(
			new window.Event( 'submit', { cancelable: true } )
		);

		const data = initiatePayment.mock.calls[ 0 ][ 0 ].data;
		expect( data.quantity ).toBe( 2 );
		expect( data.ticket_activities ).toEqual( [ [ 10 ], [ 10, 11 ] ] );
		expect( data.ticket_option_ids ).toBeUndefined();
	} );

	test( 'submits the flat list for a single ticket', () => {
		const form = buildPerTicketBlock();
		tick( fieldsets( form )[ 0 ], 11 );

		form.dispatchEvent(
			new window.Event( 'submit', { cancelable: true } )
		);

		const data = initiatePayment.mock.calls[ 0 ][ 0 ].data;
		expect( data.ticket_option_ids ).toEqual( [ 11 ] );
		expect( data.ticket_activities ).toBeUndefined();
	} );
} );

describe( 'Event Signup frontend.js — idempotent submission (#1534)', () => {
	function buildForm() {
		const block = buildBlock();
		apiFetch.mockReturnValue( Promise.resolve( noopResponse() ) );
		initialize();
		const form = block.querySelector( 'form' );
		form.querySelector( 'input[name="name"]' ).value = 'Ada';
		form.querySelector( 'input[name="email"]' ).value = 'ada@example.test';
		return form;
	}

	const submit = ( form ) =>
		form.dispatchEvent(
			new window.Event( 'submit', { cancelable: true } )
		);
	const sentKey = ( call ) =>
		initiatePayment.mock.calls[ call ][ 0 ].data.idempotency_key;
	const settle = () => new Promise( ( resolve ) => setTimeout( resolve ) );

	test( 'ignores a second submission while the first is in flight', async () => {
		const form = buildForm();
		let finish;
		initiatePayment.mockImplementationOnce(
			() =>
				new Promise( ( resolve ) => {
					finish = resolve;
				} )
		);

		submit( form );
		submit( form );
		expect( initiatePayment ).toHaveBeenCalledTimes( 1 );
		expect( sentKey( 0 ) ).toMatch( /^[a-f0-9]{32}$/ );

		finish( {} );
		await settle();
	} );

	test( 'retries a failed submission with the same key, also after the error was shown', async () => {
		const form = buildForm();
		initiatePayment.mockImplementationOnce( ( { onError } ) => {
			const error = { code: 'fetch_error' };
			onError( 'Failed', error );
			return Promise.reject( error );
		} );

		submit( form );
		await settle();

		// What the real showMessage() leaves behind after an error.
		document.querySelector( '.message-container' ).className =
			'fair-events-get-tickets-message fair-events-get-tickets-message-error';

		submit( form );
		expect( initiatePayment ).toHaveBeenCalledTimes( 2 );
		expect( sentKey( 1 ) ).toBe( sentKey( 0 ) );
		await settle();
	} );

	test( 'starts a new key once the server reports the purchase ended', async () => {
		const form = buildForm();
		initiatePayment.mockImplementationOnce( ( { onError } ) => {
			const error = { code: 'checkout_closed' };
			onError( 'Ended', error );
			return Promise.reject( error );
		} );

		submit( form );
		await settle();
		submit( form );

		expect( initiatePayment ).toHaveBeenCalledTimes( 2 );
		expect( sentKey( 1 ) ).not.toBe( sentKey( 0 ) );
		await settle();
	} );
} );

describe( 'Event Signup frontend.js — resuming from an emailed link (#1701)', () => {
	const settle = () => new Promise( ( resolve ) => setTimeout( resolve ) );
	const RESUME_MARKER =
		'<div hidden data-resume-route="/fair-audience/v1/event-signup/resume"></div>';
	const answers = [ { question_key: 'dietary', answer_value: 'No nuts' } ];

	function buildResumableBlock() {
		const block = buildBlock();
		const form = block.querySelector( 'form' );
		form.querySelector( '.fair-events-ticket-fieldset' ).insertAdjacentHTML(
			'beforeend',
			'<label><input type="radio" name="ticket_type_id" value="2" /> Supporter</label>'
		);
		form.querySelector( '.form-submit' ).insertAdjacentHTML(
			'beforebegin',
			'<div class="form-row"><input type="number" name="quantity" value="1" /></div>' +
				'<div class="form-row"><input type="checkbox" name="mailing_opt_in" value="1" /></div>'
		);
		return block;
	}

	function recognisedByToken( overrides = {} ) {
		return {
			...noopResponse(),
			viewer_resolved: true,
			token_identity_validated: true,
			prefill_name: 'Ada Participant',
			prefill_email: 'ada@example.test',
			before_form_html: RESUME_MARKER,
			...overrides,
		};
	}

	afterEach( () => {
		window.history.replaceState( {}, '', '/' );
	} );

	test( 'fetches the stashed submission once and restores it into the form', async () => {
		window.history.replaceState(
			{},
			'',
			'/?participant_token=signed-token&resume=stash-token'
		);
		const block = buildResumableBlock();
		apiFetch
			.mockResolvedValueOnce( recognisedByToken() )
			.mockResolvedValueOnce( {
				success: true,
				payload: {
					name: 'Ada Typed',
					ticket_type_id: 2,
					quantity: 2,
					keep_informed: true,
					ticket_option_ids: [],
					questionnaire_answers: answers,
				},
			} );

		initialize();
		await settle();

		expect( apiFetch ).toHaveBeenCalledTimes( 2 );
		expect( apiFetch.mock.calls[ 1 ][ 0 ].path ).toBe(
			'/fair-audience/v1/event-signup/resume?participant_token=signed-token&resume=stash-token'
		);

		const form = block.querySelector( 'form' );
		expect( form.querySelector( 'input[name="name"]' ).value ).toBe(
			'Ada Typed'
		);
		expect( form.querySelector( 'input[name="email"]' ).value ).toBe(
			'ada@example.test'
		);
		expect(
			form.querySelector( 'input[name="ticket_type_id"]:checked' ).value
		).toBe( '2' );
		expect( form.querySelector( 'input[name="quantity"]' ).value ).toBe(
			'2'
		);
		expect(
			form.querySelector( 'input[name="mailing_opt_in"]' ).checked
		).toBe( true );
		expect( applyQuestionAnswers ).toHaveBeenCalledWith( form, answers );
		expect(
			form.querySelector( '.fair-events-get-tickets-resume-notice' )
				.textContent
		).toContain( 'restored your answers' );
	} );

	test( 'leaves the form as it is when the link expired or was used', async () => {
		window.history.replaceState(
			{},
			'',
			'/?participant_token=signed-token&resume=used-token'
		);
		const block = buildResumableBlock();
		apiFetch
			.mockResolvedValueOnce( recognisedByToken() )
			.mockRejectedValueOnce( { code: 'resume_not_found' } );

		initialize();
		await settle();

		const form = block.querySelector( 'form' );
		expect( apiFetch ).toHaveBeenCalledTimes( 2 );
		expect( form.querySelector( 'input[name="name"]' ).value ).toBe(
			'Ada Participant'
		);
		expect(
			form.querySelector( '.fair-events-get-tickets-resume-notice' )
		).toBeNull();
		expect( applyQuestionAnswers ).not.toHaveBeenCalled();
	} );

	test( 'does not ask for a stash without a resume token, a validated token or a named route', async () => {
		for ( const [ url, response ] of [
			[ '/?participant_token=signed-token', recognisedByToken() ],
			[
				'/?participant_token=bad-token&resume=stash-token',
				recognisedByToken( { token_identity_validated: false } ),
			],
			[
				'/?participant_token=signed-token&resume=stash-token',
				recognisedByToken( { before_form_html: null } ),
			],
		] ) {
			window.history.replaceState( {}, '', url );
			buildResumableBlock();
			apiFetch.mockReset();
			apiFetch.mockResolvedValue( response );

			initialize();
			await settle();

			expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		}
	} );

	test( 'a recognised email keeps the form and shows the inbox message', async () => {
		const block = buildResumableBlock();
		apiFetch.mockResolvedValue( noopResponse() );
		initialize();
		const form = block.querySelector( 'form' );
		form.querySelector( 'input[name="name"]' ).value = 'Ada';
		form.querySelector( 'input[name="email"]' ).value = 'ada@example.test';
		initiatePayment.mockResolvedValueOnce( {
			status: 'email_recognized',
			message: 'We recognise this email — check your inbox to continue.',
		} );

		form.dispatchEvent(
			new window.Event( 'submit', { cancelable: true } )
		);
		await settle();

		expect( showMessage ).toHaveBeenCalledWith(
			block.querySelector( '.message-container' ),
			'We recognise this email — check your inbox to continue.',
			'success',
			'fair-events-get-tickets'
		);
		expect( form.style.display ).not.toBe( 'none' );
	} );
} );

describe( 'Event Signup frontend.js — buying another ticket (#1526)', () => {
	const CARD =
		'<div class="fair-events-signed-up-card" data-event-id="5" data-event-date-id="42" data-cancel-route="/fair-audience/v1/event-signup">' +
		'<p class="fair-events-signed-up-status">You are signed up for this date.</p>' +
		'<ul class="fair-events-signed-up-tickets"><li>Ticket 1 — General<ul><li>Workshop</li></ul></li></ul>' +
		'</div>' +
		'<div class="fair-events-add-activities" data-event-id="5" data-event-date-id="42">' +
		'<select name="add_ticket_id" required><option value="">Choose a ticket</option></select>' +
		'<input type="checkbox" name="add_option_ids[]" value="9" />' +
		'<button type="button" class="fair-events-add-activities-button">Add activities</button>' +
		'</div>';
	const HEADING =
		'<div class="fair-events-buy-another"><h3>Buy another ticket for yourself</h3></div>' +
		'<button type="button" class="fair-events-not-you-button">Not you? Start fresh</button>';

	function signedUpResponse( overrides = {} ) {
		return {
			...noopResponse(),
			viewer_resolved: true,
			existing_signup_html: CARD,
			before_form_html: HEADING,
			prefill_name: 'Ada Lovelace',
			prefill_email: 'ada@example.test',
			...overrides,
		};
	}

	const settle = () => new Promise( ( resolve ) => setTimeout( resolve ) );
	const submit = ( form ) =>
		form.dispatchEvent(
			new window.Event( 'submit', { cancelable: true } )
		);
	const sentKey = ( call ) =>
		initiatePayment.mock.calls[ call ][ 0 ].data.idempotency_key;

	async function hydrate( response = signedUpResponse() ) {
		const block = buildBlock();
		apiFetch.mockResolvedValue( response );
		initialize();
		await settle();
		return block;
	}

	test( 'keeps the existing tickets before the form and the form available', async () => {
		const block = await hydrate();
		const form = block.querySelector( '.fair-events-get-tickets-form' );
		const existing = block.querySelector(
			'.fair-events-get-tickets-existing'
		);

		expect( form ).not.toBeNull();
		expect(
			block.querySelector( '.fair-events-get-tickets-companion' )
		).toBeNull();
		expect( existing.nextElementSibling ).toBe( form );
		expect(
			existing.querySelector( '.fair-events-signed-up-card' )
		).not.toBeNull();
		// Nothing the viewer already holds is part of the new purchase's form.
		expect(
			form.querySelector( '.fair-events-signed-up-card' )
		).toBeNull();
		expect(
			form.querySelector( '.fair-events-add-activities' )
		).toBeNull();
		expect( form.firstElementChild.textContent ).toContain(
			'Buy another ticket for yourself'
		);
		expect( form.querySelector( 'button[type="submit"]' ).disabled ).toBe(
			false
		);
	} );

	test( 'retains the recognised identity and wires the identity reset inside the form', async () => {
		const block = await hydrate();
		const form = block.querySelector( '.fair-events-get-tickets-form' );

		expect( form.querySelector( 'input[name="name"]' ).value ).toBe(
			'Ada Lovelace'
		);
		expect( form.querySelector( 'input[name="email"]' ).value ).toBe(
			'ada@example.test'
		);
		expect( wireNotYouButton ).toHaveBeenCalledWith(
			form.querySelector( '.fair-events-not-you-button' )
		);
	} );

	test( 'submits the new purchase without the existing tickets’ controls', async () => {
		const block = await hydrate();
		const form = block.querySelector( '.fair-events-get-tickets-form' );

		// The add-activities section's own required ticket choice is empty;
		// it belongs to the tickets already held and must not block or join
		// the new purchase.
		submit( form );
		await settle();

		expect( initiatePayment ).toHaveBeenCalledTimes( 1 );
		const { data } = initiatePayment.mock.calls[ 0 ][ 0 ];
		expect( data.name ).toBe( 'Ada Lovelace' );
		expect( data.ticket_type_id ).toBe( 1 );
		expect( data ).not.toHaveProperty( 'add_option_ids' );
	} );

	test( 'labels an already-held occurrence and leaves it selectable', async () => {
		const block = buildBlock();
		const form = block.querySelector( '.fair-events-get-tickets-form' );
		form.insertAdjacentHTML(
			'afterbegin',
			'<div class="fair-events-instance-picker"><label><input type="checkbox" name="event_date_ids[]" value="99" /> Sat, 1 Jan</label><p class="fair-events-instance-picker-hint"></p></div>'
		);
		apiFetch.mockResolvedValue(
			signedUpResponse( { occurrences_signed_up: [ 99 ] } )
		);
		initialize();
		await settle();

		const checkbox = form.querySelector( 'input[name="event_date_ids[]"]' );
		expect( checkbox.disabled ).toBe( false );
		expect( checkbox.closest( 'label' ).textContent ).toContain(
			'already signed up'
		);
	} );

	test( 'a completed purchase gives way to a return to the signup form', async () => {
		const block = await hydrate();
		const form = block.querySelector( '.fair-events-get-tickets-form' );
		initiatePayment.mockResolvedValueOnce( { status: 'confirmed' } );

		submit( form );
		await settle();

		expect( form.hidden ).toBe( true );
		expect(
			block.querySelector( '.fair-events-get-tickets-existing' ).hidden
		).toBe( true );
		const link = block.querySelector( '.fair-events-get-tickets-return a' );
		expect( link.textContent ).toBe( 'Back to the signup form' );
		expect( link.getAttribute( 'href' ) ).toBe(
			window.location.href.split( '#' )[ 0 ]
		);

		// The finished purchase cannot be sent again from this page.
		submit( form );
		expect( initiatePayment ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'an in-flight retry keeps its key; the next purchase takes a new one', async () => {
		const block = await hydrate();
		const form = block.querySelector( '.fair-events-get-tickets-form' );
		initiatePayment.mockImplementationOnce( ( { onError } ) => {
			const error = { code: 'fetch_error' };
			onError( 'Failed', error );
			return Promise.reject( error );
		} );

		submit( form );
		await settle();
		document.querySelector( '.message-container' ).className =
			'fair-events-get-tickets-message fair-events-get-tickets-message-error';
		submit( form );
		await settle();

		expect( initiatePayment ).toHaveBeenCalledTimes( 2 );
		expect( sentKey( 1 ) ).toBe( sentKey( 0 ) );

		// That purchase completed. The page the visitor returns to builds a
		// form of its own, and the same selection there is another purchase.
		const nextBlock = await hydrate();
		submit( nextBlock.querySelector( '.fair-events-get-tickets-form' ) );
		await settle();

		expect( initiatePayment ).toHaveBeenCalledTimes( 3 );
		expect( sentKey( 2 ) ).not.toBe( sentKey( 0 ) );
	} );

	test( 'a late or repeated viewer context never rebuilds a purchase in progress', async () => {
		jest.useFakeTimers();
		try {
			const block = buildBlock();
			const form = block.querySelector( '.fair-events-get-tickets-form' );
			let respond;
			apiFetch.mockReturnValue(
				new Promise( ( resolve ) => {
					respond = resolve;
				} )
			);
			let finish;
			initiatePayment.mockImplementationOnce(
				() =>
					new Promise( ( resolve ) => {
						finish = resolve;
					} )
			);
			initialize();

			// The wait for the viewer context is bounded; the visitor submits
			// once the form is released.
			jest.advanceTimersByTime( 3000 );
			form.querySelector( 'input[name="name"]' ).value = 'Ada';
			form.querySelector( 'input[name="email"]' ).value =
				'ada@example.test';
			submit( form );
			expect( initiatePayment ).toHaveBeenCalledTimes( 1 );

			respond(
				signedUpResponse( {
					prefill_name: 'Someone Else',
					ticket_type_fieldset_html:
						'<div class="form-row"><fieldset class="fair-events-ticket-fieldset"><input type="radio" name="ticket_type_id" value="2" checked /></fieldset></div>',
				} )
			);
			await Promise.resolve();
			await Promise.resolve();

			expect( form.querySelector( 'input[name="name"]' ).value ).toBe(
				'Ada'
			);
			expect(
				form.querySelector( 'input[name="ticket_type_id"]' ).value
			).toBe( '1' );
			expect(
				block.querySelector( '.fair-events-get-tickets-existing' )
			).toBeNull();

			finish( {} );
		} finally {
			jest.useRealTimers();
		}
	} );

	test( 'attaches the existing tickets’ actions once', async () => {
		// An admission without tickets still offers the broad cancellation.
		const block = await hydrate(
			signedUpResponse( {
				existing_signup_html: CARD.replace(
					'</ul></div>',
					'</ul><button type="button" class="fair-events-cancel-signup-button">Cancel signup</button></div>'
				),
			} )
		);

		// A second pass over the page (another script reaching the same
		// DOM-ready entry) must not double the listeners.
		initialize();
		await settle();
		apiFetch.mockClear();
		apiFetch.mockResolvedValue( {} );

		block.querySelector( '.fair-events-cancel-signup-button' ).click();
		const deletions = apiFetch.mock.calls.filter(
			( [ options ] ) => options.method === 'DELETE'
		);
		expect( deletions ).toHaveLength( 1 );

		// The form's own submit handler is not doubled either.
		submit( block.querySelector( '.fair-events-get-tickets-form' ) );
		await settle();
		expect( initiatePayment ).toHaveBeenCalledTimes( 1 );
	} );

	test( 'the paid confirmation lists only this purchase and links back to the form', async () => {
		document.body.innerHTML = `
			<div class="fair-events-get-tickets-callback fair-events-get-tickets-callback-processing" data-transaction-id="77" data-token="owner-token">
				<p class="fair-events-get-tickets-callback-status">Checking</p>
				<div class="fair-events-get-tickets-callback-status-retry" style="display:none"><button class="fair-events-get-tickets-callback-status-retry-button">Check payment status again</button></div>
				<a href="#" class="fair-events-get-tickets-callback-cancel-link">Cancel and start over</a>
				<div class="fair-events-get-tickets-callback-message"></div>
			</div>`;
		initialize();
		const card = document.querySelector(
			'.fair-events-get-tickets-callback'
		);

		pollPaymentStatus.mock.calls[ 0 ][ 0 ].onConfirmed( {
			state: 'confirmed',
			amount: 12,
			currency: 'EUR',
			tickets: [
				{ ticket_type: 'Supporter', activities: [ 'Evening social' ] },
			],
		} );

		const purchase = card.querySelector(
			'.fair-events-get-tickets-callback-purchase'
		);
		expect( purchase.textContent ).toContain( 'Supporter' );
		expect( purchase.textContent ).toContain( 'Evening social' );
		expect(
			card.querySelector( '.fair-events-get-tickets-callback-return a' )
				.textContent
		).toBe( 'Back to the signup form' );
	} );
} );

describe( 'Event Signup frontend.js — registering another person (#1528)', () => {
	const CARD =
		'<div class="fair-events-signed-up-card" data-event-id="5" data-event-date-id="42">' +
		'<p class="fair-events-signed-up-status">You are signed up for this date.</p>' +
		'<ul class="fair-events-signed-up-tickets"><li>Ticket 1 — General</li></ul>' +
		'<button type="button" class="fair-events-register-another-button">Register another person</button>' +
		'</div>';
	const HEADING =
		'<div class="fair-events-buy-another"><h3>Buy another ticket for yourself</h3></div>' +
		'<button type="button" class="fair-events-not-you-button">Not you? Start fresh</button>';
	const MEMBER_FIELDSET =
		'<div class="form-row"><fieldset class="fair-events-ticket-fieldset"><legend>Choose ticket type</legend>' +
		'<label><input type="radio" name="ticket_type_id" value="1" data-ticket-price="5.00" checked /> General</label>' +
		'<label><input type="radio" name="ticket_type_id" value="2" data-ticket-price="0.00" /> Members only</label>' +
		'</fieldset></div>';
	const ANONYMOUS_FIELDSET =
		'<div class="form-row"><fieldset class="fair-events-ticket-fieldset"><legend>Choose ticket type</legend>' +
		'<label><input type="radio" name="ticket_type_id" value="1" data-ticket-price="10.00" checked /> General</label>' +
		'</fieldset></div>';

	function ownResponse( overrides = {} ) {
		return {
			...noopResponse(),
			viewer_resolved: true,
			existing_signup_html: CARD,
			before_form_html: HEADING,
			ticket_type_fieldset_html: MEMBER_FIELDSET,
			prefill_name: 'Ada Lovelace',
			prefill_email: 'ada@example.test',
			...overrides,
		};
	}

	function anotherPersonResponse() {
		return {
			...noopResponse(),
			register_another_person: true,
			ticket_type_fieldset_html: ANONYMOUS_FIELDSET,
		};
	}

	const settle = () => new Promise( ( resolve ) => setTimeout( resolve ) );
	const submit = ( form ) =>
		form.dispatchEvent(
			new window.Event( 'submit', { cancelable: true } )
		);
	const currentForm = ( block ) =>
		block.querySelector( '.fair-events-get-tickets-form' );
	const registerButton = ( block ) =>
		block.querySelector( '.fair-events-register-another-button' );
	const isAnotherPersonRequest = ( call ) =>
		call[ 0 ].path.includes( 'register_another_person=1' );

	// Answers each viewer-context request by its kind, whatever their order.
	function answerByKind() {
		apiFetch.mockImplementation( ( { path } ) =>
			Promise.resolve(
				path.includes( 'register_another_person=1' )
					? anotherPersonResponse()
					: ownResponse()
			)
		);
	}

	async function hydrate() {
		const block = buildBlock();
		answerByKind();
		initialize();
		await settle();
		return block;
	}

	async function enter( block ) {
		registerButton( block ).click();
		await settle();
		return currentForm( block );
	}

	function fill( form, name, email ) {
		form.querySelector( 'input[name="name"]' ).value = name;
		form.querySelector( 'input[name="email"]' ).value = email;
	}

	test( 'is offered only where the companion rendered the action', async () => {
		const block = buildBlock();
		apiFetch.mockResolvedValue(
			ownResponse( {
				existing_signup_html: CARD.replace(
					/<button[^>]*register-another-button.*?<\/button>/,
					''
				),
			} )
		);
		initialize();
		await settle();

		expect( registerButton( block ) ).toBeNull();
		expect(
			block.querySelector( '.fair-events-register-another' )
		).toBeNull();
	} );

	test( 'opens an empty form with none of the viewer’s identity, tickets or restricted access', async () => {
		const block = await hydrate();
		const ownForm = currentForm( block );
		ownForm.setAttribute( 'data-participant-token', 'own-token' );
		expect(
			ownForm.querySelector( 'input[name="ticket_type_id"][value="2"]' )
		).not.toBeNull();

		const form = await enter( block );

		expect( form ).not.toBe( ownForm );
		expect( form.querySelector( 'input[name="name"]' ).value ).toBe( '' );
		expect( form.querySelector( 'input[name="email"]' ).value ).toBe( '' );
		expect( form.dataset.participantToken ).toBeUndefined();
		// The member-only tier and the member price are gone.
		expect(
			form.querySelector( 'input[name="ticket_type_id"][value="2"]' )
		).toBeNull();
		expect(
			form.querySelector( 'input[name="ticket_type_id"]' ).dataset
				.ticketPrice
		).toBe( '10.00' );
		// No fragment of the viewer's own form came along.
		expect( form.querySelector( '.fair-events-buy-another' ) ).toBeNull();
		expect(
			form.querySelector( '.fair-events-not-you-button' )
		).toBeNull();
		expect(
			form.querySelector( '.fair-events-register-another-heading' )
				.textContent
		).toBe( 'Registering another person' );
		expect(
			form.querySelector( '.fair-events-register-another-back' )
				.textContent
		).toBe( 'Back to your ticket' );
		// The viewer's tickets step aside but stay in the page.
		const existing = block.querySelector(
			'.fair-events-get-tickets-existing'
		);
		expect( existing.hidden ).toBe( true );
		expect(
			existing.querySelector( '.fair-events-signed-up-card' )
		).not.toBeNull();
	} );

	test( 'asks for an anonymous context without the page’s participant token', async () => {
		const originalUrl = window.location.href;
		const block = await hydrate();
		window.history.replaceState( {}, '', '?participant_token=page-token' );

		await enter( block );
		window.history.replaceState( {}, '', originalUrl );

		const request = apiFetch.mock.calls.find( isAnotherPersonRequest );
		expect( request[ 0 ].path ).toContain( 'event_date_id=42' );
		expect( request[ 0 ].path ).not.toContain( 'participant_token' );
	} );

	test( 'keeps the form unavailable until the anonymous context arrives', async () => {
		jest.useFakeTimers();
		try {
			const block = buildBlock();
			let answer;
			apiFetch.mockImplementation( ( { path } ) =>
				path.includes( 'register_another_person=1' )
					? new Promise( ( resolve ) => {
							answer = resolve;
					  } )
					: Promise.resolve( ownResponse() )
			);
			initialize();
			await jest.advanceTimersByTimeAsync( 0 );

			registerButton( block ).click();
			const form = currentForm( block );
			const button = form.querySelector( 'button[type="submit"]' );
			expect( button.disabled ).toBe( true );

			// Unlike the viewer's own form, no timeout opens it early.
			await jest.advanceTimersByTimeAsync( 10000 );
			expect( button.disabled ).toBe( true );
			fill( form, 'Grace Hopper', 'grace@example.test' );
			submit( form );
			expect( initiatePayment ).not.toHaveBeenCalled();

			answer( anotherPersonResponse() );
			await jest.advanceTimersByTimeAsync( 0 );
			expect( button.disabled ).toBe( false );
		} finally {
			jest.useRealTimers();
		}
	} );

	test( 'a failed anonymous context leaves the form unavailable and the way back in place', async () => {
		const block = buildBlock();
		const consoleError = jest
			.spyOn( console, 'error' )
			.mockImplementation( () => {} );
		apiFetch.mockImplementation( ( { path } ) =>
			path.includes( 'register_another_person=1' )
				? Promise.reject( new Error( 'offline' ) )
				: Promise.resolve( ownResponse() )
		);
		initialize();
		await settle();

		const form = await enter( block );
		consoleError.mockRestore();

		expect( form.querySelector( 'button[type="submit"]' ).disabled ).toBe(
			true
		);
		expect( showMessage ).toHaveBeenCalledWith(
			block.querySelector( '.message-container' ),
			expect.stringContaining( 'could not prepare the form' ),
			'error',
			'fair-events-get-tickets'
		);

		form.querySelector( '.fair-events-register-another-back' ).click();
		await settle();
		expect(
			block.querySelector( '.fair-events-get-tickets-existing' ).hidden
		).toBe( false );
	} );

	test( 'sends the other person’s purchase without the viewer’s credential and under its own key', async () => {
		const block = await hydrate();
		const ownForm = currentForm( block );
		ownForm.setAttribute( 'data-participant-token', 'own-token' );
		initiatePayment.mockImplementationOnce( ( { onError } ) => {
			onError( 'Failed', { code: 'rest_error' } );
			return Promise.reject( new Error( 'Failed' ) );
		} );
		submit( ownForm );
		await settle();
		const ownData = initiatePayment.mock.calls[ 0 ][ 0 ].data;
		expect( ownData.participant_token ).toBe( 'own-token' );
		expect( ownData ).not.toHaveProperty( 'register_another_person' );

		const form = await enter( block );
		// Even with the very same details the viewer just tried to buy with.
		fill( form, 'Ada Lovelace', 'ada@example.test' );
		submit( form );
		await settle();

		const data = initiatePayment.mock.calls[ 1 ][ 0 ].data;
		expect( data.register_another_person ).toBe( true );
		expect( data ).not.toHaveProperty( 'participant_token' );
		expect( data.idempotency_key ).toMatch( /^[a-f0-9]{32}$/ );
		expect( data.idempotency_key ).not.toBe( ownData.idempotency_key );
	} );

	test( '“Back to your ticket” discards the form and restores the viewer’s own', async () => {
		const block = await hydrate();
		const form = await enter( block );
		fill( form, 'Grace Hopper', 'grace@example.test' );

		form.querySelector( '.fair-events-register-another-back' ).click();
		await settle();

		const restored = currentForm( block );
		expect( restored ).not.toBe( form );
		expect( restored.querySelector( 'input[name="name"]' ).value ).toBe(
			'Ada Lovelace'
		);
		expect( restored.querySelector( 'input[name="email"]' ).value ).toBe(
			'ada@example.test'
		);
		expect(
			restored.querySelector( '.fair-events-register-another' )
		).toBeNull();
		expect( restored.firstElementChild.textContent ).toContain(
			'Buy another ticket for yourself'
		);
		expect(
			restored.querySelector( 'input[name="ticket_type_id"][value="2"]' )
		).not.toBeNull();
		expect(
			block.querySelector( '.fair-events-get-tickets-existing' ).hidden
		).toBe( false );
		expect(
			block.querySelectorAll( '.fair-events-signed-up-card' )
		).toHaveLength( 1 );
		// The last request was the viewer's own context again.
		expect( isAnotherPersonRequest( apiFetch.mock.calls.at( -1 ) ) ).toBe(
			false
		);

		// The restored form buys for the viewer, not for another person.
		submit( restored );
		await settle();
		expect( initiatePayment.mock.calls[ 0 ][ 0 ].data ).not.toHaveProperty(
			'register_another_person'
		);
		// And the action can be used again.
		const again = await enter( block );
		expect( again.querySelector( 'input[name="name"]' ).value ).toBe( '' );
	} );

	test( 'a free registration confirms and returns to the viewer’s own ticket', async () => {
		const block = await hydrate();
		const form = await enter( block );
		fill( form, 'Grace Hopper', 'grace@example.test' );
		initiatePayment.mockResolvedValueOnce( {
			status: 'confirmed',
			message: 'Registered',
		} );

		submit( form );
		await settle();
		await settle();

		expect( showMessage ).toHaveBeenCalledWith(
			block.querySelector( '.message-container' ),
			'Registered',
			'success',
			'fair-events-get-tickets'
		);
		const restored = currentForm( block );
		expect( restored ).not.toBe( form );
		expect( restored.hidden ).toBe( false );
		expect( restored.querySelector( 'input[name="email"]' ).value ).toBe(
			'ada@example.test'
		);
		expect(
			block.querySelector( '.fair-events-get-tickets-existing' ).hidden
		).toBe( false );
		expect(
			block.querySelector( '.fair-events-get-tickets-return' )
		).toBeNull();
		expect( registerButton( block ) ).not.toBeNull();
	} );

	test( 'a paid registration stays on its way to checkout', async () => {
		const block = await hydrate();
		const form = await enter( block );
		fill( form, 'Grace Hopper', 'grace@example.test' );
		initiatePayment.mockResolvedValueOnce( {
			status: 'payment_required',
			checkout_url: 'https://pay.example.test/checkout',
		} );

		submit( form );
		await settle();

		expect( currentForm( block ) ).toBe( form );
		expect( form.querySelector( 'button[type="submit"]' ).disabled ).toBe(
			true
		);
		// Leaving is not offered half-way through a purchase.
		form.querySelector( '.fair-events-register-another-back' ).click();
		await settle();
		expect( currentForm( block ) ).toBe( form );
	} );

	test( 'a recognised email keeps the other person’s form open', async () => {
		const block = await hydrate();
		const form = await enter( block );
		fill( form, 'Ada Lovelace', 'ada@example.test' );
		initiatePayment.mockResolvedValueOnce( {
			status: 'email_recognized',
			message: 'Check your inbox',
		} );

		submit( form );
		await settle();

		expect( currentForm( block ) ).toBe( form );
		expect(
			form.querySelector( '.fair-events-register-another-heading' )
		).not.toBeNull();
		expect( form.querySelector( 'button[type="submit"]' ).disabled ).toBe(
			false
		);
	} );

	test( 'ignores a viewer context that arrives after the form it was for was replaced', async () => {
		const block = buildBlock();
		const pending = [];
		apiFetch.mockImplementation(
			( { path } ) =>
				new Promise( ( resolve ) => {
					pending.push( { path, resolve } );
				} )
		);
		initialize();
		pending.shift().resolve( ownResponse() );
		await settle();

		// Enter, leave and enter again before any of the three answers.
		registerButton( block ).click();
		currentForm( block )
			.querySelector( '.fair-events-register-another-back' )
			.click();
		registerButton( block ).click();
		const form = currentForm( block );
		const [ firstAnother, own, secondAnother ] = pending;

		// The viewer's own context must not personalize another person's form.
		own.resolve( ownResponse() );
		await settle();
		expect( form.querySelector( 'input[name="name"]' ).value ).toBe( '' );
		expect( form.querySelector( '.fair-events-buy-another' ) ).toBeNull();
		expect( form.querySelector( 'button[type="submit"]' ).disabled ).toBe(
			true
		);

		// Nor does the superseded anonymous answer open it.
		firstAnother.resolve( anotherPersonResponse() );
		await settle();
		expect( form.querySelector( 'button[type="submit"]' ).disabled ).toBe(
			true
		);

		secondAnother.resolve( anotherPersonResponse() );
		await settle();
		expect( form.querySelector( 'button[type="submit"]' ).disabled ).toBe(
			false
		);
		expect(
			block.querySelector( '.fair-events-get-tickets-existing' ).hidden
		).toBe( true );
	} );

	test( 'ignores an anonymous context that arrives after going back', async () => {
		const block = buildBlock();
		const pending = [];
		apiFetch.mockImplementation(
			( { path } ) =>
				new Promise( ( resolve ) => {
					pending.push( { path, resolve } );
				} )
		);
		initialize();
		pending.shift().resolve( ownResponse() );
		await settle();

		registerButton( block ).click();
		currentForm( block )
			.querySelector( '.fair-events-register-another-back' )
			.click();
		const [ another, own ] = pending;
		own.resolve( ownResponse() );
		await settle();
		another.resolve( anotherPersonResponse() );
		await settle();

		const form = currentForm( block );
		expect( form.querySelector( 'input[name="name"]' ).value ).toBe(
			'Ada Lovelace'
		);
		expect(
			form.querySelector( 'input[name="ticket_type_id"][value="2"]' )
		).not.toBeNull();
	} );

	test( 'keeps each block on a page in its own mode', async () => {
		const first = buildBlock( { eventDateId: 42 } );
		const markup = first.outerHTML;
		document.body.insertAdjacentHTML(
			'beforeend',
			markup.replace( /42/g, '43' )
		);
		const second = document.querySelectorAll(
			'.fair-events-get-tickets'
		)[ 1 ];
		answerByKind();
		initialize();
		await settle();

		const form = await enter( first );

		expect(
			form.querySelector( '.fair-events-register-another' )
		).not.toBeNull();
		const otherForm = currentForm( second );
		expect(
			otherForm.querySelector( '.fair-events-register-another' )
		).toBeNull();
		expect( otherForm.querySelector( 'input[name="name"]' ).value ).toBe(
			'Ada Lovelace'
		);
		expect(
			second.querySelector( '.fair-events-get-tickets-existing' ).hidden
		).toBe( false );
		expect(
			apiFetch.mock.calls.filter( isAnotherPersonRequest )
		).toHaveLength( 1 );

		fill( form, 'Grace Hopper', 'grace@example.test' );
		submit( form );
		submit( otherForm );
		await settle();
		const sent = initiatePayment.mock.calls.map(
			( call ) => call[ 0 ].data
		);
		expect( sent[ 0 ].register_another_person ).toBe( true );
		expect( sent[ 0 ].event_date_id ).toBe( 42 );
		expect( sent[ 1 ] ).not.toHaveProperty( 'register_another_person' );
		expect( sent[ 1 ].event_date_id ).toBe( 43 );
		expect( sent[ 0 ].idempotency_key ).not.toBe(
			sent[ 1 ].idempotency_key
		);
	} );
} );
