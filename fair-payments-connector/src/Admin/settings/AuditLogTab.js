/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect, useCallback } from '@wordpress/element';
import { Card, CardBody, Button, Spinner, Notice } from '@wordpress/components';

/**
 * Internal dependencies
 */
import { loadAuditLog } from './settings-api';

const ACTION_LABELS = {
	setting_changed: __( 'Setting changed', 'fair-payments-connector' ),
	mollie_connected: __( 'Mollie connected', 'fair-payments-connector' ),
	mollie_reconnected: __( 'Mollie reconnected', 'fair-payments-connector' ),
	mollie_disconnected: __( 'Mollie disconnected', 'fair-payments-connector' ),
	mollie_token_refreshed: __(
		'Mollie token refreshed',
		'fair-payments-connector'
	),
	mollie_connection_lost: __(
		'Mollie connection lost',
		'fair-payments-connector'
	),
};

/**
 * Human-readable label for an audit action.
 *
 * @param {string} action Action taxonomy value.
 * @return {string} Readable label, falling back to the raw value.
 */
function actionLabel( action ) {
	return ACTION_LABELS[ action ] || action;
}

/**
 * Render an entry's change column: redacted marker, old → new, or a dash.
 *
 * @param {Object} entry Audit log entry from the API.
 * @return {string} Change summary text.
 */
function changeSummary( entry ) {
	if ( entry.is_protected ) {
		return __( 'Value changed (not shown)', 'fair-payments-connector' );
	}
	if ( null === entry.old_value && null === entry.new_value ) {
		return '—';
	}
	return sprintf(
		'%1$s → %2$s',
		entry.old_value ?? '—',
		entry.new_value ?? '—'
	);
}

/**
 * Audit Log Tab Component
 *
 * Read-only, paginated, newest-first view of settings and connection
 * changes recorded by the backend.
 *
 * @return {JSX.Element} The audit log tab
 */
export default function AuditLogTab() {
	const [ entries, setEntries ] = useState( [] );
	const [ page, setPage ] = useState( 1 );
	const [ totalPages, setTotalPages ] = useState( 1 );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );

	const load = useCallback( ( targetPage ) => {
		setLoading( true );
		setError( null );

		loadAuditLog( { page: targetPage, perPage: 20 } )
			.then( ( response ) => {
				setEntries( response.items || [] );
				setTotalPages( response.pages || 1 );
				setPage( response.page || targetPage );
				setLoading( false );
			} )
			.catch( ( err ) => {
				setError(
					err.message ||
						__(
							'Failed to load the audit log.',
							'fair-payments-connector'
						)
				);
				setLoading( false );
			} );
	}, [] );

	useEffect( () => {
		load( 1 );
	}, [ load ] );

	return (
		<Card>
			<CardBody>
				<h2>{ __( 'Audit Log', 'fair-payments-connector' ) }</h2>
				<p style={ { color: '#666', marginBottom: '1rem' } }>
					{ __(
						'Every manual settings change and Mollie connection action, newest first.',
						'fair-payments-connector'
					) }
				</p>

				{ error && (
					<Notice status="error" isDismissible={ false }>
						{ error }
					</Notice>
				) }

				{ loading ? (
					<Spinner />
				) : entries.length === 0 ? (
					<p>
						{ __(
							'No changes have been recorded yet.',
							'fair-payments-connector'
						) }
					</p>
				) : (
					<table className="wp-list-table widefat fixed striped">
						<thead>
							<tr>
								<th>
									{ __( 'When', 'fair-payments-connector' ) }
								</th>
								<th>
									{ __(
										'Action',
										'fair-payments-connector'
									) }
								</th>
								<th>
									{ __( 'Actor', 'fair-payments-connector' ) }
								</th>
								<th>
									{ __(
										'Change',
										'fair-payments-connector'
									) }
								</th>
								<th>
									{ __(
										'Reason',
										'fair-payments-connector'
									) }
								</th>
							</tr>
						</thead>
						<tbody>
							{ entries.map( ( entry ) => (
								<tr key={ entry.id }>
									<td>{ entry.created_at }</td>
									<td>
										{ actionLabel( entry.action ) }
										{ entry.setting_key
											? ` (${ entry.setting_key })`
											: '' }
									</td>
									<td>{ entry.actor_display_name }</td>
									<td>{ changeSummary( entry ) }</td>
									<td>{ entry.reason }</td>
								</tr>
							) ) }
						</tbody>
					</table>
				) }

				{ ! loading && totalPages > 1 && (
					<div style={ { marginTop: '12px' } }>
						<Button
							isSecondary
							disabled={ page <= 1 }
							onClick={ () => load( page - 1 ) }
						>
							{ __( 'Previous', 'fair-payments-connector' ) }
						</Button>{ ' ' }
						<span style={ { margin: '0 8px' } }>
							{ sprintf(
								/* translators: 1: current page, 2: total pages */
								__(
									'Page %1$d of %2$d',
									'fair-payments-connector'
								),
								page,
								totalPages
							) }
						</span>{ ' ' }
						<Button
							isSecondary
							disabled={ page >= totalPages }
							onClick={ () => load( page + 1 ) }
						>
							{ __( 'Next', 'fair-payments-connector' ) }
						</Button>
					</div>
				) }
			</CardBody>
		</Card>
	);
}
