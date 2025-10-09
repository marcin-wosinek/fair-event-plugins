/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

/**
 * Users App Component - Placeholder for All Users page
 *
 * @return {JSX.Element} The Users app component
 */
export default function UsersApp() {
	const [users, setUsers] = useState([]);
	const [groups, setGroups] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState(null);

	// Load users and groups on mount
	useEffect(() => {
		apiFetch({ path: '/fair-membership/v1/users-with-memberships' })
			.then((data) => {
				setUsers(data.users);
				setGroups(data.groups);
				setIsLoading(false);
			})
			.catch((err) => {
				setError(err.message);
				setIsLoading(false);
			});
	}, []);

	if (isLoading) {
		return (
			<div className="wrap">
				<h1>{__('All Users', 'fair-membership')}</h1>
				<p>{__('Loading...', 'fair-membership')}</p>
			</div>
		);
	}

	if (error) {
		return (
			<div className="wrap">
				<h1>{__('All Users', 'fair-membership')}</h1>
				<div className="notice notice-error">
					<p>
						{__('Error loading users: ', 'fair-membership')}
						{error}
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1>{__('All Users', 'fair-membership')}</h1>

			<p>
				{users.length}{' '}
				{__(users.length === 1 ? 'user' : 'users', 'fair-membership')}
			</p>

			<table className="wp-list-table widefat fixed striped">
				<thead>
					<tr>
						<th scope="col" className="manage-column column-id">
							{__('ID', 'fair-membership')}
						</th>
						<th
							scope="col"
							className="manage-column column-username column-primary"
						>
							{__('Username', 'fair-membership')}
						</th>
						<th scope="col" className="manage-column column-name">
							{__('Name', 'fair-membership')}
						</th>
						{groups.map((group) => (
							<th
								key={group.id}
								scope="col"
								className="manage-column"
							>
								{group.name}
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{users.map((user) => (
						<tr key={user.id}>
							<td className="column-id">{user.id}</td>
							<td className="column-username column-primary">
								<strong>{user.slug}</strong>
							</td>
							<td className="column-name">{user.name}</td>
							{groups.map((group) => (
								<td key={group.id} className="column-center">
									{user.memberships[group.id] ? '✓' : ''}
								</td>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
