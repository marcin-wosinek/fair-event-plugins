/**
 * Email preferences on the manage-subscription page: the derived view and
 * the controls rendered from it.
 */

import { derivePreferencesView } from '../preferencesModel.js';
import { initPreferences } from '../preferences.js';

describe( 'derivePreferencesView', () => {
	it( 'offers the feed choice while the weekly summary is on', () => {
		expect(
			derivePreferencesView( {
				profile: 'marketing',
				weeklySummary: true,
			} )
		).toEqual( {
			selectedProfile: 'marketing',
			feedsDisabled: false,
		} );
	} );

	it( 'keeps the feed choice while the weekly summary is off', () => {
		expect(
			derivePreferencesView( {
				profile: 'marketing',
				weeklySummary: false,
			} ).feedsDisabled
		).toBe( true );
	} );

	it( 'offers feeds without marketing emails', () => {
		expect(
			derivePreferencesView( {
				profile: 'minimal',
				weeklySummary: true,
			} )
		).toEqual( {
			selectedProfile: 'minimal',
			feedsDisabled: false,
		} );
	} );
} );

describe( 'initPreferences', () => {
	function render( { profile = 'marketing', weekly = true } ) {
		document.body.innerHTML = `
			<form data-fair-audience-preferences>
				<label class="fair-audience-subscription-option">
					<input type="radio" name="email_profile" value="marketing" ${
						'marketing' === profile ? 'checked' : ''
					}>
				</label>
				<label class="fair-audience-subscription-option">
					<input type="radio" name="email_profile" value="minimal" ${
						'minimal' === profile ? 'checked' : ''
					}>
				</label>
				<div data-fair-audience-weekly>
					<input type="checkbox" name="weekly_summary" data-fair-audience-weekly-summary ${
						weekly ? 'checked' : ''
					}>
					<fieldset data-fair-audience-weekly-feeds>
						<input type="checkbox" name="weekly_feeds[]" value="3" checked>
					</fieldset>
				</div>
			</form>`;

		return {
			model: initPreferences( document ),
			input: ( selector ) => document.querySelector( selector ),
		};
	}

	function choose( input ) {
		input.checked = ! ( 'checkbox' === input.type && input.checked );
		input.dispatchEvent( new Event( 'change' ) );
	}

	it( 'does nothing without the form', () => {
		document.body.innerHTML = '';

		expect( initPreferences( document ) ).toBeNull();
	} );

	it( 'starts from the rendered choices', () => {
		const { input } = render( { weekly: false } );

		expect( input( '[data-fair-audience-weekly-feeds]' ).disabled ).toBe(
			true
		);
		expect(
			input( 'input[value="marketing"]' ).closest( 'label' ).classList
		).toContain( 'selected' );
	} );

	it( 'disables the feed choice, keeping it, when the weekly summary is turned off', () => {
		const { input } = render( {} );

		choose( input( '[data-fair-audience-weekly-summary]' ) );

		expect( input( '[data-fair-audience-weekly-feeds]' ).disabled ).toBe(
			true
		);
		expect( input( 'input[name="weekly_feeds[]"]' ).checked ).toBe( true );
	} );

	it( 'keeps the weekly preferences usable for essential emails only', () => {
		const { input } = render( {} );

		choose( input( 'input[value="minimal"]' ) );

		expect( input( '[data-fair-audience-weekly]' ).hidden ).toBe( false );
		expect( input( '[data-fair-audience-weekly-summary]' ).disabled ).toBe(
			false
		);
		expect( input( '[data-fair-audience-weekly-feeds]' ).disabled ).toBe(
			false
		);
		expect( input( 'input[name="weekly_feeds[]"]' ).checked ).toBe( true );
		expect(
			input( 'input[value="minimal"]' ).closest( 'label' ).classList
		).toContain( 'selected' );
		expect(
			input( 'input[value="marketing"]' ).closest( 'label' ).classList
		).not.toContain( 'selected' );
	} );

	it( 'keeps the marketing choice when the weekly summary changes', () => {
		const { input, model } = render( { profile: 'minimal' } );

		choose( input( '[data-fair-audience-weekly-summary]' ) );

		expect( model.getState().profile ).toBe( 'minimal' );
		expect( input( 'input[value="minimal"]' ).checked ).toBe( true );
	} );
} );
