import { attribution } from '../meta-attribution.js';

describe( 'Meta attribution consent boundary', () => {
	afterEach( () => {
		delete window.wp_has_consent;
		document.cookie = '_fbp=; Max-Age=0';
		document.cookie = '_fbc=; Max-Age=0';
	} );

	it( 'fails closed when the consent API is unavailable', () => {
		document.cookie = '_fbp=fb.1.1712345678901.browser';
		expect( attribution() ).toEqual( {} );
	} );

	it( 'returns only valid identifiers after marketing consent', () => {
		window.wp_has_consent = jest.fn( () => true );
		document.cookie = '_fbp=fb.1.1712345678901.browser';
		document.cookie = '_fbc=invalid';
		expect( attribution() ).toMatchObject( {
			marketing_consent: true,
			meta_fbp: 'fb.1.1712345678901.browser',
		} );
		expect( attribution() ).not.toHaveProperty( 'meta_fbc' );
	} );
} );
