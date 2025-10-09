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
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState(null);

	// Load users on mount
	useEffect(() => {
		apiFetch({ path: '/wp/v2/users' })
			.then((fetchedUsers) => {
				setUsers(fetchedUsers);
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
				{__(
					'This is a placeholder page. User management functionality will be implemented here.',
					'fair-membership'
				)}
			</p>

			<div className="card">
				<h2>{__('User Count', 'fair-membership')}</h2>
				<p>
					{users.length}{' '}
					{__(
						users.length === 1 ? 'user' : 'users',
						'fair-membership'
					)}
				</p>
			</div>
		</div>
	);
}
