/**
 * Tests for the shared month/week period navigation action.
 *
 * jsdom locks `window.location.assign`, but it does perform same-document
 * hash navigation. The document starts on the period URL without its hash,
 * so a fallback `assign()` to the full period URL shows up as a hash change.
 *
 * @jest-environment-options {"url": "https://example.test/calendar/?month=2026-12"}
 */

jest.mock(
	'@wordpress/interactivity',
	() => ( {
		getContext: jest.fn(),
		getElement: jest.fn(),
		withSyncEvent: ( callback ) => callback,
	} ),
	// The package ships only an ES module build Jest can't resolve.
	{ virtual: true }
);

const mockNavigate = jest.fn();
let mockRouterImportError = null;

jest.mock(
	'@wordpress/interactivity-router',
	() => {
		if ( mockRouterImportError ) {
			throw mockRouterImportError;
		}
		return {
			actions: { navigate: ( ...args ) => mockNavigate( ...args ) },
		};
	},
	{ virtual: true }
);

import { getContext, getElement } from '@wordpress/interactivity';
import { navigatePeriod } from '../period-navigation.js';

const PAGE_URL = 'https://example.test/calendar/?month=2026-12';
const PERIOD_URL = `${ PAGE_URL }#fair-cal-1`;

/**
 * Run an action generator the way the Interactivity API does: await each
 * yielded value and resume with its result, or throw its rejection back in.
 *
 * @param {Generator} generator Action generator.
 * @return {Promise<*>} The generator's return value.
 */
async function run( generator ) {
	let step = generator.next();
	while ( ! step.done ) {
		try {
			const value = await step.value;
			step = generator.next( value );
		} catch ( error ) {
			step = generator.throw( error );
		}
	}
	return step.value;
}

function makeLink( { href = PERIOD_URL, target = '', download = false } = {} ) {
	const link = document.createElement( 'a' );
	link.href = href;
	if ( target ) {
		link.target = target;
	}
	if ( download ) {
		link.setAttribute( 'download', '' );
	}
	return link;
}

function makeEvent( overrides = {} ) {
	const event = {
		defaultPrevented: false,
		button: 0,
		metaKey: false,
		ctrlKey: false,
		shiftKey: false,
		altKey: false,
		...overrides,
	};
	event.preventDefault = jest.fn( () => {
		event.defaultPrevented = true;
	} );
	return event;
}

/**
 * Bind a context and link as the Interactivity runtime would for one call.
 *
 * @param {Object}      context Instance context.
 * @param {HTMLElement} link    Clicked link.
 */
function bind( context, link ) {
	getContext.mockReturnValue( context );
	getElement.mockReturnValue( { ref: link } );
}

