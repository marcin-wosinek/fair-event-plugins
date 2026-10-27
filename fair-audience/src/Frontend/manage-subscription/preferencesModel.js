/**
 * State of the email preferences form on the manage-subscription page.
 *
 * The chosen email profile, the weekly summary switch and the weekly feed
 * mode live here; every related control is rendered from the view derived
 * from them and never read back.
 *
 * @package FairAudience
 */

/**
 * Which controls are shown and usable for a state.
 *
 * Disabled controls are not submitted, so the server keeps what they hold:
 * the weekly preferences while the profile is not "marketing", the feed
 * mode while the weekly summary is off, and the chosen feeds while every
 * weekly email is chosen.
 *
 * @param {Object}  state               Form state.
 * @param {string}  state.profile       'marketing' or 'minimal'.
 * @param {boolean} state.weeklySummary Whether the weekly summary is on.
 * @param {string}  state.feedMode      'all' or 'selected'.
 * @return {Object} View.
 */
export function derivePreferencesView( { profile, weeklySummary, feedMode } ) {
	const weeklyOffered = 'marketing' === profile;
	const feedsUsable = weeklyOffered && weeklySummary;

	return {
		selectedProfile: profile,
		weeklyHidden: ! weeklyOffered,
		weeklyDisabled: ! weeklyOffered,
		feedsDisabled: ! feedsUsable,
		feedListDisabled: ! feedsUsable || 'selected' !== feedMode,
	};
}

/**
 * @param {Object}   initialState Form state as the server rendered it.
 * @param {Function} onChange     Called with the derived view after every change.
 * @return {Object} Model.
 */
export function createPreferencesModel( initialState, onChange ) {
	let state = { ...initialState };

	return {
		getState: () => state,

		/**
		 * @param {Object} changes Changed state fields.
		 */
		update( changes ) {
			state = { ...state, ...changes };
			onChange( derivePreferencesView( state ) );
		},
	};
}
