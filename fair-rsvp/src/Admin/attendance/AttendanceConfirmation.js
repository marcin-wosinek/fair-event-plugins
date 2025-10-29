/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { dateI18n } from '@wordpress/date';
import { useState, useEffect } from '@wordpress/element';
import {
	Button,
	TextControl,
	CheckboxControl,
	Notice,
	ComboboxControl,
} from '@wordpress/components';
import apiFetch from '@wordpress/api-fetch';

/**
 * Attendance Confirmation Component
 *
 * @param {Object} props            Component props
 * @param {number} props.eventId    Event ID to confirm attendance for
 * @return {JSX.Element} The Attendance Confirmation component
 */
export default function AttendanceConfirmation({ eventId }) {
	const [rsvps, setRsvps] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [error, setError] = useState(null);
	const [success, setSuccess] = useState(null);
	const [searchTerm, setSearchTerm] = useState('');

	// Sorting state
	const [sortBy, setSortBy] = useState('name');
	const [sortOrder, setSortOrder] = useState('asc');

	// All users for selection
	const [allUsers, setAllUsers] = useState([]);
	const [selectedUserId, setSelectedUserId] = useState(null);
	const [isAddingMember, setIsAddingMember] = useState(false);

	// Walk-in form state
	const [walkInName, setWalkInName] = useState('');
	const [walkInEmail, setWalkInEmail] = useState('');
	const [isAddingWalkIn, setIsAddingWalkIn] = useState(false);

	// Load RSVPs and users on mount
	useEffect(() => {
		loadRsvps();
		loadUsers();
	}, [eventId]);

	const loadUsers = () => {
		apiFetch({ path: '/fair-rsvp/v1/users' })
			.then((users) => {
				setAllUsers(users);
			})
			.catch((err) => {
				console.error('Failed to load users:', err);
			});
	};

	const loadRsvps = () => {
		setIsLoading(true);
		setError(null);

		apiFetch({
			path: `/fair-rsvp/v1/rsvps?event_id=${eventId}&per_page=500`,
		})
			.then((response) => {
				// Extract data - response might be wrapped in data property
				let data = Array.isArray(response) ? response : [response];

				// Each item might also be wrapped in a data property
				data = data.map((item) => item.data || item);

				// Include yes and maybe RSVPs, add checked property
				const rsvpsWithChecked = data
					.filter((rsvp) =>
						['yes', 'maybe'].includes(rsvp.rsvp_status)
					)
					.map((rsvp) => ({
						...rsvp,
						checked: rsvp.attendance_status === 'checked_in',
					}));
				setRsvps(rsvpsWithChecked);
				setIsLoading(false);
			})
			.catch((err) => {
				setError(
					err.message || __('Failed to load RSVPs', 'fair-rsvp')
				);
				setIsLoading(false);
			});
	};

	const handleCheckboxChange = (rsvpId, checked) => {
		setRsvps((prevRsvps) =>
			prevRsvps.map((rsvp) =>
				rsvp.id === rsvpId ? { ...rsvp, checked } : rsvp
			)
		);
	};

	const handleSaveAll = () => {
		setIsSaving(true);
		setError(null);
		setSuccess(null);

		const updates = rsvps.map((rsvp) => ({
			id: rsvp.id,
			attendance_status: rsvp.checked ? 'checked_in' : 'no_show',
		}));

		apiFetch({
			path: '/fair-rsvp/v1/rsvps/bulk-attendance',
			method: 'POST',
			data: { updates },
		})
			.then((response) => {
				setSuccess(response.message);
				setIsSaving(false);
				// Reload to get fresh data
				loadRsvps();
			})
			.catch((err) => {
				setError(
					err.message || __('Failed to save attendance', 'fair-rsvp')
				);
				setIsSaving(false);
			});
	};

	const handleAddMember = () => {
		if (!selectedUserId) {
			setError(__('Please select a member', 'fair-rsvp'));
			return;
		}

		setIsAddingMember(true);
		setError(null);
		setSuccess(null);

		const selectedUser = allUsers.find((u) => u.user_id === selectedUserId);

		apiFetch({
			path: '/fair-rsvp/v1/rsvps/walk-in',
			method: 'POST',
			data: {
				event_id: eventId,
				name: selectedUser.display_name,
				email: selectedUser.user_email,
			},
		})
			.then(() => {
				setSuccess(
					__('Member added and checked in successfully', 'fair-rsvp')
				);
				setSelectedUserId(null);
				setIsAddingMember(false);
				// Reload to show new attendee
				loadRsvps();
			})
			.catch((err) => {
				setError(
					err.message || __('Failed to add member', 'fair-rsvp')
				);
				setIsAddingMember(false);
			});
	};

	const handleAddWalkIn = () => {
		if (!walkInName.trim()) {
			setError(
				__('Please enter a name for the walk-in attendee', 'fair-rsvp')
			);
			return;
		}

		setIsAddingWalkIn(true);
		setError(null);
		setSuccess(null);

		apiFetch({
			path: '/fair-rsvp/v1/rsvps/walk-in',
			method: 'POST',
			data: {
				event_id: eventId,
				name: walkInName,
				email: walkInEmail || undefined,
			},
		})
			.then(() => {
				setSuccess(
					__('Walk-in attendee added successfully', 'fair-rsvp')
				);
				setWalkInName('');
				setWalkInEmail('');
				setIsAddingWalkIn(false);
				// Reload to show new attendee
				loadRsvps();
			})
			.catch((err) => {
				setError(
					err.message ||
						__('Failed to add walk-in attendee', 'fair-rsvp')
				);
				setIsAddingWalkIn(false);
			});
	};

	// Format relative time (e.g., "2 hours ago", "3 days ago")
	// Returns null for dates 7+ days old (should show formatted date instead)
	const getRelativeTime = (dateString) => {
		if (!dateString) return '';
		const date = new Date(dateString);
		const now = new Date();
		const seconds = Math.floor((now - date) / 1000);
		const days = Math.floor(seconds / 86400); // 86400 seconds in a day

		// If 7 or more days old, return null to signal formatted date should be used
		if (days >= 7) return null;

		if (seconds < 60) return __('just now', 'fair-rsvp');
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) {
			return minutes === 1
				? __('1 minute ago', 'fair-rsvp')
				: sprintf(__('%d minutes ago', 'fair-rsvp'), minutes);
		}
		const hours = Math.floor(minutes / 60);
		if (hours < 24) {
			return hours === 1
				? __('1 hour ago', 'fair-rsvp')
				: sprintf(__('%d hours ago', 'fair-rsvp'), hours);
		}
		// days already calculated at top of function
		if (days < 30) {
			return days === 1
				? __('1 day ago', 'fair-rsvp')
				: sprintf(__('%d days ago', 'fair-rsvp'), days);
		}
		const months = Math.floor(days / 30);
		if (months < 12) {
			return months === 1
				? __('1 month ago', 'fair-rsvp')
				: sprintf(__('%d months ago', 'fair-rsvp'), months);
		}
		const years = Math.floor(days / 365);
		return years === 1
			? __('1 year ago', 'fair-rsvp')
			: sprintf(__('%d years ago', 'fair-rsvp'), years);
	};

	// Format date using WordPress locale and settings
	const getFormattedDate = (dateString) => {
		if (!dateString) return '';
		// Use WordPress date format with time
		// 'F j, Y \a\t g:i A' = "January 15, 2025 at 2:30 PM"
		return dateI18n('F j, Y \\a\\t g:i A', dateString);
	};

	// Sort RSVPs
	const sortRsvps = (rsvpList) => {
		return [...rsvpList].sort((a, b) => {
			let comparison = 0;

			if (sortBy === 'name') {
				const nameA = (a.user?.display_name || '').toLowerCase();
				const nameB = (b.user?.display_name || '').toLowerCase();
				comparison = nameA.localeCompare(nameB);
			} else if (sortBy === 'date') {
				const dateA = new Date(a.rsvp_at || 0);
				const dateB = new Date(b.rsvp_at || 0);
				comparison = dateA - dateB;
			}

			return sortOrder === 'asc' ? comparison : -comparison;
		});
	};

	// Handle column header click for sorting
	const handleSort = (column) => {
		if (sortBy === column) {
			// Toggle order if clicking same column
			setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
		} else {
			// Set new column and default to ascending
			setSortBy(column);
			setSortOrder('asc');
		}
	};

	// Filter RSVPs based on search
	const filteredRsvps = rsvps.filter((rsvp) => {
		if (!searchTerm) return true;
		const searchLower = searchTerm.toLowerCase();
		const displayName = rsvp.user?.display_name || '';
		const email = rsvp.user?.user_email || '';
		return (
			displayName.toLowerCase().includes(searchLower) ||
			email.toLowerCase().includes(searchLower) ||
			`${rsvp.user_id}`.includes(searchTerm)
		);
	});

	const checkedCount = rsvps.filter((rsvp) => rsvp.checked).length;
	const totalCount = rsvps.length;

	// Filter out users who already have RSVPs
	const userIdsWithRsvps = rsvps.map((rsvp) => rsvp.user_id);
	const availableUsers = allUsers.filter(
		(user) => !userIdsWithRsvps.includes(user.user_id)
	);

	// Format users for ComboboxControl
	const userOptions = availableUsers.map((user) => ({
		value: user.user_id,
		label: `${user.display_name} (${user.user_email})`,
	}));

	if (isLoading) {
		return <p>{__('Loading RSVPs...', 'fair-rsvp')}</p>;
	}

	return (
		<div className="fair-rsvp-attendance">
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

			<div
				className="attendance-summary"
				style={{ marginBottom: '20px' }}
			>
				<p>
					<strong>
						{checkedCount} / {totalCount}
					</strong>{' '}
					{__('attendees checked in', 'fair-rsvp')}
				</p>
			</div>

			{/* Search filter */}
			<TextControl
				label={__('Search attendees', 'fair-rsvp')}
				value={searchTerm}
				onChange={setSearchTerm}
				placeholder={__('Search by name...', 'fair-rsvp')}
				style={{ maxWidth: '400px', marginBottom: '20px' }}
			/>

			{/* RSVPs list */}
			<div className="attendance-list" style={{ marginBottom: '30px' }}>
				<h3>{__('RSVP List', 'fair-rsvp')}</h3>
				{filteredRsvps.length === 0 ? (
					<p>{__('No RSVPs found', 'fair-rsvp')}</p>
				) : (
					<table className="wp-list-table widefat fixed striped">
						<thead>
							<tr>
								<th
									className="sortable-column"
									onClick={() => handleSort('name')}
									style={{ cursor: 'pointer' }}
								>
									{__('Name', 'fair-rsvp')}{' '}
									{sortBy === 'name' && (
										<span className="sort-indicator">
											{sortOrder === 'asc' ? '↑' : '↓'}
										</span>
									)}
								</th>
								<th>{__('RSVP Status', 'fair-rsvp')}</th>
								<th>{__('Signed Up', 'fair-rsvp')}</th>
								<th style={{ width: '100px' }}>
									{__('Checked In', 'fair-rsvp')}
								</th>
							</tr>
						</thead>
						<tbody>
							{sortRsvps(filteredRsvps).map((rsvp) => {
								const displayName =
									rsvp.user?.display_name ||
									`User #${rsvp.user_id}`;
								const statusLabel =
									rsvp.rsvp_status === 'maybe'
										? __('Maybe', 'fair-rsvp')
										: __('Yes', 'fair-rsvp');

								// Date display logic
								const relativeTime = getRelativeTime(
									rsvp.rsvp_at
								);
								const formattedDate = getFormattedDate(
									rsvp.rsvp_at
								);

								return (
									<tr key={rsvp.id}>
										<td>{displayName}</td>
										<td>
											<span
												className={`status-badge status-${rsvp.rsvp_status}`}
											>
												{statusLabel}
											</span>
										</td>
										<td
											title={
												relativeTime
													? formattedDate
													: undefined
											}
										>
											{relativeTime || formattedDate}
										</td>
										<td style={{ textAlign: 'center' }}>
											<input
												type="checkbox"
												checked={rsvp.checked}
												onChange={(e) =>
													handleCheckboxChange(
														rsvp.id,
														e.target.checked
													)
												}
											/>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				)}
			</div>

			{/* Quick Add Member section */}
			<div
				className="quick-add-member-section"
				style={{
					marginBottom: '20px',
					padding: '20px',
					background: '#e7f5fe',
					borderRadius: '4px',
					border: '1px solid #0073aa',
				}}
			>
				<h3>{__('Quick Add Existing Member', 'fair-rsvp')}</h3>
				<p>
					{__(
						"Select a member who showed up but didn't RSVP",
						'fair-rsvp'
					)}
				</p>

				<div style={{ maxWidth: '500px' }}>
					<ComboboxControl
						label={__('Search members', 'fair-rsvp')}
						value={selectedUserId}
						onChange={setSelectedUserId}
						options={userOptions}
						placeholder={__(
							'Type to search by name or email...',
							'fair-rsvp'
						)}
						help={
							availableUsers.length === 0
								? __(
										'All members already have RSVPs for this event',
										'fair-rsvp'
									)
								: ''
						}
					/>
					<Button
						variant="primary"
						onClick={handleAddMember}
						isBusy={isAddingMember}
						disabled={!selectedUserId || isAddingMember}
						style={{ marginTop: '10px' }}
					>
						{__('Add & Check In', 'fair-rsvp')}
					</Button>
				</div>
			</div>

			{/* Walk-in section */}
			<div
				className="walk-in-section"
				style={{
					marginBottom: '30px',
					padding: '20px',
					background: '#f5f5f5',
					borderRadius: '4px',
				}}
			>
				<h3>{__('Add New Person (Not a Member)', 'fair-rsvp')}</h3>
				<p>
					{__(
						'Add someone who attended but is not a website member',
						'fair-rsvp'
					)}
				</p>

				<TextControl
					label={__('Name', 'fair-rsvp')}
					value={walkInName}
					onChange={setWalkInName}
					placeholder={__('Enter attendee name', 'fair-rsvp')}
					style={{ maxWidth: '400px' }}
				/>

				<TextControl
					label={__('Email (optional)', 'fair-rsvp')}
					type="email"
					value={walkInEmail}
					onChange={setWalkInEmail}
					placeholder={__('Enter email address', 'fair-rsvp')}
					style={{ maxWidth: '400px' }}
				/>

				<Button
					variant="secondary"
					onClick={handleAddWalkIn}
					isBusy={isAddingWalkIn}
					disabled={isAddingWalkIn}
				>
					{__('Add Walk-in', 'fair-rsvp')}
				</Button>
			</div>

			{/* Save button */}
			<div className="save-section">
				<Button
					variant="primary"
					onClick={handleSaveAll}
					isBusy={isSaving}
					disabled={isSaving}
				>
					{__('Save All Attendance', 'fair-rsvp')}
				</Button>

				<a
					href="/wp-admin/admin.php?page=fair-rsvp"
					className="button"
					style={{ marginLeft: '10px' }}
				>
					{__('Back to Events', 'fair-rsvp')}
				</a>
			</div>

			<style>{`
				.attendance-summary {
					font-size: 16px;
				}
				.attendance-list table {
					margin-top: 15px;
				}
				.attendance-list th.sortable-column {
					user-select: none;
				}
				.attendance-list th.sortable-column:hover {
					background-color: #f0f0f0;
				}
				.attendance-list .sort-indicator {
					margin-left: 5px;
					color: #2271b1;
				}
				.attendance-list .status-badge {
					display: inline-block;
					padding: 3px 8px;
					border-radius: 3px;
					font-size: 12px;
					font-weight: 500;
				}
				.attendance-list .status-badge.status-yes {
					background-color: #d4edda;
					color: #155724;
				}
				.attendance-list .status-badge.status-maybe {
					background-color: #fff3cd;
					color: #856404;
				}
				.attendance-list tbody tr:hover {
					background-color: #f6f7f7;
				}
				.attendance-list input[type="checkbox"] {
					width: 18px;
					height: 18px;
					cursor: pointer;
				}
			`}</style>
		</div>
	);
}
