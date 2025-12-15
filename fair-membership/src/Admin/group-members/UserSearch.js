import { useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import {
	SearchControl,
	Button,
	Spinner,
	Notice,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import apiFetch from '@wordpress/api-fetch';

const UserSearch = ({ onAddMember, existingMemberIds }) => {
	const [searchTerm, setSearchTerm] = useState('');
	const [searchResults, setSearchResults] = useState([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState(null);
	const [hasSearched, setHasSearched] = useState(false);

	const searchUsers = async (search) => {
		if (!search || search.length < 2) {
			setSearchResults([]);
			setHasSearched(false);
			return;
		}

		setLoading(true);
		setError(null);

		try {
			const users = await apiFetch({
				path: `/wp/v2/users?search=${encodeURIComponent(search)}&per_page=10`,
			});

			setSearchResults(users);
			setHasSearched(true);
		} catch (err) {
			setError(
				err.message || __('Failed to search users.', 'fair-membership')
			);
			setSearchResults([]);
		} finally {
			setLoading(false);
		}
	};

	const handleSearch = (value) => {
		setSearchTerm(value);
		searchUsers(value);
	};

	const handleAddUser = async (userId) => {
		try {
			await onAddMember(userId);
			// Clear search after successful add
			setSearchTerm('');
			setSearchResults([]);
			setHasSearched(false);
		} catch (err) {
			setError(
				err.message || __('Failed to add member.', 'fair-membership')
			);
		}
	};

	return (
		<VStack spacing={3}>
			<SearchControl
				label={__('Search for users to add', 'fair-membership')}
				value={searchTerm}
				onChange={handleSearch}
				placeholder={__('Type username or email...', 'fair-membership')}
			/>

			{loading && <Spinner />}

			{error && (
				<Notice
					status="error"
					isDismissible
					onRemove={() => setError(null)}
				>
					{error}
				</Notice>
			)}

			{!loading && hasSearched && searchResults.length === 0 && (
				<p className="description">
					{__(
						'No users found matching your search.',
						'fair-membership'
					)}
				</p>
			)}

			{searchResults.length > 0 && (
				<div className="fair-membership-user-results">
					<table className="wp-list-table widefat">
						<thead>
							<tr>
								<th>{__('Name', 'fair-membership')}</th>
								<th>{__('Email', 'fair-membership')}</th>
								<th>{__('Username', 'fair-membership')}</th>
								<th>{__('Actions', 'fair-membership')}</th>
							</tr>
						</thead>
						<tbody>
							{searchResults.map((user) => {
								const isAlreadyMember =
									existingMemberIds.includes(user.id);

								return (
									<tr key={user.id}>
										<td>{user.name}</td>
										<td>
											{user.email ||
												__(
													'No email',
													'fair-membership'
												)}
										</td>
										<td>{user.slug}</td>
										<td>
											{isAlreadyMember ? (
												<span className="description">
													{__(
														'Already a member',
														'fair-membership'
													)}
												</span>
											) : (
												<Button
													variant="secondary"
													onClick={() =>
														handleAddUser(user.id)
													}
												>
													{__(
														'Add',
														'fair-membership'
													)}
												</Button>
											)}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			)}
		</VStack>
	);
};

export default UserSearch;
