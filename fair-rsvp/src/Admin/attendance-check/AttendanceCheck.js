import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import { Spinner, Notice, TextControl, Button } from '@wordpress/components';
import apiFetch from '@wordpress/api-fetch';
import './style.css';

/**
 * AttendanceCheck Component
 * Displays attendance list for event with yes, maybe, and expected attendees
 *
 * @param {Object} props Component props
 * @param {number} props.eventId Event ID
 */
export default function AttendanceCheck({ eventId }) {
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState(null);
	const [data, setData] = useState(null);
	const [attendees, setAttendees] = useState([]);
	const [searchTerm, setSearchTerm] = useState('');
	const [saveSuccess, setSaveSuccess] = useState(false);
	const [eventUrl, setEventUrl] = useState('');

	// Fetch attendance data
	useEffect(() => {
		if (!eventId) {
			return;
		}

		apiFetch({
			path: `/fair-rsvp/v1/attendance-check?event_id=${eventId}`,
		})
			.then((response) => {
				setData(response);

				// Get post URL from response
				if (response.post_url) {
					setEventUrl(response.post_url);
				}

				// Combine all users into a single array with attendance status
				const allAttendees = [
					...(response.yes || []).map((user) => ({
						...user,
						section: 'yes',
					})),
					...(response.maybe || []).map((user) => ({
						...user,
						section: 'maybe',
					})),
					...(response.expected || []).map((user) => ({
						...user,
						section: 'expected',
					})),
				];

				setAttendees(allAttendees);
				setLoading(false);
			})
			.catch((err) => {
				setError(
					err.message ||
						__('Failed to load attendance data.', 'fair-rsvp')
				);
				setLoading(false);
			});
	}, [eventId]);

	// Toggle attendance status for a user
	const toggleAttendance = (rsvpId) => {
		setAttendees((prev) =>
			prev.map((attendee) => {
				if (attendee.rsvp_id === rsvpId) {
					const newStatus =
						attendee.attendance_status === 'checked_in'
							? 'not_applicable'
							: 'checked_in';
					return { ...attendee, attendance_status: newStatus };
				}
				return attendee;
			})
		);
	};

	// Save attendance data
	const handleSave = async () => {
		setSaving(true);
		setSaveSuccess(false);
		setError(null);

		try {
			// Users with RSVP records - update their attendance
			const updates = attendees
				.filter((attendee) => attendee.rsvp_id)
				.map((attendee) => ({
					id: attendee.rsvp_id,
					attendance_status: attendee.attendance_status,
				}));

			// Expected users who are checked in - create walk-in RSVPs
			const expectedCheckedIn = attendees.filter(
				(attendee) =>
					!attendee.rsvp_id &&
					attendee.attendance_status === 'checked_in'
			);

			// Update existing RSVPs
			if (updates.length > 0) {
				await apiFetch({
					path: '/fair-rsvp/v1/rsvps/bulk-attendance',
					method: 'POST',
					data: { updates },
				});
			}

			// Create walk-in RSVPs for expected users who checked in
			for (const attendee of expectedCheckedIn) {
				await apiFetch({
					path: '/fair-rsvp/v1/rsvps/walk-in',
					method: 'POST',
					data: {
						event_id: eventId,
						name: attendee.name,
						email: attendee.email,
					},
				});
			}

			setSaveSuccess(true);
			setTimeout(() => setSaveSuccess(false), 3000);
		} catch (err) {
			setError(
				err.message ||
					__('Failed to save attendance data.', 'fair-rsvp')
			);
		} finally {
			setSaving(false);
		}
	};

	// Filter users based on search term
	const filteredAttendees = searchTerm
		? attendees.filter(
				(attendee) =>
					attendee.name
						.toLowerCase()
						.includes(searchTerm.toLowerCase()) ||
					attendee.email
						.toLowerCase()
						.includes(searchTerm.toLowerCase())
			)
		: attendees;

	if (loading) {
		return (
			<div className="fair-rsvp-attendance-loading">
				<Spinner />
				<p>{__('Loading attendance data...', 'fair-rsvp')}</p>
			</div>
		);
	}

	if (error) {
		return (
			<Notice status="error" isDismissible={false}>
				{error}
			</Notice>
		);
	}

	if (!data) {
		return null;
	}

	return (
		<div className="fair-rsvp-attendance-check">
			<header className="fair-rsvp-attendance-header">
				<h1>{__('Attendance Check', 'fair-rsvp')}</h1>
			</header>

			{saveSuccess && (
				<Notice status="success" isDismissible={false}>
					{__('Attendance saved successfully!', 'fair-rsvp')}
				</Notice>
			)}

			<div className="fair-rsvp-attendance-controls">
				<TextControl
					label={__('Search attendees', 'fair-rsvp')}
					value={searchTerm}
					onChange={setSearchTerm}
					placeholder={__('Search by name or email...', 'fair-rsvp')}
					__nextHasNoMarginBottom
				/>
				<div className="fair-rsvp-attendance-buttons">
					{eventUrl && (
						<Button variant="secondary" href={eventUrl}>
							{__('← Back to Post', 'fair-rsvp')}
						</Button>
					)}
					<Button
						variant="primary"
						onClick={handleSave}
						isBusy={saving}
						disabled={saving}
					>
						{saving
							? __('Saving...', 'fair-rsvp')
							: __('Save Attendance', 'fair-rsvp')}
					</Button>
				</div>
			</div>

			<div className="fair-rsvp-attendance-table-wrapper">
				<table className="fair-rsvp-attendance-table">
					<thead>
						<tr>
							<th className="col-checkbox">
								{__('Present', 'fair-rsvp')}
							</th>
							<th className="col-avatar"></th>
							<th className="col-name">
								{__('Name', 'fair-rsvp')}
							</th>
							<th className="col-status">
								{__('RSVP Status', 'fair-rsvp')}
							</th>
						</tr>
					</thead>
					<tbody>
						{filteredAttendees.length === 0 ? (
							<tr>
								<td colSpan="4" className="no-results">
									{searchTerm
										? __(
												'No attendees match your search.',
												'fair-rsvp'
											)
										: __('No attendees yet.', 'fair-rsvp')}
								</td>
							</tr>
						) : (
							filteredAttendees.map((attendee) => (
								<tr
									key={`${attendee.section}-${attendee.rsvp_id}`}
									className={
										attendee.attendance_status ===
										'checked_in'
											? 'checked-in'
											: ''
									}
								>
									<td className="col-checkbox">
										<label className="checkbox-label">
											<input
												type="checkbox"
												checked={
													attendee.attendance_status ===
													'checked_in'
												}
												onChange={() =>
													toggleAttendance(
														attendee.rsvp_id
													)
												}
											/>
										</label>
									</td>
									<td className="col-avatar">
										<img
											src={attendee.avatar_url}
											alt={attendee.name}
											className="attendee-avatar"
										/>
									</td>
									<td className="col-name">
										{attendee.name}
									</td>
									<td className="col-status">
										<span
											className={`status-badge status-${attendee.section}`}
										>
											{attendee.section === 'yes' &&
												__('Yes', 'fair-rsvp')}
											{attendee.section === 'maybe' &&
												__('Maybe', 'fair-rsvp')}
											{attendee.section === 'expected' &&
												__('Expected', 'fair-rsvp')}
										</span>
									</td>
								</tr>
							))
						)}
					</tbody>
				</table>
			</div>
		</div>
	);
}
