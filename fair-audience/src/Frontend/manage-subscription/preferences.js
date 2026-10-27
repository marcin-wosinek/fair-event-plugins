/**
 * Email preferences form on the manage-subscription page.
 *
 * Without this script the form still posts every control; the server
 * ignores the ones that do not apply.
 *
 * @package FairAudience
 */

import { createPreferencesModel } from './preferencesModel.js';

/**
 * @param {Document|Element} root Where to look for the form.
 * @return {Object|null} The form's model, or null when there is no form.
 */
export function initPreferences( root ) {
	const form = root.querySelector( '[data-fair-audience-preferences]' );

	if ( ! form ) {
		return null;
	}

	const profileInputs = Array.from(
		form.querySelectorAll( 'input[name="email_profile"]' )
	);
	const weekly = form.querySelector( '[data-fair-audience-weekly]' );
	const weeklySummary = form.querySelector(
		'[data-fair-audience-weekly-summary]'
	);
	const feeds = form.querySelector( '[data-fair-audience-weekly-feeds]' );
	const feedList = form.querySelector( '[data-fair-audience-feed-list]' );
	const modeInputs = Array.from(
		form.querySelectorAll( 'input[name="weekly_feed_mode"]' )
	);
	const checkedValue = ( inputs, fallback ) =>
		inputs.find( ( input ) => input.checked )?.value ?? fallback;

	const render = ( view ) => {
		profileInputs.forEach( ( input ) => {
			input
				.closest( '.fair-audience-subscription-option' )
				?.classList.toggle(
					'selected',
					input.value === view.selectedProfile
				);
		} );
		if ( weekly ) {
			weekly.hidden = view.weeklyHidden;
		}
		if ( weeklySummary ) {
			weeklySummary.disabled = view.weeklyDisabled;
		}
		if ( feeds ) {
			feeds.disabled = view.feedsDisabled;
		}
		if ( feedList ) {
			feedList.disabled = view.feedListDisabled;
		}
	};

	// The server-rendered controls are read once, to start the model.
	const model = createPreferencesModel(
		{
			profile: checkedValue( profileInputs, 'minimal' ),
			weeklySummary: weeklySummary ? weeklySummary.checked : false,
			feedMode: checkedValue( modeInputs, 'all' ),
		},
		render
	);

	profileInputs.forEach( ( input ) =>
		input.addEventListener( 'change', () => {
			if ( input.checked ) {
				model.update( { profile: input.value } );
			}
		} )
	);
	weeklySummary?.addEventListener( 'change', () =>
		model.update( { weeklySummary: weeklySummary.checked } )
	);
	modeInputs.forEach( ( input ) =>
		input.addEventListener( 'change', () => {
			if ( input.checked ) {
				model.update( { feedMode: input.value } );
			}
		} )
	);

	model.update( {} );

	return model;
}
