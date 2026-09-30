/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { Notice } from '@wordpress/components';

/**
 * Internal dependencies
 */
import { formatCounts } from '../format.js';

const NOTICE_STATUS = {
	succeeded: 'success',
	partial: 'warning',
	failed: 'error',
	interrupted: 'error',
};

/**
 * Sentence describing a finished run.
 *
 * @param {Object} run Run from the REST API.
 * @return {string} Summary.
 */
export const describeRun = ( run ) => {
	const counts = formatCounts( run.counts );

	switch ( run.status ) {
		case 'succeeded':
			/* translators: %s: counts, e.g. "3 new, 1 updated" */
			return sprintf(
				__( 'Finished: %s.', 'fair-payments-connector' ),
				counts
			);
		case 'partial':
			return sprintf(
				/* translators: 1: counts, e.g. "3 new, 2 failed"; 2: reason the run stopped */
				__( 'Partly completed: %1$s. %2$s', 'fair-payments-connector' ),
				counts,
				run.error_message || ''
			).trim();
		default:
			return sprintf(
				/* translators: %s: reason the run failed */
				__( 'Failed. %s', 'fair-payments-connector' ),
				run.error_message || ''
			).trim();
	}
};

/**
 * Feedback for one action: the server's run outcome, or a request error.
 *
 * @param {Object}      props
 * @param {Object|null} props.run     Finished run, when one was recorded.
 * @param {string|null} props.error   Request error without a run.
 * @param {Function}    props.onClose Dismiss handler.
 * @return {JSX.Element|null} Notice.
 */
const RunResultNotice = ( { run, error, onClose } ) => {
	if ( run && 'running' !== run.status ) {
		return (
			<Notice
				status={ NOTICE_STATUS[ run.status ] || 'info' }
				onRemove={ onClose }
			>
				{ describeRun( run ) }
			</Notice>
		);
	}

	if ( error ) {
		return (
			<Notice status="error" onRemove={ onClose }>
				{ error }
			</Notice>
		);
	}

	return null;
};

export default RunResultNotice;
