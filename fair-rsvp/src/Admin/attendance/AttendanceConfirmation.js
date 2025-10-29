/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import {
	Button,
	TextControl,
	CheckboxControl,
	Notice,
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

	// Walk-in form state
	const [walkInName, setWalkInName] = useState('');
	const [walkInEmail, setWalkInEmail] = useState('');
	const [isAddingWalkIn, setIsAddingWalkIn] = useState(false);

	// Load RSVPs on mount
	useEffect(() => {
		loadRsvps();
	}, [eventId]);

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
					<div className="rsvp-checkboxes">
						{filteredRsvps.map((rsvp) => {
							const displayName =
								rsvp.user?.display_name ||
								`User #${rsvp.user_id}`;
							const statusBadge =
								rsvp.rsvp_status === 'maybe' ? ' (Maybe)' : '';
							return (
								<CheckboxControl
									key={rsvp.id}
									label={`${displayName}${statusBadge}`}
									checked={rsvp.checked}
									onChange={(checked) =>
										handleCheckboxChange(rsvp.id, checked)
									}
								/>
							);
						})}
					</div>
				)}
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
				<h3>{__('Add Walk-in Attendee', 'fair-rsvp')}</h3>
				<p>
					{__(
						"Add someone who attended but didn't sign up in advance",
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
				.rsvp-checkboxes {
					display: grid;
					grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
					gap: 10px;
				}
				.attendance-summary {
					font-size: 16px;
				}
			`}</style>
		</div>
	);
}
