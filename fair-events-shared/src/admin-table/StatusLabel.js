/**
 * Compact sentence-case status: a colored marker plus text, so the status
 * never depends on color alone.
 *
 * @package FairEventsShared
 */

export const STATUS_TONES = [
	'success',
	'warning',
	'error',
	'info',
	'neutral',
];

/**
 * @param {Object}      props
 * @param {string}      props.tone     success, warning, error, info or neutral (default).
 * @param {JSX.Element} props.children Status text, e.g. "Paid".
 * @return {JSX.Element} The status.
 */
export default function StatusLabel( { tone = 'neutral', children } ) {
	const safeTone = STATUS_TONES.includes( tone ) ? tone : 'neutral';
	return (
		<span
			className={ `fair-admin-table__status fair-admin-table__status--${ safeTone }` }
		>
			{ children }
		</span>
	);
}
