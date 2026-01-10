import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import { Button, CheckboxControl, Spinner } from '@wordpress/components';
import './style.css';

export default function PollResponse() {
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState(null);
	const [poll, setPoll] = useState(null);
	const [participantName, setParticipantName] = useState('');
	const [alreadyResponded, setAlreadyResponded] = useState(false);
	const [selectedOptions, setSelectedOptions] = useState([]);
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [submitted, setSubmitted] = useState(false);
	const [accessKey, setAccessKey] = useState('');

	useEffect(() => {
		// Read access key from data attribute
		const root = document.getElementById('fair-audience-poll-root');
		const key = root ? root.dataset.accessKey : '';

		if (!key) {
			setError(__('Invalid poll link.', 'fair-audience'));
			setIsLoading(false);
			return;
		}

		setAccessKey(key);
		validateAccessKey(key);
	}, []);

	const validateAccessKey = async (key) => {
		try {
			const response = await apiFetch({
				path: `/fair-audience/v1/poll-response/validate?access_key=${encodeURIComponent(
					key
				)}`,
			});

			if (!response.valid) {
				setError(__('Invalid or expired poll link.', 'fair-audience'));
				setIsLoading(false);
				return;
			}

			if (response.already_responded) {
				setAlreadyResponded(true);
				setParticipantName(response.participant_name);
				setIsLoading(false);
				return;
			}

			if (response.poll.status !== 'active') {
				setError(
					__(
						'This poll is no longer accepting responses.',
						'fair-audience'
					)
				);
				setIsLoading(false);
				return;
			}

			setPoll(response.poll);
			setParticipantName(response.participant_name);
			setIsLoading(false);
		} catch (err) {
			setError(
				err.message || __('Failed to load poll.', 'fair-audience')
			);
			setIsLoading(false);
		}
	};

	const handleOptionToggle = (optionId) => {
		setSelectedOptions((prev) => {
			if (prev.includes(optionId)) {
				return prev.filter((id) => id !== optionId);
			}
			return [...prev, optionId];
		});
	};

	const handleSubmit = async () => {
		if (selectedOptions.length === 0) {
			alert(__('Please select at least one option.', 'fair-audience'));
			return;
		}

		setIsSubmitting(true);
		setError(null);

		try {
			await apiFetch({
				path: '/fair-audience/v1/poll-response/submit',
				method: 'POST',
				data: {
					access_key: accessKey,
					selected_option_ids: selectedOptions,
				},
			});

			setSubmitted(true);
		} catch (err) {
			setError(
				err.message ||
					__(
						'Failed to submit your response. Please try again.',
						'fair-audience'
					)
			);
			setIsSubmitting(false);
		}
	};

	if (isLoading) {
		return (
			<div
				className="poll-response-container"
				style={{ textAlign: 'center' }}
			>
				<Spinner />
			</div>
		);
	}

	if (error) {
		return (
			<div
				className="poll-response-container"
				style={{
					backgroundColor: '#f8d7da',
					border: '1px solid #f5c6cb',
					borderRadius: '4px',
					color: '#721c24',
				}}
			>
				<h2>{__('Error', 'fair-audience')}</h2>
				<p>{error}</p>
			</div>
		);
	}

	if (alreadyResponded) {
		return (
			<div
				className="poll-response-container"
				style={{
					backgroundColor: '#d4edda',
					border: '1px solid #c3e6cb',
					borderRadius: '4px',
					color: '#155724',
				}}
			>
				<h2>{__('Thank you for your response!', 'fair-audience')}</h2>
				<p>
					{participantName && (
						<>
							{participantName},{' '}
							{__(
								"you've already submitted your response to this poll.",
								'fair-audience'
							)}
						</>
					)}
					{!participantName && (
						<>
							{__(
								"You've already submitted your response to this poll.",
								'fair-audience'
							)}
						</>
					)}
				</p>
			</div>
		);
	}

	if (submitted) {
		return (
			<div
				className="poll-response-container"
				style={{
					backgroundColor: '#d4edda',
					border: '1px solid #c3e6cb',
					borderRadius: '4px',
					color: '#155724',
				}}
			>
				<h2>{__('Thank you for your response!', 'fair-audience')}</h2>
				<p>
					{__(
						'Your response has been recorded successfully.',
						'fair-audience'
					)}
				</p>
			</div>
		);
	}

	if (!poll) {
		return null;
	}

	return (
		<div className="poll-response-container">
			{participantName && (
				<p style={{ marginBottom: '20px' }}>
					{__('Hi', 'fair-audience')} {participantName}!
				</p>
			)}

			<h2 style={{ marginBottom: '20px' }}>{poll.question}</h2>

			<div style={{ marginBottom: '20px' }}>
				{poll.options.map((option) => (
					<div
						key={option.id}
						className={`poll-response-option ${
							selectedOptions.includes(option.id)
								? 'selected'
								: ''
						}`}
						onClick={() => handleOptionToggle(option.id)}
						role="button"
						tabIndex={0}
						onKeyDown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								handleOptionToggle(option.id);
							}
						}}
					>
						<CheckboxControl
							label={option.text}
							checked={selectedOptions.includes(option.id)}
							onChange={() => {
								/* Handled by parent div onClick */
							}}
						/>
					</div>
				))}
			</div>

			<Button isPrimary onClick={handleSubmit} disabled={isSubmitting}>
				{isSubmitting
					? __('Submitting...', 'fair-audience')
					: __('Submit Response', 'fair-audience')}
			</Button>

			{error && (
				<div
					style={{
						marginTop: '20px',
						padding: '10px',
						backgroundColor: '#f8d7da',
						border: '1px solid #f5c6cb',
						borderRadius: '4px',
						color: '#721c24',
					}}
				>
					{error}
				</div>
			)}
		</div>
	);
}
