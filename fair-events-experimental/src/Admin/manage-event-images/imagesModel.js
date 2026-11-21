/**
 * Event Images - list and focal-region model
 *
 * Pure helpers shared by the Images tab and its tests. A focal region is a
 * circle on the image as displayed: centerX and centerY are fractions of
 * the width and height from the top left, radius a fraction of the shorter
 * side (see docs/event-images.md).
 *
 * @package FairEventsExperimental
 */

/** Smallest radius the editor offers, as a fraction of the shorter side. */
export const MIN_RADIUS = 0.02;

/** Largest radius that can fit: a circle touching both long edges. */
export const MAX_RADIUS = 0.5;

/** Decimal places sent to the server, as it stores them. */
const PRECISION = 6;

let nextKey = 1;

/**
 * Key of a list: the event's own, or one programme item's.
 *
 * @param {number} scheduleItemId Programme item ID, 0 for the event.
 * @return {string} List key.
 */
export function listKey( scheduleItemId ) {
	return scheduleItemId ? `item:${ scheduleItemId }` : 'event';
}

/**
 * Client entry for a saved association.
 *
 * @param {Object} image Association from the REST response.
 * @return {Object} Entry.
 */
export function entryFromImage( image ) {
	return {
		key: `saved-${ image.id }`,
		id: image.id,
		attachmentId: image.attachmentId,
		available: image.available,
		unavailableReason: image.unavailableReason,
		sourceUrl: image.sourceUrl,
		width: image.width,
		height: image.height,
		sourceRevision: image.sourceRevision,
		title: image.title,
		altText: image.altText,
		focalRegion: image.focalRegion,
		focalRegionNeedsReview: !! image.focalRegionNeedsReview,
	};
}

/**
 * Client entry for an image just chosen in the Media Library. It has no
 * association yet and no circle; one can be marked once it is saved and
 * the server has reported its oriented size.
 *
 * @param {Object} attachment Attachment from the media frame (toJSON()).
 * @return {Object} Entry.
 */
export function entryFromAttachment( attachment ) {
	return {
		key: `new-${ nextKey++ }`,
		id: null,
		attachmentId: attachment.id,
		available: true,
		unavailableReason: null,
		sourceUrl: attachment.url,
		width: null,
		height: null,
		sourceRevision: null,
		title: attachment.title || '',
		altText: attachment.alt || null,
		focalRegion: null,
		focalRegionNeedsReview: false,
	};
}

/**
 * A list from the REST response.
 *
 * @param {Object} list `{ revision, images }`.
 * @return {Object} `{ revision, entries, saved }`.
 */
export function listFromResponse( list ) {
	const entries = ( list.images || [] ).map( entryFromImage );
	return { revision: list.revision, entries, saved: serialize( entries ) };
}

/**
 * What a save would change, for dirty tracking.
 *
 * @param {Object[]} entries List entries.
 * @return {string} Serialized list.
 */
export function serialize( entries ) {
	return JSON.stringify(
		entries.map( ( entry ) => [
			entry.id,
			entry.attachmentId,
			entry.focalRegion,
		] )
	);
}

/**
 * Whether a list holds unsaved changes.
 *
 * @param {Object|undefined} list `{ entries, saved }`.
 * @return {boolean} True when dirty.
 */
export function isDirty( list ) {
	return !! list && serialize( list.entries ) !== list.saved;
}

/**
 * Request body for saving a list.
 *
 * @param {Object} list `{ revision, entries }`.
 * @return {Object} `{ revision, images }`.
 */
export function toPayload( list ) {
	return {
		revision: list.revision,
		images: list.entries.map( ( entry ) => ( {
			...( entry.id ? { id: entry.id } : {} ),
			attachmentId: entry.attachmentId,
			focalRegion: entry.focalRegion
				? roundCircle( entry.focalRegion )
				: null,
			sourceRevision: entry.sourceRevision,
		} ) ),
	};
}

/**
 * Move an entry up (-1) or down (+1).
 *
 * @param {Object[]} entries List entries.
 * @param {number}   index   Entry index.
 * @param {number}   delta   -1 or +1.
 * @return {Object[]} New list.
 */
