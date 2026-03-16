import { useState, useEffect, useCallback } from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Spinner,
	Notice,
	Button,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

export default function MigrationSummaryApp() {
	const [tables, setTables] = useState(null);
	const [error, setError] = useState(null);
	const [loading, setLoading] = useState(true);

	const fetchSummary = useCallback(() => {
		setLoading(true);
		apiFetch({ path: '/fair-events/v1/migration-summary' })
			.then((response) => {
				setTables(response.tables);
				setError(null);
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

	useEffect(() => {
		fetchSummary();
	}, [fetchSummary]);

	if (loading && !tables) {
		return (
			<div className="wrap">
				<h1>{__('Migration Summary', 'fair-events')}</h1>
				<Spinner />
			</div>
		);
	}

	if (error && !tables) {
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
					<TableCard
						key={key}
						tableKey={key}
						data={data}
						onFixed={fetchSummary}
					/>
				))}
			</div>
		</div>
	);
}

function TableCard({ tableKey, data, onFixed }) {
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
						<OrphanRow
							label={__('Orphaned event_id', 'fair-events')}
							value={data.orphaned_event_id}
							tableKey={tableKey}
							orphanType="event_id"
							onFixed={onFixed}
						/>
						<OrphanRow
							label={__('Orphaned event_date_id', 'fair-events')}
							value={data.orphaned_event_date_id}
							tableKey={tableKey}
							orphanType="event_date_id"
							onFixed={onFixed}
						/>
					</tbody>
				</table>
			</CardBody>
		</Card>
	);
}

function OrphanRow({ label, value, tableKey, orphanType, onFixed }) {
	const [busy, setBusy] = useState(null);
	const [result, setResult] = useState(null);

	const handleAction = (action) => {
		setBusy(action);
		setResult(null);
		apiFetch({
			path: `/fair-events/v1/migration-summary/${action}-orphans`,
			method: 'POST',
			data: { table: tableKey, type: orphanType },
		})
			.then((response) => {
				const count =
					action === 'update' ? response.updated : response.deleted;
				const message =
					action === 'update'
						? sprintf(__('Updated %d rows', 'fair-events'), count)
						: sprintf(__('Deleted %d rows', 'fair-events'), count);
				setResult(message);
				onFixed();
			})
			.catch((err) => {
				setResult(err.message || __('Operation failed', 'fair-events'));
			})
			.finally(() => {
				setBusy(null);
			});
	};

	const status = value > 0 ? 'error' : 'good';
	const colors = {
		good: '#00a32a',
		error: '#d63638',
	};

	return (
		<tr>
			<td>{label}</td>
			<td style={{ textAlign: 'right' }}>
				<span
					style={{
						fontWeight: 600,
						color: colors[status],
						marginRight: value > 0 ? '8px' : 0,
					}}
				>
					{value}
				</span>
				{value > 0 && (
					<>
						<Button
							variant="secondary"
							size="small"
							isBusy={busy === 'update'}
							disabled={busy !== null}
							onClick={() => handleAction('update')}
						>
							{busy === 'update'
								? __('Updating...', 'fair-events')
								: __('Update', 'fair-events')}
						</Button>{' '}
						<Button
							variant="tertiary"
							size="small"
							isDestructive
							isBusy={busy === 'delete'}
							disabled={busy !== null}
							onClick={() => handleAction('delete')}
						>
							{busy === 'delete'
								? __('Deleting...', 'fair-events')
								: __('Delete', 'fair-events')}
						</Button>
					</>
				)}
				{result && (
					<span
						style={{
							marginLeft: '8px',
							fontSize: '12px',
							color: '#757575',
						}}
					>
						{result}
					</span>
				)}
			</td>
		</tr>
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
