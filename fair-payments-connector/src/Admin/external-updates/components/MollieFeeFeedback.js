/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { Notice } from '@wordpress/components';

/**
 * Internal dependencies
 */
import RunResultNotice from './RunResultNotice.js';

/**
 * Progress and outcome notices for a missing-Mollie-fee load.
 *
 * @param {Object}      props
 * @param {Object|null} props.progress    Batch progress while running.
 * @param {Object|null} props.result      Finished run, request error, or info.
 * @param {Function}    props.clearResult Dismiss handler.
 * @return {JSX.Element} Notices.
 */
const MollieFeeFeedback = ( { progress, result, clearResult } ) => (
	<>
		<RunResultNotice
			run={ result?.run }
			error={ result?.error }
			onClose={ clearResult }
		/>
		{ result?.info && (
			<Notice status="info" onRemove={ clearResult }>
				{ result.info }
			</Notice>
		) }
		{ progress && (
			<Notice status="info" isDismissible={ false }>
				{ sprintf(
					/* translators: 1: processed count, 2: total count, 3: updated count, 4: failed count */
					__(
						'Loading Mollie fees: %1$d of %2$d (updated: %3$d, failed: %4$d)',
						'fair-payments-connector'
					),
					progress.processed,
					progress.total,
					progress.updated,
					progress.failed
				) }
			</Notice>
		) }
	</>
);

export default MollieFeeFeedback;
