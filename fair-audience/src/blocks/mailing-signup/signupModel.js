import { __ } from '@wordpress/i18n';

/**
 * State and derived values of one Mailing Signup form.
 *
 * @package FairAudience
 */

/**
 * Weekly-update state of a form, from the controls the server rendered.
 *
 * @param {Object}  options
 * @param {string}  options.config     Signed form configuration; empty when the form offers no weekly update.
 * @param {string}  options.feedMode   'hidden' or 'multiselect'.
 * @param {boolean} options.offered    Whether the weekly checkbox is shown.
 * @param {boolean} options.checked    Whether the weekly checkbox starts checked.
 * @param {boolean} options.marketing  Whether the marketing checkbox is shown and starts checked;
 *                                     null when the form does not ask for marketing consent.
 * @return {Object|null} Weekly state, or null when the form offers no weekly update.
 */
export function createWeeklyState( {
	config,
	feedMode,
	offered,
	checked,
	marketing = null,
} ) {
	if ( ! config ) {
		return null;
	}

	return {
		config,
		feedMode: feedMode === 'hidden' ? 'hidden' : 'multiselect',
		offered: !! offered,
		checked: !! offered && !! checked,
		feedIds: [],
		marketing:
			!! offered && marketing !== null && marketing !== undefined
				? !! marketing
				: null,
	};
}

/**
 * Check or uncheck general marketing emails. Feeds do not depend on it.
 *
 * @param {Object}  weekly  Weekly state.
 * @param {boolean} checked Whether marketing emails are wanted.
 * @return {Object} New weekly state.
 */
export function setMarketingChecked( weekly, checked ) {
	return weekly.marketing === null
		? weekly
		: { ...weekly, marketing: !! checked };
}

/**
 * Whether the weekly choice subscribes to at least one feed.
 *
 * @param {Object} weekly Weekly state.
 * @return {boolean}
 */
function subscribesToFeeds( weekly ) {
	return (
		weekly.checked &&
		( weekly.feedMode === 'hidden' || weekly.feedIds.length > 0 )
	);
}

/**
 * Check or uncheck the weekly update.
 *
 * @param {Object}  weekly  Weekly state.
 * @param {boolean} checked Whether the weekly update is wanted.
 * @return {Object} New weekly state.
 */
export function setWeeklyChecked( weekly, checked ) {
	return { ...weekly, checked: weekly.offered && !! checked };
}

/**
 * Select or deselect an event feed.
 *
 * @param {Object}  weekly   Weekly state.
 * @param {number}  feedId   Feed ID.
 * @param {boolean} selected Whether the feed is selected.
 * @return {Object} New weekly state.
 */
export function setFeedSelected( weekly, feedId, selected ) {
	const others = weekly.feedIds.filter( ( id ) => id !== feedId );
	return {
		...weekly,
		feedIds: selected ? [ ...others, feedId ] : others,
	};
}

/**
 * Why the weekly choice cannot be submitted.
 *
 * @param {Object|null} weekly Weekly state.
 * @return {string|null} Error message, or null when it can be submitted.
 */
export function weeklyError( weekly ) {
	if (
		weekly &&
		weekly.checked &&
		weekly.feedMode === 'multiselect' &&
		weekly.feedIds.length === 0
	) {
		return __(
			'Please choose at least one event feed to receive the weekly update.',
			'fair-audience'
		);
	}

	if (
		weekly &&
		weekly.marketing === false &&
		! subscribesToFeeds( weekly )
	) {
		return __(
			'Please choose marketing emails or at least one event feed.',
			'fair-audience'
		);
	}

	return null;
}

/**
 * Weekly fields of the signup request.
 *
 * A hidden feed is resolved by the server from the signed configuration,
 * so no feed IDs are sent for it. Declining with no feeds selected sends
 * no feed IDs, leaving the feed choice unchanged. The marketing choice is
 * sent only when the form asks for it.
 *
 * @param {Object|null} weekly Weekly state.
 * @return {Object} Request fields; empty when the form offers no weekly update.
 */
export function weeklyRequestData( weekly ) {
	if ( ! weekly ) {
		return {};
	}

	const data = {
		weekly_config: weekly.config,
		weekly_summary: weekly.checked,
	};
	if ( weekly.feedMode === 'multiselect' && weekly.feedIds.length > 0 ) {
		data.weekly_feed_ids = [ ...weekly.feedIds ].sort( ( a, b ) => a - b );
	}
	if ( weekly.marketing !== null ) {
		data.marketing = weekly.marketing;
	}

	return data;
}

/**
 * Message to show for a successful signup response.
 *
 * @param {Object} response       API response.
 * @param {string} successMessage The block's message for a new signup.
 * @return {{message: string, type: string, reset: boolean}} Message, its type, and whether to clear the form.
 */
export function responseNotice( response, successMessage ) {
	switch ( response?.status ) {
		case 'already_subscribed':
		case 'resent':
		case 'manage_link_sent':
			return { message: response.message, type: 'info', reset: false };
		case 'preferences_updated':
		case 'confirmed':
			return {
				message: response.message,
				type: 'success',
				reset: false,
			};
		default:
			return { message: successMessage, type: 'success', reset: true };
	}
}
