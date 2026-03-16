import { useState, useEffect } from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Spinner,
	Notice,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

export default function MigrationSummaryApp() {
	const [tables, setTables] = useState(null);
	const [error, setError] = useState(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		apiFetch({ path: '/fair-events/v1/migration-summary' })
			.then((response) => {
				setTables(response.tables);
			})
			.catch((err) => {
				setError(
					err.message || __('Failed to load data.', 'fair-events')
				);
			})
			.finally(() => {
				setLoading(false);
			});
	}, []);

	if (loading) {
		return (
			<div className="wrap">
				<h1>{__('Migration Summary', 'fair-events')}</h1>
				<Spinner />
			</div>
		);
	}

	if (error) {
		return (
			<div className="wrap">
				<h1>{__('Migration Summary', 'fair-events')}</h1>
				<Notice status="error" isDismissible={false}>
					{error}
				</Notice>
			</div>
		);
	}

	const entries = Object.entries(tables);
	const activeTables = entries.filter(([, data]) => data !== null);
	const fullyMigrated = activeTables.filter(
		([, data]) =>
			data.pending === 0 &&
			data.orphaned_event_id === 0 &&
			data.orphaned_event_date_id === 0
	);

	return (
		<div className="wrap">
			<h1>{__('Migration Summary', 'fair-events')}</h1>
			<p>
				{fullyMigrated.length} / {activeTables.length}{' '}
				{__('tables fully migrated', 'fair-events')}
			</p>
			<div
				style={{
					display: 'grid',
					gridTemplateColumns:
						'repeat(auto-fill, minmax(350px, 1fr))',
					gap: '16px',
					marginTop: '16px',
				}}
			>
				{entries.map(([key, data]) => (
					<TableCard key={key} tableKey={key} data={data} />
				))}
			</div>
		</div>
	);
}

function TableCard({ tableKey, data }) {
	if (data === null) {
		return (
			<Card>
				<CardHeader>
					<strong>{tableKey}</strong>
				</CardHeader>
				<CardBody>
					<em style={{ color: '#757575' }}>
						{__(
							'Table not found (plugin not active)',
							'fair-events'
						)}
					</em>
				</CardBody>
			</Card>
		);
	}

	const isHealthy =
		data.pending === 0 &&
		data.orphaned_event_id === 0 &&
		data.orphaned_event_date_id === 0;

	return (
		<Card>
			<CardHeader>
				<strong>
					{isHealthy ? '✅' : '⚠️'} {data.label}
				</strong>
			</CardHeader>
			<CardBody>
				<table className="widefat striped" style={{ margin: 0 }}>
					<tbody>
						<Row
							label={__('Total rows', 'fair-events')}
							value={data.total}
						/>
						<Row
							label={__('Migrated', 'fair-events')}
							value={data.migrated}
							status="good"
						/>
						<Row
							label={__('Pending', 'fair-events')}
							value={data.pending}
							status={data.pending > 0 ? 'warning' : 'good'}
						/>
						<Row
							label={__('Orphaned event_id', 'fair-events')}
							value={data.orphaned_event_id}
							status={
								data.orphaned_event_id > 0 ? 'error' : 'good'
							}
						/>
						<Row
							label={__('Orphaned event_date_id', 'fair-events')}
							value={data.orphaned_event_date_id}
							status={
								data.orphaned_event_date_id > 0
									? 'error'
									: 'good'
							}
						/>
					</tbody>
				</table>
			</CardBody>
		</Card>
	);
}

function Row({ label, value, status }) {
	const colors = {
		good: '#00a32a',
		warning: '#dba617',
		error: '#d63638',
	};

	return (
		<tr>
			<td>{label}</td>
			<td
				style={{
					textAlign: 'right',
					fontWeight: 600,
					color: status ? colors[status] : undefined,
				}}
			>
				{value}
			</td>
		</tr>
	);
}
