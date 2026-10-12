import { __ } from '@wordpress/i18n';
import { Notice, Spinner } from '@wordpress/components';

/**
 * Says what happened to a budget load: still running, failed (with Retry), or
 * finished without any budgets. Renders nothing once budgets are available.
 *
 * @param {Object}   props
 * @param {string}   props.status         Load status from `useBudgets`.
 * @param {Array}    props.budgets        Loaded budgets.
 * @param {?Object}  props.error          The rejection of a failed load.
 * @param {Function} props.onRetry        Starts another load.
 * @param {string}   props.failureMessage What the failure means on this screen.
 * @param {string}   props.emptyMessage   What an empty list means on this screen.
 */
export default function BudgetLoadStatus( {
	status,
	budgets,
	error,
	onRetry,
	failureMessage,
	emptyMessage,
} ) {
	if ( status === 'loading' ) {
		return (
			<p
				style={ {
					display: 'flex',
					alignItems: 'center',
					gap: '8px',
				} }
			>
				<Spinner style={ { margin: 0 } } />
				{ __( 'Loading budgets…', 'fair-audience-experimental' ) }
			</p>
		);
	}

	if ( status === 'error' ) {
		// The route is missing altogether when Fair Finance is not active.
		const reason =
			error?.code === 'rest_no_route'
				? __(
						'Budgets are unavailable because Fair Finance is not active.',
						'fair-audience-experimental'
				  )
				: __(
						'Budgets could not be loaded.',
						'fair-audience-experimental'
				  );

		return (
			<Notice
				status="error"
				isDismissible={ false }
				actions={ [
					{
						label: __( 'Retry', 'fair-audience-experimental' ),
						onClick: onRetry,
						variant: 'secondary',
					},
				] }
			>
				<p style={ { margin: 0 } }>{ reason }</p>
				<p style={ { margin: '4px 0 0' } }>{ failureMessage }</p>
			</Notice>
		);
	}

	if ( status === 'success' && budgets.length === 0 ) {
		return <p>{ emptyMessage }</p>;
	}

	return null;
}
