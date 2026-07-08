import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardBody,
	Notice,
	Spinner,
	CheckboxControl,
} from '@wordpress/components';

export default function WordPressUsersImport() {
	const [users, setUsers] = useState([]);
	const [selectedUsers, setSelectedUsers] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isImporting, setIsImporting] = useState(false);
	const [linkedUserIds, setLinkedUserIds] = useState(new Set());
	const [results, setResults] = useState(null);
	const [error, setError] = useState(null);

	useEffect(() => {
		loadData();
	}, []);

	const loadData = async () => {
		setIsLoading(true);
		setError(null);

		try {
			// Fetch WordPress users and linked participants in parallel
			const [wpUsers, participants] = await Promise.all([
				apiFetch({ path: '/wp/v2/users?per_page=100&context=edit' }),
				apiFetch({
					path: '/fair-audience/v1/participants?per_page=1000',
				}),
			]);

			setUsers(wpUsers);

			// Build set of already-linked WP user IDs
			const linked = new Set();
			participants.forEach((participant) => {
				if (participant.wp_user_id) {
					linked.add(participant.wp_user_id);
				}
			});
			setLinkedUserIds(linked);
		} catch (err) {
			setError(
				err.message ||
					__(
						'Failed to load data. Please try again.',
						'fair-audience'
					)
			);
		} finally {
			setIsLoading(false);
		}
	};

	const handleUserSelection = (userId, isSelected) => {
		if (isSelected) {
			setSelectedUsers((prev) => [...prev, userId]);
		} else {
			setSelectedUsers((prev) => prev.filter((id) => id !== userId));
		}
	};

	const handleSelectAllUnlinked = () => {
		const unlinkedUserIds = users
			.filter((user) => !linkedUserIds.has(user.id))
			.map((user) => user.id);
		setSelectedUsers(unlinkedUserIds);
	};

	const handleDeselectAll = () => {
		setSelectedUsers([]);
	};

	const handleImport = async () => {
		const usersToImport = users.filter(
			(u) => selectedUsers.includes(u.id) && !linkedUserIds.has(u.id)
		);

		if (usersToImport.length === 0) {
			setError(__('No users selected for import.', 'fair-audience'));
			return;
		}

		setIsImporting(true);
		setError(null);
		setResults(null);

		const importResults = { imported: 0, failed: 0, errors: [] };

		for (const user of usersToImport) {
			try {
				// Parse name from display_name or first_name/last_name
				let firstName = user.first_name || '';
				let lastName = user.last_name || '';

				// If no first/last name, try to parse from name/display_name
				if (!firstName && !lastName && user.name) {
					const nameParts = user.name.split(' ');
					firstName = nameParts[0] || '';
					lastName = nameParts.slice(1).join(' ') || '';
				}

				await apiFetch({
					path: '/fair-audience/v1/participants',
					method: 'POST',
					data: {
						name: firstName,
						surname: lastName,
						email: user.email,
						wp_user_id: user.id,
						email_profile: 'minimal',
					},
				});
				importResults.imported++;
			} catch (err) {
				importResults.failed++;
				const errorMessage =
					err.message || __('Unknown error', 'fair-audience');
				importResults.errors.push(`${user.name}: ${errorMessage}`);
			}
		}

		setResults(importResults);
		setSelectedUsers([]);

		// Refresh the linked status
		await loadData();

		setIsImporting(false);
	};

	const unlinkedCount = users.filter(
		(user) => !linkedUserIds.has(user.id)
	).length;
	const selectedUnlinkedCount = selectedUsers.filter(
		(id) => !linkedUserIds.has(id)
	).length;

	return (
		<Card>
			<CardBody>
				<h2>{__('Import from WordPress Users', 'fair-audience')}</h2>
				<p>
					{__(
						'Create audience members from existing WordPress users. Users who already have a linked participant will be shown but cannot be imported again.',
						'fair-audience'
					)}
				</p>

				{isLoading && (
					<div style={{ marginTop: '20px', textAlign: 'center' }}>
						<Spinner />
						<p>{__('Loading users...', 'fair-audience')}</p>
					</div>
				)}

				{error && (
					<div style={{ marginTop: '20px' }}>
						<Notice status="error" isDismissible={false}>
							{error}
						</Notice>
					</div>
				)}

				{!isLoading && !error && users.length === 0 && (
					<Notice status="info" isDismissible={false}>
						{__('No WordPress users found.', 'fair-audience')}
					</Notice>
				)}

				{!isLoading && users.length > 0 && (
					<>
						<div
							style={{
								marginTop: '20px',
								display: 'flex',
								gap: '10px',
								alignItems: 'center',
								flexWrap: 'wrap',
							}}
						>
							<Button
								isSecondary
								onClick={handleSelectAllUnlinked}
								disabled={isImporting || unlinkedCount === 0}
							>
								{__('Select All Unlinked', 'fair-audience')} (
								{unlinkedCount})
							</Button>
							<Button
								isSecondary
								onClick={handleDeselectAll}
								disabled={
									isImporting || selectedUsers.length === 0
								}
							>
								{__('Deselect All', 'fair-audience')}
							</Button>
							<span style={{ marginLeft: 'auto', color: '#666' }}>
								{__('Selected:', 'fair-audience')}{' '}
								{selectedUnlinkedCount} / {unlinkedCount}{' '}
								{__('unlinked users', 'fair-audience')}
							</span>
						</div>

						<table
							className="wp-list-table widefat fixed striped"
							style={{ marginTop: '20px' }}
						>
							<thead>
								<tr>
									<th style={{ width: '40px' }}></th>
									<th>{__('Name', 'fair-audience')}</th>
									<th>{__('Email', 'fair-audience')}</th>
									<th>{__('Role', 'fair-audience')}</th>
									<th>{__('Status', 'fair-audience')}</th>
								</tr>
							</thead>
							<tbody>
								{users.map((user) => {
									const isLinked = linkedUserIds.has(user.id);
									const isSelected = selectedUsers.includes(
										user.id
									);

									return (
										<tr
											key={user.id}
											style={{
												opacity: isLinked ? 0.6 : 1,
											}}
										>
											<td>
												<CheckboxControl
													checked={isSelected}
													onChange={(checked) =>
														handleUserSelection(
															user.id,
															checked
														)
													}
													disabled={
														isLinked || isImporting
													}
													__nextHasNoMarginBottom
												/>
											</td>
											<td>
												<strong>{user.name}</strong>
												{user.first_name ||
												user.last_name ? (
													<div
														style={{
															color: '#666',
															fontSize: '12px',
														}}
													>
														{user.first_name}{' '}
														{user.last_name}
													</div>
												) : null}
											</td>
											<td>{user.email}</td>
											<td>
												{user.roles
													? user.roles.join(', ')
													: '-'}
											</td>
											<td>
												{isLinked ? (
													<span
														style={{
															backgroundColor:
																'#dff0d8',
															color: '#3c763d',
															padding: '2px 8px',
															borderRadius: '3px',
															fontSize: '12px',
														}}
													>
														{__(
															'Already linked',
															'fair-audience'
														)}
													</span>
												) : (
													<span
														style={{
															backgroundColor:
																'#f0f0f0',
															color: '#666',
															padding: '2px 8px',
															borderRadius: '3px',
															fontSize: '12px',
														}}
													>
														{__(
															'Available',
															'fair-audience'
														)}
													</span>
												)}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>

						<div style={{ marginTop: '20px' }}>
							<Button
								isPrimary
								onClick={handleImport}
								disabled={
									selectedUnlinkedCount === 0 || isImporting
								}
							>
								{isImporting
									? __('Importing...', 'fair-audience')
									: __(
											'Import Selected Users',
											'fair-audience'
									  ) + ` (${selectedUnlinkedCount})`}
							</Button>
						</div>

						{isImporting && (
							<div style={{ marginTop: '20px' }}>
								<Spinner />
							</div>
						)}
					</>
				)}

				{results && (
					<div style={{ marginTop: '20px' }}>
						<Notice
							status={results.failed > 0 ? 'warning' : 'success'}
							isDismissible={false}
						>
							<p>
								<strong>
									{__('Import Complete', 'fair-audience')}
								</strong>
							</p>
							<ul>
								<li>
									{__('Imported:', 'fair-audience')}{' '}
									{results.imported}
								</li>
								{results.failed > 0 && (
									<li>
										{__('Failed:', 'fair-audience')}{' '}
										{results.failed}
									</li>
								)}
							</ul>
						</Notice>

						{results.errors && results.errors.length > 0 && (
							<Notice
								status="warning"
								isDismissible={false}
								style={{ marginTop: '10px' }}
							>
								<p>
									<strong>
										{__('Errors:', 'fair-audience')}
									</strong>
								</p>
								<ul>
									{results.errors.map((err, index) => (
										<li key={index}>{err}</li>
									))}
								</ul>
							</Notice>
						)}
					</div>
				)}
			</CardBody>
		</Card>
	);
}
