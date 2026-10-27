/**
 * Email preferences on the manage-subscription page: the derived view and
 * the controls rendered from it.
 */

import { derivePreferencesView } from '../preferencesModel.js';
import { initPreferences } from '../preferences.js';

describe( 'derivePreferencesView', () => {
	it( 'offers every weekly control to a marketing subscriber choosing feeds', () => {
		expect(
			derivePreferencesView( {
				profile: 'marketing',
				weeklySummary: true,
				feedMode: 'selected',
			} )
		).toEqual( {
			selectedProfile: 'marketing',
			weeklyHidden: false,
			weeklyDisabled: false,
			feedsDisabled: false,
			feedListDisabled: false,
		} );
	} );

	it( 'keeps the chosen feeds while every weekly email is chosen', () => {
		const view = derivePreferencesView( {
			profile: 'marketing',
			weeklySummary: true,
			feedMode: 'all',
		} );

		expect( view.feedsDisabled ).toBe( false );
		expect( view.feedListDisabled ).toBe( true );
	} );

	it( 'keeps the feed choice while the weekly summary is off', () => {
		const view = derivePreferencesView( {
			profile: 'marketing',
			weeklySummary: false,
			feedMode: 'selected',
		} );

		expect( view.weeklyDisabled ).toBe( false );
		expect( view.feedsDisabled ).toBe( true );
		expect( view.feedListDisabled ).toBe( true );
	} );

	it( 'hides and keeps every weekly preference for essential emails only', () => {
		expect(
			derivePreferencesView( {
				profile: 'minimal',
				weeklySummary: true,
				feedMode: 'selected',
			} )
		).toEqual( {
			selectedProfile: 'minimal',
			weeklyHidden: true,
			weeklyDisabled: true,
			feedsDisabled: true,
			feedListDisabled: true,
		} );
	} );
} );

describe( 'initPreferences', () => {
	function render( { profile = 'marketing', weekly = true, mode = 'all' } ) {
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
						<input type="radio" name="weekly_feed_mode" value="all" ${
							'all' === mode ? 'checked' : ''
						}>
						<input type="radio" name="weekly_feed_mode" value="selected" ${
							'selected' === mode ? 'checked' : ''
						}>
						<fieldset data-fair-audience-feed-list>
							<input type="checkbox" name="weekly_feeds[]" value="3">
						</fieldset>
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
		const { input } = render( { mode: 'all' } );

		expect( input( '[data-fair-audience-feed-list]' ).disabled ).toBe(
			true
		);
		expect(
			input( 'input[value="marketing"]' ).closest( 'label' ).classList
		).toContain( 'selected' );
	} );

	it( 'opens the feed list when choosing feeds', () => {
		const { input } = render( { mode: 'all' } );

		choose( input( 'input[value="selected"]' ) );

		expect( input( '[data-fair-audience-feed-list]' ).disabled ).toBe(
			false
		);
	} );

	it( 'disables the feed choice when the weekly summary is turned off', () => {
		const { input } = render( { mode: 'selected' } );

		choose( input( '[data-fair-audience-weekly-summary]' ) );

		expect( input( '[data-fair-audience-weekly-feeds]' ).disabled ).toBe(
			true
		);
		expect( input( '[data-fair-audience-feed-list]' ).disabled ).toBe(
			true
		);
	} );

	it( 'hides the weekly preferences for essential emails only', () => {
		const { input } = render( {} );

		choose( input( 'input[value="minimal"]' ) );

		expect( input( '[data-fair-audience-weekly]' ).hidden ).toBe( true );
		expect( input( '[data-fair-audience-weekly-summary]' ).disabled ).toBe(
			true
		);
		expect(
			input( 'input[value="minimal"]' ).closest( 'label' ).classList
		).toContain( 'selected' );
		expect(
			input( 'input[value="marketing"]' ).closest( 'label' ).classList
		).not.toContain( 'selected' );
	} );
} );
