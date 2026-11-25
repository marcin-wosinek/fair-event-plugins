/**
 * Marketing assets - editor model
 *
 * Pure helpers for the Marketing tab's editor: the form state of one asset,
 * whether it changed, whether it can be saved (and why not), and the
 * request body a save sends. The form keeps text exactly as typed.
 *
 * Linking a team member publishes their name on the public asset page, so
 * a save that adds one needs `publishMemberNames`; members linked before
 * that confirmation existed stay private until a save publishes them.
 *
 * @package FairEventsExperimental
 */

/**
 * Whether text has a character that is not whitespace, a separator, a
 * control or a formatting character. Mirrors the server's check.
 *
 * @param {string} text Text.
 * @return {boolean} True when the text says something.
 */
export function hasMeaningfulText( text ) {
	return /[^\s\p{Z}\p{Cc}\p{Cf}]/u.test( text || '' );
}

/**
 * Form state for a new asset.
 *
 * @return {Object} Empty form.
 */
export function emptyForm() {
	return {
		label: '',
		text: '',
		image: null,
		memberIds: [],
		scheduleItemId: null,
		publishMemberNames: false,
	};
}

/**
 * Form state for a stored asset.
 *
 * @param {Object} asset Asset from the API.
 * @return {Object} Form.
 */
export function formFromAsset( asset ) {
	return {
		label: asset.label || '',
		text: asset.text || '',
		image: asset.image || null,
		memberIds: [ ...( asset.member_ids || [] ) ],
		scheduleItemId: asset.schedule_item_id || null,
		publishMemberNames: false,
	};
}

/**
 * Image state from a Media Library attachment.
 *
 * @param {Object}   attachment Attachment from `wp.media` (`toJSON()`).
 * @param {string[]} mimeTypes  Accepted MIME types.
 * @return {Object} Image, `available: false` for an unsupported type.
 */
export function imageFromAttachment( attachment, mimeTypes ) {
	const supported = mimeTypes.includes( attachment.mime );
	return {
		attachment_id: attachment.id,
		available: supported,
		unavailable_reason: supported ? null : 'unsupported_type',
		url: attachment.url || null,
		mime_type: attachment.mime || null,
		width: attachment.width || null,
		height: attachment.height || null,
		alt: attachment.alt || null,
		title: attachment.title || '',
	};
}

const byNumber = ( x, y ) => x - y;

const sameIds = ( a, b ) => {
	if ( a.length !== b.length ) {
		return false;
	}
	const sortedB = [ ...b ].sort( byNumber );
	return [ ...a ].sort( byNumber ).every( ( id, i ) => id === sortedB[ i ] );
};

/**
 * Whether the form differs from what it was opened with.
 *
 * @param {Object} form     Current form.
 * @param {Object} original Form as opened.
 * @return {boolean} True when there are unsaved changes.
 */
export function isFormDirty( form, original ) {
	return (
		form.label !== original.label ||
		form.text !== original.text ||
		( form.image?.attachment_id || null ) !==
			( original.image?.attachment_id || null ) ||
		form.scheduleItemId !== original.scheduleItemId ||
		form.publishMemberNames !== original.publishMemberNames ||
		! sameIds( form.memberIds, original.memberIds )
	);
}

/**
 * Which selected members a save would make public: those added in this
 * edit, and those linked earlier whose names are not public yet.
 *
 * @param {Object}      form          Form.
 * @param {Object|null} original      Form as opened; null for a create.
 * @param {Object[]}    linkedMembers Stored links, `{ id, public }`.
 * @return {{ added: number[], unpublished: number[] }} Member IDs.
 */
export function publicationNeeds( form, original, linkedMembers = [] ) {
	const before = original ? original.memberIds : [];
	const added = form.memberIds.filter( ( id ) => ! before.includes( id ) );
	const unpublished = form.memberIds.filter(
		( id ) =>
			before.includes( id ) &&
			linkedMembers.some(
				( member ) => member.id === id && false === member.public
			)
	);
	return { added, unpublished };
}

/**
 * Why the form cannot be saved, or an empty string when it can.
 *
 * @param {Object}   form       Form.
 * @param {Object}   messages   Translated reasons.
 * @param {string}   messages.label   No use case.
 * @param {string}   messages.content Neither text nor a usable image.
 * @param {string}   messages.image   The chosen image cannot be used.
 * @param {string}   [messages.tooLong] Text or label over the limit.
 * @param {string}   [messages.publication] Members added without confirming their names are public.
 * @param {Object}   limits     `{ maxLabel, maxText }`.
 * @param {Object}   [needs]    From publicationNeeds().
 * @return {string} Reason.
 */
export function saveBlocker( form, messages, limits = {}, needs = null ) {
	if ( ! hasMeaningfulText( form.label ) ) {
		return messages.label;
	}
	if (
		( limits.maxLabel && [ ...form.label ].length > limits.maxLabel ) ||
		( limits.maxText && [ ...form.text ].length > limits.maxText )
	) {
		return messages.tooLong || '';
	}
	if ( form.image && ! form.image.available ) {
		return messages.image;
	}
	if ( ! hasMeaningfulText( form.text ) && ! form.image ) {
		return messages.content;
	}
	if ( needs?.added.length && ! form.publishMemberNames ) {
		return messages.publication || '';
	}
	return '';
}

/**
 * Request body for a save. A create sends every field; an update sends
 * only what changed, so a concurrent edit of another field is kept.
 * Publishing names always sends the member list it applies to.
 *
 * @param {Object}      form     Form.
 * @param {Object|null} original Form as opened; null for a create.
 * @return {Object} Body.
 */
export function toPayload( form, original = null ) {
	const full = {
		label: form.label,
		text: form.text,
		attachment_id: form.image ? form.image.attachment_id : null,
		member_ids: form.memberIds,
		schedule_item_id: form.scheduleItemId,
	};
	if ( form.publishMemberNames ) {
		full.publish_member_names = true;
	}
	if ( ! original ) {
		return full;
	}
	const body = {};
	if ( form.label !== original.label ) {
		body.label = full.label;
	}
	if ( form.text !== original.text ) {
		body.text = full.text;
	}
	if (
		( form.image?.attachment_id || null ) !==
		( original.image?.attachment_id || null )
	) {
		body.attachment_id = full.attachment_id;
	}
	if (
		form.publishMemberNames ||
		! sameIds( form.memberIds, original.memberIds )
	) {
		body.member_ids = full.member_ids;
	}
	if ( form.publishMemberNames ) {
		body.publish_member_names = true;
	}
	if ( form.scheduleItemId !== original.scheduleItemId ) {
		body.schedule_item_id = full.schedule_item_id;
	}
	return body;
}

/**
 * Display name of a team member.
 *
 * @param {Object} member `{ name, surname }`.
 * @return {string} Name.
 */
export function memberName( member ) {
	return [ member.name, member.surname ].filter( Boolean ).join( ' ' );
}
