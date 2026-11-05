import {
	closeCalendarDropdown,
	formatEventDescription,
	openCalendarDropdown,
} from '../calendar-dropdown.js';

const ICONS = {
	google: { iconName: 'google' },
	outlook: { iconName: 'microsoft' },
	yahoo: { iconName: 'yahoo' },
	ics: { iconName: 'download' },
};

function createOptions( overrides = {} ) {
	return {
		generators: {
			google: jest.fn( () => 'https://google.example/add' ),
			outlook: jest.fn( () => 'https://outlook.example/add' ),
			yahoo: jest.fn( () => 'https://yahoo.example/add' ),
			ics: jest.fn( () => 'data:text/calendar;charset=utf8,ICS' ),
		},
		icons: ICONS,
		renderIcon: jest.fn( ( iconDef, { styles } ) => ( {
			html: [
				`<svg data-icon="${ iconDef.iconName }" style="color: ${ styles.color }"></svg>`,
			],
		} ) ),
		icsLabel: 'Translated ICS',
		...overrides,
	};
}

function createButton() {
	const button = document.createElement( 'button' );
	button.getBoundingClientRect = () => ( {
		bottom: 100,
		left: 40,
		top: 70,
		right: 140,
		width: 100,
		height: 30,
	} );
	document.body.appendChild( button );
	return button;
}

function option( dropdown, key ) {
	return dropdown.querySelector( `[data-provider="${ key }"]` );
}

