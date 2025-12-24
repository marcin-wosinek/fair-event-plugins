/**
 * Connections Admin Page Component
 */
import { useState, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Card,
	CardBody,
	CardHeader,
	Button,
	SelectControl,
	TextControl,
	Spinner,
	Notice,
	FlexBlock,
	FlexItem,
	Flex,
	__experimentalHStack as HStack,
	__experimentalVStack as VStack,
} from '@wordpress/components';

/**
 * ConnectionsPage component
 */
export default function ConnectionsPage() {
	const [connections, setConnections] = useState([]);
	const [statistics, setStatistics] = useState(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [page, setPage] = useState(1);
	const [totalPages, setTotalPages] = useState(1);
	const [statusFilter, setStatusFilter] = useState('');
	const [orderBy, setOrderBy] = useState('connected_at');
	const [order, setOrder] = useState('DESC');
	const [cleanupDays, setCleanupDays] = useState(90);
	const [isCleaningUp, setIsCleaningUp] = useState(false);

	// Fetch connections
	useEffect(() => {
		fetchConnections();
		fetchStatistics();
	}, [page, statusFilter, orderBy, order]);

	const fetchConnections = async () => {
		setLoading(true);
		setError(null);

		try {
			const params = new URLSearchParams({
				page: page.toString(),
				per_page: '50',
				orderby: orderBy,
				order,
			});

			if (statusFilter) {
				params.set('status', statusFilter);
			}

			const data = await apiFetch({
				path: `/fair-platform/v1/connections?${params.toString()}`,
			});

			setConnections(data.items || []);
			setTotalPages(data.total_pages || 1);
		} catch (err) {
			setError(
				err.message || __('Failed to load connections', 'fair-platform')
			);
		} finally {
			setLoading(false);
		}
	};

	const fetchStatistics = async () => {
		try {
			const data = await apiFetch({
				path: '/fair-platform/v1/connections/stats',
			});
			setStatistics(data);
		} catch (err) {
			console.error('Failed to load statistics:', err);
		}
	};

	const handleCleanup = async () => {
		if (
			!confirm(
				__(
					'Are you sure you want to delete old connection logs? This cannot be undone.',
					'fair-platform'
				)
			)
		) {
			return;
		}

		setIsCleaningUp(true);

		try {
			const data = await apiFetch({
				path: `/fair-platform/v1/connections/cleanup?days=${cleanupDays}`,
				method: 'DELETE',
			});

			alert(
				data.message ||
					__('Old logs cleaned up successfully', 'fair-platform')
			);
			fetchConnections();
			fetchStatistics();
		} catch (err) {
			alert(err.message || __('Failed to cleanup logs', 'fair-platform'));
		} finally {
			setIsCleaningUp(false);
		}
	};

	const formatDate = (dateString) => {
		if (!dateString) return '-';
		return new Date(dateString).toLocaleString();
	};

	const getStatusBadge = (status) => {
		const badges = {
			connected: {
				color: '#00a32a',
				text: __('Connected', 'fair-platform'),
			},
			failed: { color: '#d63638', text: __('Failed', 'fair-platform') },
			disconnected: {
				color: '#dba617',
				text: __('Disconnected', 'fair-platform'),
			},
		};

		const badge = badges[status] || {
			color: '#646970',
			text: status || '-',
		};

		return (
			<span
				style={{
					display: 'inline-block',
					padding: '4px 8px',
					borderRadius: '3px',
					fontSize: '12px',
					fontWeight: 'bold',
					color: '#fff',
					backgroundColor: badge.color,
				}}
			>
				{badge.text}
			</span>
		);
	};

	return (
		<VStack spacing={4}>
			<div>
				<h1>{__('Connection Logs', 'fair-platform')}</h1>
				<p>
					{__(
						'Monitor OAuth connections from WordPress sites.',
						'fair-platform'
					)}
				</p>
			</div>

			{/* Statistics Cards */}
			{statistics && (
				<Flex gap={4} wrap>
					<FlexBlock>
						<Card>
							<CardBody>
								<div
									style={{
										fontSize: '24px',
										fontWeight: 'bold',
									}}
								>
									{statistics.total_connections}
								</div>
								<div style={{ color: '#646970' }}>
									{__('Total Connections', 'fair-platform')}
								</div>
							</CardBody>
						</Card>
					</FlexBlock>
					<FlexBlock>
						<Card>
							<CardBody>
								<div
									style={{
										fontSize: '24px',
										fontWeight: 'bold',
										color: '#00a32a',
									}}
								>
									{statistics.successful}
								</div>
								<div style={{ color: '#646970' }}>
									{__('Successful', 'fair-platform')}
								</div>
							</CardBody>
						</Card>
					</FlexBlock>
					<FlexBlock>
						<Card>
							<CardBody>
								<div
									style={{
										fontSize: '24px',
										fontWeight: 'bold',
										color: '#d63638',
									}}
								>
									{statistics.failed}
								</div>
								<div style={{ color: '#646970' }}>
									{__('Failed', 'fair-platform')}
								</div>
							</CardBody>
						</Card>
					</FlexBlock>
					<FlexBlock>
						<Card>
							<CardBody>
								<div
									style={{
										fontSize: '24px',
										fontWeight: 'bold',
									}}
								>
									{statistics.unique_sites}
								</div>
								<div style={{ color: '#646970' }}>
									{__('Unique Sites', 'fair-platform')}
								</div>
							</CardBody>
						</Card>
					</FlexBlock>
				</Flex>
			)}

			{/* Filters and Cleanup */}
			<Card>
				<CardBody>
					<HStack spacing={3} alignment="bottom">
						<SelectControl
							label={__('Status Filter', 'fair-platform')}
							value={statusFilter}
							options={[
								{
									label: __('All Statuses', 'fair-platform'),
									value: '',
								},
								{
									label: __('Connected', 'fair-platform'),
									value: 'connected',
								},
								{
									label: __('Failed', 'fair-platform'),
									value: 'failed',
								},
								{
									label: __('Disconnected', 'fair-platform'),
									value: 'disconnected',
								},
							]}
							onChange={setStatusFilter}
						/>
						<SelectControl
							label={__('Sort By', 'fair-platform')}
							value={orderBy}
							options={[
								{
									label: __(
										'Connection Date',
										'fair-platform'
									),
									value: 'connected_at',
								},
								{
									label: __('Site Name', 'fair-platform'),
									value: 'site_name',
								},
								{
									label: __('Status', 'fair-platform'),
									value: 'status',
								},
								{
									label: __('ID', 'fair-platform'),
									value: 'id',
								},
							]}
							onChange={setOrderBy}
						/>
						<SelectControl
							label={__('Order', 'fair-platform')}
							value={order}
							options={[
								{
									label: __('Descending', 'fair-platform'),
									value: 'DESC',
								},
								{
									label: __('Ascending', 'fair-platform'),
									value: 'ASC',
								},
							]}
							onChange={setOrder}
						/>
						<FlexItem style={{ marginLeft: 'auto' }}>
							<TextControl
								label={__('Cleanup Days', 'fair-platform')}
								type="number"
								value={cleanupDays}
								onChange={(value) =>
									setCleanupDays(parseInt(value) || 90)
								}
								style={{ width: '100px' }}
							/>
						</FlexItem>
						<FlexItem>
							<Button
								variant="secondary"
								onClick={handleCleanup}
								isBusy={isCleaningUp}
								disabled={isCleaningUp}
								style={{ marginTop: '22px' }}
							>
								{__('Cleanup Old Logs', 'fair-platform')}
							</Button>
						</FlexItem>
					</HStack>
				</CardBody>
			</Card>

			{/* Error Notice */}
			{error && (
				<Notice status="error" isDismissible={false}>
					{error}
				</Notice>
			)}

			{/* Connections Table */}
			<Card>
				<CardHeader>
					<h2>{__('Connection History', 'fair-platform')}</h2>
				</CardHeader>
				<CardBody style={{ padding: 0 }}>
					{loading ? (
						<div style={{ padding: '40px', textAlign: 'center' }}>
							<Spinner />
						</div>
					) : connections.length === 0 ? (
						<div style={{ padding: '40px', textAlign: 'center' }}>
							<p style={{ color: '#646970' }}>
								{__('No connections found.', 'fair-platform')}
							</p>
						</div>
					) : (
						<div style={{ overflowX: 'auto' }}>
							<table
								className="wp-list-table widefat fixed striped"
								style={{ borderSpacing: 0 }}
							>
								<thead>
									<tr>
										<th style={{ padding: '12px' }}>
											{__('ID', 'fair-platform')}
										</th>
										<th style={{ padding: '12px' }}>
											{__('Site', 'fair-platform')}
										</th>
										<th style={{ padding: '12px' }}>
											{__('Status', 'fair-platform')}
										</th>
										<th style={{ padding: '12px' }}>
											{__(
												'Organization',
												'fair-platform'
											)}
										</th>
										<th style={{ padding: '12px' }}>
											{__('Profile', 'fair-platform')}
										</th>
										<th style={{ padding: '12px' }}>
											{__(
												'Connected At',
												'fair-platform'
											)}
										</th>
										<th style={{ padding: '12px' }}>
											{__(
												'Last Refresh',
												'fair-platform'
											)}
										</th>
									</tr>
								</thead>
								<tbody>
									{connections.map((connection) => (
										<tr key={connection.id}>
											<td style={{ padding: '12px' }}>
												{connection.id}
											</td>
											<td style={{ padding: '12px' }}>
												<div>
													<strong>
														{connection.site_name ||
															'-'}
													</strong>
												</div>
												{connection.site_url && (
													<div
														style={{
															fontSize: '12px',
															color: '#646970',
														}}
													>
														<a
															href={
																connection.site_url
															}
															target="_blank"
															rel="noopener noreferrer"
														>
															{
																connection.site_url
															}
														</a>
													</div>
												)}
												{connection.site_id && (
													<div
														style={{
															fontSize: '11px',
															color: '#999',
															fontFamily:
																'monospace',
														}}
													>
														{connection.site_id}
													</div>
												)}
											</td>
											<td style={{ padding: '12px' }}>
												{getStatusBadge(
													connection.status
												)}
												{connection.error_message && (
													<div
														style={{
															marginTop: '8px',
															fontSize: '12px',
															color: '#d63638',
														}}
													>
														{
															connection.error_message
														}
													</div>
												)}
												{connection.profile_created ? (
													<div
														style={{
															marginTop: '4px',
															fontSize: '11px',
															color: '#00a32a',
														}}
													>
														{__(
															'✓ Profile created',
															'fair-platform'
														)}
													</div>
												) : null}
											</td>
											<td style={{ padding: '12px' }}>
												<code>
													{connection.mollie_organization_id ||
														'-'}
												</code>
											</td>
											<td style={{ padding: '12px' }}>
												<code>
													{connection.mollie_profile_id ||
														'-'}
												</code>
											</td>
											<td style={{ padding: '12px' }}>
												{formatDate(
													connection.connected_at
												)}
											</td>
											<td style={{ padding: '12px' }}>
												{formatDate(
													connection.last_token_refresh
												)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}

					{/* Pagination */}
					{totalPages > 1 && (
						<div
							style={{
								padding: '12px',
								borderTop: '1px solid #dcdcde',
								display: 'flex',
								justifyContent: 'space-between',
								alignItems: 'center',
							}}
						>
							<div>
								{__(
									`Page ${page} of ${totalPages}`,
									'fair-platform'
								)}
							</div>
							<HStack spacing={2}>
								<Button
									variant="secondary"
									disabled={page === 1}
									onClick={() => setPage(page - 1)}
								>
									{__('Previous', 'fair-platform')}
								</Button>
								<Button
									variant="secondary"
									disabled={page === totalPages}
									onClick={() => setPage(page + 1)}
								>
									{__('Next', 'fair-platform')}
								</Button>
							</HStack>
						</div>
					)}
				</CardBody>
			</Card>
		</VStack>
	);
}
