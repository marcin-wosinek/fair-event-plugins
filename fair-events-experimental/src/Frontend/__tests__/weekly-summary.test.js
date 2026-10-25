import { ROOT_SELECTOR, setup } from '../weekly-summary.js';

jest.mock( '../weekly-summary.css', () => ( {} ) );

const SUMMARY =
	'Acro agenda Valencia (https://example.test/valencia/), 26 Oct – 1 Nov 2026:\n* Tue, 18:00, Acro jam';

function render() {
	document.body.innerHTML = `
		<section class="fair-weekly-summary__copy"
			data-copied-message="Summary copied."
			data-failed-message="Couldn’t copy automatically.">
			<button type="button" class="fair-weekly-summary__button">Copy summary</button>
			<p class="fair-weekly-summary__status" role="status"></p>
			<textarea class="fair-weekly-summary__text" readonly></textarea>
		</section>
	`;
	document.querySelector( 'textarea' ).value = SUMMARY;
	return document.querySelector( ROOT_SELECTOR );
}

function setClipboard( writeText ) {
	Object.defineProperty( window.navigator, 'clipboard', {
		value: writeText ? { writeText } : undefined,
		configurable: true,
	} );
}

const status = () => document.querySelector( '.fair-weekly-summary__status' );
const button = () => document.querySelector( '.fair-weekly-summary__button' );

describe( 'weekly summary copy', () => {
	afterEach( () => {
		setClipboard( undefined );
	} );

	it( 'copies the exact summary text and confirms it', async () => {
		const writeText = jest.fn().mockResolvedValue();
		setClipboard( writeText );
		const controls = setup( render() );

		await controls.copy();

		expect( writeText ).toHaveBeenCalledWith( SUMMARY );
		expect( status().textContent ).toBe( 'Summary copied.' );
		expect( status().classList.contains( 'is-error' ) ).toBe( false );
		expect( button().disabled ).toBe( false );
	} );

	it( 'disables the button while copying and ignores a second click', async () => {
		let finish;
		const writeText = jest.fn(
			() => new Promise( ( resolve ) => ( finish = resolve ) )
		);
		setClipboard( writeText );
		const controls = setup( render() );

		const pending = controls.copy();
		expect( button().disabled ).toBe( true );
		expect( status().textContent ).toBe( '' );
		await controls.copy();
		expect( writeText ).toHaveBeenCalledTimes( 1 );

		finish();
		await pending;
		expect( button().disabled ).toBe( false );
	} );

	it( 'selects the text for manual copying when the clipboard rejects', async () => {
		setClipboard( jest.fn().mockRejectedValue( new Error( 'denied' ) ) );
		const controls = setup( render() );

		await controls.copy();

		const textarea = document.querySelector( 'textarea' );
		expect( status().textContent ).toBe( 'Couldn’t copy automatically.' );
		expect( status().classList.contains( 'is-error' ) ).toBe( true );
		expect( document.activeElement ).toBe( textarea );
		expect( textarea.selectionStart ).toBe( 0 );
		expect( textarea.selectionEnd ).toBe( SUMMARY.length );
		expect( controls.model.phase ).toBe( 'failed' );
	} );

	it( 'reports failure when the clipboard API is unavailable', async () => {
		setClipboard( undefined );
		const controls = setup( render() );

		await controls.copy();

		expect( status().textContent ).toBe( 'Couldn’t copy automatically.' );
	} );

	it( 'copies again after a failure', async () => {
		const writeText = jest
			.fn()
			.mockRejectedValueOnce( new Error( 'denied' ) )
			.mockResolvedValueOnce();
		setClipboard( writeText );
		const controls = setup( render() );

		await controls.copy();
		await controls.copy();

		expect( status().textContent ).toBe( 'Summary copied.' );
		expect( status().classList.contains( 'is-error' ) ).toBe( false );
	} );

	it( 'wires the button click', async () => {
		const writeText = jest.fn().mockResolvedValue();
		setClipboard( writeText );
		setup( render() );

		button().click();
		await Promise.resolve();

		expect( writeText ).toHaveBeenCalledWith( SUMMARY );
	} );

	it( 'skips incomplete markup', () => {
		document.body.innerHTML =
			'<section class="fair-weekly-summary__copy"></section>';
		expect( setup( document.querySelector( ROOT_SELECTOR ) ) ).toBeNull();
	} );
} );