describe( 'openCalendarDropdown', () => {
	let addListenerSpy;
	let removeListenerSpy;

	beforeEach( () => {
		jest.useFakeTimers();
		addListenerSpy = jest.spyOn( document, 'addEventListener' );
		removeListenerSpy = jest.spyOn( document, 'removeEventListener' );
		window.open = jest.fn();
	} );

	afterEach( () => {
		closeCalendarDropdown();
		document.body.innerHTML = '';
		jest.runOnlyPendingTimers();
		jest.useRealTimers();
		jest.restoreAllMocks();
	} );

	const clickListenerCalls = ( spy ) =>
		spy.mock.calls.filter( ( [ type ] ) => type === 'click' );

	it( 'renders the four providers in order with labels, icons and colors', () => {
		const options = createOptions();
		const dropdown = openCalendarDropdown(
			{ title: 'Event' },
			createButton(),
			options
		);

		const buttons = [ ...dropdown.querySelectorAll( 'button' ) ];
		expect( buttons.map( ( b ) => b.dataset.provider ) ).toEqual( [
			'google',
			'outlook',
			'yahoo',
			'ics',
		] );
		expect( buttons.map( ( b ) => b.textContent ) ).toEqual( [
			' Google Calendar',
			' Outlook',
			' Yahoo Calendar',
			' Translated ICS',
		] );
		buttons.forEach( ( b ) => {
			expect( b.className ).toBe( 'calendar-dropdown-option' );
			expect(
				b.querySelector( 'svg' ).classList.contains( 'calendar-icon' )
			).toBe( true );
		} );
		expect(
			options.renderIcon.mock.calls.map( ( [ def, opts ] ) => [
				def,
				opts.styles.color,
			] )
		).toEqual( [
			[ ICONS.google, '#4285f4' ],
			[ ICONS.outlook, '#0078d4' ],
			[ ICONS.yahoo, '#720e9e' ],
			[ ICONS.ics, '#666' ],
		] );
	} );

	it( 'falls back to the default ICS label', () => {
		const dropdown = openCalendarDropdown(
			{},
			createButton(),
			createOptions( { icsLabel: undefined } )
		);

		expect( option( dropdown, 'ics' ).textContent ).toBe( ' Download ICS' );
	} );

	it( 'positions the dropdown below the button', () => {
		window.pageYOffset = 200;
		window.pageXOffset = 10;
		const dropdown = openCalendarDropdown(
			{},
			createButton(),
			createOptions()
		);

		expect( dropdown.className ).toBe( 'calendar-dropdown' );
		expect( dropdown.parentNode ).toBe( document.body );
		expect( dropdown.style.position ).toBe( 'absolute' );
		expect( dropdown.style.top ).toBe( '305px' );
		expect( dropdown.style.left ).toBe( '50px' );
		expect( dropdown.style.zIndex ).toBe( '9999' );
		window.pageYOffset = 0;
		window.pageXOffset = 0;
	} );

	it.each( [
		[ 'google', 'https://google.example/add' ],
		[ 'outlook', 'https://outlook.example/add' ],
		[ 'yahoo', 'https://yahoo.example/add' ],
	] )(
		'opens the %s link in a new tab and closes the dropdown',
		( key, url ) => {
			const options = createOptions();
			const dropdown = openCalendarDropdown(
				{ title: 'Event' },
				createButton(),
				options
			);
			jest.runAllTimers();

			option( dropdown, key ).click();

			expect( options.generators[ key ] ).toHaveBeenCalledTimes( 1 );
			expect( window.open ).toHaveBeenCalledWith( url, '_blank' );
			expect( document.querySelector( '.calendar-dropdown' ) ).toBe(
				null
			);
			expect( clickListenerCalls( removeListenerSpy ) ).toHaveLength( 1 );
		}
	);

	it.each( [
		[ { title: 'Board meeting' }, 'Board meeting.ics' ],
		[ {}, 'event.ics' ],
	] )( 'downloads the ICS file for %p', ( eventData, filename ) => {
		const clickSpy = jest
			.spyOn( HTMLAnchorElement.prototype, 'click' )
			.mockImplementation( function () {
				expect( this.href ).toBe(
					'data:text/calendar;charset=utf8,ICS'
				);
				expect( this.download ).toBe( filename );
			} );
		const dropdown = openCalendarDropdown(
			eventData,
			createButton(),
			createOptions()
		);

		option( dropdown, 'ics' ).click();

		expect( clickSpy ).toHaveBeenCalledTimes( 1 );
		expect( window.open ).not.toHaveBeenCalled();
		expect( document.querySelector( '.calendar-dropdown' ) ).toBe( null );
	} );

	it( 'appends the URL to the description without mutating the input', () => {
		const options = createOptions();
		const start = new Date( '2026-07-15T10:00:00Z' );
		const eventData = {
			title: 'Event',
			description: 'Details',
			url: 'https://example.com/event',
			start,
			end: '2026-07-16',
		};
		const dropdown = openCalendarDropdown(
			eventData,
			createButton(),
			options
		);

		option( dropdown, 'google' ).click();

		const passed = options.generators.google.mock.calls[ 0 ][ 0 ];
		expect( passed.description ).toBe(
			'Details\n\nhttps://example.com/event'
		);
		expect( passed.start ).toBe( start );
		expect( passed.end ).toBe( '2026-07-16' );
		expect( eventData.description ).toBe( 'Details' );
	} );

	it( 'passes event data unchanged when there is no URL', () => {
		const options = createOptions();
		const eventData = { title: 'Event', description: 'Details' };
		const dropdown = openCalendarDropdown(
			eventData,
			createButton(),
			options
		);

		option( dropdown, 'yahoo' ).click();

		expect( options.generators.yahoo ).toHaveBeenCalledWith( eventData );
	} );

	it( 'calls onProviderSelect with the provider key', () => {
		const onProviderSelect = jest.fn();
		const dropdown = openCalendarDropdown(
			{},
			createButton(),
			createOptions( { onProviderSelect } )
		);

		option( dropdown, 'outlook' ).click();

		expect( onProviderSelect ).toHaveBeenCalledWith( 'outlook' );
	} );

	it( 'logs generator errors and keeps the dropdown open', () => {
		const error = new Error( 'bad date' );
		const consoleSpy = jest
			.spyOn( console, 'error' )
			.mockImplementation( () => {} );
		const options = createOptions();
		options.generators.google.mockImplementation( () => {
			throw error;
		} );
		const dropdown = openCalendarDropdown( {}, createButton(), options );

		option( dropdown, 'google' ).click();

		expect( consoleSpy ).toHaveBeenCalledWith(
			'Error creating Google Calendar link:',
			error
		);
		expect( window.open ).not.toHaveBeenCalled();
		expect( dropdown.isConnected ).toBe( true );
	} );

	it( 'registers the outside-click listener on the next tick', () => {
		const button = createButton();
		const dropdown = openCalendarDropdown( {}, button, createOptions() );

		expect( clickListenerCalls( addListenerSpy ) ).toHaveLength( 0 );
		document.body.click();
		expect( dropdown.isConnected ).toBe( true );

		jest.runAllTimers();
		expect( clickListenerCalls( addListenerSpy ) ).toHaveLength( 1 );
	} );

	it( 'stays open for clicks inside the dropdown or on the button', () => {
		const button = createButton();
		const dropdown = openCalendarDropdown( {}, button, createOptions() );
		jest.runAllTimers();

		dropdown.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		button.click();

		expect( dropdown.isConnected ).toBe( true );
	} );

	it( 'closes on an outside click and removes its listener', () => {
		const dropdown = openCalendarDropdown(
			{},
			createButton(),
			createOptions()
		);
		jest.runAllTimers();
		const [ [ , listener ] ] = clickListenerCalls( addListenerSpy );

		document.body.click();

		expect( dropdown.isConnected ).toBe( false );
		expect( removeListenerSpy ).toHaveBeenCalledWith( 'click', listener );
	} );

	it( 'replaces an open dropdown and cleans up its listener', () => {
		const button = createButton();
		const first = openCalendarDropdown( {}, button, createOptions() );
		jest.runAllTimers();
		const [ [ , firstListener ] ] = clickListenerCalls( addListenerSpy );

		const second = openCalendarDropdown( {}, button, createOptions() );

		expect( first.isConnected ).toBe( false );
		expect( second.isConnected ).toBe( true );
		expect(
			document.querySelectorAll( '.calendar-dropdown' )
		).toHaveLength( 1 );
		expect( removeListenerSpy ).toHaveBeenCalledWith(
			'click',
			firstListener
		);
	} );

	it( 'never registers the listener of a dropdown replaced before the next tick', () => {
		const button = createButton();
		openCalendarDropdown( {}, button, createOptions() );
		openCalendarDropdown( {}, button, createOptions() );

		jest.runAllTimers();

		expect( clickListenerCalls( addListenerSpy ) ).toHaveLength( 1 );
	} );

	it( 'removes a dropdown left by another bundle', () => {
		const foreign = document.createElement( 'div' );
		foreign.className = 'calendar-dropdown';
		document.body.appendChild( foreign );

		openCalendarDropdown( {}, createButton(), createOptions() );

		expect( foreign.isConnected ).toBe( false );
	} );
} );

describe( 'formatEventDescription', () => {
	it.each( [
		[ 'Event', 'https://example.com', 'Event\n\nhttps://example.com' ],
		[ '', 'https://example.com', 'https://example.com' ],
		[ null, 'https://example.com', 'https://example.com' ],
		[ 'Event', '', 'Event' ],
		[ undefined, undefined, '' ],
	] )( 'formats %p + %p', ( description, url, expected ) => {
		expect( formatEventDescription( description, url ) ).toBe( expected );
	} );
} );
