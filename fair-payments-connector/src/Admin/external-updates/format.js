/**
 * WordPress dependencies
 */
import { __, _n, sprintf } from '@wordpress/i18n';

/**
 * Human-readable, comma-separated run counts; zero counts are left out.
 *
 * @param {Object} counts `{ created, updated, skipped, failed }`.
 * @return {string} Summary, e.g. "3 new, 2 failed".
 */
export const formatCounts = ( counts = {} ) => {
	const parts = [];

	if ( counts.created ) {
		parts.push(
			/* translators: %d: number of newly created transactions */
			sprintf(
				_n(
					'%d new',
					'%d new',
					counts.created,
					'fair-payments-connector'
				),
				counts.created
			)
		);
	}
	if ( counts.updated ) {
		parts.push(
			/* translators: %d: number of updated transactions */
			sprintf(
				_n(
					'%d updated',
					'%d updated',
					counts.updated,
					'fair-payments-connector'
				),
				counts.updated
			)
		);
	}
	if ( counts.skipped ) {
		parts.push(
			/* translators: %d: number of skipped items */
			sprintf(
				_n(
					'%d skipped',
					'%d skipped',
					counts.skipped,
					'fair-payments-connector'
				),
				counts.skipped
			)
		);
	}
	if ( counts.failed ) {
		parts.push(
			/* translators: %d: number of failed items */
			sprintf(
				_n(
					'%d failed',
					'%d failed',
					counts.failed,
					'fair-payments-connector'
				),
				counts.failed
			)
		);
	}

	if ( parts.length === 0 ) {
		return __( 'no changes', 'fair-payments-connector' );
	}

	/* translators: separator between count items, e.g. "3 new, 2 failed" */
	return parts.join( __( ', ', 'fair-payments-connector' ) );
};

/**
 * Translated label for a run status.
 *
 * @param {string} status Run status.
 * @return {string} Label.
 */
export const statusLabel = ( status ) => {
	switch ( status ) {
		case 'running':
			return __( 'Running', 'fair-payments-connector' );
		case 'succeeded':
			return __( 'Succeeded', 'fair-payments-connector' );
		case 'partial':
			return __( 'Partly completed', 'fair-payments-connector' );
		case 'failed':
			return __( 'Failed', 'fair-payments-connector' );
		case 'interrupted':
			return __( 'Interrupted', 'fair-payments-connector' );
		default:
			return status;
	}
};
