import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Card,
	CardBody,
	CardHeader,
	Spinner,
	Notice,
} from '@wordpress/components';

function formatDateTime(dateString) {
	if (!dateString) {
		return '';
	}
	const date = new Date(dateString + 'Z');
	return date.toLocaleString();
}

function formatEventDate(dateString) {
	if (!dateString) {
		return '—';
	}
	const date = new Date(dateString.replace(' ', 'T'));
	if (Number.isNaN(date.getTime())) {
		return dateString;
	}
	return date.toLocaleString();
}

const LABEL_DISPLAY = {
	collaborator: __('Collaborator', 'fair-audience'),
	signed_up: __('Signed up', 'fair-audience'),
	interested: __('Interested', 'fair-audience'),
};

const EMAIL_PROFILE_DISPLAY = {
	minimal: __('Minimal', 'fair-audience'),
	marketing: __('Marketing', 'fair-audience'),
};

const STATUS_DISPLAY = {
	pending: __('Pending', 'fair-audience'),
	confirmed: __('Confirmed', 'fair-audience'),
};

export default function ParticipantDetail() {
	const urlParams = new URLSearchParams(window.location.search);
	const participantId = urlParams.get('participant_id');

	const [participant, setParticipant] = useState(null);
	const [activity, setActivity] = useState(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState(null);

	useEffect(() => {
		if (!participantId) {
			setIsLoading(false);
			setError(__('No participant ID provided.', 'fair-audience'));
			return;
		}

		Promise.all([
			apiFetch({
				path: `/fair-audience/v1/participants/${participantId}`,
			}),
			apiFetch({
				path: `/fair-audience/v1/participants/${participantId}/activity`,
			}),
		])
			.then(([profileData, activityData]) => {
				setParticipant(profileData);
				setActivity(activityData);
			})
			.catch(() => {
				setError(__('Participant not found.', 'fair-audience'));
			})
			.finally(() => {
				setIsLoading(false);
			});
	}, [participantId]);

	if (isLoading) {
		return (
			<div style={{ padding: '20px', textAlign: 'center' }}>
				<Spinner />
			</div>
		);
	}

	if (error) {
		return (
			<div style={{ maxWidth: '900px', margin: '20px 0' }}>
				<Notice status="error" isDismissible={false}>
					{error}
				</Notice>
			</div>
		);
	}

	if (!participant) {
		return null;
	}

	const fullName = `${participant.name || ''} ${
		participant.surname || ''
	}`.trim();
	const events = activity?.events || [];
	const submissions = activity?.submissions || [];

	return (
		<div style={{ maxWidth: '900px', margin: '20px 0' }}>
			<h1>{fullName || __('Participant', 'fair-audience')}</h1>

			<Card style={{ marginBottom: '16px' }}>
				<CardHeader>
					<h2 style={{ margin: 0 }}>
						{__('Profile', 'fair-audience')}
					</h2>
				</CardHeader>
				<CardBody>
					<table
						className="widefat striped"
						style={{ border: 'none' }}
					>
						<tbody>
							<tr>
								<th style={{ width: '200px' }}>
									{__('Name', 'fair-audience')}
								</th>
								<td>{fullName || '—'}</td>
							</tr>
							<tr>
								<th>{__('Email', 'fair-audience')}</th>
								<td>{participant.email || '—'}</td>
							</tr>
							<tr>
								<th>{__('Status', 'fair-audience')}</th>
								<td>
									{STATUS_DISPLAY[participant.status] ||
										participant.status ||
										'—'}
								</td>
							</tr>
							<tr>
								<th>{__('Email profile', 'fair-audience')}</th>
								<td>
									{EMAIL_PROFILE_DISPLAY[
										participant.email_profile
									] ||
										participant.email_profile ||
										'—'}
								</td>
							</tr>
							<tr>
								<th>{__('Instagram', 'fair-audience')}</th>
								<td>
									{participant.instagram ? (
										<a
											href={`https://instagram.com/${participant.instagram}`}
											target="_blank"
											rel="noopener noreferrer"
										>
											@{participant.instagram}
										</a>
									) : (
										'—'
									)}
								</td>
							</tr>
							<tr>
								<th>{__('WordPress user', 'fair-audience')}</th>
								<td>
									{participant.wp_user
										? participant.wp_user.display_name
										: '—'}
								</td>
							</tr>
							<tr>
								<th>{__('Created', 'fair-audience')}</th>
								<td>
									{formatDateTime(participant.created_at)}
								</td>
							</tr>
						</tbody>
					</table>
				</CardBody>
			</Card>

			<Card style={{ marginBottom: '16px' }}>
				<CardHeader>
					<h2 style={{ margin: 0 }}>
						{__('Events', 'fair-audience')} ({events.length})
					</h2>
				</CardHeader>
				<CardBody>
					{events.length === 0 ? (
						<p>{__('No events yet.', 'fair-audience')}</p>
					) : (
						<table className="wp-list-table widefat striped">
							<thead>
								<tr>
									<th>{__('Event', 'fair-audience')}</th>
									<th>{__('Date', 'fair-audience')}</th>
									<th>{__('Role', 'fair-audience')}</th>
									<th>
										{__('Signed up at', 'fair-audience')}
									</th>
								</tr>
							</thead>
							<tbody>
								{events.map((ev) => {
									const manageUrl = ev.event_date_id
										? `admin.php?page=fair-events-manage-event&event_date_id=${ev.event_date_id}&tab=audience`
										: null;
									return (
										<tr key={ev.id}>
											<td>
												{manageUrl ? (
													<a href={manageUrl}>
														{ev.event_title ||
															__(
																'(untitled)',
																'fair-audience'
															)}
													</a>
												) : (
													ev.event_title || '—'
												)}
											</td>
											<td>
												{formatEventDate(
													ev.start_datetime
												)}
											</td>
											<td>
												{LABEL_DISPLAY[ev.label] ||
													ev.label}
											</td>
											<td>
												{formatDateTime(ev.created_at)}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					)}
				</CardBody>
			</Card>

			<Card>
				<CardHeader>
					<h2 style={{ margin: 0 }}>
						{__('Form submissions', 'fair-audience')} (
						{submissions.length})
					</h2>
				</CardHeader>
				<CardBody>
					{submissions.length === 0 ? (
						<p>{__('No form submissions yet.', 'fair-audience')}</p>
					) : (
						<table className="wp-list-table widefat striped">
							<thead>
								<tr>
									<th>{__('Form', 'fair-audience')}</th>
									<th>{__('Page', 'fair-audience')}</th>
									<th>{__('Event', 'fair-audience')}</th>
									<th>
										{__('Submitted at', 'fair-audience')}
									</th>
								</tr>
							</thead>
							<tbody>
								{submissions.map((sub) => {
									const detailUrl = `admin.php?page=fair-audience-submission-detail&submission_id=${sub.id}`;
									return (
										<tr key={sub.id}>
											<td>
												<a href={detailUrl}>
													{sub.title ||
														__(
															'Fair Form',
															'fair-audience'
														)}
												</a>
											</td>
											<td>{sub.page_title || '—'}</td>
											<td>{sub.event_title || '—'}</td>
											<td>
												{formatDateTime(sub.created_at)}
											</td>
										</tr>
									);
								})}
							</tbody>
						</table>
					)}
				</CardBody>
			</Card>
		</div>
	);
}
