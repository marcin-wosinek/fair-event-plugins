import {
	FAIR_FORM_QUESTION_BLOCK_NAMES,
	canonicalFairFormBlockName,
} from '../question-utils.js';

describe( 'canonicalFairFormBlockName', () => {
	it( 'maps a legacy Fair Form block name to the fair-form namespace', () => {
		expect( canonicalFairFormBlockName( 'fair-audience/fair-form' ) ).toBe(
			'fair-form/fair-form'
		);
		expect(
			canonicalFairFormBlockName( 'fair-audience/fair-form-option' )
		).toBe( 'fair-form/fair-form-option' );
	} );

	it( 'passes canonical, unrelated and unknown names through', () => {
		for ( const name of [
			'fair-form/fair-form-email',
			'fair-audience/mailing-signup',
			'fair-audience/event-signup',
			'fair-audience/fair-form-unknown',
			'core/paragraph',
			undefined,
		] ) {
			expect( canonicalFairFormBlockName( name ) ).toBe( name );
		}
	} );

	it( 'lists the question blocks under the fair-form namespace', () => {
		expect(
			FAIR_FORM_QUESTION_BLOCK_NAMES.every( ( name ) =>
				name.startsWith( 'fair-form/fair-form-' )
			)
		).toBe( true );
	} );
} );
