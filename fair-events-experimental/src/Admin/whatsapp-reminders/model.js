/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';

export const PATH = '/fair-events-experimental/v1/whatsapp/reminders';
export const TEMPLATES_PATH = '/fair-events-experimental/v1/whatsapp/templates';

export const DAYS = [
	{ value: '1', label: __( 'Monday', 'fair-events-experimental' ) },
	{ value: '2', label: __( 'Tuesday', 'fair-events-experimental' ) },
	{ value: '3', label: __( 'Wednesday', 'fair-events-experimental' ) },
	{ value: '4', label: __( 'Thursday', 'fair-events-experimental' ) },
	{ value: '5', label: __( 'Friday', 'fair-events-experimental' ) },
	{ value: '6', label: __( 'Saturday', 'fair-events-experimental' ) },
	{ value: '7', label: __( 'Sunday', 'fair-events-experimental' ) },
];

/** Number in international format, as the server accepts it. */
const NUMBER_PATTERN = /^\+?[\d\s().-]+$/;

/**
 * Digits of a number as typed, or '' when it cannot be an international
 * number. Mirrors Client::normalize_recipient().
 *
 * @param {string} value Number as typed.
 * @return {string} Digits.
 */
export function numberDigits( value ) {
	const trimmed = String( value || '' ).trimStart();
	if ( ! NUMBER_PATTERN.test( trimmed ) ) {
		return '';
	}
	const digits = trimmed.replace( /\D/g, '' );
	return /^[1-9]\d{6,14}$/.test( digits ) ? digits : '';
}

/**
 * Whether two links point at the same page, ignoring a trailing slash.
 *
 * @param {string} a Link.
 * @param {string} b Link.
 * @return {boolean} Whether they match.
 */
export function sameUrl( a, b ) {
	const trim = ( url ) => {
		let text = String( url || '' );
		while ( text.endsWith( '/' ) ) {
			text = text.slice( 0, -1 );
		}
		return text;
	};
	return '' !== trim( a ) && trim( a ) === trim( b );
}

/**
 * Key of a template choice in the selection.
 *
 * @param {{name: string, language: string}|null} template Template.
 * @return {string} `name|language`, or ''.
 */
export function templateKey( template ) {
	return template ? `${ template.name }|${ template.language }` : '';
}

/**
 * The editable state of a feed's saved reminder.
 *
 * @param {Object|null} reminder Saved reminder from the API, or null.
 * @return {Object} Draft.
 */
export function draftFromReminder( reminder ) {
	const recipient = reminder?.recipient || null;
	return {
		enabled: reminder ? reminder.enabled : false,
		day_of_week: String( reminder?.day_of_week || 1 ),
		time_of_day: reminder?.time_of_day || '10:00',
		kind: recipient ? recipient.kind : 'none',
		member_id: recipient?.member_id ? String( recipient.member_id ) : '',
		name: 'standalone' === recipient?.kind ? recipient.name : '',
		number: 'standalone' === recipient?.kind ? recipient.number : '',
		consent: reminder ? reminder.consent_confirmed : false,
		template: templateKey( reminder?.template || null ),
	};
}

/**
 * Whether a change moves the reminder to another number, so the consent
 * given so far no longer applies.
 *
 * @param {string} field Changed field.
 * @return {boolean} Whether consent must be given again.
 */
export function changesDestination( field ) {
	return [ 'kind', 'member_id', 'number' ].includes( field );
}

/**
 * Apply a field change to a draft. Choosing another collaborator or number
 * clears the consent box.
 *
 * @param {Object} draft Draft.
 * @param {string} field Field.
 * @param {*}      value New value.
 * @return {Object} New draft.
 */
export function updateDraft( draft, field, value ) {
	const next = { ...draft, [ field ]: value };
	if ( changesDestination( field ) && draft[ field ] !== value ) {
		next.consent = false;
	}
	return next;
}

/**
 * The collaborator a draft designates, for the consent text.
 *
 * @param {Object}   draft   Draft.
 * @param {Object[]} members Team members with `id`, `name` and `number`.
 * @return {{name: string, number: string}|null} Collaborator, or null.
 */
export function draftCollaborator( draft, members ) {
	if ( 'member' === draft.kind ) {
		const member = members.find(
			( { id } ) => String( id ) === draft.member_id
		);
		return member ? { name: member.name, number: member.number } : null;
	}
	if ( 'standalone' === draft.kind ) {
		return { name: draft.name.trim(), number: draft.number.trim() };
	}
	return null;
}

/**
 * Why a draft cannot be saved yet.
 *
 * @param {Object}   draft   Draft.
 * @param {Object[]} members Team members.
 * @return {string|null} The first problem, or null.
 */
export function draftProblem( draft, members ) {
	if ( 'member' === draft.kind ) {
		const member = members.find(
			( { id } ) => String( id ) === draft.member_id
		);
		if ( ! member ) {
			return __( 'Choose a team member.', 'fair-events-experimental' );
		}
		if ( ! member.number ) {
			return __(
				'This team member has no phone number in international format. Add it in Team members, or enter a name and number instead.',
				'fair-events-experimental'
			);
		}
	}
	if ( 'standalone' === draft.kind ) {
		if ( ! draft.name.trim() ) {
			return __(
				'Enter the collaborator’s name.',
				'fair-events-experimental'
			);
		}
		if ( ! numberDigits( draft.number ) ) {
			return __(
				'Enter the WhatsApp number in international format, with the country code, such as +34 600 123 456.',
				'fair-events-experimental'
			);
		}
	}
	if ( 'none' !== draft.kind && ! draft.consent ) {
		return __(
			'Confirm that the collaborator agreed to receive these reminders at this number.',
			'fair-events-experimental'
		);
	}
	if ( ! /^([01]\d|2[0-3]):[0-5]\d$/.test( draft.time_of_day ) ) {
		return __(
			'Enter the time as hours and minutes.',
			'fair-events-experimental'
		);
	}
	return null;
}

