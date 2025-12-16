import { useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	TextControl,
	TextareaControl,
	Notice,
	__experimentalVStack as VStack,
	__experimentalNumberControl as NumberControl,
} from '@wordpress/components';

const UserFeeForm = ({ userFee, onSave, onCancel }) => {
	const [userId, setUserId] = useState(userFee?.user_id?.toString() || '');
	const [selectedUser, setSelectedUser] = useState(null);
	const [userSearchQuery, setUserSearchQuery] = useState('');
	const [userSuggestions, setUserSuggestions] = useState([]);
	const [searchingUsers, setSearchingUsers] = useState(false);

	const [title, setTitle] = useState(userFee?.title || '');
	const [amount, setAmount] = useState(userFee?.amount?.toString() || '');
	const [dueDate, setDueDate] = useState(userFee?.due_date || '');
	const [notes, setNotes] = useState(userFee?.notes || '');

	const [saving, setSaving] = useState(false);
	const [error, setError] = useState(null);

	// Search users as the admin types
	const handleUserSearch = async (searchTerm) => {
		setUserSearchQuery(searchTerm);
		setUserSuggestions([]);

		if (!searchTerm || searchTerm.length < 2) {
			return;
		}

		setSearchingUsers(true);
		try {
			const users = await apiFetch({
				path: `/wp/v2/users?search=${encodeURIComponent(searchTerm)}&per_page=10`,
			});

			setUserSuggestions(users);
		} catch (err) {
			// Silently fail - user search is not critical
			console.error('Failed to search users:', err);
		} finally {
			setSearchingUsers(false);
		}
	};

	// Select a user from suggestions
	const handleSelectUser = (user) => {
		setSelectedUser(user);
		setUserId(user.id.toString());
		setUserSearchQuery(user.name);
		setUserSuggestions([]);
	};

	// Clear user selection
	const handleClearUser = () => {
		setSelectedUser(null);
		setUserId('');
		setUserSearchQuery('');
		setUserSuggestions([]);
	};

	const handleSubmit = async (e) => {
		e.preventDefault();
		setError(null);
		setSaving(true);

		try {
			const data = {
				amount: parseFloat(amount),
				due_date: dueDate,
				notes,
			};

			// Only include user_id and title for new fees
			if (!userFee) {
				data.user_id = parseInt(userId);
				data.title = title;
			}

			await onSave(data);
		} catch (err) {
			setError(
				err.message || __('Failed to save user fee.', 'fair-membership')
			);
		} finally {
			setSaving(false);
		}
	};

	return (
		<form onSubmit={handleSubmit}>
			<VStack spacing={4}>
				{error && (
					<Notice status="error" isDismissible={false}>
						{error}
					</Notice>
				)}

				{!userFee && (
					<>
						<div style={{ position: 'relative' }}>
							<TextControl
								label={__('Search User', 'fair-membership')}
								value={userSearchQuery}
								onChange={handleUserSearch}
								required={!selectedUser}
								placeholder={__(
									'Type name or email to search...',
									'fair-membership'
								)}
								help={
									selectedUser
										? __(
												'User selected. Clear to search again.',
												'fair-membership'
											)
										: __(
												'Search by name or email to select a user.',
												'fair-membership'
											)
								}
							/>
							{selectedUser && (
								<div
									style={{
										marginTop: '8px',
										padding: '8px',
										backgroundColor: '#f0f0f1',
										borderRadius: '4px',
										display: 'flex',
										justifyContent: 'space-between',
										alignItems: 'center',
									}}
								>
									<div>
										<strong>{selectedUser.name}</strong>
										{selectedUser.email && (
											<div
												style={{
													fontSize: '13px',
													color: '#666',
												}}
											>
												{selectedUser.email}
											</div>
										)}
									</div>
									<Button
										variant="secondary"
										isSmall
										onClick={handleClearUser}
									>
										{__('Clear', 'fair-membership')}
									</Button>
								</div>
							)}
							{searchingUsers && (
								<div
									style={{
										padding: '8px',
										color: '#666',
										fontSize: '13px',
									}}
								>
									{__('Searching...', 'fair-membership')}
								</div>
							)}
							{!selectedUser &&
								userSuggestions.length > 0 &&
								userSearchQuery && (
									<div
										style={{
											position: 'absolute',
											top: '100%',
											left: 0,
											right: 0,
											backgroundColor: 'white',
											border: '1px solid #ddd',
											borderRadius: '4px',
											maxHeight: '200px',
											overflowY: 'auto',
											boxShadow:
												'0 2px 6px rgba(0,0,0,0.1)',
											zIndex: 1000,
										}}
									>
										{userSuggestions.map((user) => (
											<button
												key={user.id}
												type="button"
												onClick={() =>
													handleSelectUser(user)
												}
												style={{
													width: '100%',
													padding: '8px 12px',
													border: 'none',
													backgroundColor: 'white',
													textAlign: 'left',
													cursor: 'pointer',
													borderBottom:
														'1px solid #f0f0f1',
												}}
												onMouseEnter={(e) => {
													e.currentTarget.style.backgroundColor =
														'#f0f0f1';
												}}
												onMouseLeave={(e) => {
													e.currentTarget.style.backgroundColor =
														'white';
												}}
											>
												<div>
													<strong>{user.name}</strong>
												</div>
												{user.email && (
													<div
														style={{
															fontSize: '13px',
															color: '#666',
														}}
													>
														{user.email}
													</div>
												)}
											</button>
										))}
									</div>
								)}
						</div>

						<TextControl
							label={__('Title', 'fair-membership')}
							value={title}
							onChange={setTitle}
							required
						/>
					</>
				)}

				<TextControl
					label={__('Amount', 'fair-membership')}
					type="number"
					value={amount}
					onChange={setAmount}
					required
					min="0"
					step="0.01"
				/>

				<TextControl
					label={__('Due Date', 'fair-membership')}
					type="date"
					value={dueDate}
					onChange={setDueDate}
					required
				/>

				<TextareaControl
					label={__('Notes', 'fair-membership')}
					value={notes}
					onChange={setNotes}
					rows={3}
				/>

				<div
					style={{
						display: 'flex',
						justifyContent: 'flex-end',
						gap: '8px',
						marginTop: '16px',
					}}
				>
					<Button variant="secondary" onClick={onCancel}>
						{__('Cancel', 'fair-membership')}
					</Button>
					<Button
						variant="primary"
						type="submit"
						isBusy={saving}
						disabled={saving}
					>
						{saving
							? __('Saving...', 'fair-membership')
							: __('Save', 'fair-membership')}
					</Button>
				</div>
			</VStack>
		</form>
	);
};

export default UserFeeForm;
