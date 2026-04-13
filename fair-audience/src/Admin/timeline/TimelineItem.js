/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { Card, CardBody, Icon } from '@wordpress/components';

/**
 * Get icon name for a timeline event type.
 *
 * @param {string} type Event type.
 * @return {string} Dashicon name.
 */
function getIcon(type) {
	const icons = {
		signup: 'groups',
		form_submission: 'forms',
		fee: 'money-alt',
		email: 'email',
		instagram: 'camera',
		poll: 'chart-bar',
		new_participant: 'admin-users',
	};
	return icons[type] || 'marker';
}

/**
 * Get background color for a timeline event type.
 *
 * @param {string} type Event type.
 * @return {string} CSS color.
 */
function getTypeColor(type) {
	const colors = {
		signup: '#007cba',
		form_submission: '#9b59b6',
		fee: '#00a32a',
		email: '#e67e22',
		instagram: '#e91e63',
		poll: '#3498db',
		new_participant: '#2ecc71',
	};
	return colors[type] || '#999';
}

/**
 * Get human-readable relative time string.
 *
 * @param {string} dateString Date string from the API.
 * @return {string} Relative time string.
 */
function getRelativeTime(dateString) {
	const date = new Date(dateString + 'Z');
	const now = new Date();
	const diffMs = now - date;
	const diffMinutes = Math.floor(diffMs / 60000);
	const diffHours = Math.floor(diffMs / 3600000);
	const diffDays = Math.floor(diffMs / 86400000);

	if (diffMinutes < 1) {
		return __('just now', 'fair-audience');
	}
	if (diffMinutes < 60) {
		return diffMinutes === 1
			? __('1 minute ago', 'fair-audience')
			: `${diffMinutes} ${__('minutes ago', 'fair-audience')}`;
	}
	if (diffHours < 24) {
		return diffHours === 1
			? __('1 hour ago', 'fair-audience')
			: `${diffHours} ${__('hours ago', 'fair-audience')}`;
	}
	if (diffDays < 30) {
		return diffDays === 1
			? __('yesterday', 'fair-audience')
			: `${diffDays} ${__('days ago', 'fair-audience')}`;
	}

	return date.toLocaleDateString();
}

/**
 * Form submission content component.
 *
 * @param {Object} props Props.
 * @param {Object} props.item Timeline item with submission details.
 * @return {JSX.Element} Submission summary with link.
 */
function FormSubmissionContent({ item }) {
	const {
		submission_id: submissionId,
		participant_id: participantId,
		participant_name: participantName,
		form_name: formName,
		page_title: pageTitle,
		post_url: postUrl,
	} = item.details;

	const submissionUrl = `admin.php?page=fair-audience-submission-detail&submission_id=${submissionId}`;
	const participantUrl = participantId
		? `admin.php?page=fair-audience-participant-detail&participant_id=${participantId}`
		: null;

	const nameNode = participantUrl ? (
		<a href={participantUrl}>{participantName}</a>
	) : (
		participantName
	);

	const pageNode =
		pageTitle && postUrl ? (
			<a href={postUrl} target="_blank" rel="noopener noreferrer">
				{pageTitle}
			</a>
		) : (
			pageTitle
		);

	return (
		<div style={{ fontSize: '13px', lineHeight: '1.5' }}>
			{pageTitle ? (
				<>
					{nameNode} {__('submitted', 'fair-audience')} &quot;
					{formName}&quot; {__('on', 'fair-audience')} &quot;
					{pageNode}&quot;
				</>
			) : (
				<>
					{nameNode} {__('submitted', 'fair-audience')} &quot;
					{formName}&quot;
				</>
			)}
			{' — '}
			<a href={submissionUrl}>{__('View answers', 'fair-audience')}</a>
		</div>
	);
}

/**
 * New participant content component.
 *
 * @param {Object} props Props.
 * @param {Object} props.item Timeline item with participant details.
 * @return {JSX.Element} Participant summary with linked name.
 */
function NewParticipantContent({ item }) {
	const { participant_id: participantId, name } = item.details;
	const displayName = name || item.summary;

	if (!participantId) {
		return (
			<div style={{ fontSize: '13px', lineHeight: '1.5' }}>
				{item.summary}
			</div>
		);
	}

	const participantUrl = `admin.php?page=fair-audience-participant-detail&participant_id=${participantId}`;

	return (
		<div style={{ fontSize: '13px', lineHeight: '1.5' }}>
			{__('New participant:', 'fair-audience')}{' '}
			<a href={participantUrl}>{displayName}</a>
		</div>
	);
}

/**
 * Fee summary content component.
 *
 * @param {Object} props Props.
 * @param {Object} props.item Timeline item with fee details.
 * @return {JSX.Element} Fee summary.
 */
function FeeContent({ item }) {
	const { details } = item;
	const feeUrl = `admin.php?page=fair-audience-fee-detail&fee_id=${details.fee_id}`;

	return (
		<div style={{ fontSize: '13px', lineHeight: '1.6' }}>
			<div>
				{__('Created membership fee', 'fair-audience')}{' '}
				<a href={feeUrl}>
					<strong>{details.fee_name}</strong>
				</a>
				. {__('Total amount:', 'fair-audience')}{' '}
				{Number(details.total_amount).toFixed(2)} {details.currency}.
			</div>
			<div>
				{__('Already paid:', 'fair-audience')}{' '}
				{Number(details.total_paid).toFixed(2)} {details.currency}.{' '}
				{__('Pending:', 'fair-audience')} {details.pending_text}
			</div>
		</div>
	);
}

/**
 * Timeline item component.
 *
 * @param {Object} props Props.
 * @param {Object} props.item Timeline item from API.
 * @return {JSX.Element} Timeline item.
 */
export default function TimelineItem({ item }) {
	const iconColor = getTypeColor(item.type);

	return (
		<Card
			size="small"
			style={{
				marginBottom: '8px',
			}}
		>
			<CardBody>
				<div
					style={{
						display: 'flex',
						alignItems: 'flex-start',
						gap: '12px',
					}}
				>
					<div
						style={{
							backgroundColor: iconColor,
							borderRadius: '50%',
							width: '32px',
							height: '32px',
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							flexShrink: 0,
						}}
					>
						<Icon
							icon={getIcon(item.type)}
							size={18}
							style={{ color: '#fff' }}
						/>
					</div>
					<div style={{ flex: 1, minWidth: 0 }}>
						{item.type === 'fee' ? (
							<FeeContent item={item} />
						) : item.type === 'form_submission' ? (
							<FormSubmissionContent item={item} />
						) : item.type === 'new_participant' ? (
							<NewParticipantContent item={item} />
						) : (
							<div
								style={{
									fontSize: '13px',
									lineHeight: '1.5',
								}}
							>
								{item.summary}
							</div>
						)}
						<div
							style={{
								fontSize: '12px',
								color: '#757575',
								marginTop: '2px',
							}}
						>
							{getRelativeTime(item.created_at)}
						</div>
					</div>
				</div>
			</CardBody>
		</Card>
	);
}