describe( 'navigatePeriod', () => {
	beforeEach( () => {
		mockNavigate.mockReset();
		mockNavigate.mockResolvedValue( undefined );
		mockRouterImportError = null;
		jest.resetModules();
		document.body.innerHTML = '';
		window.history.replaceState( null, '', PAGE_URL );
	} );

	it.each( [
		[ 'already-prevented', { defaultPrevented: true } ],
		[ 'non-primary button', { button: 1 } ],
		[ 'meta key', { metaKey: true } ],
		[ 'ctrl key', { ctrlKey: true } ],
		[ 'shift key', { shiftKey: true } ],
		[ 'alt key', { altKey: true } ],
	] )( 'leaves a %s click to the browser when idle', async ( _, props ) => {
		const context = { isLoading: false };
		const event = makeEvent( props );
		bind( context, makeLink() );

		await run( navigatePeriod( event ) );

		expect( event.preventDefault ).not.toHaveBeenCalled();
		expect( context.isLoading ).toBe( false );
		expect( mockNavigate ).not.toHaveBeenCalled();
	} );

	it.each( [
		[ 'targeted', { target: '_blank' } ],
		[ 'download', { download: true } ],
	] )( 'leaves a %s link to the browser when idle', async ( _, props ) => {
		const context = { isLoading: false };
		const event = makeEvent();
		bind( context, makeLink( props ) );

		await run( navigatePeriod( event ) );

		expect( event.preventDefault ).not.toHaveBeenCalled();
		expect( mockNavigate ).not.toHaveBeenCalled();
	} );

	it( 'prevents every click, modified ones included, while loading', async () => {
		const context = { isLoading: true };

		for ( const props of [ {}, { metaKey: true }, { button: 1 } ] ) {
			const event = makeEvent( props );
			bind( context, makeLink() );
			await run( navigatePeriod( event ) );
			expect( event.preventDefault ).toHaveBeenCalled();
		}

		expect( context.isLoading ).toBe( true );
		expect( mockNavigate ).not.toHaveBeenCalled();
	} );

	it( 'navigates the router to the URL without its hash and focuses the title', async () => {
		document.body.innerHTML =
			'<div id="fair-cal-1"><h2 class="navigation-title" tabindex="-1">Dec</h2></div>';
		const title = document.querySelector( '.navigation-title' );
		const focus = jest.spyOn( title, 'focus' );
		const context = { isLoading: false };
		const event = makeEvent();
		bind( context, makeLink() );

		let loadingDuringNavigate;
		mockNavigate.mockImplementation( () => {
			loadingDuringNavigate = context.isLoading;
			return Promise.resolve();
		} );

		const generator = navigatePeriod( event );
		const pending = run( generator );
		expect( event.preventDefault ).toHaveBeenCalled();
		expect( context.isLoading ).toBe( true );
		await pending;

		expect( loadingDuringNavigate ).toBe( true );
		expect( mockNavigate ).toHaveBeenCalledWith( PAGE_URL );
		expect( focus ).toHaveBeenCalledWith( { preventScroll: true } );
		expect( context.isLoading ).toBe( false );
		expect( window.location.href ).toBe( PAGE_URL );
	} );

	it( 'completes without error when the focus target is missing', async () => {
		const context = { isLoading: false };
		bind( context, makeLink() );

		await run( navigatePeriod( makeEvent() ) );

		expect( mockNavigate ).toHaveBeenCalled();
		expect( context.isLoading ).toBe( false );
		expect( window.location.href ).toBe( PAGE_URL );
	} );

	it( 'falls back to the original URL when navigation rejects', async () => {
		mockNavigate.mockRejectedValue( new Error( 'fetch failed' ) );
		const context = { isLoading: false };
		bind( context, makeLink() );

		await run( navigatePeriod( makeEvent() ) );

		expect( window.location.href ).toBe( PERIOD_URL );
		expect( context.isLoading ).toBe( false );
	} );

	it( 'falls back to the original URL when the router import fails', async () => {
		mockRouterImportError = new Error( 'chunk failed' );
		const context = { isLoading: false };
		bind( context, makeLink() );

		await run( navigatePeriod( makeEvent() ) );

		expect( mockNavigate ).not.toHaveBeenCalled();
		expect( window.location.href ).toBe( PERIOD_URL );
		expect( context.isLoading ).toBe( false );
	} );

	it( 'keeps loading state per instance context', async () => {
		let release;
		mockNavigate.mockImplementationOnce(
			() =>
				new Promise( ( resolve ) => {
					release = resolve;
				} )
		);
		const first = { isLoading: false };
		const second = { isLoading: false };

		bind( first, makeLink() );
		const pendingFirst = run( navigatePeriod( makeEvent() ) );
		expect( first.isLoading ).toBe( true );

		const secondEvent = makeEvent();
		bind(
			second,
			makeLink( {
				href: 'https://example.test/calendar/?week=2026-W50#fair-week-2',
			} )
		);
		const pendingSecond = run( navigatePeriod( secondEvent ) );

		expect( secondEvent.preventDefault ).toHaveBeenCalled();
		expect( second.isLoading ).toBe( true );
		await pendingSecond;
		expect( second.isLoading ).toBe( false );
		expect( first.isLoading ).toBe( true );

		release();
		await pendingFirst;
		expect( first.isLoading ).toBe( false );
		expect( mockNavigate ).toHaveBeenLastCalledWith(
			'https://example.test/calendar/?week=2026-W50'
		);
	} );
} );
