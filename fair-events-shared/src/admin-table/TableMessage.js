/**
 * Loading, empty, no-results and error messages for a list. The page decides
 * which one applies; this only renders it consistently.
 *
 * @package FairEventsShared
 */

import { Button, Notice, Spinner } from '@wordpress/components';

/**
 * @param {Object}      props
 * @param {string}      props.status     loading, empty, no-results or error.
 * @param {JSX.Element} props.children   Message text.
 * @param {Function}    props.onRetry    Error only: retry handler.
 * @param {string}      props.retryLabel Error only: retry button text.
 * @param {Function}    props.onClear    No-results only: clear filters handler.
 * @param {string}      props.clearLabel No-results only: clear button text.
 * @param {JSX.Element} props.actions    Empty only: next steps, e.g. a create button.
 * @return {JSX.Element} The message.
 */
export default function TableMessage( {
	status,
	children,
	onRetry,
	retryLabel,
	onClear,
	clearLabel,
	actions,
} ) {
	if ( 'error' === status ) {
		return (
			<Notice
				status="error"
				isDismissible={ false }
				className="fair-admin-table__message fair-admin-table__message--error"
				actions={
					onRetry && retryLabel
						? [
								{
									label: retryLabel,
									onClick: onRetry,
									variant: 'secondary',
								},
							]
						: []
				}
			>
				{ children }
			</Notice>
		);
	}

	if ( 'loading' === status ) {
		return (
			<div
				className="fair-admin-table__message fair-admin-table__message--loading"
				role="status"
			>
				<Spinner />
				<span>{ children }</span>
			</div>
		);
	}

	return (
		<div
			className={ `fair-admin-table__message fair-admin-table__message--${
				'no-results' === status ? 'no-results' : 'empty'
			}` }
		>
			<p>{ children }</p>
			{ 'no-results' === status && onClear && clearLabel && (
				<Button variant="secondary" onClick={ onClear }>
					{ clearLabel }
				</Button>
			) }
			{ 'empty' === status && actions }
		</div>
	);
}
