/**
 * @jest-environment jsdom
 */
import html2canvas from 'html2canvas';
import {
	EXPORT_IGNORE_ATTRIBUTE,
	buildChartFilename,
	downloadElementAsPng,
	toFilenamePart,
} from '../exportChartImage.js';

jest.mock( 'html2canvas', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

describe( 'toFilenamePart', () => {
	it( 'lowercases, strips diacritics, and hyphenates separators', () => {
		expect( toFilenamePart( 'Clase de Cerámica, Ñandú!', 'x' ) ).toBe(
			'clase-de-ceramica-nandu'
		);
	} );

	it( 'removes path separators and reserved filename characters', () => {
		const part = toFilenamePart( '../a/b\\c:d*e?f"g<h>i|j', 'x' );
		expect( part ).toBe( 'a-b-c-d-e-f-g-h-i-j' );
		expect( part ).not.toMatch( /[./\\:*?"<>|]/ );
	} );

	it( 'keeps letters and digits from other scripts', () => {
		expect( toFilenamePart( 'Фестиваль 2026', 'x' ) ).toBe(
			'фестиваль-2026'
		);
	} );

	it( 'limits length without leaving a trailing hyphen', () => {
		const part = toFilenamePart(
			`${ 'a'.repeat( 59 ) } ${ 'b'.repeat( 40 ) }`
		);
		expect( part.length ).toBeLessThanOrEqual( 60 );
		expect( part ).toBe( 'a'.repeat( 59 ) );
	} );

	it.each( [ '', '   ', '!!!', null, undefined ] )(
		'falls back when %p leaves nothing safe',
		( value ) => {
			expect( toFilenamePart( value, 'fallback' ) ).toBe( 'fallback' );
		}
	);
} );

describe( 'buildChartFilename', () => {
	it( 'combines the event and chart names', () => {
		expect(
			buildChartFilename( 'Summer Retreat', 'Cumulative sales' )
		).toBe( 'summer-retreat-cumulative-sales.png' );
	} );

	it( 'uses non-empty fallbacks for unusable names', () => {
		expect( buildChartFilename( '///', '' ) ).toBe( 'event-chart.png' );
	} );
} );

describe( 'downloadElementAsPng', () => {
	let canvas;
	let clickSpy;
	let clickedLink;

	beforeEach( () => {
		canvas = {
			width: 800,
			height: 400,
			toBlob: jest.fn( ( callback ) =>
				callback( new Blob( [ 'png' ], { type: 'image/png' } ) )
			),
		};
		html2canvas.mockReset().mockResolvedValue( canvas );
		URL.createObjectURL = jest.fn( () => 'blob:chart' );
		URL.revokeObjectURL = jest.fn();
		clickedLink = null;
		clickSpy = jest
			.spyOn( HTMLAnchorElement.prototype, 'click' )
			.mockImplementation( function () {
				clickedLink = {
					href: this.getAttribute( 'href' ),
					download: this.download,
					attached: document.body.contains( this ),
				};
			} );
	} );

	afterEach( () => {
		clickSpy.mockRestore();
		delete URL.createObjectURL;
		delete URL.revokeObjectURL;
	} );

	it( 'renders the element at high resolution on an opaque background', async () => {
		const card = document.createElement( 'div' );

		await downloadElementAsPng( card, 'chart.png' );

		expect( html2canvas ).toHaveBeenCalledWith(
			card,
			expect.objectContaining( { backgroundColor: '#ffffff' } )
		);
		expect( html2canvas.mock.calls[ 0 ][ 1 ].scale ).toBeGreaterThanOrEqual(
			2
		);
		expect( canvas.toBlob ).toHaveBeenCalledWith(
			expect.any( Function ),
			'image/png'
		);
	} );

	it( 'excludes only elements marked as export-ignored', async () => {
		await downloadElementAsPng(
			document.createElement( 'div' ),
			'chart.png'
		);
		const { ignoreElements } = html2canvas.mock.calls[ 0 ][ 1 ];

		const control = document.createElement( 'button' );
		control.setAttribute( EXPORT_IGNORE_ATTRIBUTE, 'true' );
		expect( ignoreElements( control ) ).toBe( true );
		expect( ignoreElements( document.createElement( 'h3' ) ) ).toBe(
			false
		);
		expect( ignoreElements( document.createTextNode( 'text' ) ) ).toBe(
			false
		);
	} );

	it( 'downloads through a temporary object URL and cleans up', async () => {
		await downloadElementAsPng(
			document.createElement( 'div' ),
			'a-b.png'
		);

		expect( URL.createObjectURL ).toHaveBeenCalledWith(
			expect.any( Blob )
		);
		expect( clickedLink ).toEqual( {
			href: 'blob:chart',
			download: 'a-b.png',
			attached: true,
		} );
		expect( URL.revokeObjectURL ).toHaveBeenCalledWith( 'blob:chart' );
		expect( document.querySelector( 'a[download]' ) ).toBeNull();
		expect( canvas.width ).toBe( 0 );
		expect( canvas.height ).toBe( 0 );
	} );

	it( 'rejects and creates no download when rendering fails', async () => {
		html2canvas.mockRejectedValue( new Error( 'render failed' ) );

		await expect(
			downloadElementAsPng( document.createElement( 'div' ), 'chart.png' )
		).rejects.toThrow( 'render failed' );

		expect( URL.createObjectURL ).not.toHaveBeenCalled();
		expect( clickSpy ).not.toHaveBeenCalled();
		expect( document.querySelector( 'a[download]' ) ).toBeNull();
	} );

	it( 'rejects and releases the canvas when PNG encoding yields nothing', async () => {
		canvas.toBlob.mockImplementation( ( callback ) => callback( null ) );

		await expect(
			downloadElementAsPng( document.createElement( 'div' ), 'chart.png' )
		).rejects.toThrow();

		expect( URL.createObjectURL ).not.toHaveBeenCalled();
		expect( clickSpy ).not.toHaveBeenCalled();
		expect( canvas.width ).toBe( 0 );
		expect( canvas.height ).toBe( 0 );
	} );

	it( 'still releases the object URL and anchor when the click throws', async () => {
		clickSpy.mockImplementation( () => {
			throw new Error( 'click blocked' );
		} );

		await expect(
			downloadElementAsPng( document.createElement( 'div' ), 'chart.png' )
		).rejects.toThrow( 'click blocked' );

		expect( URL.revokeObjectURL ).toHaveBeenCalledWith( 'blob:chart' );
		expect( document.querySelector( 'a[download]' ) ).toBeNull();
		expect( canvas.width ).toBe( 0 );
	} );
} );
