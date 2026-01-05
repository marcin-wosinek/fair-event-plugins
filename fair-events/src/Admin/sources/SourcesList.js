/**
 * WordPress dependencies
 */
import { useState, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Spinner,
	Notice,
	Modal,
	Tooltip,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { copy } from '@wordpress/icons';

/**
 * Internal dependencies
 */
import SourceForm from './components/SourceForm.js';
import './style.css';

const SourcesList = () => {
	const [sources, setSources] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [success, setSuccess] = useState(null);
	const [isFormOpen, setIsFormOpen] = useState(false);
	const [editingSource, setEditingSource] = useState(null);

	useEffect(() => {
		loadSources();
	}, []);

	const loadSources = async () => {
		setLoading(true);
		setError(null);

		try {
			const data = await apiFetch({
				path: '/fair-events/v1/sources',
			});
			setSources(data);
		} catch (err) {
			setError(
				err.message || __('Failed to load sources.', 'fair-events')
			);
		} finally {
			setLoading(false);
		}
	};

	const handleCreate = () => {
		setEditingSource(null);
		setIsFormOpen(true);
	};

	const handleEdit = (source) => {
		setEditingSource(source);
		setIsFormOpen(true);
	};

	const handleDelete = async (id) => {
		if (
			!window.confirm(
				__(
					'Are you sure you want to delete this source?',
					'fair-events'
				)
			)
		) {
			return;
		}

		setError(null);
		setSuccess(null);

		try {
			await apiFetch({
				path: `/fair-events/v1/sources/${id}`,
				method: 'DELETE',
			});
			setSuccess(__('Source deleted successfully.', 'fair-events'));
			loadSources();
		} catch (err) {
			setError(
				err.message || __('Failed to delete source.', 'fair-events')
			);
		}
	};

	const handleFormSuccess = () => {
		setIsFormOpen(false);
		setEditingSource(null);
		setSuccess(
			editingSource
				? __('Source updated successfully.', 'fair-events')
				: __('Source created successfully.', 'fair-events')
		);
		loadSources();
	};

	const handleFormCancel = () => {
		setIsFormOpen(false);
		setEditingSource(null);
	};

	const getStatusBadge = (enabled) => {
		return enabled ? (
			<span className="source-status-badge source-status-enabled">
				{__('Enabled', 'fair-events')}
			</span>
		) : (
			<span className="source-status-badge source-status-disabled">
				{__('Disabled', 'fair-events')}
			</span>
		);
	};

	const getIcalUrl = (slug) => {
		const restUrl = window.wpApiSettings?.root || '/wp-json/';
		return (
			window.location.origin +
			restUrl +
			'fair-events/v1/sources/' +
			slug +
			'/ical'
		);
	};

	const handleCopyIcalUrl = async (slug) => {
		const url = getIcalUrl(slug);
		try {
			await navigator.clipboard.writeText(url);
			setSuccess(__('iCal URL copied to clipboard!', 'fair-events'));
		} catch (err) {
			setError(__('Failed to copy URL to clipboard.', 'fair-events'));
		}
	};

	return (
		<div className="fair-events-sources-page">
			<Card>
				<CardHeader>
					<HStack justify="space-between">
						<h1>{__('Event Sources', 'fair-events')}</h1>
						<Button variant="primary" onClick={handleCreate}>
							{__('Add New Source', 'fair-events')}
						</Button>
					</HStack>
				</CardHeader>
				<CardBody>
					<VStack spacing={4}>
						{error && (
							<Notice
								status="error"
								isDismissible
								onRemove={() => setError(null)}
							>
								{error}
							</Notice>
						)}

						{success && (
							<Notice
								status="success"
								isDismissible
								onRemove={() => setSuccess(null)}
							>
								{success}
							</Notice>
						)}

						{loading && (
							<div className="sources-loading">
								<Spinner />
								<p>{__('Loading sources...', 'fair-events')}</p>
							</div>
						)}

						{!loading && sources.length === 0 && (
							<div className="sources-empty">
								<p>
									{__(
										'No sources found. Create your first source to get started.',
										'fair-events'
									)}
								</p>
							</div>
						)}

						{!loading && sources.length > 0 && (
							<table className="wp-list-table widefat fixed striped">
								<thead>
									<tr>
										<th>{__('Name', 'fair-events')}</th>
										<th>{__('Slug', 'fair-events')}</th>
										<th>
											{__('Data Sources', 'fair-events')}
										</th>
										<th>
											{__('iCal Feed', 'fair-events')}
										</th>
										<th>{__('Status', 'fair-events')}</th>
										<th>{__('Actions', 'fair-events')}</th>
									</tr>
								</thead>
								<tbody>
									{sources.map((source) => (
										<tr key={source.id}>
											<td>
												<strong>{source.name}</strong>
											</td>
											<td>
												<code>{source.slug}</code>
											</td>
											<td>
												{source.data_sources?.length ||
													0}{' '}
												{__(
													'data source(s)',
													'fair-events'
												)}
											</td>
											<td>
												<Tooltip
													text={__(
														'Copy iCal feed URL',
														'fair-events'
													)}
												>
													<Button
														variant="secondary"
														size="small"
														icon={copy}
														onClick={() =>
															handleCopyIcalUrl(
																source.slug
															)
														}
													>
														{__(
															'Copy URL',
															'fair-events'
														)}
													</Button>
												</Tooltip>
											</td>
											<td>
												{getStatusBadge(source.enabled)}
											</td>
											<td>
												<HStack spacing={2}>
													<Button
														variant="secondary"
														size="small"
														onClick={() =>
															handleEdit(source)
														}
													>
														{__(
															'Edit',
															'fair-events'
														)}
													</Button>
													<Button
														variant="tertiary"
														size="small"
														isDestructive
														onClick={() =>
															handleDelete(
																source.id
															)
														}
													>
														{__(
															'Delete',
															'fair-events'
														)}
													</Button>
												</HStack>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</VStack>
				</CardBody>
			</Card>

			{isFormOpen && (
				<Modal
					title={
						editingSource
							? __('Edit Event Source', 'fair-events')
							: __('Add New Event Source', 'fair-events')
					}
					onRequestClose={handleFormCancel}
					style={{ maxWidth: '800px' }}
				>
					<SourceForm
						source={editingSource}
						onSuccess={handleFormSuccess}
						onCancel={handleFormCancel}
					/>
				</Modal>
			)}
		</div>
	);
};

export default SourcesList;