export function moveEntry( entries, index, delta ) {
	const target = index + delta;
	if ( target < 0 || target >= entries.length ) {
		return entries;
	}
	const next = [ ...entries ];
	[ next[ index ], next[ target ] ] = [ next[ target ], next[ index ] ];
	return next;
}

/**
 * Add chosen attachments, skipping the ones already in the list and the
 * ones that are not supported images.
 *
 * @param {Object[]} entries     List entries.
 * @param {Object[]} attachments Chosen attachments.
 * @param {string[]} mimeTypes   Supported MIME types.
 * @return {{entries: Object[], duplicates: Object[], unsupported: Object[]}} Result.
 */
export function addAttachments( entries, attachments, mimeTypes ) {
	const present = new Set( entries.map( ( entry ) => entry.attachmentId ) );
	const added = [];
	const duplicates = [];
	const unsupported = [];
	for ( const attachment of attachments ) {
		if ( ! mimeTypes.includes( attachment.mime ) ) {
			unsupported.push( attachment );
		} else if ( present.has( attachment.id ) ) {
			duplicates.push( attachment );
		} else {
			present.add( attachment.id );
			added.push( entryFromAttachment( attachment ) );
		}
	}
	return { entries: [ ...entries, ...added ], duplicates, unsupported };
}

/**
 * Whether a focal region can be marked on an entry.
 *
 * @param {Object} entry List entry.
 * @return {boolean} True when the oriented size is known.
 */
export function canMarkFocalRegion( entry ) {
	return (
		entry.available &&
		!! entry.id &&
		!! entry.sourceRevision &&
		entry.width > 0 &&
		entry.height > 0
	);
}

/**
 * The circle the editor starts with when the organizer asks for one.
 *
 * @return {Object} Circle.
 */
export function startingCircle() {
	return { centerX: 0.5, centerY: 0.5, radius: 0.25 };
}

/**
 * Keep a circle inside a width × height image.
 *
 * @param {Object} circle `{ centerX, centerY, radius }`.
 * @param {number} width  Oriented width.
 * @param {number} height Oriented height.
 * @return {Object} Clamped circle.
 */
export function clampCircle( circle, width, height ) {
	const shorter = Math.min( width, height );
	const radius = Math.min(
		MAX_RADIUS,
		Math.max( MIN_RADIUS, Number( circle.radius ) || MIN_RADIUS )
	);
	const marginX = ( radius * shorter ) / width;
	const marginY = ( radius * shorter ) / height;
	const clamp = ( value, min, max ) =>
		Math.min( max, Math.max( min, Number( value ) || 0 ) );
	return {
		centerX: clamp( circle.centerX, marginX, 1 - marginX ),
		centerY: clamp( circle.centerY, marginY, 1 - marginY ),
		radius,
	};
}

/**
 * Circle as CSS percentages of the displayed image box.
 *
 * @param {Object} circle `{ centerX, centerY, radius }`.
 * @param {number} width  Oriented width.
 * @param {number} height Oriented height.
 * @return {Object} `{ left, top, width, height }` in percent.
 */
export function circleStyle( circle, width, height ) {
	const diameter = 2 * circle.radius * Math.min( width, height );
	return {
		left: `${ circle.centerX * 100 }%`,
		top: `${ circle.centerY * 100 }%`,
		width: `${ ( diameter / width ) * 100 }%`,
		height: `${ ( diameter / height ) * 100 }%`,
	};
}

/**
 * Round a circle to the stored precision, staying inside the image the
 * clamp already guaranteed.
 *
 * @param {Object} circle Circle.
 * @return {Object} Rounded circle.
 */
function roundCircle( circle ) {
	const factor = 10 ** PRECISION;
	return {
		centerX: Math.round( circle.centerX * factor ) / factor,
		centerY: Math.round( circle.centerY * factor ) / factor,
		// Down, so rounding never pushes the circle past an edge.
		radius: Math.floor( circle.radius * factor ) / factor,
	};
}
