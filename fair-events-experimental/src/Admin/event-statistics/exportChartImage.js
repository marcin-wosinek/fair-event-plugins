/**
 * Chart image export for the Statistics tab.
 *
 * Captures one rendered chart card (heading, event subtitle, and the chart's
 * SVG) as a PNG and hands it to the browser as a download.
 *
 * @package FairEventsExperimental
 */

// Elements carrying this attribute (the download control) are left out of the
// captured image.
export const EXPORT_IGNORE_ATTRIBUTE = 'data-chart-export-ignore';

const MAX_FILENAME_PART_LENGTH = 60;

// Written as a string so the escaped range survives tooling that would
// otherwise expand it into invisible literal characters.
const COMBINING_DIACRITICS = new RegExp( '[\\u0300-\\u036f]', 'g' );

/**
 * Turn a display name into a filesystem-safe filename component.
 *
 * Diacritics are dropped, letters and digits from any script are kept, and
 * every other run of characters (including path separators and reserved
 * characters) collapses to a single hyphen.
 *
 * @param {string|null|undefined} value    Display name.
 * @param {string}                fallback Component used when nothing safe remains.
 * @return {string} Lowercase, length-limited component; never empty.
 */
export function toFilenamePart( value, fallback ) {
	const part = String( value ?? '' )
		.normalize( 'NFKD' )
		.replace( COMBINING_DIACRITICS, '' )
		.normalize( 'NFC' )
		.toLowerCase()
		.replace( /[^\p{L}\p{N}]+/gu, '-' )
		.replace( /^-+|-+$/g, '' )
		.slice( 0, MAX_FILENAME_PART_LENGTH )
		.replace( /-+$/g, '' );
	return part || fallback;
}

/**
 * Build the download filename for one chart of one event.
 *
 * @param {string} eventName Event display name.
 * @param {string} chartName Chart title.
 * @return {string} Filename such as `yoga-retreat-cumulative-sales.png`.
 */
export function buildChartFilename( eventName, chartName ) {
	return `${ toFilenamePart( eventName, 'event' ) }-${ toFilenamePart(
		chartName,
		'chart'
	) }.png`;
}

function canvasToBlob( canvas ) {
	return new Promise( ( resolve, reject ) => {
		canvas.toBlob( ( blob ) => {
			if ( blob ) {
				resolve( blob );
			} else {
				reject( new Error( 'The chart image could not be encoded.' ) );
			}
		}, 'image/png' );
	} );
}

/**
 * Render an element to a PNG and download it.
 *
 * Temporary browser resources (the canvas bitmap, object URL, and anchor) are
 * released whether or not the export succeeds.
 *
 * @param {HTMLElement} element  Chart card to capture.
 * @param {string}      filename Download filename.
 * @return {Promise<void>} Resolves once the download has been triggered.
 */
export async function downloadElementAsPng( element, filename ) {
	const { default: html2canvas } = await import( 'html2canvas' );

	let canvas = null;
	let objectUrl = null;
	let link = null;
	try {
		canvas = await html2canvas( element, {
			backgroundColor: '#ffffff',
			scale: Math.max( 2, window.devicePixelRatio || 1 ),
			logging: false,
			ignoreElements: ( node ) =>
				node.hasAttribute?.( EXPORT_IGNORE_ATTRIBUTE ) === true,
		} );
		const blob = await canvasToBlob( canvas );

		objectUrl = URL.createObjectURL( blob );
		link = document.createElement( 'a' );
		link.href = objectUrl;
		link.download = filename;
		link.style.display = 'none';
		document.body.appendChild( link );
		link.click();
	} finally {
		link?.remove();
		if ( objectUrl ) {
			URL.revokeObjectURL( objectUrl );
		}
		if ( canvas ) {
			// Release the bitmap memory held by large exports.
			canvas.width = 0;
			canvas.height = 0;
		}
	}
}
