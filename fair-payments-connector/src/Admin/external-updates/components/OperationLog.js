/**
 * WordPress dependencies
 */
import { useState, useEffect } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Notice,
	Spinner,
	__experimentalHStack as HStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import { loadRuns, errorMessage } from '../runs-api.js';
import { formatCounts, statusLabel } from '../format.js';

/**
 * Persistent, newest-first log of External Updates runs.
 *
 * @param {Object} props
 * @param {number} props.refreshKey Changes whenever a run starts or ends.
 * @return {JSX.Element} Log card.
 */
const OperationLog = ( { refreshKey } ) => {
	const [ page, setPage ] = useState( 1 );
	const [ data, setData ] = useState( null );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );

	useEffect( () => {
		let isCurrent = true;
		setLoading( true );

		loadRuns( page )
			.then( ( response ) => {
				if ( isCurrent ) {
					setData( response );
					setError( null );
				}
			} )
			.catch( ( err ) => {
				if ( isCurrent ) {
					setError(
						errorMessage(
							err,
							__(
								'Failed to load the operation log.',
								'fair-payments-connector'
							)
						)
					);
				}
			} )
			.finally( () => {
				if ( isCurrent ) {
					setLoading( false );
				}
			} );

		return () => {
			isCurrent = false;
		};
	}, [ page, refreshKey ] );

	const items = data?.items || [];
	const pages = data?.pages || 1;

	const renderRows = () =>
		items.map( ( run ) => (
			<tr key={ run.id }>
				<td data-label={ __( 'Started', 'fair-payments-connector' ) }>
					{ run.started_at }
				</td>
				<td data-label={ __( 'Source', 'fair-payments-connector' ) }>
					{ run.source_label }
				</td>
				<td data-label={ __( 'Action', 'fair-payments-connector' ) }>
					{ run.action_label }
				</td>
				<td
					data-label={ __( 'Started by', 'fair-payments-connector' ) }
				>
					{ run.user_name || '—' }
				</td>
				<td data-label={ __( 'Outcome', 'fair-payments-connector' ) }>
					<div>
						<span
							className={ `fair-external-updates__status is-${ run.status }` }
						>
							{ statusLabel( run.status ) }
						</span>
						{ run.error_message && (
							<span className="fair-external-updates__reason">
								{ run.error_message }
							</span>
						) }
					</div>
				</td>
				<td data-label={ __( 'Counts', 'fair-payments-connector' ) }>
					{ formatCounts( run.counts ) }
				</td>
			</tr>
		) );

	return (
		<Card>
			<CardHeader>
				<h2 className="fair-external-updates__title">
					{ __( 'Operation log', 'fair-payments-connector' ) }
				</h2>
			</CardHeader>
			<CardBody>
				{ error && (
					<Notice status="error" isDismissible={ false }>
						{ error }
					</Notice>
				) }
				{ loading && ! data && <Spinner /> }
				{ data && items.length === 0 && (
					<p>
						{ __(
							'No external updates have run yet.',
							'fair-payments-connector'
						) }
					</p>
				) }
				{ items.length > 0 && (
					<table className="widefat striped fair-external-updates__log">
						<thead>
							<tr>
								<th>
									{ __(
										'Started',
										'fair-payments-connector'
									) }
								</th>
								<th>
									{ __(
										'Source',
										'fair-payments-connector'
									) }
								</th>
								<th>
									{ __(
										'Action',
										'fair-payments-connector'
									) }
								</th>
								<th>
									{ __(
										'Started by',
										'fair-payments-connector'
									) }
								</th>
								<th>
									{ __(
										'Outcome',
										'fair-payments-connector'
									) }
								</th>
								<th>
									{ __(
										'Counts',
										'fair-payments-connector'
									) }
								</th>
							</tr>
						</thead>
						<tbody>{ renderRows() }</tbody>
					</table>
				) }
				{ pages > 1 && (
					<HStack
						justify="center"
						className="fair-external-updates__pagination"
					>
						<Button
							variant="secondary"
							disabled={ page <= 1 || loading }
							onClick={ () => setPage( page - 1 ) }
						>
							{ __( 'Newer', 'fair-payments-connector' ) }
						</Button>
						<span>
							{ sprintf(
								/* translators: 1: current page, 2: total pages */
								__(
									'Page %1$d of %2$d',
									'fair-payments-connector'
								),
								page,
								pages
							) }
						</span>
						<Button
							variant="secondary"
							disabled={ page >= pages || loading }
							onClick={ () => setPage( page + 1 ) }
						>
							{ __( 'Older', 'fair-payments-connector' ) }
						</Button>
					</HStack>
				) }
			</CardBody>
		</Card>
	);
};

export default OperationLog;