/**
 * The request body that saves a draft.
 *
 * @param {Object} draft Draft.
 * @return {Object} PUT body.
 */
export function payloadFromDraft( draft ) {
	let recipient = null;
	if ( 'member' === draft.kind ) {
		recipient = {
			kind: 'member',
			member_id: Number.parseInt( draft.member_id, 10 ),
		};
	} else if ( 'standalone' === draft.kind ) {
		recipient = {
			kind: 'standalone',
			name: draft.name.trim(),
			number: draft.number.trim(),
		};
	}
	const [ name, language ] = draft.template
		? draft.template.split( '|' )
		: [];
	return {
		enabled: draft.enabled,
		day_of_week: Number.parseInt( draft.day_of_week, 10 ),
		time_of_day: draft.time_of_day,
		recipient,
		consent: null !== recipient && draft.consent,
		template: name ? { name, language } : null,
	};
}

/**
 * Approved templates whose button opens a feed's summary page.
 *
 * @param {Object[]} templates  Templates from the API, with `button_urls`.
 * @param {string}   summaryUrl The feed's weekly-summary link.
 * @return {Object[]} Matching templates.
 */
export function templatesForFeed( templates, summaryUrl ) {
	return templates.filter( ( template ) =>
		( template.button_urls || [] ).some( ( url ) =>
			sameUrl( url, summaryUrl )
		)
	);
}

/**
 * A feed's status in the list: its tone, label and what to fix.
 *
 * @param {Object}  feed  Feed from the API.
 * @param {boolean} ready Whether the WhatsApp connection is validated.
 * @return {{tone: string, label: string, detail: string|null}} Status.
 */
export function feedStatus( feed, ready ) {
	const reminder = feed.reminder;
	if ( ! reminder ) {
		return {
			tone: 'neutral',
			label: __( 'Not set up', 'fair-events-experimental' ),
			detail: null,
		};
	}
	if ( ! reminder.enabled ) {
		return {
			tone: 'neutral',
			label: __( 'Paused', 'fair-events-experimental' ),
			detail: null,
		};
	}
	const problem = reminderProblem( feed, ready );
	return problem
		? {
				tone: 'warning',
				label: __( 'On, not sending', 'fair-events-experimental' ),
				detail: problem,
			}
		: {
				tone: 'success',
				label: __( 'On', 'fair-events-experimental' ),
				detail: null,
			};
}

/**
 * What keeps a saved, enabled reminder from sending.
 *
 * @param {Object}  feed  Feed from the API.
 * @param {boolean} ready Whether the WhatsApp connection is validated.
 * @return {string|null} Explanation, or null.
 */
export function reminderProblem( feed, ready ) {
	const reminder = feed.reminder;
	if ( ! feed.feed_enabled ) {
		return __( 'The event feed is disabled.', 'fair-events-experimental' );
	}
	if ( ! feed.has_page ) {
		return __(
			'The event feed has no page, so its weekly summary is unavailable.',
			'fair-events-experimental'
		);
	}
	switch ( reminder.destination_status ) {
		case 'none':
			return __(
				'No collaborator is designated.',
				'fair-events-experimental'
			);
		case 'directory_off':
			return __(
				'The team member directory is turned off.',
				'fair-events-experimental'
			);
		case 'member_missing':
			return __(
				'The collaborator’s team member profile was deleted.',
				'fair-events-experimental'
			);
		case 'no_number':
			return __(
				'The collaborator has no number in international format.',
				'fair-events-experimental'
			);
		case 'needs_confirmation':
			return __(
				'The collaborator’s number changed. Confirm their agreement again.',
				'fair-events-experimental'
			);
	}
	if ( ! reminder.template ) {
		return __( 'No template is chosen.', 'fair-events-experimental' );
	}
	if ( ! reminder.template.matches_feed ) {
		return sprintf(
			/* translators: %s: link to the feed's weekly summary */
			__(
				'The feed’s link changed to %s. Choose a template whose button opens it.',
				'fair-events-experimental'
			),
			feed.summary_url
		);
	}
	if ( ! ready ) {
		return __(
			'The WhatsApp connection is not validated.',
			'fair-events-experimental'
		);
	}
	return null;
}

/**
 * A run's tone in the history.
 *
 * @param {Object} run Run from the API.
 * @return {string} StatusLabel tone.
 */
export function runTone( run ) {
	if ( 'skipped' === run.state ) {
		return 'neutral';
	}
	if ( 'failed' === run.state || 'not_accepted' === run.state ) {
		return 'error';
	}
	const outcome = run.delivery?.outcome;
	if ( 'failed' === outcome || 'not_accepted' === outcome ) {
		return 'error';
	}
	if ( 'delivered' === outcome || 'read' === outcome ) {
		return 'success';
	}
	return 'accepted' === run.state ? 'info' : 'warning';
}
