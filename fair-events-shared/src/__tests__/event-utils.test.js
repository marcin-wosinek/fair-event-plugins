import {
	decodeEntityText,
	getEventDisplayTitle,
	isLinkOnlyEvent,
} from '../event-utils.js';

const NBSP = '\u00a0';

describe( 'decodeEntityText', () => {
	test( 'decodes named entities, keeping &nbsp; as a non-breaking space', () => {
		expect(
			decodeEntityText(
				'Entrada para Minifesti "La&nbsp;Mutable", 22 de noviembre'
			)
		).toBe(
			`Entrada para Minifesti "La${ NBSP }Mutable", 22 de noviembre`
		);
		expect( decodeEntityText( 'Rock &amp; Roll' ) ).toBe( 'Rock & Roll' );
		expect( decodeEntityText( '&quot;Quoted&quot; &#039;x&#039;' ) ).toBe(
			'"Quoted" \'x\''
		);
	} );

	test( 'decodes numeric entities and keeps Unicode text', () => {
		expect(
			decodeEntityText( '&#8220;Caf&eacute;&#8221; &#x2014; ñ' )
		).toBe( '“Café” — ñ' );
		expect( decodeEntityText( 'Zażółć gęślą jaźń 🎉' ) ).toBe(
			'Zażółć gęślą jaźń 🎉'
		);
	} );

	test( 'keeps HTML-like text literal and creates no elements', () => {
		const decoded = decodeEntityText(
			'&lt;img src=x onerror=alert(1)&gt; <b>bold</b>'
		);
		expect( decoded ).toBe( '<img src=x onerror=alert(1)> <b>bold</b>' );
		expect( document.querySelector( 'img, b' ) ).toBeNull();
	} );

	test( 'decodes only once, so intentionally literal entities survive', () => {
		expect( decodeEntityText( 'Use &amp;nbsp; for spacing' ) ).toBe(
			'Use &nbsp; for spacing'
		);
		expect( decodeEntityText( '&amp;amp;' ) ).toBe( '&amp;' );
	} );

	test( 'does not trim and maps empty values to an empty string', () => {
		expect( decodeEntityText( '  a  ' ) ).toBe( '  a  ' );
		expect( decodeEntityText( null ) ).toBe( '' );
		expect( decodeEntityText( undefined ) ).toBe( '' );
		expect( decodeEntityText( 42 ) ).toBe( '42' );
	} );
} );

describe( 'getEventDisplayTitle', () => {
	test( 'returns the trimmed title when present', () => {
		expect( getEventDisplayTitle( '  My Event  ' ) ).toBe( 'My Event' );
	} );

	test( 'falls back for an empty title', () => {
		expect( getEventDisplayTitle( '' ) ).toBe( '(untitled event)' );
	} );

	test( 'falls back for a whitespace-only title', () => {
		expect( getEventDisplayTitle( '   ' ) ).toBe( '(untitled event)' );
	} );

	test( 'decodes entities in the title', () => {
		expect(
			getEventDisplayTitle( ' La&nbsp;Mutable &amp; Friends ' )
		).toBe( `La${ NBSP }Mutable & Friends` );
		expect( getEventDisplayTitle( '&lt;b&gt;Bold&lt;/b&gt;' ) ).toBe(
			'<b>Bold</b>'
		);
		expect( getEventDisplayTitle( '&amp;lt;tag&amp;gt;' ) ).toBe(
			'&lt;tag&gt;'
		);
	} );

	test( 'falls back when the title is only an encoded space', () => {
		expect( getEventDisplayTitle( '&nbsp;' ) ).toBe( '(untitled event)' );
	} );

	test( 'falls back for a null or undefined title', () => {
		expect( getEventDisplayTitle( null ) ).toBe( '(untitled event)' );
		expect( getEventDisplayTitle( undefined ) ).toBe( '(untitled event)' );
	} );
} );

describe( 'isLinkOnlyEvent', () => {
	test( 'true when link_type is external', () => {
		expect( isLinkOnlyEvent( { link_type: 'external' } ) ).toBe( true );
	} );

	test( 'false otherwise', () => {
		expect( isLinkOnlyEvent( { link_type: 'post' } ) ).toBe( false );
		expect( isLinkOnlyEvent( undefined ) ).toBe( false );
	} );
} );
