/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

/**
 * Confirm Step Component - Review and execute import
 *
 * @param {Object} props Component props
 * @param {Array} props.userData User data to import
 * @param {Object} props.userActions Actions for each user (create/update/skip)
 * @param {Array} props.selectedGroups Selected group IDs
 * @param {Array} props.groups All available groups
 * @param {Function} props.onComplete Callback when import is complete
 * @param {Function} props.onBack Callback to go back
 * @return {JSX.Element} The Confirm Step component
 */
export default function ConfirmStep({
	userData,
	userActions,
	selectedGroups,
	groups,
	onComplete,
	onBack,
}) {
	const [isImporting, setIsImporting] = useState(false);
	const [importResult, setImportResult] = useState(null);
	const [error, setError] = useState(null);

	// Calculate counts
	const toCreate = Object.values(userActions).filter(
		(action) => action === 'create'
	).length;
	const toUpdate = Object.values(userActions).filter(
		(action) => action === 'update'
	).length;
	const toSkip = Object.values(userActions).filter(
		(action) => action === 'skip'
	).length;

	// Get selected group names
	const selectedGroupNames = groups
		.filter((group) => selectedGroups.includes(group.id))
		.map((group) => group.name);

	const handleImport = async () => {
		if (
			!window.confirm(
				__(
					'Are you sure you want to import these users? This action cannot be undone.',
					'fair-membership'
				)
			)
		) {
			return;
		}

		setIsImporting(true);
		setError(null);

		try {
			// Prepare users data with actions
			const usersToImport = userData.map((user, index) => ({
				...user,
				action: userActions[index] || 'skip',
			}));

			const response = await apiFetch({
				path: '/fair-membership/v1/import-users/execute',
				method: 'POST',
				data: {
					users: usersToImport,
					group_ids: selectedGroups,
				},
			});

			if (response.success) {
				setImportResult(response.data.results);
				onComplete(response.data.results);
			} else {
				setError(
					response.message || __('Import failed', 'fair-membership')
				);
			}
		} catch (err) {
			setError(err.message || __('Import failed', 'fair-membership'));
		} finally {
			setIsImporting(false);
		}
	};

	if (importResult) {
		return (
			<div className="fair-membership-confirm-step">
				<div className="notice notice-success">
					<h2>{__('Import Complete!', 'fair-membership')}</h2>
				</div>

				<div className="fair-membership-import-results">
					<h3>{__('Import Results', 'fair-membership')}</h3>
					<table className="wp-list-table widefat fixed striped">
						<tbody>
							<tr>
								<th>
									{__('Users Created', 'fair-membership')}
								</th>
								<td>
									<strong>{importResult.created}</strong>
								</td>
							</tr>
							<tr>
								<th>
									{__('Users Updated', 'fair-membership')}
								</th>
								<td>
									<strong>{importResult.updated}</strong>
								</td>
							</tr>
							<tr>
								<th>
									{__('Users Skipped', 'fair-membership')}
								</th>
								<td>
									<strong>{importResult.skipped}</strong>
								</td>
							</tr>
							{importResult.errors &&
								importResult.errors.length > 0 && (
									<tr>
										<th>
											{__('Errors', 'fair-membership')}
										</th>
										<td>
											<strong className="error-text">
												{importResult.errors.length}
											</strong>
										</td>
									</tr>
								)}
						</tbody>
					</table>

					{importResult.errors && importResult.errors.length > 0 && (
						<div className="notice notice-warning">
							<h4>{__('Import Errors:', 'fair-membership')}</h4>
							<ul>
								{importResult.errors.map((error, idx) => (
									<li key={idx}>
										{__('Row', 'fair-membership')}{' '}
										{error.row}: {error.message}
									</li>
								))}
							</ul>
						</div>
					)}
				</div>

				<div className="fair-membership-confirm-actions">
					<a
						href="admin.php?page=fair-membership-matrix"
						className="button button-primary"
					>
						{__('View All Users', 'fair-membership')}
					</a>
					<button
						type="button"
						className="button"
						onClick={() => window.location.reload()}
						style={{ marginLeft: '10px' }}
					>
						{__('Import More Users', 'fair-membership')}
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className="fair-membership-confirm-step">
			<p>
				{__(
					'Review the import summary below. Click "Import Users" to proceed.',
					'fair-membership'
				)}
			</p>

			{error && (
				<div className="notice notice-error">
					<p>{error}</p>
				</div>
			)}

			<div className="fair-membership-import-summary">
				<h3>{__('Import Summary', 'fair-membership')}</h3>

				<table className="wp-list-table widefat fixed striped">
					<tbody>
						<tr>
							<th>{__('Users to Create', 'fair-membership')}</th>
							<td>
								<strong>{toCreate}</strong>
							</td>
						</tr>
						<tr>
							<th>{__('Users to Update', 'fair-membership')}</th>
							<td>
								<strong>{toUpdate}</strong>
							</td>
						</tr>
						<tr>
							<th>{__('Users to Skip', 'fair-membership')}</th>
							<td>{toSkip}</td>
						</tr>
						<tr>
							<th>{__('Total Users', 'fair-membership')}</th>
							<td>
								<strong>{userData.length}</strong>
							</td>
						</tr>
					</tbody>
				</table>

				<h3 style={{ marginTop: '30px' }}>
					{__('Group Assignments', 'fair-membership')}
				</h3>
				{selectedGroups.length === 0 ? (
					<p>
						{__(
							'No groups will be assigned to imported users.',
							'fair-membership'
						)}
					</p>
				) : (
					<>
						<p>
							{__(
								'The following groups will be assigned to all imported users:',
								'fair-membership'
							)}
						</p>
						<ul className="group-list">
							{selectedGroupNames.map((name, idx) => (
								<li key={idx}>{name}</li>
							))}
						</ul>
					</>
				)}
			</div>

			{(toCreate > 0 || toUpdate > 0) && (
				<div className="notice notice-info">
					<p>
						<strong>{__('Important:', 'fair-membership')}</strong>{' '}
						{__(
							'This action will create/update users in your WordPress site. Make sure you have reviewed the data carefully.',
							'fair-membership'
						)}
					</p>
				</div>
			)}

			<div className="fair-membership-confirm-actions">
				<button
					type="button"
					className="button"
					onClick={onBack}
					disabled={isImporting}
					style={{ marginRight: '10px' }}
				>
					{__('← Back to Groups', 'fair-membership')}
				</button>
				<button
					type="button"
					className="button button-primary"
					onClick={handleImport}
					disabled={isImporting || (toCreate === 0 && toUpdate === 0)}
				>
					{isImporting
						? __('Importing...', 'fair-membership')
						: __('Import Users', 'fair-membership')}
				</button>
			</div>

			<style>{`
				.fair-membership-confirm-step {
					margin-top: 20px;
				}
				.fair-membership-import-summary {
					background: #fff;
					border: 1px solid #ddd;
					border-radius: 4px;
					padding: 20px;
					margin: 20px 0;
				}
				.fair-membership-import-summary h3 {
					margin-top: 0;
				}
				.fair-membership-import-summary .wp-list-table {
					margin-top: 15px;
				}
				.fair-membership-import-summary .group-list {
					margin-left: 20px;
				}
				.fair-membership-import-results {
					background: #fff;
					border: 1px solid #ddd;
					border-radius: 4px;
					padding: 20px;
					margin: 20px 0;
				}
				.fair-membership-import-results h3 {
					margin-top: 0;
				}
				.fair-membership-import-results .error-text {
					color: #d63638;
				}
				.fair-membership-confirm-actions {
					margin-top: 20px;
				}
			`}</style>
		</div>
	);
}
