/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

/**
 * Membership Matrix Component - Manage user memberships in groups
 *
 * @return {JSX.Element} The Membership Matrix component
 */
export default function MembershipMatrix() {
	const [users, setUsers] = useState([]);
	const [groups, setGroups] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState(null);
	const [savingStates, setSavingStates] = useState({});

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

	/**
	 * Toggle membership for a user and group
	 *
	 * @param {number} userId    User ID
	 * @param {number} groupId   Group ID
	 * @param {boolean} isActive Current membership status
	 */
	const toggleMembership = (userId, groupId, isActive) => {
		const key = `${userId}-${groupId}`;
		setSavingStates((prev) => ({ ...prev, [key]: true }));

		apiFetch({
			path: '/fair-membership/v1/membership',
			method: 'POST',
			data: {
				user_id: userId,
				group_id: groupId,
				status: isActive ? 'inactive' : 'active',
			},
		})
			.then(() => {
				// Update local state
				setUsers((prevUsers) =>
					prevUsers.map((user) => {
						if (user.id === userId) {
							return {
								...user,
								memberships: {
									...user.memberships,
									[groupId]: !isActive,
								},
							};
						}
						return user;
					})
				);
				setSavingStates((prev) => {
					const newState = { ...prev };
					delete newState[key];
					return newState;
				});
			})
			.catch((err) => {
				alert(
					__('Failed to update membership: ', 'fair-membership') +
						err.message
				);
				setSavingStates((prev) => {
					const newState = { ...prev };
					delete newState[key];
					return newState;
				});
			});
	};

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
							{groups.map((group) => {
								const key = `${user.id}-${group.id}`;
								const isChecked = user.memberships[group.id];
								const isSaving = savingStates[key];

								return (
									<td
										key={group.id}
										className="column-center"
									>
										<input
											type="checkbox"
											checked={isChecked}
											disabled={isSaving}
											onChange={() =>
												toggleMembership(
													user.id,
													group.id,
													isChecked
												)
											}
										/>
									</td>
								);
							})}
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
