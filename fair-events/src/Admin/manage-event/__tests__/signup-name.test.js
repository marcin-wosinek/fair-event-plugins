import { joinName, signupFullName } from '../signup-name.js';

describe( 'joinName', () => {
	it( 'joins a name and a surname with one space', () => {
		expect( joinName( 'Ana', 'López' ) ).toBe( 'Ana López' );
	} );

	it( 'keeps a name without a surname as it is', () => {
		expect( joinName( 'Prince', '' ) ).toBe( 'Prince' );
		expect( joinName( 'Ana María López', null ) ).toBe( 'Ana María López' );
	} );

	it( 'trims each part without doubling spaces', () => {
		expect( joinName( '  Zoë ', ' Álvarez  ' ) ).toBe( 'Zoë Álvarez' );
		expect( joinName( '', 'Okafor' ) ).toBe( 'Okafor' );
		expect( joinName( undefined, undefined ) ).toBe( '' );
	} );
} );

describe( 'signupFullName', () => {
	it( 'prefers the full name the API derived', () => {
		expect(
			signupFullName( {
				name: 'María José',
				surname: 'García de la Vega',
				full_name: 'María José García de la Vega',
			} )
		).toBe( 'María José García de la Vega' );
	} );

	it( 'joins the components when there is no full name', () => {
		expect( signupFullName( { name: '李', surname: '小龙' } ) ).toBe(
			'李 小龙'
		);
		expect( signupFullName( { name: 'Ada Lovelace' } ) ).toBe(
			'Ada Lovelace'
		);
	} );
} );
